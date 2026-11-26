import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createShallowWater } from "../viewer/bridge-shallow-water.js";

const dt=1/66;
const channel={minX:-4,minZ:-6,width:8,length:12,columns:64,rows:96,
  current:.39,depthAt:x=>x>3.24 ? 0 : .91};
const pier=[{x:0,y:0}];
const moving=createShallowWater({...channel,piers:pier});
const fixed=createShallowWater({...channel,piers:pier,wakeStrength:0});
const boat=createShallowWater(channel);
const noBoatWake=createShallowWater({...channel,wakeStrength:0});
const still=createShallowWater({...channel,current:0,piers:pier});
const idle=createShallowWater({...channel,current:0,piers:pier});
let stillDetachedCurl=0;
const motion={x:.46,y:-.22,z:0,w:0};
const epsilon=.145;

function curl(yes,no,x,z) {
  const sample=(x,z)=>{
    const a=yes.sample(x,z),b=no.sample(x,z);
    return [a.meanU-b.meanU,a.meanV-b.meanV];
  };
  return (sample(x+epsilon,z)[1]-sample(x-epsilon,z)[1]-
    sample(x,z+epsilon)[0]+sample(x,z-epsilon)[0])/(2*epsilon);
}
const births=new Map();
const pierResult={upstream:0,foamExtra:0,peakHeight:0};
const skiffResult={detachedCurl:0,detachedDrift:0,transverse:0,oldest:null,last:null};
const tracks=[];
for(let i=0;i<655;i++) {
  const t=(i+1)*dt;
  const hull=t<1.78 ? {x:-1.36+motion.x*t,y:-1.8+motion.y*t,z:0,w:1} : null;
  const outline=()=>{
    const {x,y}=hull;
    return [{x:x-.43,y:y-.82},{x:x-.37,y:y+.68},{x,y:y+1.48},
      {x:x+.37,y:y+.68},{x:x+.43,y:y-.82},{x,y:y-1.40}];
  };
  moving.advance(dt);
  fixed.advance(dt);
  boat.advance(dt,hull,motion,outline);
  noBoatWake.advance(dt,hull,motion,outline);
  still.advance(dt,hull,motion,outline);
  idle.advance(dt);
  if(!hull && i%6===0) {
    const old=still.inspect().wakes.packets[0];
    if(old) stillDetachedCurl=Math.max(stillDetachedCurl,Math.abs(curl(still,idle,old.x,old.z)));
  }
  if(i%6!==0) continue;

  const scene=moving.inspect();
  assert.ok(Math.abs(moving.sample(0,0).meanV)<.004, "pier cells have no through-flow");
  assert.equal(moving.sample(3.66,1.2).meanV,0);
  assert.equal(moving.sample(3.66,1.2).foam,0);
  pierResult.peakHeight=Math.max(pierResult.peakHeight,scene.peakHeight);
  for(const packet of scene.wakes.packets) {
    const rotation=curl(moving,fixed,packet.x,packet.z);
    const record=births.get(packet.id)??{side:packet.side,origin:packet.z,maxZ:packet.z,curl:0,maxRadius:0};
    record.maxZ=Math.max(packet.z,record.maxZ);
    if(packet.age>.27 && packet.age<.73) record.curl=rotation;
    record.maxRadius=Math.max(record.maxRadius,packet.radius);
    births.set(packet.id,record);
  }
  const upstream=moving.sample(0,-1.05);
  pierResult.upstream=Math.max(pierResult.upstream,upstream.foam);
  // A shedding wake moves side to side. Compare the entire wake section.
  let foam=0, staticFoam=0;
  for(let x=-.57;x<.61;x+=.12) for(let z=.52;z<1.98;z+=.12) {
    foam+=moving.sample(x,z).foam;
    staticFoam+=fixed.sample(x,z).foam;
  }
  pierResult.foamExtra=Math.max(pierResult.foamExtra,foam-staticFoam);

  const skiff=boat.inspect().wakes;
  const packet=skiff.packets[0];
  if(packet && !skiffResult.oldest) skiffResult.oldest=packet;
  if(packet && packet.id===skiffResult.oldest.id && !hull) {
    skiffResult.last=packet;
    skiffResult.detachedDrift=packet.z-skiffResult.oldest.z;
    skiffResult.detachedCurl=Math.max(skiffResult.detachedCurl,Math.abs(curl(boat,noBoatWake,packet.x,packet.z)));
    const a=boat.sample(packet.x,packet.z+.26), b=noBoatWake.sample(packet.x,packet.z+.26);
    skiffResult.transverse=Math.max(skiffResult.transverse,Math.abs(a.meanU-b.meanU));
    assert.equal(skiff.skiffAttached,false);
  }
  tracks.push({t,pier:scene.wakes.packets,skiff:skiff.packets});
}

const cores=[...births.values()].filter(v=>v.maxZ-v.origin>.43);
assert.ok(cores.length>=3, cores);
for(const [i,packet] of cores.entries()) {
  assert.ok(packet.side*packet.curl<-.85,packet);
  assert.ok(packet.maxRadius>.35,JSON.stringify(packet));
  if(i) assert.equal(packet.side,-cores[i-1].side);
}
assert.ok(pierResult.foamExtra>.55 && pierResult.upstream<.004,pierResult);
assert.ok(pierResult.peakHeight<.060,pierResult);
assert.ok(skiffResult.detachedCurl>.8 && skiffResult.detachedDrift>.85 && skiffResult.transverse>.075,skiffResult);
assert.equal(boat.inspect().wakes.packets.length,0);
assert.ok(stillDetachedCurl>.8,stillDetachedCurl);
assert.equal(still.inspect().wakes.pierBirths.length,0);
assert.equal(idle.inspect().wakes.packets.length,0);
assert.equal(idle.inspect().peakHeight,0);
const result={pier:{...pierResult,cores},skiff:{...skiffResult,stillDetachedCurl},tracks};
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({pier:result.pier,skiff:result.skiff},null,2));
