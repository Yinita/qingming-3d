import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createShallowWater } from "../viewer/bridge-shallow-water.js";

const physics={minX:-4,minZ:-4,width:8,length:8,columns:64,rows:64,current:0,openEnds:false};
const basin=createShallowWater({...physics,depthAt:()=>.84});
const shore=createShallowWater({...physics,depthAt:x=>x<1.875 ? .84 : 0});
const timestep=1/66;
const near={x:1.08,z:.12}, far={x:-2.38,z:.12};
const probe={};
basin.impact(0,0,1,"stone");
shore.impact(0,0,1,"stone");

const trace=[];
let massError=0;
for(let i=0;i<211;i++){
  basin.advance(timestep);
  shore.advance(timestep);
  const free=basin.sample(near.x,near.z,probe);
  const clean={ h:free.height,u:free.u };
  const bounded=shore.sample(near.x,near.z,probe);
  const outside=shore.sample(2.05,.12);
  trace.push({t:(i+1)*timestep, freeHeight:clean.h, shoreHeight:bounded.height,
    freeAcross:clean.u, shoreAcross:bounded.u, distant:basin.sample(far.x,far.z).height,
    outside:outside.height});
  basin.pack();
  shore.pack();
  massError=Math.max(massError,Math.abs(basin.inspect().volume),Math.abs(shore.inspect().volume));
}
assert.ok(trace.every(sample=>sample.outside===0),"dry cells remain dry");
const distanceArrival=trace.find(sample=>Math.abs(sample.distant)>.006)?.t;
assert.ok(distanceArrival>.43 && distanceArrival<1.26,distanceArrival);
const firstReflection=trace.find(sample=>Math.abs(sample.shoreHeight-sample.freeHeight)>.008)?.t;
assert.ok(firstReflection>.54 && firstReflection<1.42,firstReflection);
const returnFlow=trace.filter(sample=>sample.t>firstReflection && sample.t<1.73)
  .find(sample=>sample.shoreAcross<-.028 && sample.shoreAcross<sample.freeAcross-.022);
assert.ok(returnFlow,"bank-reflected disturbance travels upstream of the impact-side sample");
assert.ok(massError<.00012,massError);

const tow=createShallowWater({...physics,current:.39,openEnds:true,depthAt:()=>.84});
const wake=[];
for(let i=0;i<270;i++){
  const time=i*timestep;
  const boat=time<1.28 ? {x:-1.30+time*.85,y:0,z:0,w:1} : null;
  const mover={x:.85,y:0,z:0,w:-.026};
  tow.advance(timestep,boat,mover);
  if(i%3===0){
    tow.pack();
    const trail=tow.sample(-.78,.68);
    wake.push({time, sourceActive:!!boat, wave:trail.height, foam:trail.foam,
      energy:tow.inspect().energy, peakFoam:tow.inspect().peakFoam});
  }
}
const trailing=wake.filter(row=>row.time>1.55 && row.time<2.60);
assert.ok(trailing.some(row=>Math.abs(row.wave)>.006 && row.energy>.006),trailing);
assert.ok(trailing.some(row=>row.peakFoam>.035),"foam persists after the source is removed");
assert.ok(tow.inspect().peakHeight<.30,tow.inspect());

const channel={...physics,current:.39,openEnds:true,depthAt:()=>.84};
const clear=createShallowWater(channel);
const blocked=createShallowWater({...channel,piers:[{x:0,y:0}]});
const pile={
  clearSpeed:clear.sample(0,0).meanV,
  stopping:blocked.sample(0,0).meanV,
  upstreamLeft:blocked.sample(-.23,-.29).meanU,
  upstreamRight:blocked.sample(.23,-.29).meanU,
  sideSpeed:blocked.sample(.23,0).meanV,
  downstreamReturn:blocked.sample(.23,.29).meanU,
};
assert.ok(Math.abs(pile.stopping)<.001 && pile.sideSpeed>1.20*pile.clearSpeed,pile);
assert.ok(pile.upstreamLeft<-.03 && pile.upstreamRight>.03 && pile.downstreamReturn<-.03,pile);
for(let i=0;i<210;i++) blocked.advance(timestep);
pile.downstreamFoam=blocked.sample(.30,.89).foam;
pile.upstreamFoam=blocked.sample(.30,-.89).foam;
assert.ok(pile.downstreamFoam>.014 && pile.downstreamFoam>3*pile.upstreamFoam,pile);

const stationary={x:-.1,y:-.42,z:0,w:1};
clear.advance(timestep,stationary,{x:0,y:0,z:0,w:0});
const hull={stillWater:clear.sample(stationary.x,stationary.y).meanV,
  flankSpeed:clear.sample(stationary.x-.66,stationary.y).meanV};
clear.advance(timestep,stationary,{x:0,y:.22,z:0,w:0});
hull.movingWater=clear.sample(stationary.x,stationary.y).meanV;
assert.ok(Math.abs(hull.stillWater)<.02 && hull.flankSpeed>1.30*pile.clearSpeed,hull);
assert.ok(Math.abs(hull.movingWater-.22)<.025,hull);

const flume=createShallowWater({minX:-4,minZ:-5,width:8,length:10,columns:80,rows:92,current:0,
  depthAt:x=>x< -3.15 ? 0 : Math.min(1.35,.12+(x+3.15)*.39),
  waveMaker:{x:1.85,z:0,span:4.3,period:1.68,amplitude:.128}});
const series=[];
for(let i=0;i<661;i++) {
  if(i===435) flume.stopWaveMaker();
  flume.advance(timestep);
  series.push({time:(i+1)*timestep,inner:flume.heightAt(.52,0),shore:flume.heightAt(-2.15,0),
    forcing:flume.inspect().forcing});
}
function crests(key) {
  return series.filter((v,i)=>i>0 && i<series.length-1 && v[key]>.079 &&
    v[key]>=series[i-1][key] && v[key]>series[i+1][key]);
}
const inner=crests("inner"), shoreward=crests("shore");
const travel=shoreward[0]?.time-inner[0]?.time;
const detached=shoreward.filter(row=>!row.forcing);
assert.ok(inner.length>=4 && shoreward.length>=4 && travel>.6 && travel<1.1,{inner,shoreward,travel});
assert.ok(detached.some(row=>row.time>7.4 && row.shore>.084),detached);
const waveTrain={travel,inner,shoreward,detached,series};
const intake={...physics,depthAt:x=>x> -3 ? .84 : 0};
const withInflow=createShallowWater(intake);
const zeroMomentum=createShallowWater(intake);
const parcel={x:-2.67,z:.065}, controlParcel={...parcel};
const mouth=withInflow.enqueueRunoff(-3.04,.065,.008,1.15,0,.005,.32);
zeroMomentum.enqueueRunoff(-3.04,.065,.008,0,0,.005,.32);
assert.ok(mouth && mouth.x> -3,mouth);
assert.equal(withInflow.enqueueRunoff(-6,0,.001,1,0,0,.1),null);
let largestDirectionalDifference=0, farthestParcelDifference=0;
for(let i=0;i<92;i++) {
  withInflow.advance(timestep);
  zeroMomentum.advance(timestep);
  largestDirectionalDifference=Math.max(largestDirectionalDifference,
    withInflow.sample(-2.77,.065).u-zeroMomentum.sample(-2.77,.065).u);
  for(const [solver,leaf] of [[withInflow,parcel],[zeroMomentum,controlParcel]]) {
    const v=solver.sample(leaf.x,leaf.z);
    leaf.x+=(v.u+v.meanU)*timestep;
    leaf.z+=(v.v+v.meanV)*timestep;
  }
  farthestParcelDifference=Math.max(farthestParcelDifference,parcel.x-controlParcel.x);
}
withInflow.pack();
const inlet={...withInflow.inspect().runoff,waterLitres:withInflow.inspect().volume*1000,
  largestDirectionalDifference,farthestParcelDifference};
assert.equal(inlet.acceptedLitres,8);
assert.equal(inlet.rejectedLitres,1);
assert.ok(Math.abs(inlet.appliedLitres-8)<1e-9 && Math.abs(inlet.taggedLitres-5)<1e-9,inlet);
assert.ok(inlet.pendingLitres<1e-9 && Math.abs(inlet.waterLitres-8)<.001,inlet);
assert.ok(largestDirectionalDifference>.021 && farthestParcelDifference>.002,inlet);
assert.equal(withInflow.sample(-3.60,.065).runoff,0);

const moving=createShallowWater({...intake,current:.52});
const still=createShallowWater(intake);
for(const solver of [moving,still]) solver.enqueueRunoff(-2.52,0,.002,0,0,.001,.12);
for(let i=0;i<113;i++) for(const solver of [moving,still]) solver.advance(timestep);
inlet.downstreamMarker=moving.sample(-2.52,.75).runoff;
inlet.upstreamMarker=moving.sample(-2.52,-.75).runoff;
inlet.stillMarker=still.sample(-2.52,.75).runoff;
assert.ok(inlet.downstreamMarker>.012 && inlet.downstreamMarker>3*inlet.upstreamMarker &&
  inlet.downstreamMarker>3*inlet.stillMarker,inlet);
const result={ timestep, distanceArrival, firstReflection, returnFlow, massError, pile, hull, trace, wake, waveTrain, inlet };
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({distanceArrival,firstReflection,returnFlow,massError,inlet,
  detachedWave:Math.max(...trailing.map(row=>Math.abs(row.wave))),pile,hull,
  waveTrain:{travel,inner:inner.length,shoreward:shoreward.length,detached}},null,2));
