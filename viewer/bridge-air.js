import { DataTexture, LinearFilter, MathUtils, Vector2, Vector3, Vector4 } from "three";
import { airWakeAt, placeWakes, refreshWakes, wakeGLSL, wakeUniforms, windScreen } from "./bridge-air-wakes.js";

const directionX=.8660254, directionZ=.5;
const gustSpeed=3.85, cycle=11.4;
export const waterWindDrift=.023;
export const waterWindDelay=.11;
export const prevailingWind=new Vector2(directionX,directionZ);
const columns=128, rows=72, velocityRange=4.25;
const fieldData=new Uint8Array(columns*rows*4);
const texture=new DataTexture(fieldData,columns,rows);
texture.name="Air velocity across the canal";
texture.minFilter=texture.magFilter=LinearFilter;
const windTime={value:0};
const windStrength={value:1};
const windOrigin={value:new Vector2()};
const windMap={value:texture};
const windBounds={value:new Vector4()};
export const airUniforms={windTime,windStrength,windOrigin,windMap,windBounds,...wakeUniforms};
let lastSample=-1;
const sample=new Vector2();
const wake=new Vector3();

export function placeAir(center,width,depth) {
  windOrigin.value.set(center.x-11,center.z-5);
  windBounds.value.set(-width/2-2,-depth-2,1/(width+4),1/(depth+4));
  placeWakes(windBounds.value.x,windBounds.value.y,width+4,depth+4,directionX,directionZ);
  refreshAir();
}

export function advanceAir(dt,visible=true) {
  windTime.value+=Math.min(.18,dt);
  if(!visible) return;
  if(windTime.value-lastSample>=.038) refreshAir(false);
  refreshWakes(windTime.value,airAt);
}

export function registerWindCanopy({x,z,radius,bottom,top,density=.71,pose,enabled,name}) {
  windScreen({x,z,along:radius*.84,cross:radius,bottom,top,density,pose,enabled,name});
}

export function registerWindBuilding({x,z,width,depth,height,enabled,name="house"}) {
  const along=.5*(width*directionX+depth*directionZ);
  const cross=.5*(width*directionZ+depth*directionX);
  windScreen({x,z,along,cross,top:height,density:1.43,porous:false,enabled,name});
}

// Each crest passes downstream at a finite speed. A broader, staggered crest
// feeds the valley between the stronger gusts without resetting their phase.
function forecast(x,z,out,time) {
  const u=x-windOrigin.value.x, v=z-windOrigin.value.y;
  const across=-u*directionZ+v*directionX;
  const along=u*directionX+v*directionZ;
  const age=time-along/gustSpeed+across*.071;
  const phase=MathUtils.euclideanModulo(age+.4,cycle);
  const crest=MathUtils.smoothstep(phase,.68,2.23)*(1-MathUtils.smoothstep(phase,2.71,4.67));
  const ph2=MathUtils.euclideanModulo(age+6.8,cycle);
  const swell=MathUtils.smoothstep(ph2,.86,2.9)*(1-MathUtils.smoothstep(ph2,3.31,6.27));
  const front=.73+.27*Math.cos(across*.245+along*.095);
  const forward=.65+front*(2.63*crest+.73*swell)+.15*Math.sin(age*1.51+across*.08);
  const lateral=(.20+.38*crest)*Math.sin(across*.27-age*1.13);
  return out.set(directionX*forward-directionZ*lateral,directionZ*forward+directionX*lateral);
}

export function airAt(x,z,out,time=windTime.value) {
  return forecast(x,z,out,time).multiplyScalar(windStrength.value);
}

export function refreshAir(refreshObstacles=true) {
  const {x,y,z,w}=windBounds.value;
  for(let row=0;row<rows;row++) {
    const worldZ=y+(row+.5)/(rows*w);
    for(let col=0;col<columns;col++) {
      forecast(x+(col+.5)/(columns*z),worldZ,sample,windTime.value);
      const i=4*(row*columns+col);
      fieldData[i]=Math.round(128+127*sample.x/velocityRange);
      fieldData[i+1]=Math.round(128+127*sample.y/velocityRange);
      fieldData[i+3]=255;
    }
  }
  texture.needsUpdate=true;
  lastSample=windTime.value;
  if(refreshObstacles) refreshWakes(windTime.value,airAt,true);
}

export function airFromMap(x,z,out,delay=0,height=.10) {
  const bounds=windBounds.value;
  const {clamp,lerp}=MathUtils;
  const u=clamp((x+directionX*delay*gustSpeed-bounds.x)*bounds.z*columns-.5,0,columns-1.001);
  const v=clamp((z+directionZ*delay*gustSpeed-bounds.y)*bounds.w*rows-.5,0,rows-1.001);
  const col=Math.floor(u), row=Math.floor(v), at=(row*columns+col)*4;
  function component(offset) {
    const i=at+offset;
    const north=lerp(fieldData[i],fieldData[i+4],u-col);
    const south=lerp(fieldData[i+columns*4],fieldData[i+columns*4+4],u-col);
    return (lerp(north,south,v-row)-128)*velocityRange/127;
  }
  const vx=component(0), vz=component(1);
  if(wakeUniforms.windWakeMix.value<.001 || height>9.05) {
    return out.set(vx,vz).multiplyScalar(windStrength.value);
  }
  airWakeAt(x,z,height,wake);
  return out.set(vx*wake.x-vz*wake.y,vz*wake.x+vx*wake.y).multiplyScalar(windStrength.value);
}

export const airGLSL=`
  uniform float windTime;
  uniform float windStrength;
  uniform vec2 windOrigin;
  uniform sampler2D windMap;
  uniform vec4 windBounds;
  ${wakeGLSL}
  vec3 canalAirFlow(vec2 world,float time,float y) {
    const vec2 heading=vec2(${directionX},${directionZ});
    vec2 upwind=world+heading*(${gustSpeed}*(windTime-time));
    vec2 uv=(upwind-windBounds.xy)*windBounds.zw;
    vec2 encoded=texture2D(windMap,uv).rg;
    vec2 freeWind=(encoded*255.-128.)*(${velocityRange}/127.)*windStrength;
    vec3 wake=localWindWake(world,y);
    vec2 corrected=freeWind*wake.x+vec2(-freeWind.y,freeWind.x)*wake.y;
    return vec3(corrected,wake.z*length(freeWind));
  }
  vec2 canalAirAt(vec2 world,float time,float y){return canalAirFlow(world,time,y).xy;}
  vec2 canalAir(vec2 world,float time){return canalAirAt(world,time,.10);}
`;
