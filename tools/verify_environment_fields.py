"""Compare wind and water texture bytes against the pre-optimization modules."""

import argparse
import json
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import sync_playwright


AUDIT = """async()=>{
  const load=(file,reference=false)=>import('./'+file+'.js'+(reference?'?reference=1':''));
  const wind=await Promise.all([load('bridge-air-wakes',true),load('bridge-air-wakes')]);
  const river=await Promise.all([load('bridge-shallow-water',true),load('bridge-shallow-water')]);
  const {Vector3}=await import('three');
  function equal(a,b,label) {
    if(a.length!==b.length) throw Error(label+' length');
    for(let i=0;i<a.length;i++) if(a[i]!==b[i]) throw Error(label+' at '+i+': '+a[i]+' / '+b[i]);
  }
  function summary(rows){
    const values=rows.toSorted((a,b)=>a-b);
    const choose=q=>values[Math.ceil(q*values.length)-1];
    return {count:rows.length,p50:choose(.50),p95:choose(.95)};
  }
  let seed=88;
  const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
  const sites=Array.from({length:64},(_,i)=>({
    x:-69+random()*135,z:-78+random()*69,along:.44+random()*1.7,cross:.74+random()*1.6,
    bottom:1.4,top:3.5+random()*2.1,density:.64+random()*.34,name:'Willow '+i,
  }));
  sites.push(...Array.from({length:12},(_,i)=>({
    x:-72+random()*99,z:-63+random()*42,along:2.26,cross:1.59,top:3.14,
    density:1.43,porous:false,name:'Wall '+i,
  })));
  sites[0].x=-68;sites[0].z=-47;
  sites[1].x=-49;sites[1].z=-42;
  sites[0].pose=out=>out.set(travel,.33*travel);
  sites[1].pose=out=>out.set(.17*travel,-.44*travel);
  let visible=true,travel=0;
  sites[sites.length-1].enabled=()=>visible;
  const install=(module,rows)=>{
    module.placeWakes(-77,-86,154,88,.8660254,.5);
    rows.forEach(site=>module.windScreen(site));
  };
  const windBytes=module=>module.wakeUniforms.windWakes.value.image.data;
  const air=(x,z,out,t)=>out.set(1.2+.82*Math.sin(t*.92+x*.012),.51+.34*Math.cos(t*1.16+z*.024));
  const times=[[],[]], steady=[[],[]], moving=[[],[]];
  wind.forEach(module=>install(module,sites));
  const p=new Vector3(),q=new Vector3();
  let sampled=0;
  for(let frame=0;frame<105;frame++){
    const isMoving=frame>=60;
    if(isMoving)travel=.47*Math.sin((frame-60)*.46);
    visible=frame<74 || frame>=88;
    const time=.081*frame;
    for(const i of frame%2===0?[0,1]:[1,0]){
      const at=performance.now();
      wind[i].refreshWakes(time,air,true);
      const ms=performance.now()-at;
      if(frame>=12) {
        times[i].push(ms);
        (isMoving?moving:steady)[i].push(ms);
      }
    }
    equal(windBytes(wind[0]),windBytes(wind[1]),'wind atlas '+frame);
    for(let n=0;n<6;n++){
      const x=-70+n*16.4,z=-46+Math.sin(n*1.27)*7.7,y=.10+n*1.19;
      const a=wind[0].airWakeAt(x,z,y,p).toArray(),b=wind[1].airWakeAt(x,z,y,q).toArray();
      equal(a,b,'sampled air velocity');
      sampled++;
    }
  }
  wind.forEach(module=>install(module,sites.slice(0,2)));
  wind.forEach(module=>module.refreshWakes(9,air,true));
  equal(windBytes(wind[0]),windBytes(wind[1]),'wind atlas after reset');
  const windReport={frames:106,comparedBytes:windBytes(wind[0]).length*106,airSamples:sampled,
    full:times.map(summary),steady:steady.map(summary),moving:moving.map(summary)};

  const {airAt,airUniforms}=await load('bridge-air');
  const {windOrigin,windStrength}=airUniforms;
  windOrigin.value.set(-71,-47);
  windStrength.value=1.66;
  wind.forEach(module=>install(module,sites));
  for(const [time,shift,wallVisible] of [[1.1,0,true],[1.32,.37,false],[1.58,-.24,true]]) {
    travel=shift;
    visible=wallVisible;
    wind[0].refreshWakes(time,airAt,true);
    const deadline=performance.now()+5000;
    do {
      wind[1].scheduleWakes(time,airAt,windOrigin.value,windStrength.value);
      const state=wind[1].inspectWakes();
      if(state.thread==='worker' && state.atlasTime===time)break;
      if(performance.now()>deadline)throw Error('No committed worker atlas at '+time);
      await new Promise(resolve=>setTimeout(resolve,8));
    }while(true);
    equal(windBytes(wind[0]),windBytes(wind[1]),'committed worker atlas');
  }
  windReport.workerFrames=3;
  wind.forEach(module=>install(module,sites));
  wind[1].scheduleWakes(2,airAt,windOrigin.value,windStrength.value);
  wind[1].scheduleWakes(2.22,airAt,windOrigin.value,windStrength.value);
  wind[0].refreshWakes(2.22,airAt,true);
  equal(windBytes(wind[0]),windBytes(wind[1]),'pending worker catch-up');
  const Worker=window.Worker;
  try {
    window.Worker=class { constructor(){throw Error('Worker unavailable');} };
    wind.forEach(module=>install(module,sites));
    wind[1].scheduleWakes(2.5,airAt,windOrigin.value,windStrength.value);
    wind[0].refreshWakes(2.5,airAt,true);
    equal(windBytes(wind[0]),windBytes(wind[1]),'unavailable worker fallback');
  } finally {window.Worker=Worker;}
  windReport.fallbackFrames=2;

  const depthAt=(x,z)=>Math.max(0,Math.min(1.45,(6.5-Math.abs(x-.27*Math.sin(z*.53)))*.36));
  const waves=river.map(module=>module.createShallowWater({
    minX:-9.7,minZ:-16.2,width:19.4,length:32.4,depthAt,piers:[{x:.8,y:-.8},{x:-.8,y:-.8}],
    waveMaker:{x:-3.8,z:-4.6,span:6.4,period:1.68,amplitude:.136},
  }));
  const cost=[[],[]], motion={x:.09,y:.35,z:.03,w:.024};
  let compared=0;
  for(let i=0;i<136;i++) {
    const t=(i+1)/60, boat={x:1.1+.18*Math.sin(t*1.4),y:.53+t*.35,z:.18,w:.98};
    for(const n of i%2===0?[0,1]:[1,0]){
      const water=waves[n];
      if(i%29===1)water.impact(.54,-1.36,.78,'stone');
      if(i%18===4)water.enqueueRunoff(-6.12,-4.77,.0035,.71,.08,.0019,.26);
      if(i%13===7)water.exchangeSkiffWater(boat.x-.57,boat.y,-.0018);
      water.advance(1/60,boat,motion);
      const at=performance.now();
      water.pack();
      if(i>=15)cost[n].push(performance.now()-at);
    }
    if(i%4===0||i===135) {
      equal(waves[0].buffer,waves[1].buffer,'canal height and foam');
      equal(waves[0].flowTexture,waves[1].flowTexture,'canal current and runoff');
      const [a,b]=waves.map(water=>water.inspect());
      if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Canal inspection mismatch '+i);
      compared++;
    }
  }
  return {wind:windReport,water:{frames:compared,comparedBytes:compared*waves[0].buffer.length*2,
    pack:cost.map(summary),steps:waves[1].inspect().steps}};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--viewer',default='http://127.0.0.1:8133/viewer/')
    parser.add_argument('--reference',type=Path,required=True,help='Directory with the old viewer modules')
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    url=urljoin(args.viewer,'environment-field-verification')
    html='''<!doctype html><script type="importmap">
{"imports":{"three":"./vendor/three/build/three.module.js"}}
</script>'''

    def serve_reference(route):
        name=Path(urlsplit(route.request.url).path).name
        route.fulfill(content_type='text/javascript',body=(args.reference/name).read_text())

    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        page=browser.new_page()
        page.route(url,lambda route:route.fulfill(content_type='text/html',body=html))
        for file in ('bridge-air-wakes.js','bridge-shallow-water.js'):
            page.route(urljoin(args.viewer,file+'?reference=1'),serve_reference)
        page.goto(url)
        result=page.evaluate(AUDIT)
        browser.close()
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
