import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createHullBoundary } from "../viewer/bridge-hull-boundary.js";
import { createShallowWater } from "../viewer/bridge-shallow-water.js";

const boundary=createHullBoundary();
const box=[{x:-.3,y:-1}, {x:.3,y:-1}, {x:.3,y:1}, {x:-.3,y:1}];
const probe={};
for(const ring of [box,[...box].reverse()]) {
  assert.ok(boundary.update(ring));
  assert.ok(Math.abs(boundary.sample(.32,.01,probe).distance-.02)<1e-12,probe);
  assert.ok(probe.nx>.999 && Math.abs(probe.nz)<1e-8,probe);
  assert.ok(boundary.sample(.24,.01,probe).distance<-.059,probe);
  assert.ok(probe.nx>.999,probe);
  boundary.sample(.3,.01,probe);
  assert.ok(probe.nx>.999,probe);
}
assert.equal(boundary.update(box.map(point=>({...point,x:0}))),false);

const physics={minX:-4,minZ:-4,width:8,length:8,columns:96,rows:96,current:0,
  openEnds:false,depthAt:()=>.84};
const narrow=createShallowWater(physics), broad=createShallowWater(physics);
const pose={x:-.75,y:.12,z:0,w:1};
const motion={x:.73,y:0,z:0,w:-.041};
const dt=1/66, cell=physics.width/physics.columns;
const plan=[
  [-1.64,.043],[-1.43,.36],[-.77,.53],[.32,.60],[1.10,.38],[1.53,.061],
];
function outline(scale) {
  return [...plan.map(([z,beam])=>({x:pose.x-beam*scale,y:pose.y+z})),
    ...plan.slice().reverse().map(([z,beam])=>({x:pose.x+beam*scale,y:pose.y+z}))];
}

function distribution(solver,footprint) {
  solver.pack();
  boundary.update(footprint);
  let sum=0,gap=0,interior=0,peak=0,far=0,beam=0;
  const bytes=solver.flowTexture;
  for(let row=0;row<physics.rows;row++) for(let col=0;col<physics.columns;col++) {
    const x=physics.minX+(col+.5)*cell,z=physics.minZ+(row+.5)*cell;
    const d=boundary.sample(x,z,probe).distance;
    const air=bytes[(row*physics.columns+col)*4+2]/255;
    sum+=air;
    gap+=air*Math.abs(d);
    beam+=air*Math.abs(x-pose.x);
    if(d<-.06) interior+=air;
    if(d>.35) far+=air;
    peak=Math.max(peak,air);
  }
  return {sum,meanGap:gap/sum,meanBeam:beam/sum,interior,far,peak};
}

const slimOutline=outline(.60), wideOutline=outline(1.19);
narrow.advance(dt,pose,motion,()=>slimOutline);
broad.advance(dt,pose,motion,()=>wideOutline);
const slim=distribution(narrow,slimOutline), wide=distribution(broad,wideOutline);
assert.ok(slim.meanGap<.13 && wide.meanGap<.13 && slim.peak>.15 && wide.peak>.15,{slim,wide});
assert.ok(slim.interior===0 && wide.interior===0 && slim.far===0 && wide.far===0,{slim,wide});
assert.ok(wide.meanBeam>slim.meanBeam+.18,{slim,wide});

let peakWave=0, strongestShapeDifference=0;
for(let i=0;i<159;i++) {
  const active=i<81;
  if(active) pose.x+=motion.x*dt;
  const boat=active ? pose : null;
  narrow.advance(dt,boat,motion,()=>outline(.60));
  broad.advance(dt,boat,motion,()=>outline(1.19));
  const a=narrow.sample(.65,.54).height,b=broad.sample(.65,.54).height;
  peakWave=Math.max(peakWave,Math.abs(a),Math.abs(b));
  strongestShapeDifference=Math.max(strongestShapeDifference,Math.abs(a-b));
}
wideOutline.length=0;
broad.advance(dt,pose,motion,()=>wideOutline);
broad.pack();
const report={slim,wide,peakWave,strongestShapeDifference,detached:broad.inspect()};
assert.ok(peakWave>.006 && strongestShapeDifference>.005,report);
assert.ok(report.detached.peakHeight<.24 && report.detached.airInput===0,report);
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
