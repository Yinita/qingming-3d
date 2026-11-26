import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const code=await readFile(new URL("../viewer/bridge-street-runoff.js",import.meta.url));
const solverModule="data:text/javascript;base64,"+code.toString("base64");
const {createStreetRunoff}=await import(solverModule);

const w=18,h=5,n=w*h;
const bed=new Float32Array(n), solid=new Uint8Array(n), river=new Uint8Array(n);
const wet=new Float32Array(n), exposed=new Uint8Array(n), soil=new Float32Array(n).fill(.46);
const at=(x,z)=>z*w+x;
for(let z=0;z<h;z++) for(let x=0;x<w;x++) {
  bed[at(x,z)]=20-x*1.18;
  if(z===1 || z===3) solid[at(x,z)]=1;
  if(z===2 && x===w-1) river[at(x,z)]=1;
}
const solver=createStreetRunoff(w,h,bed,solid,river,.0625);
solver.add(at(1,2),2.0,true);
solver.add(at(4,1),1.2,true);
for(let i=0;i<135;i++) solver.advance(.08,0,wet,exposed,soil);
const channeled=solver.inspect();
assert.ok(channeled.runoffInLitres>1.49 && channeled.runoffInLitres<1.51);
assert.ok(channeled.runoffInRiverLitres>.12,channeled);
assert.ok(channeled.infiltratedLitres>1.2,channeled);
assert.ok(channeled.runoffMovedLitres>channeled.runoffInLitres*4,channeled);
assert.ok(channeled.storedLitres<.12,channeled);
assert.ok(Math.abs(channeled.balanceErrorLitres)<.00001,channeled);
for(let x=0;x<w;x++) {
  assert.equal(solver.depth[at(x,0)],0);
  assert.equal(solver.depth[at(x,1)],0);
  assert.equal(solver.depth[at(x,3)],0);
  assert.equal(solver.depth[at(x,4)],0);
}
assert.ok(solver.depth.every(v=>v>=0) && solver.tracer.every(v=>v>=0));

const shelf=createStreetRunoff(3,1,new Float32Array(3),new Uint8Array(3),new Uint8Array(3),.0625);
const intake=new Float32Array([.75,.75,.75]), open=new Uint8Array([1,0,0]);
const basin=new Float32Array([.70,.70,.70]);
for(let i=0;i<80;i++) shelf.advance(.08,1,intake,open,basin);
const first=shelf.inspect();
assert.ok(shelf.depth[0]>shelf.depth[1] && shelf.depth[1]>shelf.depth[2]);
shelf.displace(1);
const second=shelf.inspect();
assert.ok(second.displacedLitres>0 && second.storedLitres<first.storedLitres);
assert.ok(Math.abs(second.balanceErrorLitres)<.00001,second);
assert.equal(shelf.depth[1],0);

const fieldCode=await readFile(new URL("../viewer/bridge-street-rain-field.js",import.meta.url),"utf8");
const {createStreetRainField}=await import("data:text/javascript;base64,"+
  Buffer.from(fieldCode.replace("./bridge-street-runoff.js",solverModule)).toString("base64"));
const layout={width:w,height:h,bed,blocked:solid,whichRiver:river,basin:soil,
  deck:new Uint8Array(n),open:exposed,area:.0625};
const background=createStreetRainField(layout);
let snapshot=background.advance({dt:.08,intensity:0,input:[at(1,2),1.6,false,true]});
for(let i=0;i<20;i++) snapshot=background.advance({dt:.08,intensity:0,input:[]});
const recovered=createStreetRainField(layout);
recovered.resume(snapshot);
const covered=solid.slice();
covered[at(5,2)]=1;
const transfer={dt:.08,intensity:0,input:[at(8,2),.4,false,true],
  cover:{open:exposed,blocked:covered}};
const after=background.advance(transfer);
const resumed=recovered.advance(transfer);
assert.deepEqual(new Float32Array(resumed.grid),new Float32Array(after.grid));
assert.deepEqual(new Uint8Array(resumed.pixels),new Uint8Array(after.pixels));
assert.deepEqual(resumed.shoreline,after.shoreline);
const recoveryError=Math.abs(resumed.stats.runoff.balanceErrorLitres);
assert.ok(recoveryError<.00001,resumed.stats);

// The worker can catch up across several substeps. Even a trickle below the
// visual ripple cutoff must appear in the packet exactly once.
const sink=at(w-1,2);
const transferField=createStreetRainField(layout);
const incoming=transferField.advance({dt:.46,intensity:0,input:[at(w-2,2),.014,false,true]});
assert.equal(incoming.shoreline.length,5);
const [outlet,depth,vx,vz,tagged]=incoming.shoreline;
const volumeUnit=.012*layout.area;
assert.equal(outlet,sink);
assert.ok(depth>0 && depth<.018 && vx>0 && vz===0,incoming.shoreline);
assert.equal(incoming.dt,.46);
assert.ok(Math.abs(depth*volumeUnit*1000-incoming.stats.runoff.riverLitres)<1e-10);
assert.ok(Math.abs(tagged*volumeUnit*1000-incoming.stats.runoff.runoffInRiverLitres)<1e-10);
const following=transferField.advance({dt:.31,intensity:0,input:[]});
assert.ok(Math.abs((following.shoreline[1] ?? 0)*volumeUnit*1000-
  (following.stats.runoff.riverLitres-incoming.stats.runoff.riverLitres))<1e-10);
console.log(JSON.stringify({channeled,first,second,recoveryError,catchup:incoming.shoreline},null,2));
