"""Verify rainfall interception, water impact, surface wetness and 4K visibility."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
from verify_rain_wave_packets import expose_paused_frame

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&rain&gust&swell")
parser.add_argument("--out",type=Path,required=True)
parser.add_argument("--record",action="store_true")
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

OVERVIEW=[[-65.90,3.58,-53.70],[-57.10,1.57,-42.62],57]
RIVER=[[-63.76,.88,-47.6],[-59.19,.04,-43.87],51]
CANOPY=[[-68.96,3.18,-45.15],[-65.82,4.03,-46.90],57]
EAVE=[[-46.48,1.38,-39.33],[-43.27,1.63,-43.11],53]
PAVING=[[-45.95,.64,-39.86],[-43.45,.51,-42.2],52]
CAMERA="""([eye,look,fov])=>{
  const {persp}=__scene;
  window.rainCamera=[eye,look];
  if(!window.rainCameraUpdate) {
    window.rainCameraUpdate=persp.updateMatrixWorld.bind(persp);
    persp.updateMatrixWorld=force=>{
      const [position,target]=window.rainCamera;
      persp.position.set(...position);
      persp.lookAt(...target);
      return rainCameraUpdate(force);
    };
  }
  persp.fov=fov;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
  document.querySelector('#missionIntro').style.display='none';
}"""
BEAD_CAMERA="""async()=>{
  const {Matrix4,Raycaster,Vector3}=await import('./vendor/three/build/three.module.js');
  const {scene,renderer,persp}=__scene;
  const beads=scene.getObjectByName('Water beads held at willow leaf tips');
  const rain=scene.getObjectByName('Rain over the bridge district');
  const streaks=rain.getObjectByName('Wind-driven rain and runoff streaks');
  const wood=[];
  scene.traverse(o=>{if(o.name==='Willow trunk and branches') wood.push(o)});
  const matrix=new Matrix4(), ray=new Raycaster();
  const center=new Vector3(), origin=new Vector3(), direction=new Vector3();
  const offsets=[[-.28,-.21,.47],[.28,-.21,.40],[.13,-.18,-.52],[-.50,.07,-.28],[.44,.16,-.29],
    [-.31,.095,.17],[.12,.36,.16]];
  const candidates=[];
  for(let i=0;i<beads.count;i++) {
    beads.getMatrixAt(i,matrix);
    center.setFromMatrixPosition(matrix);
    if(center.x>-62 || center.z>-42 || center.z<-51) continue;
    for(const offset of offsets) {
      origin.copy(center).add(new Vector3(...offset));
      direction.subVectors(center,origin);
      ray.far=direction.length()-.020;
      ray.set(origin,direction.normalize());
      if(ray.intersectObjects(wood,false).length) continue;
      const priority=(4.6-center.y)*.13+matrix.getMaxScaleOnAxis()*29;
      candidates.push({eye:origin.toArray(),look:center.clone().add(new Vector3(0,.014,0)).toArray(),priority});
    }
  }
  candidates.sort((a,b)=>b.priority-a.priority);
  const gl=renderer.getContext(), width=320, channels=width*width*4;
  const on=new Uint8Array(channels), off=new Uint8Array(channels);
  const x=(renderer.domElement.width-width)/2,y=(renderer.domElement.height-width)/2;
  const shadow=renderer.shadowMap.autoUpdate;
  const previous=rain.visible;
  let best=null;
  rain.visible=true;
  streaks.visible=false;
  renderer.shadowMap.autoUpdate=false;
  persp.fov=39;
  persp.updateProjectionMatrix();
  try {
    for(const candidate of candidates.slice(0,14)) {
      window.rainCamera=[candidate.eye,candidate.look];
      beads.visible=true;
      renderer.render(scene,persp);
      gl.readPixels(x,y,width,width,gl.RGBA,gl.UNSIGNED_BYTE,on);
      beads.visible=false;
      renderer.render(scene,persp);
      gl.readPixels(x,y,width,width,gl.RGBA,gl.UNSIGNED_BYTE,off);
      let changed=0,contrast=0;
      for(let i=0;i<channels;i+=4) {
        const delta=Math.max(Math.abs(on[i]-off[i]),Math.abs(on[i+1]-off[i+1]),Math.abs(on[i+2]-off[i+2]));
        if(delta>5) { changed++; contrast+=delta; }
      }
      const score=contrast;
      if(!best || score>best.score) best={camera:[candidate.eye,candidate.look,39],changed,score};
      if(changed>2800 && contrast>55000) break;
    }
  } finally {
    rain.visible=previous;
    streaks.visible=true;
    beads.visible=true;
    renderer.shadowMap.autoUpdate=shadow;
  }
  return best;
}"""
STATE="""()=>{
  const {rain,water}=__scene.mission();
  const highPools=[];
  for(let x=-46.3;x<=-41.25;x+=.15) for(let z=-41.77;z<=-39.19;z+=.15) {
    const p=__scene.rainSample(x,z);
    if(p.puddle>.20) highPools.push({x,z,...p});
  }
  highPools.sort((a,b)=>b.puddle-a.puddle);
  return {rain,paving:{exposed:__scene.rainSample(-43.15,-40.62),
    underEave:__scene.rainSample(-43.15,-43.48),
    bridge:__scene.rainSample(-60.8,-41.42),deepestPool:highPools[0]},
    reflections:water.reflectionPasses};
}"""
RECORD="""duration=>new Promise(resolve=>{
  const canvas=document.createElement('canvas');
  canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d',{alpha:false});
  const capture=new MediaRecorder(canvas.captureStream(30),{
    mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:10800000});
  const chunks=[],original=__scene.renderer.domElement;
  let start;
  capture.ondataavailable=e=>chunks.push(e.data);
  capture.onstop=()=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));
  };
  function frame(t){
    if(start===undefined)start=t;
    if(t-start>duration){capture.stop();return;}
    ctx.drawImage(original,0,0,1920,1080);
    requestAnimationFrame(frame);
  };
  capture.start();
  requestAnimationFrame(frame);
})"""


def difference(first,second,region):
    left=np.asarray(Image.open(BytesIO(first)).convert("RGB").crop(region),dtype=np.int16)
    right=np.asarray(Image.open(BytesIO(second)).convert("RGB").crop(region),dtype=np.int16)
    delta=np.abs(left-right)
    return {"mean":float(delta.mean()),"changedPixels":int((delta.max(2)>5).sum())}


with sync_playwright() as api:
    browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    errors=[]

    def open_page(dpr,camera,paused=False):
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=dpr)
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
        if paused:
            page.route(args.url,expose_paused_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        if paused:
            page.wait_for_function("""window.__scene?.mission()?.rain && typeof leafFrame==='function' &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
        else:
            page.wait_for_function("window.__scene?.mission()?.rain && __scene.mission().water.reflectionPasses>=2",timeout=65000)
        page.evaluate(CAMERA,camera)
        return page

    page=open_page(2,OVERVIEW)
    device=page.evaluate("""()=>{
      const {renderer}=__scene, gl=renderer.getContext(), info=gl.getExtension('WEBGL_debug_renderer_info');
      return {gpu:info&&gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height]};
    }""")
    assert device["resolution"]==[3840,2160],device

    def until(time):
        page.wait_for_function(f"__scene.mission().rain.time>{time}",timeout=65000)

    def shot(name):
        page.screenshot(path=args.out/(name+".jpg"),quality=94,timeout=65000)

    until(4.2)
    shot("01-rain-at-the-bridge-4k")
    page.evaluate(CAMERA,RIVER)
    until(6.2)
    fps=page.evaluate("""()=>new Promise(resolve=>{
      const deltas=[];
      let start, previous;
      function next(now){
        if(start===undefined)start=now;
        if(previous!==undefined) deltas.push(now-previous);
        previous=now;
        if(now-start<1500) { requestAnimationFrame(next); return; }
        deltas.sort((a,b)=>a-b);
        resolve({frames:deltas.length,p50:deltas[Math.floor(deltas.length*.5)],
          p95:deltas[Math.floor(deltas.length*.95)],maximum:deltas.at(-1)});
      }
      requestAnimationFrame(next);
    })""")
    shot("02-rain-on-running-water-4k")
    page.evaluate(CAMERA,CANOPY)
    until(9.2)
    shot("03-willow-beads-4k")
    page.evaluate(CAMERA,EAVE)
    until(12.8)
    peak=page.evaluate(STATE)
    shot("04-under-the-eaves-4k")

    counts=peak["rain"]["counts"]
    print("peak",counts,"paving",peak["paving"],"fps",fps,flush=True)
    assert counts["river"]>3500 and counts["roof"]>1200 and counts["eaves"]>800,counts
    assert counts["fineImpacts"]>26000,counts
    assert counts["leaves"]>16 and counts["leafDrips"]>12 and counts["dripsToRiver"]>15,counts
    assert counts["poolImpacts"]>30 and peak["paving"]["deepestPool"]["puddle"]>.24,peak["paving"]
    assert counts["groundUnderRoof"]<counts["land"]*.038, counts
    assert peak["rain"]["ripples"]["maximum"]>300
    assert peak["paving"]["underEave"]["wet"]<.12 and not peak["paving"]["underEave"]["exposed"]
    assert peak["paving"]["exposed"]["wet"]>.65 and peak["paving"]["bridge"]["high"]>.68,peak["paving"]
    assert peak["rain"]["lastRiver"] and peak["rain"]["lastLeaf"] and peak["rain"]["lastEave"]

    page.evaluate(CAMERA,PAVING)
    until(20.2)
    aftermath=page.evaluate(STATE)
    shot("05-wet-flagstones-after-rain-4k")
    assert aftermath["rain"]["intensity"]==0 and aftermath["paving"]["exposed"]["wet"]>.42,aftermath
    assert aftermath["rain"]["ripples"]["active"]<130,aftermath["rain"]["ripples"]
    page.close()

    check=open_page(2,RIVER,paused=True)
    optics_time=check.evaluate("""()=>{
      const {renderer,scene,persp}=__scene;
      // Fix the rain clock so the A/B uses the same wave phase across machines.
      // Warm the water caches at low resolution and read the final frame at 4K.
      renderer.setSize(620,350,false);
      leafClock.getDelta=()=>.025;
      for(let i=1;i<=252;i++) leafFrame(i*25);
      renderer.setSize(1920,1080,false);
      renderer.render(scene,persp);
      return __scene.mission().rain.time;
    }""")
    full=check.screenshot()
    check.evaluate("""()=>{
      const {scene,renderer,persp}=__scene;
      scene.getObjectByName('Rain over the bridge district').visible=false;
      renderer.render(scene,persp);
    }""")
    no_drops=check.screenshot()
    check.evaluate("""()=>{
      const {scene,renderer,persp}=__scene;
      scene.getObjectByName('Canal surface').material.uniforms.rainRippleReady.value=0;
      renderer.render(scene,persp);
    }""")
    no_ripples=check.screenshot()
    visual={
        "dropStreaks":difference(full,no_drops,(110,140,3670,2090)),
        "waterImpact":difference(no_drops,no_ripples,(560,840,3210,1960)),
    }
    print("4K A/B",visual,flush=True)
    assert visual["dropStreaks"]["changedPixels"]>5000,visual
    assert visual["waterImpact"]["changedPixels"]>17000,visual
    crop=(1060,1115,2730,1955)
    pair=Image.new("RGB",((crop[2]-crop[0])*2,crop[3]-crop[1]))
    for column,data in enumerate([no_drops,no_ripples]):
        pair.paste(Image.open(BytesIO(data)).convert("RGB").crop(crop),(column*(crop[2]-crop[0]),0))
    pair.save(args.out/"06-same-frame-ripples-on-off.jpg",quality=96)
    bead_shot=None
    for _ in range(5):
        check.evaluate(CAMERA,RIVER)
        found=check.evaluate("""async ()=>{
          const {Matrix4}=await import("three");
          const {renderer,scene}=__scene;
          const beads=scene.getObjectByName('Water beads held at willow leaf tips');
          scene.getObjectByName('Rain over the bridge district').visible=true;
          scene.getObjectByName('Canal surface').material.uniforms.rainRippleReady.value=1;
          renderer.setSize(620,350,false);
          const transform=new Matrix4();
          let visible=false;
          const limit=60;
          for(let i=0;i<limit && !visible;i++){
            leafFrame(Math.round(__scene.mission().rain.time*1000)+25);
            for(let j=0;j<beads.count;j++){
              beads.getMatrixAt(j,transform);
              const {12:x,14:z}=transform.elements;
              if(x<-62 && z>-51 && z<-42) { visible=true;break; }
            }
          }
          renderer.setSize(1920,1080,false);
          return visible;
        }""")
        if found:
            bead_shot=check.evaluate(BEAD_CAMERA)
            if bead_shot and bead_shot["changed"]>400:
                break
    assert bead_shot is not None and bead_shot["changed"]>400,bead_shot
    visual["leafTipBead"]={"changedPixels":bead_shot["changed"]}
    check.evaluate(CAMERA,bead_shot["camera"])
    check.evaluate("""()=>{
      const {scene,renderer,persp}=__scene;
      scene.getObjectByName('Rain over the bridge district').visible=true;
      scene.getObjectByName('Canal surface').material.uniforms.rainRippleReady.value=1;
      renderer.render(scene,persp);
    }""")
    check.screenshot(path=args.out/"07-water-bead-at-the-leaf-tip-4k.jpg",quality=94)
    check.close()

    if args.record:
        record=open_page(1,OVERVIEW)
        clips=[]
        for camera,duration in [(OVERVIEW,3800),(RIVER,3800),(EAVE,4800)]:
            record.evaluate(CAMERA,camera)
            record.wait_for_function("__scene.mission().rain.time>3.3")
            raw=record.evaluate(RECORD,duration)
            clips.append(raw)
        for n,clip in enumerate(clips):
            (args.out/f"rain-shot-{n}.webm").write_bytes(base64.b64decode(clip))
        record.close()

    assert not errors,errors
    report={"device":device,"peak":peak,"aftermath":aftermath,"renderIntervalsMs":fps,
            "opticsSeconds":optics_time,"visualDifference":visual,"errors":errors}
    (args.out/"rain-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    browser.close()
