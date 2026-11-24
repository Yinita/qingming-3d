import * as THREE from "three";
import { waterHeight } from "./bridge-canal-bed.js";

const resolution=1024, span=7.2, texel=span/resolution;
const limit=THREE.MathUtils.clamp;
const profiles={drift:1,impact:2,refloat:2,wash:2};
const quadVertex=`
  uniform vec4 leafSlopeBounds;
  attribute vec4 footprint;
  attribute vec4 heading;
  attribute vec2 life;
  varying vec2 local;
  varying vec2 radius;
  varying vec4 blade;
  varying vec2 timing;
  void main(){
    radius=footprint.zw;
    local=position.xy*2.*radius;
    blade=heading;
    timing=life;
    vec2 side=vec2(heading.y,-heading.x);
    vec2 world=footprint.xy+side*local.x+heading.xy*local.y;
    gl_Position=vec4((world-leafSlopeBounds.xy)*leafSlopeBounds.zw*2.-1.,0.,1.);
  }
`;

const quadFragment=`
  varying vec2 local,radius,timing;
  varying vec4 blade;
  void main(){
    vec2 gradient;
    if(blade.w<.5){
      // A pinned meniscus follows the rounded outline of the floating blade.
      vec2 p=local/(radius*.58);
      float r=length(p);
      float rim=(r-.99)/.24;
      float slope=-1.72*rim*exp(-rim*rim)*smoothstep(.38,.73,r);
      gradient=(p/radius)/max(.001,length(p/radius))*slope;
    } else if(blade.w<1.5) {
      // Two dispersive branches spread from the path of a slipping leaf.
      float astern=-local.y;
      float ridge=abs(local.x)-(.017+.38*astern+.08*timing.x);
      float envelope=exp(-pow((astern-.045-.21*timing.x)/(.089+.18*timing.x),2.))
        *smoothstep(-.032,.009,astern)*exp(-pow(ridge/(.022+.040*timing.x),2.));
      float signal=sin(ridge*(132.-43.*timing.x))*envelope;
      gradient=vec2(sign(local.x),.38)*signal;
    } else {
      float r=length(local*vec2(1.,.92));
      float ring=r-(.023+.46*timing.x);
      float envelope=exp(-pow(ring/(.020+.035*timing.x),2.))*smoothstep(.008,.028,r);
      float lobe=.84+.16*local.y/max(.001,r);
      gradient=local/max(.001,r)*sin(ring*(136.-31.*timing.x))*envelope*lobe;
    }
    float decay=1.-smoothstep(.36,1.,timing.x/max(.001,timing.y));
    vec2 slope=(vec2(blade.y,-blade.x)*gradient.x+blade.xy*gradient.y)*blade.z*decay;
    gl_FragColor=vec4(max(slope.x,0.),max(-slope.x,0.),max(slope.y,0.),max(-slope.y,0.))*2.;
  }
`;

export const leafSlopeGLSL=`
  uniform sampler2D leafSlopeMap;
  uniform vec4 leafSlopeBounds;
  uniform float leafSlopeReady,leafContactOptics;
  vec2 leafWaterSlope(vec2 world){
    vec2 uv=(world-leafSlopeBounds.xy)*leafSlopeBounds.zw;
    vec2 margin=min(uv,1.-uv);
    float fade=smoothstep(.0,.098,min(margin.x,margin.y))*leafSlopeReady*leafContactOptics;
    if(fade<.001) return vec2(0.);
    vec4 s=texture2D(leafSlopeMap,uv);
    return vec2(s.r-s.g,s.b-s.a)*(.5*fade);
  }
`;

export function createLeafWater(capacity) {
  const map=new THREE.WebGLRenderTarget(resolution,resolution,{depthBuffer:false,stencilBuffer:false});
  map.texture.name="Floating leaf capillary slopes";
  const bounds=new THREE.Vector4(0,0,1/span,1/span);
  const uniforms={leafSlopeMap:{value:map.texture},leafSlopeBounds:{value:bounds},
    leafSlopeReady:{value:0},leafContactOptics:{value:1}};
  const attached=Array.from({length:capacity},()=>({}));
  const packets=Array.from({length:192},()=>({time:-10,life:0}));
  const count=attached.length+packets.length;
  const plane=new THREE.PlaneGeometry(1,1);
  const layout=new THREE.InstancedBufferGeometry().copy(plane);
  plane.dispose();
  const footprint=new THREE.InstancedBufferAttribute(new Float32Array(count*4),4);
  const heading=new THREE.InstancedBufferAttribute(new Float32Array(count*4),4);
  const life=new THREE.InstancedBufferAttribute(new Float32Array(count*2),2);
  for(const [name,buffer] of Object.entries({footprint,heading,life})) {
    buffer.setUsage(THREE.DynamicDrawUsage);
    layout.setAttribute(name,buffer);
  }
  const material=new THREE.ShaderMaterial({vertexShader:quadVertex,fragmentShader:quadFragment,uniforms,
    depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,
    blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor});
  const scene=new THREE.Scene(), camera=new THREE.Camera(), mesh=new THREE.Mesh(layout,material);
  const direction=new THREE.Vector3(), clearColor=new THREE.Color();
  mesh.frustumCulled=false;
  scene.add(mesh);
  const totals={drift:0,impact:0,refloat:0,wash:0};
  const latest={drift:null,impact:null,refloat:null,wash:null};
  let cursor=0,currentTime=-1,lastTime=-2,active=0,visiblePackets=0,passes=0,attachedCount=0;

  function emit(kind,index,x,z,time,u,v,dx,dz,power){
    const p=packets[cursor];
    cursor=(cursor+1)%packets.length;
    const speed=Math.hypot(u,v);
    const motion=speed>.90 ? .90/speed : 1;
    const trail=kind==="drift";
    Object.assign(p,{index,x,z,time,u:u*motion,v:v*motion,dx,dz,power,type:profiles[kind],
      life:trail ? .53 : kind==="impact" ? .69 : .53, rx:trail ? .21 : .42, rz:trail ? .38 : .42});
    totals[kind]++;
    latest[kind]={index,x,z,time,u:p.u,v:p.v,dx,dz,power};
  }

  function prepare(renderer,viewer,time){
    const altitude=viewer.position.y-waterHeight;
    if(altitude>5.2 || uniforms.leafContactOptics.value<.001) {
      uniforms.leafSlopeReady.value=0;
      lastTime=-2;
      return;
    }
    viewer.getWorldDirection(direction);
    const reach=Math.min(2.8,altitude/Math.max(.23,-direction.y));
    const x=Math.round((viewer.position.x+reach*direction.x-span/2)/texel)*texel;
    const z=Math.round((viewer.position.z+reach*direction.z-span/2)/texel)*texel;
    if(time===lastTime && x===bounds.x && z===bounds.y) return;
    lastTime=time;
    bounds.setX(x).setY(z);
    active=visiblePackets=0;
    function put(entry,age){
      const px=entry.x+age*entry.u,pz=entry.z+age*entry.v;
      if(px<x-.62 || px>x+span+.62 || pz<z-.62 || pz>z+span+.62) return false;
      footprint.setXYZW(active,px,pz,entry.rx,entry.rz);
      heading.setXYZW(active,entry.dx,entry.dz,entry.power,entry.type);
      life.setXY(active++,age,entry.life);
      return true;
    }
    for(const leaf of attached) if(leaf.time===currentTime) put(leaf,0);
    for(const packet of packets) {
      const age=time-packet.time;
      if(age>=0 && age<packet.life && put(packet,age)) visiblePackets++;
    }
    uniforms.leafSlopeReady.value=Number(active>0);
    if(!active) return;
    layout.instanceCount=active;
    footprint.needsUpdate=heading.needsUpdate=life.needsUpdate=true;
    const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,alpha=renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.setRenderTarget(map);
    renderer.autoClear=false;
    renderer.setClearColor(0x000000,0);
    try {
      renderer.clear(true,false,false);
      renderer.render(scene,camera);
    } finally {
      renderer.setClearColor(clearColor,alpha);
      renderer.autoClear=autoClear;
      renderer.setRenderTarget(previous);
    }
    passes++;
  }

  return {
    uniforms,prepare,emit,
    begin(time) { currentTime=time; attachedCount=0; },
    attach(index,x,z,length,width,dx,dz,power) {
      const entry=attached[index];
      Object.assign(entry,{x,z,rx:limit(width,.022,.095),rz:limit(length,.070,.29),dx,dz,power,
        u:0,v:0,time:currentTime,life:1,type:0});
      attachedCount++;
    },
    inspect:()=>({attached:attachedCount,visible:active,visiblePackets,totals:{...totals},latest:{...latest},
      origin:[bounds.x,bounds.y],span,resolution,passes}),
  };
}
