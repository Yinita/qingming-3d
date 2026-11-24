import * as THREE from "three";

const capacity=4800, duration=.88;
const waveVertex=`
  attribute vec4 impact;
  attribute float impactScale;
  uniform vec4 rainBounds;
  varying vec2 displacement;
  varying vec2 agePower;
  void main(){
    float reach=.087+impact.z*.83;
    displacement=position.xy*2.*reach;
    agePower=impact.zw;
    vec2 uv=(impact.xy+displacement*impactScale-rainBounds.xy)*rainBounds.zw;
    gl_Position=vec4(uv*2.-1.,0.,1.);
  }
`;
const waveFragment=`
  varying vec2 displacement;
  varying vec2 agePower;
  void main(){
    float r=length(displacement);
    float age=agePower.x;
    float crest=(r-(.029+.69*age));
    float packet=crest/(.047+.085*age);
    float ring=exp(-packet*packet);
    float rise=sin(crest*65.)*ring*exp(-age*2.65)*smoothstep(.0,.022,r);
    float spread=1./sqrt(1.+r*7.8);
    float expiry=1.-smoothstep(.59,.881,age);
    vec2 slope=displacement/max(.001,r)*rise*spread*expiry*agePower.y;
    gl_FragColor=vec4(max(0.,slope.x),max(0.,-slope.x),max(0.,slope.y),max(0.,-slope.y))*.61;
  }
`;

export function makeRainRipples(bounds) {
  const events=Array.from({length:capacity},()=>({time:-10,x:0,z:0,power:0,scale:1,life:duration,u:0,v:0}));
  const target=new THREE.WebGLRenderTarget(1536,1152,{depthBuffer:false,stencilBuffer:false});
  target.texture.name="Rain impact capillary slopes";
  const uniforms={rainBounds:{value:bounds},rainRippleMap:{value:target.texture},
    rainRippleReady:{value:0}};
  const plane=new THREE.PlaneGeometry(1,1);
  const layout=new THREE.InstancedBufferGeometry().copy(plane);
  plane.dispose();
  const impact=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4);
  const scale=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);
  impact.setUsage(THREE.DynamicDrawUsage);
  scale.setUsage(THREE.DynamicDrawUsage);
  layout.setAttribute("impact",impact);
  layout.setAttribute("impactScale",scale);
  const material=new THREE.ShaderMaterial({vertexShader:waveVertex,fragmentShader:waveFragment,uniforms,
    transparent:true,depthWrite:false,depthTest:false,blending:THREE.CustomBlending,
    blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor});
  const rainMesh=new THREE.Mesh(layout,material);
  rainMesh.frustumCulled=false;
  const scene=new THREE.Scene();
  scene.add(rainMesh);
  const camera=new THREE.Camera();
  const background=new THREE.Color();
  let cursor=0,last=-1,passes=0,active=0,maximum=0;
  return {
    uniforms,
    invalidate() { last=-1; },
    enter(x,z,time,power,size=1,life=duration,u=0,v=0) {
      Object.assign(events[cursor],{x,z,time,power,scale:size,life,u,v});
      cursor=(cursor+1)%capacity;
    },
    update(renderer,time) {
      if(last>=0 && time-last<.027) return;
      const before=active;
      active=0;
      for(const event of events) {
        const age=time-event.time;
        if(age<0 || age>event.life) continue;
        impact.setXYZW(active,event.x+event.u*age,event.z+event.v*age,age*duration/event.life,event.power);
        scale.setX(active++,event.scale);
      }
      layout.instanceCount=active;
      maximum=Math.max(maximum,active);
      last=time;
      if(!active && !before) return;
      impact.needsUpdate=true;
      scale.needsUpdate=true;
      const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear;
      const alpha=renderer.getClearAlpha();
      renderer.getClearColor(background);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000,0);
      renderer.autoClear=false;
      try {
        renderer.clear(true,false,false);
        if(active) renderer.render(scene,camera);
      } finally {
        renderer.setClearColor(background,alpha);
        renderer.setRenderTarget(previous);
        renderer.autoClear=autoClear;
      }
      uniforms.rainRippleReady.value=Number(active>0);
      passes++;
    },
    inspect:()=>({passes,active,maximum,dimensions:[target.width,target.height]}),
    target,
  };
}

export const rainRippleGLSL=`
  uniform sampler2D rainRippleMap;
  uniform vec4 rainBounds;
  uniform float rainRippleReady;
  vec2 rainRipple(vec2 p) {
    if(rainRippleReady<.001) return vec2(0.);
    vec2 uv=(p-rainBounds.xy)*rainBounds.zw;
    float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
    if(edge<.001) return vec2(0.);
    vec4 s=texture2D(rainRippleMap,uv);
    return vec2(s.r-s.g,s.b-s.a)*.87*rainRippleReady*smoothstep(.001,.037,edge);
  }
`;
