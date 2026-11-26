import assert from "node:assert/strict";
import { createSheetBreakup, sampleFilmBreakup } from "../viewer/bridge-bilge-breakup.js";

const old={}, mature={}, thick={};
let openings=0, rimSamples=0, grown=0, strongest=null;
for(let zi=0;zi<140;zi++) for(let ti=0;ti<85;ti++) {
  const z=-1.53+zi*.021, born=2.02+ti*.017;
  sampleFilmBreakup(z,born,.058,.0038,1,old);
  sampleFilmBreakup(z,born,.123,.0038,1,mature);
  sampleFilmBreakup(z,born,.123,.028,1,thick);
  assert.ok(mature.cut>=old.cut && mature.cut<=1 && mature.rim>=0 && mature.rim<=1);
  assert.equal(thick.cut,0);
  assert.equal(thick.rim,0);
  openings+=Number(mature.cut>.70);
  rimSamples+=Number(mature.rim>.22);
  grown+=Number(mature.cut>old.cut+.20);
  if(!strongest || mature.cut>strongest.tear.cut) strongest={z,born,tear:{...mature}};
}
assert.ok(openings>35 && rimSamples>35 && grown>50,{openings,rimSamples,grown});
assert.deepEqual(sampleFilmBreakup(strongest.z,strongest.born,.02,.0038,1,{}),{cut:0,rim:0,key:0});

const film=createSheetBreakup(), accepted=[];
const emit=(site,seed,time)=>{
  assert.ok(site.cut>=.7 && site.gauge===.0038 && seed>=0 && seed<1);
  accepted.push({site,seed,time});
  return true;
};
film.begin(2.22);
film.track(strongest.tear,.39,.14,.28,-.8,-1.01,.0038);
film.track(strongest.tear,.41,.19,.31,-.8,-1.01,.0038);
film.finish(2.22,emit);
film.begin(2.26);
film.track(strongest.tear,.41,.19,.31,-.8,-1.01,.0038);
film.finish(2.26,emit);
assert.equal(accepted.length,1);
assert.deepEqual(film.inspect(),{nodes:1,rims:0,openings:1,peakNodes:2});
console.log(JSON.stringify({openings,rimSamples,grown,accepted:accepted.length},null,2));
