import * as THREE from "three";
import { canalShoreRadius } from "./bridge-canal-bed.js";
import { breakerRows as rows, breakerSpan, breakingPosition, crestRiseAt, rolledSection } from "./bridge-breaker-surface.js";

const dx=.085;
const {clamp,lerp,smoothstep}=THREE.MathUtils;

export function buildCanalBreakers(origin,sourceZ,field,depthAt,swash,{height,foam,drop,bubbles}) {
  const buffer=new Float32Array(rows*8);
  const texture=new THREE.DataTexture(buffer,rows,2,THREE.RGBAFormat,THREE.FloatType);
  texture.name="Tracked crest positions and roll by bank section";
  texture.needsUpdate=true;
  const bankStart=sourceZ-breakerSpan*.5;
  const uniforms={
    breakingRows:{value:texture},
    breakingBounds:{value:new THREE.Vector2(bankStart,1/breakerSpan)},
    breakingBlend:{value:1},
  };

  let passes=0, spray=0, foamed=0, maxWidth=0, active=0, rolled=0, openings=0;
  let lastPass=-Infinity;
  const events=[];
  const sample={};
  const section=Array.from({length:rows},(_,index)=>{
    const z=bankStart+breakerSpan*index/(rows-1);
    const shore=origin.x-canalShoreRadius(z-origin.y,-1);
    const profile=Array.from({length:27},(_,i)=>{
      const x=shore+.19+dx*i;
      return {x,depth:depthAt(x,z)};
    });
    return {z,profile,life:0,age:0,x:shore+.78,h:0,depth:.26,velocity:0,
      potency:0,produced:false,lastFoam:-10,visible:0,lift:0,roll:0};
  });

  function follow(node,time,dt) {
    let left=height(node.profile[0].x,node.z);
    let middle=height(node.profile[1].x,node.z);
    let chosen=null;
    for(let i=1;i<node.profile.length-1;i++) {
      const {x,depth}=node.profile[i];
      const right=height(node.profile[i+1].x,node.z);
      if(middle>.046 && middle>=left && middle>right && depth>.106 && depth<.60 && middle/depth>.29) {
        const q=field.disturbance(x,node.z,sample);
        const velocity=q.u+q.meanU;
        if(velocity<-.15 && (!chosen || middle>chosen.h)) {
          const curvature=left-2*middle+right;
          const offset=curvature<-.00002 ? clamp(.5*(left-right)/curvature,-.6,.6)*dx : 0;
          chosen={x:x+offset,h:middle,depth,velocity};
        }
      }
      left=middle;
      middle=right;
    }
    if(chosen && (!node.life || Math.abs(chosen.x-node.x)<.47)) {
      if(!node.life) {
        node.age=0;
        node.x=chosen.x;
        node.produced=false;
      }
      node.life=.16;
      node.x=lerp(node.x,chosen.x,Math.min(1,22*dt));
      node.h=chosen.h;
      node.velocity=chosen.velocity;
      node.depth=chosen.depth;
    } else {
      node.life=Math.max(0,node.life-dt);
      node.x+=node.life ? node.velocity*dt*.59 : 0;
    }
    node.age+=dt;
    const steady=smoothstep(node.age,0,.088)*(1-smoothstep(node.age,.40,.63));
    node.visible=steady*smoothstep(node.life,0,.09);
    node.potency=clamp(node.h/Math.max(.12,node.depth),.2,1.1);
    if(node.visible>.24 && node.age>=.14 && time-node.lastFoam>.078) {
      foam(node.x-.22,node.z,(.025+.079*node.potency)*node.visible);
      node.lastFoam=time;
      foamed++;
    }
  }

  const point=new THREE.Vector3();
  const xSections=Array.from({length:17},(_,i)=>rolledSection(i/16,{}).x);
  function writeRow(node,index,time) {
    const envelope=smoothstep(index,0,4)*(1-smoothstep(index,rows-5,rows-1));
    const strength=node.visible*envelope;
    const roll=node.roll=smoothstep(node.age,.075,.257)*strength;
    node.lift=(.072+node.h*(.60+.64*node.potency))*strength;
    const fringe=.53+.47*Math.sin(node.z*6.71-time*3.3+.72*Math.sin(node.z*10.7));
    const foamStart=smoothstep(node.age,.105,.35);
    const aeration=(.13+.87*foamStart)*(.48+.52*fringe)*(.42+.58*smoothstep(node.potency,.28,.73));
    const at=index*4, optics=at+rows*4;
    buffer[at]=node.x;
    buffer[at+1]=roll;
    buffer[at+2]=node.lift;
    buffer[at+3]=strength;
    buffer[optics]=aeration;
    if(node.visible<.045) return;
    active++;
    let reversed=0;
    for(let i=1;i<xSections.length;i++) {
      if(lerp(1/16,xSections[i]-xSections[i-1],roll)<-.001) reversed++;
    }
    if(reversed) rolled++;
    openings+=reversed;
    if(node.visible>.42 && node.age>.168 && index%3===0 && !node.produced) {
      node.produced=true;
      const {x,y,z}=breakingPosition(node,node.z,.48,field,swash,time,point);
      for(let j=0;j<3;j++) {
        const seed=.5+.5*Math.sin(index*17.62+j*4.19+time*7.1);
        drop(time,x,y,z+(j-1)*.032,node.velocity-.25-.61*seed,.27+.59*seed,.08+(j-1)*.25,.004+.006*seed);
        spray++;
      }
      if(index%9===0) bubbles(x,y,z,time,node.visible);
    }
  }

  function frame(time,dt) {
    if(dt<=0) return;
    active=rolled=openings=0;
    let width=0;
    for(const [i,node] of section.entries()) {
      follow(node,time,dt);
      writeRow(node,i,time);
      if(i>0 && node.visible>.045 && section[i-1].visible>.045) {
        width+=node.z-section[i-1].z;
        maxWidth=Math.max(maxWidth,width);
      } else width=0;
    }
    texture.needsUpdate=true;
    const center=section[Math.floor(rows/2)];
    if(center.visible>.63 && time-lastPass>.81) {
      lastPass=time;
      passes++;
      events.push({time,x:center.x,z:center.z,depth:center.depth,height:center.h,velocity:center.velocity});
      if(events.length>9) events.shift();
    }
  }

  function renderHeight(x,z,time) {
    const base=swash.height(x,z,field.height(x,z,time));
    const at=(z-bankStart)*(rows-1)/breakerSpan;
    if(x>origin.x-5.42 || at<0 || at>=rows-1) return base;
    const i=Math.floor(at)*4, t=at%1;
    const a=buffer[i+3], b=buffer[i+7];
    if(a<.02 && b<.02) return base;
    const center=a<.02 ? buffer[i+4] : b<.02 ? buffer[i] : lerp(buffer[i],buffer[i+4],t);
    const weight=uniforms.breakingBlend.value;
    return base+crestRiseAt(x,center,weight*lerp(buffer[i+1],buffer[i+5],t),weight*lerp(buffer[i+2],buffer[i+6],t));
  }
  return {uniforms,frame,renderHeight,inspect:()=>({passes,events:events.slice(),active,rolled,openings,maxWidth,foamed,spray})};
}
