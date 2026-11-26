import assert from "node:assert/strict";
import { createSpillProfile } from "../viewer/bridge-bilge-parcels.js";

const rows=19, profile=createSpillProfile(rows);
const parcel={born:0,due:.24,volume:.0008,dt:1/60,lipSpeed:1.2};
const sum=values=>values.reduce((total,value)=>total+value,0);
function deposit(samples,now) {
  profile.clear();
  const live=samples.filter(sample=>profile.deposit(sample,now));
  const total=live.reduce((amount,sample)=>amount+sample.volume,0);
  assert.ok(Math.abs(total-sum(profile.water))<1e-13);
  assert.ok(Math.abs(profile.total-total)<1e-13);
  assert.ok(profile.water.every(volume=>volume>=0));
  const expectedAge=live.reduce((elapsed,sample)=>elapsed+sample.volume*(now-sample.born),0);
  assert.ok(Math.abs(expectedAge-sum(profile.age))<1e-13);
}
function center() {
  return sum(profile.water.map((water,index)=>water*index))/profile.total/(rows-1);
}

const centers=[];
for(const time of [0,.060,.120,.180,.238]) {
  deposit([parcel],time);
  centers.push(center());
}
assert.ok(centers[0]<.04 && centers[4]>.95,centers);
assert.ok(centers[3]>centers[2] && centers[2]>centers[1],centers);
deposit([parcel],.24);
assert.equal(sum(profile.water),0);

const resumed={...parcel,born:.121,due:.361,volume:.0004};
deposit([parcel,resumed],.17);
const hasDrySpace=profile.water.slice(6,10).some(amount=>amount<1e-8);
assert.ok(hasDrySpace,profile.water);
assert.ok(profile.water[0]===0 && profile.water[4]>0 && profile.water[13]>0,profile.water);

const flight=.21, dt=1/60;
const steady=Array.from({length:20},(_,i)=>({born:i*dt,due:i*dt+flight,volume:.0006,dt,lipSpeed:1}));
deposit(steady,.239);
const middle=profile.water.slice(4,15);
const steadyVariation=Math.max(...middle)/Math.min(...middle);
assert.ok(steadyVariation<1.12,steadyVariation);

console.log(JSON.stringify({centers,hasDrySpace,steadyVariation},null,2));
