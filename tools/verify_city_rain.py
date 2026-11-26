"""Exercise city-wide wetness and geometry-driven runoff during a real walk."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?walk&rain&gust&swell")
parser.add_argument("--out",type=Path,required=True)
parser.add_argument("--record",action="store_true")
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

WEST=[[-15.4,1.86,-17.6],[-15.9,2.40,-28.7]]
EAST=[[49.2,2.4,-13.2],[58.8,1.6,-8.9]]
ROOF=[[-1.2,7.55,-17.6],[4.86,4.28,-26.77]]
PATH_Z=-17.40
ROUTE="""preferred=>{
  const {walkClear}=__scene;
  const x0=-17.7,z0=-23.6,dx=.44,dz=.42,cols=137,rows=33;
  const parent=Array.from({length:cols},()=>new Int8Array(rows).fill(-1));
  const clear=(x,z)=>walkClear(x,z,.11,.44);
  function segment(ax,az,bx,bz) {
    const steps=Math.ceil(Math.hypot(bx-ax,bz-az)/.12);
    for(let k=1;k<=steps;k++) {
      if(!clear(ax+(bx-ax)*k/steps,az+(bz-az)*k/steps)) return false;
    }
    return true;
  }
  let cost=Array.from({length:rows},(_,j)=>{
    const z=z0+j*dz;
    return clear(x0,z) ? Math.abs(z-preferred)*.42 : Infinity;
  });
  for(let i=1;i<cols;i++) {
    const x=x0+i*dx, best=new Array(rows).fill(Infinity);
    for(let j=0;j<rows;j++) {
      const z=z0+j*dz;
      if(!clear(x,z)) continue;
      for(let k=Math.max(0,j-2);k<=Math.min(rows-1,j+2);k++) {
        const score=cost[k]+Math.abs(j-k)*.35+Math.abs(z-preferred)*.018;
        if(score>=best[j] || !segment(x-dx,z0+k*dz,x,z)) continue;
        best[j]=score;
        parent[i][j]=k;
      }
    }
    cost=best;
  }
  let j=cost.indexOf(Math.min(...cost));
  if(!Number.isFinite(cost[j])) return [];
  const raw=[];
  for(let i=cols-1;i>=0;i--) {
    raw.unshift([x0+i*dx,z0+j*dz]);
    j=parent[i][j];
  }
  const route=[raw[0]];
  for(let i=0;i<raw.length-1;) {
    const [ax,az]=raw[i];
    let next=Math.min(i+24,raw.length-1);
    while(next>i+1 && !segment(ax,az,...raw[next])) next--;
    route.push(raw[next]);
    i=next;
  }
  return route;
}"""

SHELTER="""async()=>{
  const {Box3,Raycaster,Vector3}=await import('./vendor/three/build/three.module.js');
  const {models,rainSample}=__scene;
  const house=models.find(o=>o.userData.id==='o0557');
  const {min,max}=new Box3().setFromObject(house);
  const ray=new Raycaster();
  const origin=new Vector3(), down=new Vector3(0,-1,0);
  const limit=min.y+Math.max(.26,(max.y-min.y)*.145);
  let tests=0, matches=0, actualHits=0, uncovered=0;
  for(let x=min.x+.19;x<max.x;x+=.51) for(let z=min.z+.23;z<max.z;z+=.53) {
    const wet=rainSample(x,z);
    if(!wet) continue;
    ray.set(origin.set(x,max.y+2,z),down);
    const hit=ray.intersectObject(house,true).some(h=>h.point.y>=limit);
    if(hit) actualHits++;
    if(!hit && wet.exposed) uncovered++;
    if((!wet.exposed)===hit) matches++;
    tests++;
  }
  return {tests,matches,actualHits,uncovered,agreement:matches/tests};
}"""

RECORD_START="""()=>{
  const source=__scene.renderer.domElement;
  const encoder=new MediaRecorder(source.captureStream(30),{
    mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:10000000});
  const clips=[];
  encoder.ondataavailable=e=>clips.push(e.data);
  window.finishedRainWalk=()=>new Promise(resolve=>{
    encoder.onstop=()=>{
      const r=new FileReader();
      r.onload=()=>resolve(r.result.split(',')[1]);
      r.readAsDataURL(new Blob(clips,{type:'video/webm'}));
    };
    encoder.stop();
  });
  encoder.start();
}"""

with sync_playwright() as api:
    browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    errors=[]

    def open_page(ratio):
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=ratio)
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("""window.__scene?.mission()?.rain?.roofs.filter(r=>r.kind==='mesh').length===30
          && __scene.mission().water.reflectionPasses>=2""",timeout=65000)
        page.evaluate("""()=>{
          document.querySelector('#hud').style.visibility='hidden';
          document.querySelector('#seal').style.visibility='hidden';
        }""")
        return page

    def camera(page,shot):
        page.evaluate("""([position,target])=>{
          const {walk}=__scene;
          walk.pos.set(...position);
          const dx=target[0]-position[0],dy=target[1]-position[1],dz=target[2]-position[2];
          walk.yaw=Math.atan2(-dx,-dz);
          walk.pitch=Math.atan2(dy,Math.hypot(dx,dz));
        }""",shot)

    def until(page,t):
        page.wait_for_function(f"__scene.mission().rain.time>{t}",timeout=65000)

    def shot(page,name):
        page.screenshot(path=args.out/(name+".jpg"),quality=93,timeout=65000)

    def start_street(page):
        route=page.evaluate(ROUTE,PATH_Z)
        assert len(route)>=3,route
        page.evaluate("""route=>{
          const {walk}=__scene;
          let i=1;
          walk.pos.set(route[0][0],1.65,route[0][1]);
          walk.pitch=-.035;
          window.followRainStreet=false;
          window.steerRainStreet=()=>{
            const [x,z]=route[i];
            if((walk.pos.x>=x-.15 || Math.hypot(walk.pos.x-x,walk.pos.z-z)<.23) && i<route.length-1) i++;
            walk.yaw=Math.atan2(walk.pos.x-route[i][0],walk.pos.z-route[i][1]);
            if(window.followRainStreet) requestAnimationFrame(window.steerRainStreet);
          };
          steerRainStreet();
        }""",route)
        return route

    def sprint(page):
        page.evaluate("window.followRainStreet=true; window.steerRainStreet()")
        page.keyboard.down("Shift")
        page.keyboard.down("w")
        try:
            page.wait_for_function("__scene.walk.pos.x>40",timeout=20000)
        finally:
            page.evaluate("window.followRainStreet=false")
            page.keyboard.up("w")
            page.keyboard.up("Shift")

    page=open_page(2)
    camera(page,WEST)
    until(page,5.0)
    shot(page,"01-west-street-rain-4k")
    geometry=page.evaluate(SHELTER)
    assert geometry["agreement"]>.88 and geometry["tests"]>350 and geometry["uncovered"]>15,geometry
    first=page.evaluate("""()=>{
      const {rain}=__scene.mission();
      return {time:rain.time,window:rain.window,covered:rain.wetness.covered,
        housing:rain.roofs.find(o=>o.label==='o0557'),
        canopy:rain.canopies.filter(o=>o.label.startsWith('o')&&o.caught>0),
        inside:__scene.rainSample(-15.90,-29),outside:__scene.rainSample(-23.40,-18.40),
        east:__scene.rainSample(52.5,-18.5)};
    }""")
    assert first["covered"]>20000 and first["housing"]["caught"]>80 and first["housing"]["runoff"]>20,first
    assert first["inside"]["wet"]<.07 and not first["inside"]["exposed"],first
    assert first["outside"]["wet"]>.37 and first["east"]["wet"]>.36,first
    assert len(first["canopy"])>=2 and sum(o["runoff"] for o in first["canopy"])>4,first

    route=start_street(page)
    page.evaluate("""()=>{
      let previous;
      window.rainTraverse=[];
      function measure(t){
        if(rainTraverse===null) return;
        const {walk,mission}=__scene;
        const {rain}=mission();
        if(previous!==undefined) rainTraverse.push({ms:t-previous,x:walk.pos.x,p:rain.particles,
          shift:rain.window.shifts,time:rain.time,minX:rain.window.minX});
        previous=t;
        requestAnimationFrame(measure);
      }
      requestAnimationFrame(measure);
    }""")
    sprint(page)
    traversed=page.evaluate("""()=>{
      const frames=rainTraverse;
      window.rainTraverse=null;
      const values=frames.map(f=>f.ms).sort((a,b)=>a-b);
      return {distance:frames.at(-1).x-frames[0].x,frames:frames.length,
        windows:frames.at(-1).shift-frames[0].shift,
        minParticles:Math.min(...frames.map(f=>f.p)),
        maxGap:values.at(-1),p95:values[Math.floor(values.length*.95)],
        coverage:frames.every(f=>f.x>=f.minX&&f.x<f.minX+41),
        snapshots:frames.filter((f,i)=>i%30===0)};
    }""")
    print("travel",traversed,flush=True)
    traversed["path"]=route
    assert traversed["distance"]>55 and traversed["windows"]>=23 and traversed["coverage"], traversed
    assert traversed["minParticles"]>600 and traversed["p95"]<29,traversed

    camera(page,EAST)
    page.wait_for_function("""__scene.mission().rain.roofs.some(o=>o.kind==='mesh'&&o.x>25&&o.runoff>12)""",timeout=10000)
    shot(page,"02-east-street-rain-4k")
    east=page.evaluate("""()=>{
      const {rain}=__scene.mission();
      return {time:rain.time,wet:__scene.rainSample(52.5,-18.5),west:__scene.rainSample(-23.4,-18.4),
        roofs:rain.roofs.filter(r=>r.x>25 && r.caught>0),
        leftBehind:rain.canopies.filter(c=>c.x<0&&c.caught>0).map(c=>({label:c.label,
          retained:c.retained,drips:c.runoff})),
        activeWindow:rain.window};
    }""")
    assert east["wet"]["wet"]>.66 and east["west"]["wet"]>.66,east
    assert len(east["leftBehind"])>=2 and not any(c["retained"] for c in east["leftBehind"]),east

    pool=page.evaluate("""()=>{
      const {rainSample,walkClear}=__scene;
      let best;
      for(let x=-.2;x<=10.4;x+=.18) for(let z=-19.20;z<=-13.6;z+=.18){
        const wet=rainSample(x,z);
        if(!wet?.exposed || wet.puddle<.24 || (best && wet.puddle<=best.puddle)) continue;
        const eye=[x-1.02,.71,z+1.7];
        if(!walkClear(eye[0],eye[2],-.83,.50)) continue;
        best={x,z,...wet,camera:[eye,[x+.55,.26,z-1.05]]};
      }
      return best;
    }""")
    assert pool and pool["puddle"]>.32,pool
    camera(page,pool["camera"])
    page.wait_for_timeout(380)
    shot(page,"05-street-puddle-4k")

    page.evaluate("__scene.setMode('paint')")
    paused=page.evaluate("__scene.mission().rain.time")
    page.wait_for_timeout(280)
    assert page.evaluate("__scene.mission().rain.time")==paused
    assert not page.evaluate("__scene.scene.getObjectByName('Rain over the bridge district').visible")
    page.evaluate("__scene.setMode('mission')")
    page.wait_for_function("__scene.mission().rain.counts.fineImpacts>800",timeout=9000)
    canal=page.evaluate("""()=>{
      const r=__scene.mission().rain;
      return {time:r.time,window:r.window,fineImpacts:r.counts.fineImpacts,east:__scene.rainSample(52.5,-18.5)};
    }""")
    assert not canal["window"]["moving"] and canal["time"]>paused and canal["east"]["wet"]>.60,canal
    page.close()

    page=open_page(2)
    camera(page,ROOF)
    until(page,7.0)
    page.evaluate("__scene.renderer.setAnimationLoop(null)")
    metadata=page.evaluate("""()=>{
      const {renderer,models}=__scene;
      const face=models.find(o=>o.userData.id==='o0548').userData.finishFaces.find(o=>o.name==='roof');
      const data=face.material.userData.roofRainFlow.roofFlowMap.value.image;
      const flux=new Set(), heading=new Set();
      for(let i=0;i<data.data.length;i+=4) {
        if(!data.data[i+3]) continue;
        flux.add(data.data[i]);
        heading.add(data.data[i+1]*256+data.data[i+2]);
      }
      return {dimensions:[data.width,data.height],fluxBands:flux.size,directions:heading.size,
        resolution:[renderer.domElement.width,renderer.domElement.height]};
    }""")
    assert metadata["fluxBands"]>=5 and metadata["directions"]>=3 and metadata["resolution"]==[3840,2160],metadata
    shot(page,"03-roof-film-4k")
    before=page.screenshot()
    page.evaluate("""()=>{
      const {renderer,scene,persp,models}=__scene;
      const face=models.find(o=>o.userData.id==='o0548').userData.finishFaces.find(o=>o.name==='roof');
      face.material.userData.roofRainFlow.roofRain.value=0;
      renderer.render(scene,persp);
    }""")
    after=page.screenshot()
    crop=(790,560,2970,1750)
    images=[Image.open(BytesIO(data)).convert("RGB").crop(crop) for data in (before,after)]
    delta=np.abs(np.asarray(images[0],dtype=np.int16)-np.asarray(images[1],dtype=np.int16))
    changes=int((delta.max(axis=2)>4).sum())
    print("runoff film",changes,metadata,flush=True)
    assert changes>14500,changes
    pair=Image.new("RGB",(images[0].width*2,images[0].height))
    for i,image in enumerate(images):
        pair.paste(image,(i*image.width,0))
    pair.save(args.out/"04-roof-flow-on-off.jpg",quality=95)
    page.close()

    if args.record:
        page=open_page(1)
        start_street(page)
        until(page,4.1)
        page.evaluate(RECORD_START)
        sprint(page)
        page.wait_for_timeout(1600)
        video=page.evaluate("finishedRainWalk()")
        (args.out/"city-rain-walk.webm").write_bytes(base64.b64decode(video))
        page.close()

    assert not errors,errors
    report={"shelter":geometry,"west":first,"travel":traversed,"east":east,"puddle":pool,"canal":canal,
        "roofFilm":{**metadata,"changedPixels":changes},"errors":errors}
    (args.out/"city-rain-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    browser.close()
