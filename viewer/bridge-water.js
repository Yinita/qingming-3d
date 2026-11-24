import * as THREE from "three";

import { canalDepth, canalBankGLSL, canalHalfLength as halfLength, canalSpeed as flowSpeed, waterHeight } from "./bridge-canal-bed.js";

import { buildWaterContacts } from "./bridge-canal-contacts.js";
import { buildCanalLeaves } from "./bridge-canal-leaves.js";
import { createWaterField, surfaceGLSL, waterStateGLSL } from "./bridge-water-field.js";
import { createShallowWater } from "./bridge-shallow-water.js";

const worldToUV = new THREE.Matrix4().set(
  .5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1
);

const vertexShader = `
  uniform mat4 reflectionUV;
  ${surfaceGLSL}
  varying vec3 worldPoint;
  varying vec4 reflected;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y+=surfaceOffset(world.xz);
    worldPoint = world.xyz;
    reflected = reflectionUV * world;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = `
  uniform float time;
  uniform float current;
  uniform float reflectionReady;
  uniform vec2 origin;
  uniform sampler2D reflection;
  uniform sampler2D refractionColor;
  uniform sampler2D refractionDepth;
  uniform mat4 refractionViewToWorld;
  uniform mat4 refractionProjectionInverse;
  uniform vec2 drawingSize;
  uniform float refractionReady;
  ${canalBankGLSL}
  uniform vec2 piers[PIER_COUNT];
  ${waterStateGLSL}
  varying vec3 worldPoint;
  varying vec4 reflected;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * .1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
  }

  vec2 slope(vec2 p, vec2 direction, float frequency, float c, float amplitude) {
    vec2 k = direction * frequency;
    float footprint = length(fwidth(p) * k);
    return k * amplitude * cos(dot(k,p)-c*time) * (1.0-smoothstep(.65,2.6,footprint));
  }

  // Downstream shear and a broken V-shaped crest at an obstruction.
  vec2 pierWake(vec2 p, vec2 pier) {
    vec2 d = p - pier;
    float spread = abs(d.x + .07*sin(d.y*2.7-time*.76));
    float envelope = smoothstep(-.12,.33,d.y) * (1.0-smoothstep(.45,2.8,d.y));
    float band = exp(-pow((spread - .15 - .29*max(0.0,d.y)) * 6.6,2.0));
    float pulse = .5 + .5*sin(17.0*d.y - time*4.5 + spread*4.0);
    float pressure = exp(-pow(length(d * vec2(1.7,1.0))/.37,2.0));
    return vec2(envelope*band*pulse + .52*pressure, envelope*band + pressure);
  }

  void main() {
    vec2 p = worldPoint.xz - origin;
    float bank = canalBank(p);
    float shore = bank - abs(p.x);
    float feather = smoothstep(-.12,.89,shore) * (1.0-smoothstep(13.6,16.2,abs(p.y)));
    if (feather < .004) discard;

    float channel = smoothstep(.0,3.2,shore);
    vec2 flow = p - vec2(0,time*current*mix(.43,1.0,channel));
    float eddies = noise(flow*vec2(.56,.27));
    vec2 q = flow + vec2(.92*noise(flow*vec2(.30,.76)), 1.52*eddies);
    float gust = noise(q*vec2(.78,.45));
    vec2 grad = slope(q, vec2(.30,.954), 5.1, 1.20, .010 + gust*.004)
              + slope(q, vec2(-.66,.751), 8.9, 1.53, .004 + .007*gust)
              + slope(q, vec2(.85,.527), 15.5, 1.9, .0044)
              + slope(q, vec2(-.42,.907), 24.4, 2.1, .0017);
    vec2 wake = vec2(0.0);
    if (p.y > .40 && p.y < 5.78) {
      for (int i=0; i<PIER_COUNT; ++i) {
        vec2 d = p - piers[i];
        if (abs(d.x)<1.31 && d.y>-.37 && d.y<2.9) wake += pierWake(p,piers[i]);
      }
    }
    vec4 disturbance=sampleWaterState(worldPoint.xz);
    float foamGrain=noise(q*vec2(15.7,10.3)+vec2(0.,-time*.84));
    float crestFoam=smoothstep(.068,.39,disturbance.b);
    float lingeringFoam=crestFoam*mix(.38,1.,smoothstep(.19,.73,foamGrain));
    grad+=disturbance.a*.045*vec2(cos(p.y*13.6-p.x*6.1-time*2.3),sin(p.x*16.7+time*2.7));
    grad *= mix(.72,1.03,channel)*(.87+.19*gust);
    grad += .13*wake.y*vec2(sin(22.0*p.x-time*3.5), cos(13.0*p.y-time*4.9));
    vec3 geometryNormal=normalize(cross(dFdx(worldPoint),dFdy(worldPoint)));
    grad-=geometryNormal.xz/max(.36,abs(geometryNormal.y))*.82*sign(geometryNormal.y);
    vec3 n = normalize(vec3(-grad.x,1.0,-grad.y));
    vec3 eye = normalize(cameraPosition-worldPoint);
    float f = pow(1.0-clamp(dot(n,eye),0.0,1.0),4.0);

    float sediment = noise(q*vec2(.88,.39))*.73 + noise(q*1.7)*.27;
    vec3 shallow = mix(vec3(.198,.176,.111),vec3(.336,.295,.175),sediment);
    vec3 deep = mix(vec3(.088,.135,.094),vec3(.148,.204,.127),sediment);
    vec3 body = mix(shallow,deep,channel);
    // Soft contacts remain legible when the pier or reflection is in shadow.
    body *= 1.0-.23*clamp(wake.y,0.0,1.0);

    vec2 uv = reflected.xy / reflected.w;
    vec2 distorted = uv + grad*vec2(.085,.074)*mix(.7,1.0,channel);
    float border = smoothstep(0.005,.065,min(min(distorted.x,distorted.y),min(1.0-distorted.x,1.0-distorted.y)));
    vec3 reflectedLight = texture2D(reflection,clamp(distorted,.002,.998)).rgb;
    vec3 sky = vec3(.51,.53,.37);
    vec3 surface = mix(sky,reflectedLight*vec3(.86,.89,.73),reflectionReady*border*.88);
    if (refractionReady>.5 && f<.985) {
      vec2 screen = gl_FragCoord.xy/drawingSize;
      vec2 sampleUV = clamp(screen + grad*.013*mix(.42,1.,channel),.002,.998);
      float sceneDepth = texture2D(refractionDepth,sampleUV).r;
      if (sceneDepth<.9995) {
        vec4 clipPoint=vec4(sampleUV*2.0-1.0,sceneDepth*2.0-1.0,1.0);
        vec4 refractedWorld=refractionViewToWorld*refractionProjectionInverse*clipPoint;
        vec3 bed=refractedWorld.xyz/refractedWorld.w;
        float thickness=min(3.8,length(bed-worldPoint));
        vec3 transmit=exp(-vec3(1.19,.80,1.57)*thickness);
        vec3 bottom=texture2D(refractionColor,sampleUV).rgb;
        body=mix(body,bottom,transmit*.77);
      }
    }
    vec3 color = mix(body,surface,.10+f*.74);

    vec3 sun = normalize(vec3(-.42,.82,-.33));
    float highlight = pow(max(dot(n,normalize(sun+eye)),0.0),62.0);
    float streak = noise(q*vec2(2.3,6.1));
    float filaments = smoothstep(.70,.91,streak) * (.50+.50*eddies);
    float strand = noise(vec2(shore*5.6,flow.y*3.2));
    float bankCrest = exp(-pow((shore-.61)*2.87,2.0)) * smoothstep(.57,.87,strand);
    float pearl = (smoothstep(.22,.73,wake.x)*smoothstep(.32,.86,streak) + .19*bankCrest + lingeringFoam*.67)
                 * (1.0-smoothstep(.13,.43,fwidth(p.y)));
    color += vec3(.46,.44,.30)*(highlight*.29 + filaments*.12 + pearl*.58);

    float distanceHaze = smoothstep(13.0,44.0,distance(cameraPosition,worldPoint));
    gl_FragColor = vec4(mix(color,vec3(.61,.57,.46),distanceHaze*.32),feather);
    #include <colorspace_fragment>
  }
`;

export function buildCanal(parent, origin, piers, hull, hullMotion) {
  const target = new THREE.WebGLRenderTarget(768, 432, { depthBuffer: true });
  target.texture.name = "Canal reflection";
  const refraction = new THREE.WebGLRenderTarget(768,432);
  refraction.texture.name = "Canal refraction color";
  refraction.depthTexture = new THREE.DepthTexture(768,432,THREE.UnsignedIntType);
  const refractedCamera = new THREE.PerspectiveCamera();
  refractedCamera.layers.set(1);
  const contacts=buildWaterContacts(parent);
  const simulation=createShallowWater({
    minX:origin.x-9.7,minZ:origin.y-halfLength,width:19.4,length:halfLength*2,
    depthAt:(x,z)=>canalDepth(origin,x,z),piers,current:flowSpeed,
  });
  const surfaceState=new THREE.DataTexture(simulation.pack(),simulation.columns,simulation.rows,THREE.RGBAFormat);
  surfaceState.name="Canal height and foam";
  surfaceState.minFilter=surfaceState.magFilter=THREE.LinearFilter;
  surfaceState.needsUpdate=true;
  const field=createWaterField(origin,simulation);
  contacts.followSurface(field.height);
  function hit(x,z,time,strength,kind,vx,vz) {
    contacts.hit(x,z,time,strength,kind,vx,vz);
    simulation.impact(x,z,strength,kind,vx,vz);
  }
  const uniforms = {
    time: { value: 0 }, current: { value: flowSpeed }, origin: { value: origin },
    reflection: { value: target.texture }, reflectionUV: { value: new THREE.Matrix4() },
    reflectionReady: { value: 0 },
    refractionReady: { value: 0 }, refractionColor: { value: refraction.texture },
    refractionDepth: { value: refraction.depthTexture }, drawingSize: { value: new THREE.Vector2() },
    refractionViewToWorld: { value: refractedCamera.matrixWorld },
    refractionProjectionInverse: { value: refractedCamera.projectionMatrixInverse },
    piers: { value: piers.map(point => point.clone().sub(origin)) },
    waterState:{ value:surfaceState }, simulationHeight:{ value:simulation.maximumHeight },
    simulationBounds:{ value:new THREE.Vector4(simulation.minX,simulation.minZ,1/simulation.width,1/simulation.length) },
  };
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms,
    defines: { PIER_COUNT: piers.length },
    transparent: true, depthWrite: false });
  const river = new THREE.Mesh(new THREE.PlaneGeometry(19.4,halfLength*2,160,216), material);
  river.name = "Canal surface";
  river.rotation.x = -Math.PI / 2;
  river.position.set(origin.x, waterHeight, origin.y);
  parent.add(river);

  const leaves=buildCanalLeaves(parent,origin,hit,hull,field);

  const mirror = new THREE.PerspectiveCamera();
  const direction = new THREE.Vector3(), focus = new THREE.Vector3();
  const clip = new THREE.Plane(), clipVector = new THREE.Vector4(), corner = new THREE.Vector4();
  const frustum = new THREE.Frustum(), projectionView = new THREE.Matrix4();
  const bounds = new THREE.Box3(
    new THREE.Vector3(origin.x - 9.7, waterHeight - .4, origin.y - halfLength),
    new THREE.Vector3(origin.x + 9.7, waterHeight + .4, origin.y + halfLength)
  );
  const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lastRotation = new THREE.Quaternion();
  let reflectionPasses = 0;
  let lastTime = -1;
  let lastReflectionTime = -1;
  let refractionPasses = 0;

  function clipAtSurface(virtualCamera, face) {
    clip.normal.set(0,face,0);
    clip.constant = -face*waterHeight + .002;
    clip.applyMatrix4(virtualCamera.matrixWorldInverse);
    clipVector.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
    const proj = virtualCamera.projectionMatrix.elements;
    corner.set((Math.sign(clipVector.x)+proj[8])/proj[0],
               (Math.sign(clipVector.y)+proj[9])/proj[5],-1,(1+proj[10])/proj[14]);
    clipVector.multiplyScalar(2/clipVector.dot(corner));
    proj[2]=clipVector.x;
    proj[6]=clipVector.y;
    proj[10]=clipVector.z+1-.001;
    proj[14]=clipVector.w;
    virtualCamera.projectionMatrixInverse.copy(virtualCamera.projectionMatrix).invert();
  }
  function prepare(renderer, scene, camera) {
    if (camera.position.y <= waterHeight + .025) return;
    const size = renderer.getDrawingBufferSize(uniforms.drawingSize.value);
    camera.updateMatrixWorld();
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projectionView);
    if (!frustum.intersectsBox(bounds)) return;
    const moved=lastCamera.distanceToSquared(camera.position)>.013;
    const turned=lastRotation.angleTo(camera.quaternion)>.026;
    const refreshInterval=moved ? .027 : .047;
    const reflect=lastTime<0 || turned || uniforms.time.value-lastTime>=refreshInterval;
    // Keep the transmitted silhouette in phase with moving boots or a sinking object.
    const refract=reflect || camera.position.y-waterHeight<2.0;
    if (!reflect && !refract) return;

    if (reflect) {
      lastCamera.copy(camera.position);
      lastRotation.copy(camera.quaternion);
      lastTime=uniforms.time.value;
      const width=Math.min(960,Math.max(320,Math.round(size.x*.25)));
      const height=Math.min(640,Math.max(180,Math.round(width*size.y/size.x)));
      if (target.width!==width || target.height!==height) target.setSize(width,height);
      camera.getWorldDirection(direction);
      mirror.position.copy(camera.position);
      mirror.position.y=2*waterHeight-mirror.position.y;
      direction.y*=-1;
      mirror.up.set(0,-1,0);
      mirror.lookAt(focus.copy(mirror.position).add(direction));
      mirror.updateMatrixWorld();
      mirror.layers.mask=camera.layers.mask;
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      uniforms.reflectionUV.value.copy(worldToUV).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
      clipAtSurface(mirror,1);
    }

    if (refract) {
      const width=Math.min(1152,Math.max(480,Math.round(size.x*.3)));
      const height=Math.min(720,Math.max(270,Math.round(width*size.y/size.x)));
      if (refraction.width!==width || refraction.height!==height) refraction.setSize(width,height);
      refractedCamera.position.copy(camera.position);
      refractedCamera.quaternion.copy(camera.quaternion);
      refractedCamera.updateMatrixWorld();
      refractedCamera.projectionMatrix.copy(camera.projectionMatrix);
      clipAtSurface(refractedCamera,-1);
    }

    const oldTarget=renderer.getRenderTarget();
    const shadowUpdate=renderer.shadowMap.autoUpdate;
    const xr=renderer.xr.enabled;
    try {
      river.visible=false;
      leaves.mesh.visible=false;
      contacts.group.visible=false;
      renderer.xr.enabled=false;
      renderer.shadowMap.autoUpdate=false;
      if (reflect) {
        renderer.setRenderTarget(target);
        renderer.render(scene,mirror);
        reflectionPasses++;
        lastReflectionTime=uniforms.time.value;
        uniforms.reflectionReady.value=1;
      }
      if (refract) {
        renderer.setRenderTarget(refraction);
        renderer.render(scene,refractedCamera);
        refractionPasses++;
        uniforms.refractionReady.value=1;
      }
    } finally {
      renderer.setRenderTarget(oldTarget);
      renderer.shadowMap.autoUpdate=shadowUpdate;
      renderer.xr.enabled=xr;
      river.visible=true;
      leaves.mesh.visible=true;
      contacts.group.visible=true;
    }
  }
  return {
    prepare,
    frame(time,dt) {
      uniforms.time.value=time;
      simulation.advance(dt,hull,hullMotion);
      leaves.frame(time,dt);
      simulation.pack();
      surfaceState.needsUpdate=true;
      contacts.frame(time);
    },
    hit,
    probe:simulation.sample,
    field,
    leafSource: leaves.source,
    inspect() { return { time: uniforms.time.value, currentMetresPerSecond: flowSpeed,
      reflectionPasses, refractionPasses, contacts: contacts.inspect(uniforms.time.value), lastReflectionTime, visiblePiers: piers.length, driftingLeaves: leaves.seededLeaves, foliage:leaves.inspect(), reflectionSize: [target.width, target.height],
      refractionSize:[refraction.width,refraction.height], simulation:simulation.inspect() }; },
  };
}
