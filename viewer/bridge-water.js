import * as THREE from "three";

import { canalDepth, canalBankGLSL, canalBathymetryGLSL, canalHalfLength as halfLength, canalSpeed as flowSpeed, waterHeight } from "./bridge-canal-bed.js";

import { buildWaterContacts } from "./bridge-canal-contacts.js";
import { buildCanalLeaves, canalLeafCapacity } from "./bridge-canal-leaves.js";
import { createLeafWater, leafSlopeGLSL } from "./bridge-leaf-water.js";
import { capillaryGLSL, createWaterField, surfaceGLSL, waterStateGLSL } from "./bridge-water-field.js";
import { createShallowWater } from "./bridge-shallow-water.js";
import { createCanalCaustics } from "./bridge-caustics.js";
import { createFoamTransport, foamDensityGLSL } from "./bridge-foam.js";
import { createSiltTransport, murkGLSL } from "./bridge-silt.js";
import { createCanalBubbles } from "./bridge-canal-bubbles.js";
import { airUniforms } from "./bridge-air.js";
import { buildCanalBreakers } from "./bridge-canal-breakers.js";
import { buildCanalSwash } from "./bridge-canal-swash.js";
import { bankReachGLSL, breakerSurfaceGLSL, refinedCanalGeometry } from "./bridge-breaker-surface.js";
import { rainRippleGLSL } from "./bridge-rain-ripples.js";
import { reflectionFootprintGLSL } from "./bridge-reflection.js";

const worldToUV = new THREE.Matrix4().set(
  .5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1
);

const vertexShader = `
  uniform mat4 reflectionUV;
  ${surfaceGLSL}
  varying vec3 worldPoint;
  varying vec4 reflected;
  varying vec2 surfaceGradient;
  #ifdef COHERENT_BREAKERS
    ${canalBathymetryGLSL}
    ${breakerSurfaceGLSL}
    varying vec3 shapeNormal;
    varying vec3 waveOptics;
  #endif

  void main() {
    vec4 world = modelMatrix * vec4(position,1.);
    #ifdef COHERENT_BREAKERS
      const float d=.022;
      vec2 base=world.xz;
      float row=(base.y-breakingBounds.x)*breakingBounds.y;
      if(base.x<origin.x-5.42 && row>-.10 && row<1.10) {
        vec3 ignore;
        float flatY=world.y;
        world.xyz=coherentWaterPoint(base,flatY,waveOptics);
        vec3 a=coherentWaterPoint(base+vec2(d,0.),flatY,ignore)-
               coherentWaterPoint(base-vec2(d,0.),flatY,ignore);
        vec3 b=coherentWaterPoint(base+vec2(0.,d),flatY,ignore)-
               coherentWaterPoint(base-vec2(0.,d),flatY,ignore);
        shapeNormal=normalize(cross(b,a));
        surfaceGradient=vec2(a.y,b.y)/(2.*d);
      } else {
        world.y+=surfaceOffset(world.xz);
        surfaceGradient=vec2(surfaceOffset(world.xz+vec2(d,0.))-surfaceOffset(world.xz-vec2(d,0.)),
          surfaceOffset(world.xz+vec2(0.,d))-surfaceOffset(world.xz-vec2(0.,d)))/(2.*d);
        shapeNormal=normalize(vec3(-surfaceGradient.x,1.,-surfaceGradient.y));
        waveOptics=vec3(0.);
      }
    #else
      const float d=.09;
      world.y+=surfaceOffset(world.xz);
      surfaceGradient=vec2(surfaceOffset(world.xz+vec2(d,0.))-surfaceOffset(world.xz-vec2(d,0.)),
        surfaceOffset(world.xz+vec2(0.,d))-surfaceOffset(world.xz-vec2(0.,d)))/(2.*d);
    #endif
    worldPoint=world.xyz;
    reflected=reflectionUV*world;
    gl_Position=projectionMatrix*viewMatrix*world;
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
  uniform sampler2D bubbleLayer;
  uniform sampler2D bubbleDepth;
  uniform float bubblesReady;
  uniform float bubbleStrength;
  uniform mat4 refractionViewToWorld;
  uniform mat4 refractionProjectionInverse;
  uniform vec2 drawingSize;
  uniform float refractionReady;
  uniform float shorelineOptics;
  ${reflectionFootprintGLSL}
  ${canalBankGLSL}
  ${canalBathymetryGLSL}
  uniform sampler2D channelFlow;
  uniform sampler2D advectedFoam;
  uniform float foamDetail;
  ${waterStateGLSL}
  ${capillaryGLSL}
  ${foamDensityGLSL}
  ${leafSlopeGLSL}
  ${murkGLSL}
  #ifdef RAIN_SURFACE
    uniform float rainIntensity;
    uniform float runoffOptics;
    ${rainRippleGLSL}
  #endif
  varying vec3 worldPoint;
  varying vec4 reflected;
  varying vec2 surfaceGradient;
  #ifdef COHERENT_BREAKERS
    ${bankReachGLSL}
    varying vec3 shapeNormal;
    varying vec3 waveOptics;
  #endif

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

  vec3 worldAt(vec2 screen,float depth) {
    vec4 point=refractionViewToWorld*refractionProjectionInverse*vec4(screen*2.-1.,depth*2.-1.,1.);
    return point.xyz/point.w;
  }

  void main() {
    vec2 p = worldPoint.xz - origin;
    float bank = canalBank(p);
    float shore = bank - abs(p.x);
    float column=worldPoint.y-canalBedElevation(p);
    float feather=smoothstep(-.56,-.27,shore)*smoothstep(.001,.038,column)*
      (1.-smoothstep(13.6,16.2,abs(p.y)));
    #ifdef COHERENT_BREAKERS
      float reach=bankReach(worldPoint.xz,shore);
      float front=shore+reach;
      float edgeLace=.010*(.5+.5*sin(worldPoint.z*58.-time*4.6));
      float running=smoothstep(.018,.069,reach)*smoothstep(edgeLace,.065+edgeLace,front);
      feather=max(feather,running*(1.-smoothstep(.09,.19,shore))*smoothstep(.001,.008,column)*.80);
    #endif
    float channel = smoothstep(.0,3.2,shore);
    float thin=shorelineOptics*(1.-smoothstep(.023,.16,column))*smoothstep(.003,.017,column);
    float channelCut=thin>.001 ? thin*shelfGroove(shore,p.y,sign(p.x)) : 0.;
    vec2 flow = p - vec2(0,time*current*mix(.43,1.0,channel));
    float eddies = noise(flow*vec2(.56,.27));
    vec2 q = flow + vec2(.92*noise(flow*vec2(.30,.76)), 1.52*eddies);
    float gust = noise(q*vec2(.78,.45));
    vec3 airflow=canalAirFlow(worldPoint.xz,windTime-.20,.10);
    float airSpeed=length(airflow.xy);
    float steepness=.39+.71*smoothstep(.32,5.08,airSpeed)+min(.16,airflow.z*.22);
    vec2 grad = slope(q, vec2(.30,.954), 5.1, 1.20, .010 + gust*.004)
              + steepness*(slope(q, vec2(-.66,.751), 8.9, 1.53, .004 + .007*gust)
              + slope(q, vec2(.85,.527), 15.5, 1.9, .0044)
              + slope(q, vec2(-.42,.907), 24.4, 2.1, .0017));
    vec2 stateUV=clamp((worldPoint.xz-simulationBounds.xy)*simulationBounds.zw,0.,1.);
    vec4 channelState=texture2D(channelFlow,stateUV);
    float entrainment=channelState.b;
    #ifdef RAIN_SURFACE
      float bankSediment=0.;
      if(channelState.a>.009 && runoffOptics>.001) {
        float runoffStreak=.69+.31*noise(q*vec2(12.0,3.7));
        bankSediment=runoffOptics*smoothstep(.009,.25,channelState.a*runoffStreak);
      }
    #endif
    vec4 disturbance=sampleWaterState(worldPoint.xz);
    float crests=smoothstep(.095,.69,disturbance.b);
    float shadeContact=smoothstep(.035,.67,entrainment);
    float filterWidth=length(fwidth(worldPoint.xz));
    float density=foamDensity(texture2D(advectedFoam,stateUV).rg);
    float pores=noise(p*52.0+vec2(time*.3,-time*.9));
    float granules=mix(pores,.55,smoothstep(.009,.045,filterWidth));
    float floc=smoothstep(.048,.37,density*(.52+.68*granules));
    float crestPatch=smoothstep(.49,.78,noise(q*vec2(16.7,13.2)));
    float foam=(crests*(.08+.12*crestPatch)+.58*floc*foamDetail)*smoothstep(.024,.098,column);
    foam*=1.-smoothstep(.095,.30,filterWidth);
    grad+=disturbance.a*.045*vec2(cos(p.y*13.6-p.x*6.1-time*2.3),sin(p.x*16.7+time*2.7));
    float fineFade=1.-smoothstep(.033,.14,length(fwidth(worldPoint.xz)));
    grad+=capillaryFromAir(worldPoint.xz,airflow).yz*mix(.52,.21,channel)*fineFade;
    grad*=1.-.45*thin;
    vec2 leafSlope=leafWaterSlope(worldPoint.xz)*(1.-smoothstep(.010,.050,filterWidth))*
      smoothstep(.001,.009,column);
    grad+=leafSlope;
    #ifdef RAIN_SURFACE
      vec2 rainSlope=rainRipple(worldPoint.xz)*smoothstep(.007,.029,column)*fineFade;
      grad+=rainSlope;
    #endif
    grad *= mix(.72,1.03,channel)*(.87+.19*gust);
    grad += .072*shadeContact*vec2(sin(22.0*p.x-time*3.5), cos(13.0*p.y-time*4.9));
    vec3 eye = normalize(cameraPosition-worldPoint);
    #ifdef COHERENT_BREAKERS
      vec3 unperturbed=normalize(shapeNormal);
      vec3 n=normalize(unperturbed+vec3(-grad.x,0.,-grad.y)*(.87-.35*waveOptics.y));
      n=faceforward(n,-eye,n);
      float folded=clamp(waveOptics.y*1.45,0.,1.);
      float airFolds=folded*smoothstep(.25,.85,1.-abs(n.y));
      grad=clamp(-n.xz/max(.37,abs(n.y)),-1.44,1.44);
      float cell=mix(.55,noise(q*vec2(38.9,45.1)),1.-smoothstep(.016,.041,filterWidth));
      float foldingFoam=smoothstep(.20,.78,waveOptics.x*(.68+.62*cell));
      foam=1.-(1.-foam)*(1.-foldingFoam*.72);
    #else
      grad+=surfaceGradient*.82;
      vec3 n = normalize(vec3(-grad.x,1.0,-grad.y));
    #endif
    float f = pow(1.0-clamp(dot(n,eye),0.0,1.0),4.0);

    float sediment = noise(q*vec2(.88,.39))*.73 + noise(q*1.7)*.27;
    vec3 shallow = mix(vec3(.198,.176,.111),vec3(.336,.295,.175),sediment);
    vec3 deep = mix(vec3(.088,.135,.094),vec3(.148,.204,.127),sediment);
    vec3 body = mix(shallow,deep,channel);
    // Soft contacts remain legible when the pier or reflection is in shadow.
    body *= 1.0-.16*shadeContact;

    vec2 uv = reflected.xy / reflected.w;
    vec2 distorted = uv + grad*vec2(.085,.074)*mix(.7,1.0,channel)*mirrorOverscan;
    float border = reflectionDetail>.5 ? reflectionBorder(distorted,.044) :
      smoothstep(.005,.065,min(min(distorted.x,distorted.y),min(1.-distorted.x,1.-distorted.y)));
    vec2 footprintX=dFdx(distorted), footprintY=dFdy(distorted);
    if(feather<.004) discard;
    float scatter=.29+.46*steepness+.48*foam;
    #ifdef RAIN_SURFACE
      scatter+=.31*rainIntensity+.34*smoothstep(.01,.09,length(rainSlope));
    #endif
    #ifdef COHERENT_BREAKERS
      float reflectionSpread=.12+.91*airFolds+.55*waveOptics.z+.63*foldingFoam+.42*steepness;
      scatter+=1.60*airFolds+.76*waveOptics.z+.96*foldingFoam;
    #else
      float reflectionSpread=0.;
    #endif
    vec3 reflectedLight;
    if(reflectionDetail>.5) {
      reflectedLight=filteredMirror(reflection,distorted,footprintX,footprintY,scatter);
    } else {
      reflectedLight=texture2D(reflection,clamp(distorted,.002,.998),reflectionSpread).rgb;
    }
    vec3 sky = vec3(.51,.53,.37);
    #ifdef RAIN_SURFACE
      sky=mix(sky,vec3(.35,.43,.40),rainIntensity*.72);
    #endif
    vec3 surface = mix(sky,reflectedLight*vec3(.86,.89,.73),reflectionReady*border*.88);
    if (refractionReady>.5 && f<.985) {
      vec2 screen = gl_FragCoord.xy/drawingSize;
      vec2 deflection=grad*.013*mix(.42,1.,channel);
      #ifdef COHERENT_BREAKERS
        vec3 through=refract(-eye,n,1./1.333);
        vec2 foldedRefraction=(mat3(viewMatrix)*(through+eye)).xy*.023;
        deflection=mix(deflection,foldedRefraction,folded);
      #endif
      vec2 sampleUV=clamp(screen+deflection,.002,.998);
      float sceneDepth = texture2D(refractionDepth,sampleUV).r;
      if (sceneDepth<.9995) {
        vec3 bed=worldAt(sampleUV,sceneDepth);
        float thickness=min(3.8,length(bed-worldPoint));
        #ifdef COHERENT_BREAKERS
          thickness=mix(thickness,min(thickness,.14+.17*abs(n.y)),airFolds);
        #endif
        vec3 extinction=vec3(1.19,.80,1.57);
        #ifdef RAIN_SURFACE
          extinction+=vec3(.26,.52,.83)*bankSediment;
        #endif
        vec3 transmit=exp(-extinction*thickness);
        vec3 bottom=texture2D(refractionColor,sampleUV).rgb;
        body=mix(body,bottom,transmit*.77);
        if(murkStrength>.001 && bed.y<worldPoint.y+.022) body=transmitSediment(body,worldPoint,bed,thickness);
      }
      if(bubblesReady>.5 && bubbleStrength>.001) {
        vec4 air=texture2D(bubbleLayer,sampleUV);
        if(air.a>.025) {
          float depth=texture2D(bubbleDepth,sampleUV).r;
          vec3 bubble=worldAt(sampleUV,depth);
          float path=min(3.8,length(bubble-worldPoint));
          vec3 transmit=exp(-vec3(1.19,.80,1.57)*path);
          vec3 lens=air.rgb/air.a;
          if(murkStrength>.001) lens=transmitSediment(lens,worldPoint,bubble,path);
          body=mix(body,lens,transmit*air.a*.82*bubbleStrength);
        }
      }
    }
    #ifdef RAIN_SURFACE
      body=mix(body,vec3(.252,.191,.103),bankSediment*.54*smoothstep(.016,.10,column));
    #endif
    float fresnel=.10+f*.74;
    vec3 color = mix(body,surface,fresnel+thin*.16*(1.-fresnel));
    float meniscus=exp(-pow((column-.012)/.009,2.))*thin;
    color+=vec3(.031,.039,.035)*fineFade*(meniscus+channelCut*.56);
    vec2 leafLight=normalize(vec2(-.44,-.36)+eye.xz*.50);
    float leafGlint=dot(leafSlope,leafLight);
    float leafGleam=smoothstep(.009,.085,leafGlint)*(.42+.58*sqrt(f));
    float leafShade=smoothstep(.011,.11,-leafGlint);
    color=color*(1.-leafShade*.068)+mix(sky*.73,reflectedLight,.51)*leafGleam*.245;

    vec3 sun = normalize(vec3(-.42,.82,-.33));
    float highlight = pow(max(dot(n,normalize(sun+eye)),0.0),62.0);
    float streak = noise(q*vec2(2.3,6.1));
    float filaments = smoothstep(.70,.91,streak) * (.50+.50*eddies);
    float strand = noise(vec2(shore*5.6,flow.y*3.2));
    float bankCrest = exp(-pow((shore-.61)*2.87,2.0)) * smoothstep(.57,.87,strand);
    float pearl = .13*bankCrest * (1.0-smoothstep(.13,.43,fwidth(p.y)));
    color += vec3(.46,.44,.30)*(highlight*.29 + filaments*.12 + pearl*.58);
    #ifdef RAIN_SURFACE
      float edgeLinger=smoothstep(.010,.079,length(rainSlope));
      float rainSkyLobe=.26+.74*max(0.,dot(n,normalize(vec3(-.12,1.,.46)+eye)));
      color+=vec3(.143,.161,.151)*edgeLinger*rainSkyLobe*(.32+.68*sqrt(f));
    #endif
    vec3 aerated=mix(vec3(.53,.51,.39),vec3(.82,.78,.63),.37+.44*f);
    color=mix(color,aerated,min(.88,foam));

    float distanceHaze = smoothstep(13.0,44.0,distance(cameraPosition,worldPoint));
    gl_FragColor = vec4(mix(color,vec3(.61,.57,.46),distanceHaze*.32),feather);
    #include <colorspace_fragment>
  }
`;

function coatShoreRocks(material,uniforms,swash) {
  const compile=material.onBeforeCompile, key=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    compile.call(material,shader);
    for(const name of ["origin","time","waterState","simulationBounds","simulationHeight","shorelineOptics"])
      shader.uniforms[name]=uniforms[name];
    if(swash) Object.assign(shader.uniforms,swash.wetting);
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 rockPoint;")
      .replace("#include <begin_vertex>",`#include <begin_vertex>
        rockPoint=(modelMatrix*vec4(transformed,1.)).xyz;`);
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        varying vec3 rockPoint;
        uniform float shorelineOptics;
        ${surfaceGLSL}
        ${swash ? "uniform sampler2D bankWash; uniform vec2 bankWashBounds; uniform float bankWashRange;" : ""}
        `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec2 rockLocal=rockPoint.xz-origin;
        float shore=canalBank(rockLocal)-abs(rockLocal.x);
        float line=${waterHeight.toFixed(3)}+surfaceOffset(rockPoint.xz)-rockPoint.y;
        float splashMark=smoothstep(-.10,.006,line)*smoothstep(-.37,.17,shore);
        ${swash ? `
        float washU=(rockPoint.z-bankWashBounds.x)*bankWashBounds.y;
        if(rockLocal.x<0. && washU>0. && washU<1.) {
          float reach=texture2D(bankWash,vec2(washU,.5)).r*bankWashRange;
          splashMark=max(splashMark,smoothstep(.025,.20,reach)*smoothstep(-reach,-reach+.055,shore)
            *(1.-smoothstep(.057,.22,rockPoint.y)));
        }` : ""}
        float slick=splashMark*shorelineOptics*(1.-smoothstep(13.2,16.2,abs(rockLocal.y)));
        diffuseColor.rgb*=mix(vec3(1.),vec3(.56,.62,.58),slick*.91);
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.27,slick*.76);`);
  };
  material.customProgramCacheKey=()=>key+"-waterline-stones";
}

export function buildCanal(parent, origin, piers, skiff, swell, groundAt, gust, shore) {
  const {wake:hull,motion:hullMotion,waterline}=skiff;
  const target = new THREE.WebGLRenderTarget(768, 432, { depthBuffer: true });
  target.texture.name = "Canal reflection";
  const refraction = new THREE.WebGLRenderTarget(768,432);
  refraction.texture.name = "Canal refraction color";
  refraction.depthTexture = new THREE.DepthTexture(768,432,THREE.UnsignedIntType);
  const refractedCamera = new THREE.PerspectiveCamera();
  refractedCamera.layers.set(1);
  const depthAt=(x,z)=>canalDepth(origin,x,z);
  const fluidDepth=(x,z)=>Math.max(0,Math.min(depthAt(x,z),waterHeight-shore.rockTop(x,z)));
  const sourceZ=origin.y-4.6;
  const waveMaker=swell ? {x:origin.x-3.8,z:sourceZ,span:6.4,period:1.68,amplitude:.136} : null;
  const simulation=createShallowWater({
    minX:origin.x-9.7,minZ:origin.y-halfLength,width:19.4,length:halfLength*2,
    depthAt:fluidDepth,piers,current:flowSpeed,waveMaker,
  });
  const surfaceState=new THREE.DataTexture(simulation.pack(),simulation.columns,simulation.rows,THREE.RGBAFormat);
  surfaceState.name="Canal height and foam";
  surfaceState.minFilter=surfaceState.magFilter=THREE.LinearFilter;
  surfaceState.needsUpdate=true;
  const channelFlow=new THREE.DataTexture(simulation.flowTexture,simulation.columns,simulation.rows,THREE.RGBAFormat);
  channelFlow.name="Canal flow, foam source and runoff turbidity";
  channelFlow.minFilter=channelFlow.magFilter=THREE.LinearFilter;
  channelFlow.needsUpdate=true;
  const field=createWaterField(origin,simulation);
  let impactPending=false;
  function hit(x,z,time,strength,kind,vx,vz) {
    contacts.hit(x,z,time,strength,kind,vx,vz);
    simulation.impact(x,z,strength,kind,vx,vz);
    impactPending=true;
    if(kind!=="leaf") {
      const surface=field.height(x,z,time), depth=depthAt(x,z);
      const entry=Math.min(.22,depth*(kind==="step" ? .53 : .27));
      bubbles.burst(x,surface-entry,z,time,kind,strength,vx,vz);
      if(kind==="step") silt.disturb(x,z,time,"step",strength);
    }
  }
  const uniforms = {
    ...airUniforms,
    time: { value: 0 }, current: { value: flowSpeed }, origin: { value: origin },
    reflection: { value: target.texture }, reflectionUV: { value: new THREE.Matrix4() },
    reflectionReady: { value: 0 },
    reflectionDetail:{value:1}, mirrorRaster:{value:new THREE.Vector2(target.width,target.height)},
    mirrorOverscan:{value:1},
    refractionReady: { value: 0 }, refractionColor: { value: refraction.texture },
    refractionDepth: { value: refraction.depthTexture }, drawingSize: { value: new THREE.Vector2() },
    refractionViewToWorld: { value: refractedCamera.matrixWorld },
    refractionProjectionInverse: { value: refractedCamera.projectionMatrixInverse },
    channelFlow:{ value:channelFlow },
    shorelineOptics:{value:1},
    waterState:{ value:surfaceState }, simulationHeight:{ value:simulation.maximumHeight },
    simulationBounds:{ value:new THREE.Vector4(simulation.minX,simulation.minZ,1/simulation.width,1/simulation.length) },
  };
  const contacts=buildWaterContacts(parent,uniforms,field,depthAt,(x,z,strength,vx,vz)=>{
    simulation.impact(x,z,strength,"return",vx,vz);
    impactPending=true;
  });
  const silt=createSiltTransport(uniforms);
  Object.assign(uniforms,silt.uniforms);
  const bubbles=createCanalBubbles(uniforms,field,depthAt,(x,z,strength)=>{
    simulation.depositFoam(x,z,strength);
    impactPending=true;
  });
  Object.assign(uniforms,bubbles.uniforms);
  const swash=waveMaker && buildCanalSwash(origin,sourceZ,field,simulation.heightAt);
  coatShoreRocks(shore.material,uniforms,swash);
  const breakers=waveMaker && buildCanalBreakers(origin,sourceZ,field,depthAt,swash,{
    height:simulation.heightAt,
    foam(x,z,strength) {
      simulation.depositFoam(x,z,strength);
      impactPending=true;
    },
    drop:contacts.emitAtCrest,
    bubbles(x,y,z,time,strength) {
      bubbles.burst(x,Math.min(y-.2,field.height(x,z,time)-.09),z,time,"breaker",strength,-.80,.10);
    },
  });
  if (breakers) Object.assign(uniforms,breakers.uniforms,swash.wetting);
  const edgeHistory=waterline.map(()=>({gap:NaN,last:-Infinity}));
  const incoming=new THREE.Vector2();
  function slap(time,dt) {
    if(dt<=0) return;
    for(const [i,{point,normal}] of waterline.entries()) {
      const edge=edgeHistory[i];
      const x=point.x+normal.x*.15, z=point.z+normal.z*.15;
      const gap=point.y-field.height(x,z,time);
      const vertical=Number.isFinite(edge.gap) ? (edge.gap-gap)/dt : 0;
      edge.gap=gap;
      if(gap>.081 || gap<-.032 || time-edge.last<.19 || depthAt(x,z)<.15) continue;
      field.velocity(x,z,time,incoming);
      const lateral=hullMotion.x+hullMotion.z*(point.z-hull.y)-incoming.x;
      const along=hullMotion.y-hullMotion.z*(point.x-hull.x)-incoming.y;
      const pressure=lateral*normal.x+along*normal.z+.22*Math.max(0,vertical);
      if(pressure<.44) continue;
      const strength=.22+.47*THREE.MathUtils.smoothstep(pressure,.44,1.04);
      const speed=.58+pressure;
      edge.last=time;
      hit(x,z,time,strength,"boat",normal.x*speed,normal.z*speed);
    }
  }
  const surfaceFoam=createFoamTransport(uniforms);
  uniforms.advectedFoam=surfaceFoam.visibleFoam;
  uniforms.foamDetail={value:1};
  const caustics=createCanalCaustics(uniforms);
  uniforms.siltLighting=caustics.uniforms.causticMap;
  const leafContact=createLeafWater(canalLeafCapacity(gust));
  Object.assign(uniforms,leafContact.uniforms);
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms,
    defines:breakers ? {COHERENT_BREAKERS:1} : {},
    transparent:true,depthWrite:!!breakers,side:breakers ? THREE.DoubleSide : THREE.FrontSide,
    forceSinglePass:true });
  const geometry=breakers ? refinedCanalGeometry(halfLength) : new THREE.PlaneGeometry(19.4,halfLength*2,160,216);
  const river=new THREE.Mesh(geometry,material);
  river.name="Canal surface";
  if(!breakers) river.rotation.x=-Math.PI/2;
  river.position.set(origin.x, waterHeight, origin.y);
  parent.add(river);

  const leafField=breakers ? {...field,height:breakers.renderHeight} : field;
  const leaves=buildCanalLeaves(parent,origin,hit,hull,piers,leafField,groundAt,swash?.support,gust,leafContact);

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
  const lastProjection = new THREE.Matrix4();
  let reflectionPasses = 0;
  let lastReflectionTime = -1;
  let refractionPasses = 0;
  let lastRefractionTime=-1;
  let closeReflection=false;

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
  function prepare(renderer, scene, camera, wetSurfaces=false) {
    if (camera.position.y <= waterHeight + .025) return false;
    const size = renderer.getDrawingBufferSize(uniforms.drawingSize.value);
    camera.updateMatrixWorld();
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projectionView);
    const seesCanal=frustum.intersectsBox(bounds);
    if (!seesCanal && !wetSurfaces) return false;
    const detail=uniforms.reflectionDetail.value>.5 && renderer.capabilities.isWebGL2;
    const cameraHeight=camera.position.y-waterHeight;
    closeReflection=detail && seesCanal && cameraHeight<(closeReflection ? 3.25 : 2.75) &&
      bounds.distanceToPoint(camera.position)<(closeReflection ? 6.1 : 5.1);
    const streetDetail=detail && wetSurfaces && cameraHeight<2.8;
    const enhanced=detail && (seesCanal || streetDetail);
    const scale=closeReflection ? .50 : enhanced ? .335 : .25;
    const cap=closeReflection ? 1920 : enhanced ? 1280 : 960;
    const width=THREE.MathUtils.clamp(Math.round(size.x*scale),320,cap);
    const height=THREE.MathUtils.clamp(Math.round(width*size.y/size.x),180,closeReflection ? 1280 : 960);
    const samples=closeReflection ? Math.min(4,renderer.capabilities.maxSamples) : 0;
    const mipmaps=detail || !!swell;
    const resized=target.width!==width || target.height!==height;
    const rebuild=target.samples!==samples || target.texture.generateMipmaps!==mipmaps;
    const overscan=detail ? .92 : 1;
    const projectionChanged=!lastProjection.equals(camera.projectionMatrix);
    const shift=lastCamera.distanceToSquared(camera.position);
    const turn=lastRotation.angleTo(camera.quaternion);
    const turned=turn>.026;
    const trackView=closeReflection || (streetDetail && (shift>.000049 || turn>.0015));
    const refreshInterval=seesCanal ? (shift>.013 ? .027 : .047) : .079;
    const now=uniforms.time.value;
    if(seesCanal) leafContact.prepare(renderer,camera,now);
    const reflect=lastReflectionTime<0 || resized || rebuild || overscan!==uniforms.mirrorOverscan.value ||
      projectionChanged || turned || now-lastReflectionTime>=refreshInterval || (trackView && now>lastReflectionTime);
    // The transmitted silhouette keeps its own cadence when the mirror runs faster.
    const refract=seesCanal && (lastRefractionTime<0 || projectionChanged || turned ||
      cameraHeight<2 || now-lastRefractionTime>=refreshInterval);
    if (!reflect && !refract) return uniforms.reflectionReady.value>0;

    if (reflect) {
      lastCamera.copy(camera.position);
      lastRotation.copy(camera.quaternion);
      lastProjection.copy(camera.projectionMatrix);
      target.samples=samples;
      target.texture.generateMipmaps=mipmaps;
      target.texture.minFilter=mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      if(resized) target.setSize(width,height);
      else if(rebuild) target.dispose();
      uniforms.mirrorRaster.value.set(width,height);
      uniforms.mirrorOverscan.value=overscan;
      camera.getWorldDirection(direction);
      mirror.position.copy(camera.position);
      mirror.position.y=2*waterHeight-mirror.position.y;
      direction.y*=-1;
      mirror.up.set(0,-1,0);
      mirror.lookAt(focus.copy(mirror.position).add(direction));
      mirror.updateMatrixWorld();
      mirror.layers.mask=camera.layers.mask;
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      mirror.projectionMatrix.elements[0]*=overscan;
      mirror.projectionMatrix.elements[5]*=overscan;
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
      caustics.update(renderer);
      surfaceFoam.update(renderer);
      silt.update(renderer);
      if (reflect) {
        renderer.setRenderTarget(target);
        renderer.render(scene,mirror);
        reflectionPasses++;
        lastReflectionTime=now;
        uniforms.reflectionReady.value=1;
      }
      if (refract) {
        renderer.setRenderTarget(refraction);
        renderer.render(scene,refractedCamera);
        refractionPasses++;
        lastRefractionTime=now;
        uniforms.refractionReady.value=1;
        bubbles.render(renderer,refractedCamera,refraction.width,refraction.height);
      }
    } finally {
      renderer.setRenderTarget(oldTarget);
      renderer.shadowMap.autoUpdate=shadowUpdate;
      renderer.xr.enabled=xr;
      river.visible=true;
      leaves.mesh.visible=true;
      contacts.group.visible=true;
    }
    return uniforms.reflectionReady.value>0;
  }
  return {
    prepare,
    caustics:caustics.uniforms,
    wetting:swash?.wetting,
    frame(time,dt) {
      uniforms.time.value=time;
      const advanced=simulation.advance(dt,hull,hullMotion);
      if(swash) swash.frame(time,dt);
      if(breakers) breakers.frame(time,dt);
      leaves.frame(time,dt);
      slap(time,dt);
      contacts.frame(time);
      bubbles.frame(time,dt);
      if(advanced || impactPending) {
        simulation.pack();
        surfaceState.needsUpdate=true;
        channelFlow.needsUpdate=true;
        impactPending=false;
      }
    },
    hit,
    submerged:{
      trail(x,y,z,time,vx,vz) { bubbles.burst(x,y,z,time,"trail",.85,vx,vz); },
      bedStrike(x,z,time,strength) { silt.disturb(x,z,time,"bed",strength); },
    },
    probe:simulation.sample,
    field,
    rain: {height:leafField.height,velocity:field.velocity,inflow:simulation.enqueueRunoff,
      material,mirror:uniforms.reflection,mirrorUV:uniforms.reflectionUV,mirrorFilter:{
        reflectionDetail:uniforms.reflectionDetail,mirrorRaster:uniforms.mirrorRaster,mirrorOverscan:uniforms.mirrorOverscan,
      }},
    leafSource: leaves.source,
    inspect() { return { time: uniforms.time.value, currentMetresPerSecond: flowSpeed,
      reflectionPasses, refractionPasses, contacts: contacts.inspect(uniforms.time.value), lastReflectionTime, visiblePiers: piers.length, driftingLeaves: leaves.seededLeaves, foliage:leaves.inspect(), reflectionSize: [target.width, target.height],
      reflectionSamples:target.samples,closeReflection,
      leafWater:leafContact.inspect(),
      refractionSize:[refraction.width,refraction.height], simulation:simulation.inspect(), caustics:caustics.inspect(),
      foam:surfaceFoam.inspect(), submerged:{bubbles:bubbles.inspect(), silt:silt.inspect()},
      breakers:breakers ? breakers.inspect() : null, swash:swash ? swash.inspect() : null }; },
  };
}
