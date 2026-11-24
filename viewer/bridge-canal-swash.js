import * as THREE from "three";
import { canalShoreRadius, canalTerrainHeight } from "./bridge-canal-bed.js";

const rows=128, span=10.6, limit=.54;
const {lerp,smoothstep}=THREE.MathUtils;

export function buildCanalSwash(origin,sourceZ,field,heightAt) {
  const minZ=sourceZ-span/2;
  const bytes=new Uint8Array(rows*4);
  const map=new THREE.DataTexture(bytes,rows,1,THREE.RGBAFormat);
  map.name="Shoreline wetting and retreat";
  map.minFilter=map.magFilter=THREE.LinearFilter;
  map.needsUpdate=true;
  const wetting={
    bankWash:{value:map},
    bankWashBounds:{value:new THREE.Vector2(minZ,1/span)},
    bankWashRange:{value:limit},
  };
  const bank=Array.from({length:rows},(_,i)=>{
    const z=minZ+(i+.5)*span/rows;
    const x=origin.x-canalShoreRadius(z-origin.y,-1);
    return {x,z,reach:0,wet:0,velocity:0};
  });
  let widest=0,liveReach=0,maxRetained=0,darkened=0,lastTime=0;

  function frame(time,dt) {
    if(dt<=0) return;
    lastTime=time;
    liveReach=darkened=0;
    for(const [row,state] of bank.entries()) {
      const {x,z}=state;
      const edge=Math.max(0,heightAt(x+.37,z)-.037);
      const head=Math.min(limit,edge*4.15);
      const quick=head>state.reach ? 12.8 : 6.1;
      const last=state.reach;
      state.reach=lerp(state.reach,head,Math.min(1,dt*quick));
      state.velocity=(state.reach-last)/dt;
      state.wet=Math.max(state.reach,state.wet*Math.exp(-dt*.37));
      widest=Math.max(widest,state.reach);
      liveReach=Math.max(liveReach,state.reach);
      maxRetained=Math.max(maxRetained,state.wet-state.reach);
      darkened+=Number(state.wet-state.reach>.069);
      const at=row*4;
      bytes[at]=Math.round(255*state.wet/limit);
      bytes[at+1]=Math.round(255*state.reach/limit);
      bytes[at+3]=255;
    }
    map.needsUpdate=true;
  }

  const current={signed:0,reach:0,velocity:0};
  function sample(x,z) {
    if(x>origin.x) return false;
    const line=(z-minZ)/span*rows-.5;
    if(line<0 || line>=rows-1) return false;
    const row=Math.floor(line), a=bank[row], b=bank[row+1], t=line-row;
    const reach=lerp(bytes[row*4+1],bytes[(row+1)*4+1],t)*limit/255;
    const signed=x-(origin.x-canalShoreRadius(z-origin.y,-1));
    if(reach<=.022 || signed< -reach || signed>=.155) return false;
    current.signed=signed;
    current.reach=reach;
    current.velocity=lerp(a.velocity,b.velocity,t);
    return true;
  }

  function heightAtFilm(x,z,baseline) {
    const {signed,reach}=current;
    const thin=canalTerrainHeight(origin,x,z)+.006+.008*Math.sqrt(reach);
    return lerp(thin,Math.max(baseline,thin),smoothstep(signed,-reach,.155));
  }

  function height(x,z,baseline) {
    return sample(x,z) ? heightAtFilm(x,z,baseline) : baseline;
  }

  function support(x,z,out) {
    if(!sample(x,z)) return false;
    const {signed,reach,velocity}=current;
    const filmElevation=heightAtFilm(x,z,field.height(x,z,lastTime));
    const cross=(.155-signed)/(.155+reach);
    const depth=(.004+.008*reach/4.15)*(1-cross*.76);
    out.depth=Math.max(out.depth,depth);
    out.height=Math.max(out.height,out.ground,filmElevation);
    out.u=-velocity*(.4+.6*cross);
    out.v=0;
    return true;
  }
  return {wetting,frame,support,height,inspect:()=>({widest,liveReach,maxRetained,darkened})};
}
