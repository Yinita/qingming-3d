import * as THREE from "three";

const { clamp,smoothstep }=THREE.MathUtils;
const spacing=.044, minimumFilm=.19, fadeDepth=.022;
const rippleLimit=12;
const worldToUV=new THREE.Matrix4().set(
  .5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1,
);

function shoreAt(x,z,basin) {
  const {cx,cz,rx,rz}=basin;
  const ripple=.13*Math.sin(x*15.7+z*3.9)*Math.sin(z*19.1-x*6.2);
  return 1.04-Math.hypot((x-cx)/rx,(z-cz)/rz)+ripple;
}

function buildBasin([cx,cz,rx,rz],floor,exposed) {
  const basin={cx,cz,rx,rz};
  const columns=Math.ceil(rx*2.4/spacing), rows=Math.ceil(rz*2.4/spacing);
  const position=[],bed=[],indices=[],lows=[];
  for(let j=0;j<=rows;j++) for(let i=0;i<=columns;i++) {
    const x=cx+(2*i/columns-1)*rx*1.20,z=cz+(2*j/rows-1)*rz*1.20;
    const shore=exposed(x,z) ? shoreAt(x,z,basin) : -.36;
    const ground=floor(x,z);
    position.push(x,0,z);
    bed.push(ground,shore);
    if(shore>.23) lows.push(ground);
  }
  if(lows.length<8) return null;
  lows.sort((a,b)=>a-b);
  const level=lows[Math.floor((lows.length-1)*.38)]+.012;
  const upper=new THREE.Vector3(cx+rx*1.2,level+.012,cz+rz*1.2);
  const lower=new THREE.Vector3(cx-rx*1.2,level-.04,cz-rz*1.2);
  const bounds=new THREE.Box3(lower,upper);
  for(let n=0;n<position.length;n+=3) position[n+1]=level;
  for(let j=0;j<rows;j++) for(let i=0;i<columns;i++) {
    const a=j*(columns+1)+i,b=a+columns+1;
    if([a,a+1,b,b+1].every(v=>bed[v*2]>level+.002 || bed[v*2+1]<-.055)) continue;
    indices.push(a,b,a+1,a+1,b,b+1);
  }
  if(!indices.length) return null;
  const geometry=new THREE.BufferGeometry()
    .setAttribute("position",new THREE.Float32BufferAttribute(position,3))
    .setAttribute("puddleBed",new THREE.Float32BufferAttribute(bed,2))
    .setIndex(indices);
  geometry.boundingBox=bounds;
  return {...basin,geometry,level,bounds};
}

const vertexShader=`
  attribute vec2 puddleBed;
  uniform float puddleDrop;
  uniform mat4 puddleProjection;
  varying vec3 waterPoint;
  varying vec2 bed;
  varying vec4 reflected;
  void main(){
    bed=puddleBed;
    vec4 world=modelMatrix*vec4(position,1.);
    world.y-=puddleDrop;
    waterPoint=world.xyz;
    reflected=puddleProjection*world;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

const fragmentShader=`
  uniform sampler2D puddleReflection;
  uniform float puddleFilm,puddleReflect,puddleTime;
  uniform vec2 puddleTexel;
  uniform int puddleRipples;
  uniform vec4 puddleImpact[${rippleLimit}];
  varying vec3 waterPoint;
  varying vec2 bed;
  varying vec4 reflected;
  void main(){
    float depth=waterPoint.y-bed.x;
    if(depth<.001 || bed.y<=0. || puddleFilm<.19) discard;
    float edge=smoothstep(.001,.006,depth)*smoothstep(0.,.096,bed.y);
    vec2 surfaceSlope=vec2(0.);
    float crests=0.;
    for(int i=0;i<${rippleLimit};i++){
      if(i>=puddleRipples)break;
      vec4 hit=puddleImpact[i];
      float age=puddleTime-hit.z;
      vec2 delta=waterPoint.xz-hit.xy;
      float radius=length(delta);
      float wave=(radius-age*.59)*54.;
      float envelope=exp(-wave*wave*.060)*(1.-smoothstep(.11,.58,age));
      float amplitude=envelope*.038*hit.w;
      surfaceSlope+=delta/max(radius,.008)*sin(wave)*amplitude;
      crests+=pow(max(0.,cos(wave)),5.)*envelope;
    }
    vec3 direction=normalize(cameraPosition-waterPoint);
    vec3 normal=normalize(vec3(surfaceSlope.x,1.,surfaceSlope.y));
    float fresnel=.022+.978*pow(1.-clamp(dot(normal,direction),0.,1.),4.);
    vec2 lookup=reflected.xy/max(reflected.w,.001)+surfaceSlope*.29;
    float inView=step(.001,reflected.w)*smoothstep(.0,.035,min(lookup.x,lookup.y))*
      smoothstep(.0,.035,1.-max(lookup.x,lookup.y));
    lookup=clamp(lookup,.002,.998);
    vec3 image=texture2D(puddleReflection,lookup).rgb*.69;
    image+=.155*(texture2D(puddleReflection,lookup+vec2(puddleTexel.x,0.)).rgb+
      texture2D(puddleReflection,lookup+vec2(0.,puddleTexel.y)).rgb);
    vec3 sky=mix(vec3(.30,.31,.285),vec3(.45,.47,.45),smoothstep(.06,.81,direction.y));
    vec3 reflectedLight=mix(sky,image*vec3(.81,.87,.83),clamp(inView*puddleReflect,0.,1.));
    float absorption=smoothstep(.002,.057,depth);
    vec3 tint=mix(vec3(.30,.25,.18),vec3(.16,.18,.149),absorption);
    vec3 color=mix(tint,reflectedLight,clamp(.35+fresnel*.66,0.,1.));
    color+=vec3(.45,.50,.45)*min(.16,crests*.075);
    float alpha=edge*smoothstep(.19,.58,puddleFilm)*clamp(.20+.25*absorption+.67*fresnel,.0,.96);
    gl_FragColor=vec4(color,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createGroundPuddles(parent,footprints,floor,exposed) {
  const group=new THREE.Group();
  group.name="Shallow rain puddles";
  group.visible=false;
  parent.add(group);
  const target=new THREE.WebGLRenderTarget(480,270,{depthBuffer:true});
  target.texture.name="Street puddle reflection";
  const impacts=Array.from({length:rippleLimit},()=>new THREE.Vector4());
  const uniforms={
    puddleReflection:{value:target.texture},puddleProjection:{value:new THREE.Matrix4()},
    puddleFilm:{value:0},puddleDrop:{value:fadeDepth},puddleReflect:{value:0},
    puddleTexel:{value:new THREE.Vector2(1/480,1/270)},puddleTime:{value:0},
    puddleImpact:{value:impacts},puddleRipples:{value:0},
  };
  const material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true,depthWrite:false});
  const basins=footprints.map(footprint=>buildBasin(footprint,floor,exposed)).filter(Boolean);
  for(const basin of basins) {
    const mesh=new THREE.Mesh(basin.geometry,material);
    mesh.name="Level water between street stones";
    mesh.renderOrder=4;
    group.add(mesh);
  }
  const mirror=new THREE.PerspectiveCamera(), pointing=new THREE.Vector3(), focus=new THREE.Vector3();
  const clip=new THREE.Plane(), plane=new THREE.Vector4(), corner=new THREE.Vector4();
  const frustum=new THREE.Frustum(), cameraMatrix=new THREE.Matrix4(), size=new THREE.Vector2();
  const cameraBefore=new THREE.Vector3(Infinity,Infinity,Infinity), attitudeBefore=new THREE.Quaternion();
  let film=0, drop=fadeDepth, current=null, passes=0, lastTime=-Infinity;

  function heightAt(x,z,ground) {
    if(film<=minimumFilm) return -Infinity;
    let height=-Infinity;
    for(const basin of basins) {
      if(Math.abs(x-basin.cx)>basin.rx*1.18 || Math.abs(z-basin.cz)>basin.rz*1.18) continue;
      const level=basin.level-drop;
      if(level>ground+.003 && shoreAt(x,z,basin)>.075) height=Math.max(height,level);
    }
    return Number.isFinite(height) && exposed(x,z) ? height : -Infinity;
  }

  function frame(amount,time,events,player) {
    film=amount;
    drop=fadeDepth*(1-smoothstep(.19,.86,amount));
    group.visible=amount>minimumFilm;
    uniforms.puddleFilm.value=amount;
    uniforms.puddleDrop.value=drop;
    uniforms.puddleTime.value=time;
    let count=0;
    for(let i=events.length-1;i>=0 && count<rippleLimit;i--) {
      const event=events[i];
      if(event.river || Math.hypot(event.x-player.x,event.z-player.z)>14) continue;
      impacts[count++].set(event.x,event.z,event.time,event.scale);
    }
    uniforms.puddleRipples.value=count;
  }

  function prepare(renderer,scene,camera) {
    if(!group.visible) return;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(cameraMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    let basin=null,nearest=12**2;
    for(const candidate of basins) {
      const distance=(candidate.cx-camera.position.x)**2+(candidate.cz-camera.position.z)**2;
      if(distance>=nearest || camera.position.y<candidate.level+.055 || !frustum.intersectsBox(candidate.bounds)) continue;
      basin=candidate;
      nearest=distance;
    }
    if(!basin) {
      uniforms.puddleReflect.value=0;
      return;
    }
    const time=uniforms.puddleTime.value;
    const moving=cameraBefore.distanceToSquared(camera.position)>.034 || attitudeBefore.angleTo(camera.quaternion)>.044;
    if(current===basin && time-lastTime<(moving ? .059 : .108)) return;
    const y=basin.level-drop;
    renderer.getDrawingBufferSize(size);
    const width=clamp(Math.round(size.x*.205),344,704);
    const height=Math.max(192,Math.round(width*size.y/size.x));
    if(target.width!==width || target.height!==height) target.setSize(width,height);
    uniforms.puddleTexel.value.set(1/width,1/height);
    camera.getWorldDirection(pointing);
    pointing.y*=-1;
    mirror.position.copy(camera.position);
    mirror.position.y=2*y-camera.position.y;
    mirror.up.set(0,-1,0);
    mirror.lookAt(focus.copy(mirror.position).add(pointing));
    mirror.updateMatrixWorld();
    mirror.layers.mask=camera.layers.mask;
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    uniforms.puddleProjection.value.copy(worldToUV).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // Clip out geometry below the reflecting plane, including the puddle bed.
    clip.normal.set(0,1,0);
    clip.constant=-y+.002;
    clip.applyMatrix4(mirror.matrixWorldInverse);
    plane.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
    const p=mirror.projectionMatrix.elements;
    corner.set((Math.sign(plane.x)+p[8])/p[0],(Math.sign(plane.y)+p[9])/p[5],-1,(1+p[10])/p[14]);
    plane.multiplyScalar(2/plane.dot(corner));
    p[2]=plane.x;p[6]=plane.y;p[10]=plane.z+1-.001;p[14]=plane.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

    const previous=renderer.getRenderTarget(),shadows=renderer.shadowMap.autoUpdate,xr=renderer.xr.enabled;
    const weatherVisible=parent.visible;
    try {
      parent.visible=false;
      renderer.shadowMap.autoUpdate=false;
      renderer.xr.enabled=false;
      renderer.setRenderTarget(target);
      renderer.render(scene,mirror);
      current=basin;
      passes++;
      lastTime=time;
      cameraBefore.copy(camera.position);
      attitudeBefore.copy(camera.quaternion);
      uniforms.puddleReflect.value=1;
    } finally {
      parent.visible=weatherVisible;
      renderer.setRenderTarget(previous);
      renderer.shadowMap.autoUpdate=shadows;
      renderer.xr.enabled=xr;
    }
  }
  return {
    heightAt,frame,prepare,
    reset() {
      frame(0,0,[],null);
      current=null;
      passes=0;
      lastTime=-Infinity;
      uniforms.puddleReflect.value=0;
    },
    inspect:()=>({basins:basins.length,visible:group.visible,passes,
      target:[target.width,target.height],impacts:uniforms.puddleRipples.value,
      surface:current ? {x:current.cx,y:current.level-drop,z:current.cz} : null}),
  };
}
