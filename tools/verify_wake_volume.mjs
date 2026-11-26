import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createShallowWater } from "../viewer/bridge-shallow-water.js";
import { createWakeVolume, submergedDrift } from "../viewer/bridge-wake-volume.js";

const dt=1/66, depth=1.28;
const solver=createShallowWater({minX:-4,minZ:-5,width:8,length:10,columns:80,rows:100,
  depthAt:x=>Math.abs(x)<3.11 ? depth : 0,piers:[{x:2,y:1.5}]});
const volume=createWakeVolume(solver);
const motion={x:0,y:-.11,z:0,w:0};
const boat={x:0,y:-2,z:0,w:1};
const history=[];
let roll, air=0, downstreamAfterRemoval=0;
for(let i=0;i<490;i++) {
  const moving=i<115;
  if(moving) boat.y+=motion.y*dt;
  solver.advance(dt,moving ? boat : null,motion);
  volume.refresh();
  volume.emit((i+1)*dt,()=>air++);
  const packet=solver.inspect().wakes.packets.find(p=>p.source==="skiff" && p.id===1);
  if(packet && packet.age>.57 && packet.age<.59) roll=probeRoll(packet);
  if(!moving && packet) downstreamAfterRemoval=Math.max(downstreamAfterRemoval,packet.z);
  if(i%22===0) history.push({i,packet,rolls:volume.inspect().rolls});
}

function probeRoll(packet) {
  const at=(x,z,fraction,column=depth)=>volume.at(x,z,fraction,column,{});
  const {x,z,radius}=packet;
  const right=x+radius*.93, left=x-radius*.93;
  const measurement={
    packet, center:at(x,z,.5), right:at(right,z,.5), left:at(left,z,.5),
    upperRight:at(right,z,.26), lowerRight:at(right,z,.74),
    top:at(x,z,0), bed:at(x,z,1), dry:at(x,z,.5,solver.columnAt(3.75,z)),
  };
  const h=.001, fraction=.40;
  const lateralRate=(at(right+h,z,fraction).x-at(right-h,z,fraction).x)/(2*h);
  const verticalRate=(at(right,z,fraction-h/depth).y-at(right,z,fraction+h/depth).y)/(2*h);
  measurement.divergence=lateralRate+verticalRate;
  assert.ok(volume.encode());
  assert.equal(volume.encode(),false);
  const col=Math.floor((right-solver.minX)/.10), row=Math.floor((z-solver.minZ)/.10);
  const atCell=(row*solver.columns+col)*4;
  const packed=volume.data.slice(atCell,atCell+4);
  const midCell=at(solver.minX+(col+.5)*.10,solver.minZ+(row+.5)*.10,.5);
  measurement.packed={bytes:[...packed],referenceLift:midCell.y,
    decodedLift:(packed[2]-128)*1.85/127*depth/Math.PI};
  return measurement;
}

assert.ok(roll && roll.center.y<-.20 && roll.right.y>.09 && roll.left.y>.09,roll);
assert.ok(roll.upperRight.x<-.08 && roll.lowerRight.x>.08,roll);
assert.ok(Math.abs(roll.divergence)<.001,roll.divergence);
for(const where of ["top","bed","dry"]) assert.deepEqual(roll[where],{x:0,y:0,z:0});
assert.ok(Math.abs(roll.packed.referenceLift-roll.packed.decodedLift)<.004,roll.packed);
assert.ok(downstreamAfterRemoval>roll.packet.z+.55,downstreamAfterRemoval);
assert.ok(air>=2 && solver.inspect().wakes.packets.every(p=>p.source!=="skiff"));
assert.ok(submergedDrift(.26)>submergedDrift(.74)+.40);
const result={roll,air,downstreamAfterRemoval,history};
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({roll,air,downstreamAfterRemoval},null,2));
