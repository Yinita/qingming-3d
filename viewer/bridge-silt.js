import * as THREE from "three";
import { canalBankGLSL, canalBathymetryGLSL } from "./bridge-canal-bed.js";
import { channelVelocityLimit } from "./bridge-channel-flow.js";

const sourceLimit=10;
const layersGLSL=`
  vec2 suspendedLayers(vec4 value) {
    return vec2(dot(value.rg,vec2(65280.,255.)), dot(value.ba,vec2(65280.,255.)))/65535.;
  }
`;

export const murkGLSL=`
  uniform sampler2D suspendedSediment;
  uniform sampler2D siltLighting;
  uniform float murkStrength;
  ${layersGLSL}
  float sedimentAt(vec3 p,float surfaceY) {
    vec2 uv=clamp((p.xz-simulationBounds.xy)*simulationBounds.zw,0.,1.);
    vec2 layers=suspendedLayers(texture2D(suspendedSediment,uv));
    float bedY=canalBedElevation(p.xz-origin);
    float depth=clamp((surfaceY-p.y)/max(.09,surfaceY-bedY),0.,1.);
    float upper=smoothstep(.015,.20,depth)*(1.-smoothstep(.54,.90,depth));
    float lower=smoothstep(.39,.92,depth);
    return layers.x*upper+layers.y*lower;
  }

  vec3 transmitSediment(vec3 substrate,vec3 surfacePoint,vec3 submergedPoint,float distanceInWater) {
    vec3 delta=submergedPoint-surfacePoint;
    float density=sedimentAt(surfacePoint+.19*delta,surfacePoint.y)*.29
                 +sedimentAt(surfacePoint+.55*delta,surfacePoint.y)*.34
                 +sedimentAt(surfacePoint+.88*delta,surfacePoint.y)*.37;
    if(density<.0007) return substrate;
    vec3 transmission=exp(-vec3(2.46,3.71,5.20)*density*distanceInWater*murkStrength);
    vec3 center=surfacePoint+.66*delta;
    float bed=canalBedElevation(center.xz-origin);
    vec2 projected=center.xz+vec2(.32,.25)*max(0.,center.y-bed);
    vec2 lightUV=clamp((projected-simulationBounds.xy)*simulationBounds.zw,0.,1.);
    float focus=smoothstep(.028,.48,texture2D(siltLighting,lightUV).r);
    vec3 diffuse=vec3(.36,.263,.119)+vec3(.094,.072,.023)*focus;
    return substrate*transmission+diffuse*(1.-transmission);
  }
`;

const transportShader=`
  uniform vec4 simulationBounds;
  uniform vec2 origin;
  uniform sampler2D channelFlow;
  uniform sampler2D priorSediment;
  uniform float time;
  uniform float elapsed;
  uniform float carry;
  uniform int sourceCount;
  uniform vec4 sourcePosition[${sourceLimit}];
  uniform vec2 sourceRates[${sourceLimit}];
  varying vec2 fieldUV;
  ${layersGLSL}
  ${canalBankGLSL}
  ${canalBathymetryGLSL}

  vec2 packDensity(float value) {
    float q=floor(clamp(value,0.,1.)*65535.+.5);
    return vec2(floor(q/256.),mod(q,256.))/255.;
  }
  vec2 velocity(vec2 uv) {
    return (texture2D(channelFlow,uv).rg*255.-128.)*(${channelVelocityLimit}/127.);
  }
  void main() {
    vec2 p=simulationBounds.xy+fieldUV/simulationBounds.zw;
    float depth=-canalBedElevation(p-origin);
    if(depth<.027) { gl_FragColor=vec4(0.); return; }
    vec2 current=velocity(fieldUV);
    vec2 midpoint=fieldUV-current*elapsed*.5*simulationBounds.zw;
    current=velocity(midpoint);
    vec2 swirl=.044*vec2(sin(p.y*8.7+p.x*3.4-time*1.53),cos(p.x*9.2-p.y*4.1+time*.87));
    vec2 upperUV=fieldUV-elapsed*(current*.93+swirl)*simulationBounds.zw;
    vec2 lowerUV=fieldUV-elapsed*(current*.49-swirl*.35)*simulationBounds.zw;
    float upper=suspendedLayers(texture2D(priorSediment,upperUV)).x*carry;
    float lower=suspendedLayers(texture2D(priorSediment,lowerUV)).y*carry;
    float settles=(1.-exp(-elapsed*(.39+.14/max(.25,depth))))*upper;
    upper=(upper-settles)*exp(-.52*elapsed);
    lower=(lower+settles*.77)*exp(-.47*elapsed);
    for(int i=0;i<${sourceLimit};i++) {
      if(i>=sourceCount) break;
      vec4 source=sourcePosition[i];
      vec2 q=(p-source.xy)/source.z;
      if(dot(q,q)>8.) continue;
      float folds=.81+.19*sin(q.y*5.+3.*sin(q.x*2.7)+source.w);
      float spread=exp(-dot(q,q)*1.16)*folds;
      upper+=elapsed*sourceRates[i].x*spread;
      lower+=elapsed*sourceRates[i].y*spread;
    }
    float shore=smoothstep(.027,.14,depth);
    gl_FragColor=vec4(packDensity(upper*shore),packDensity(lower*shore));
  }
`;

export function createSiltTransport(water) {
  const width=384, height=640;
  const makeTarget=()=>new THREE.WebGLRenderTarget(width,height,{depthBuffer:false,stencilBuffer:false});
  let buffer=makeTarget(), output=makeTarget();
  buffer.texture.name=output.texture.name="Suspended canal sediment";
  const suspendedSediment={value:buffer.texture};
  const murkStrength={value:0};
  const sourcePosition=Array.from({length:sourceLimit},()=>new THREE.Vector4());
  const sourceRates=Array.from({length:sourceLimit},()=>new THREE.Vector2());
  const source=[];
  const uniforms={
    simulationBounds:water.simulationBounds, origin:water.origin, channelFlow:water.channelFlow,time:water.time,
    priorSediment:{value:buffer.texture},carry:{value:0},elapsed:{value:0},sourceCount:{value:0},
    sourcePosition:{value:sourcePosition},sourceRates:{value:sourceRates},
  };
  const material=new THREE.ShaderMaterial({uniforms,fragmentShader:transportShader,depthTest:false,depthWrite:false,
    vertexShader:`varying vec2 fieldUV; void main(){fieldUV=uv;gl_Position=vec4(position.xy,0.,1.);}`});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  quad.frustumCulled=false;
  const pass=new THREE.Scene();
  pass.add(quad);
  const camera=new THREE.Camera();
  let last=-1, activeUntil=-1, passes=0, deposits=0, previousDeposit=null;

  function disturb(x,z,time,kind,strength) {
    const stone=kind==="bed";
    const duration=stone ? .38 : .29;
    if(source.length===sourceLimit) source.shift();
    source.push({x,z,time,duration,radius:stone ? .33 : .20,
      upper:(stone ? .72 : .31)*strength,lower:(stone ? 2.53 : 1.19)*strength});
    previousDeposit={x,z,time,kind,strength};
    deposits++;
    activeUntil=time+6.1;
  }

  function update(renderer) {
    const time=water.time.value;
    if(time>activeUntil) { murkStrength.value=0; return; }
    if(last>=0 && time-last<.040) return;
    const dt=last<0 ? .044 : Math.min(.10,time-last);
    for(let i=source.length-1;i>=0;i--) if(time-source[i].time>source[i].duration) source.splice(i,1);
    source.forEach((event,i)=>{
      const age=Math.max(0,time-event.time);
      const pulse=Math.min(1,age/.069)*Math.max(0,1-age/event.duration);
      sourcePosition[i].set(event.x,event.z,Math.sqrt(event.radius**2+.21*age),event.time*3.1);
      sourceRates[i].set(event.upper*pulse,event.lower*pulse);
    });
    uniforms.priorSediment.value=buffer.texture;
    uniforms.sourceCount.value=source.length;
    uniforms.carry.value=last>=0 && time-last<.52 ? 1 : 0;
    uniforms.elapsed.value=dt;
    renderer.setRenderTarget(output);
    renderer.render(pass,camera);
    [buffer,output]=[output,buffer];
    suspendedSediment.value=buffer.texture;
    murkStrength.value=THREE.MathUtils.clamp((activeUntil-time)/1.3,0,1);
    last=time;
    passes++;
  }

  return {uniforms:{suspendedSediment,murkStrength},disturb,update,
    inspect:()=>({passes,deposits,previousDeposit,sources:source.length,active:murkStrength.value>0,width,height})};
}
