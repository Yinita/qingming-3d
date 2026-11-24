"""Verify a rain-driven street flow budget, wet footsteps, and 4K puddle optics."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&rain&gust&swell")
parser.add_argument("--out",type=Path,required=True)
parser.add_argument("--record",action="store_true")
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

PAVING=[[-45.05,.46,-39.96],[-43.46,.16,-42.32],56]
RIVER=[[-67.16,1.07,-51.22],[-65.15,.09,-46.77],54]
CAMERA="""([eye,look,fov])=>{
  const {persp}=__scene;
  window.streetWaterCamera=[eye,look];
  if(!window.streetWaterUpdate) {
    window.streetWaterUpdate=persp.updateMatrixWorld.bind(persp);
    persp.updateMatrixWorld=force=>{
      const [position,target]=window.streetWaterCamera;
      persp.position.set(...position);
      persp.lookAt(...target);
      return streetWaterUpdate(force);
    };
  }
  persp.fov=fov;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
}"""
STATE="""()=>{
  const {player,phase,rain,gait}=__scene.mission();
  let deepest, tagged;
  for(let x=-45.3;x<=-41.6;x+=.14) for(let z=-41.76;z<=-39.44;z+=.14) {
    const wet=__scene.rainSample(x,z);
    if(!wet.exposed || wet.foundation) continue;
    if(!deepest || wet.depthMm>deepest.depthMm) deepest={x,z,...wet};
    if(!tagged || wet.runoffMm>tagged.runoffMm) tagged={x,z,...wet};
  }
  return {rainTime:rain.time,rain:rain.intensity,player,phase,gait,
    solver:rain.wetness.thread,
    flow:rain.wetness.runoff,entryWaves:rain.counts.runoffEntryWaves,
    leafDrips:rain.counts.leafDrips,eaves:rain.counts.eaves,steps:rain.counts.poolSteps,
    deepest,tagged,shelter:__scene.rainSample(-43.15,-43.48)};
}"""
TIMING="""ms=>new Promise(resolve=>{
  const samples=[];
  let prev,start;
  function frame(now){
    if(start===undefined) start=now;
    if(prev!==undefined) samples.push(now-prev);
    prev=now;
    if(now-start<ms) {requestAnimationFrame(frame);return;}
    samples.sort((a,b)=>a-b);
    resolve({frames:samples.length,p95:samples[Math.floor(samples.length*.95)],
      worst:samples.at(-1)});
  }
  requestAnimationFrame(frame);
})"""
RECORD="""length=>new Promise(resolve=>{
  const encoder=new MediaRecorder(__scene.renderer.domElement.captureStream(30),{
    mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:9600000});
  const chunks=[];
  encoder.ondataavailable=e=>chunks.push(e.data);
  encoder.onstop=()=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result.split(',')[1]);
    r.readAsDataURL(new Blob(chunks,{type:'video/webm'}));
  };
  encoder.start();
  setTimeout(()=>encoder.stop(),length);
})"""


with sync_playwright() as api:
    browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    errors=[]

    def open_page(scale):
        p=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=scale)
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
        p.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        p.wait_for_function("window.__scene?.mission()?.rain?.wetness?.runoff?.steps>4",timeout=65000)
        return p

    def until(p,t):
        p.wait_for_function(f"__scene.mission().rain.time>{t}",timeout=65000)

    def move(p,key,expression):
        p.keyboard.down(key)
        try:
            p.wait_for_function(expression,timeout=16000)
        finally:
            p.keyboard.up(key)

    def shot(p,label):
        p.screenshot(path=args.out/(label+".jpg"),quality=94,timeout=65000)

    gameplay=open_page(2)
    until(gameplay,4.6)
    move(gameplay,"w","__scene.mission().player.x>-72.36")
    gameplay.keyboard.press("e")
    assert gameplay.evaluate("__scene.mission().phase")== "carrying"
    gameplay.keyboard.down("Shift")
    try:
        move(gameplay,"w","__scene.mission().player.x>-44.49")
    finally:
        gameplay.keyboard.up("Shift")
    gameplay.keyboard.press("e")
    gameplay.evaluate(CAMERA,PAVING)
    gait=gameplay.evaluate(STATE)
    print("gameplay",gait["player"],gait["phase"],gait["steps"],flush=True)
    assert gait["phase"]=="delivered" and gait["steps"]>0,gait

    until(gameplay,11.8)
    signal=gameplay.evaluate(TIMING,1800)
    peak=gameplay.evaluate(STATE)
    flow=peak["flow"]
    print("paving",peak["deepest"],peak["tagged"],signal,flush=True)
    assert signal["p95"]<30 and signal["frames"]>66,signal
    assert peak["solver"]=="worker",peak["solver"]
    assert peak["deepest"]["depthMm"]>4 and peak["tagged"]["runoffMm"]>.32,peak
    assert peak["shelter"]["depthMm"]<.85,peak["shelter"]
    assert flow["runoffInLitres"]>160 and flow["runoffMovedLitres"]>145,flow
    assert flow["runoffInRiverLitres"]>.25 and peak["entryWaves"]>300,flow
    assert abs(flow["balanceErrorLitres"])<.015,flow
    assert peak["leafDrips"]>70 and peak["eaves"]>650,peak
    shot(gameplay,"01-tea-shop-runoff-4k")
    gameplay.evaluate(CAMERA,RIVER)
    until(gameplay,15)
    shot(gameplay,"02-runoff-at-canal-bank-4k")
    river_signal=gameplay.evaluate(TIMING,1450)
    assert river_signal["p95"]<25,river_signal
    until(gameplay,18.15)
    at_stop=gameplay.evaluate(STATE)
    until(gameplay,20.6)
    aftermath=gameplay.evaluate(STATE)
    assert at_stop["rain"]==0 and aftermath["rain"]==0
    assert aftermath["flow"]["storedLitres"]<at_stop["flow"]["storedLitres"],aftermath
    assert aftermath["flow"]["runoffInRiverLitres"]>at_stop["flow"]["runoffInRiverLitres"],aftermath
    assert abs(aftermath["flow"]["balanceErrorLitres"])<.015,aftermath
    gameplay.evaluate(CAMERA,PAVING)
    gameplay.wait_for_timeout(180)
    shot(gameplay,"04-wet-stones-after-rain-4k")
    gameplay.close()

    optics=open_page(2)
    optics.evaluate(CAMERA,PAVING)
    until(optics,10.4)
    optics.evaluate("__scene.renderer.setAnimationLoop(null)")
    active=optics.screenshot()
    optics.evaluate("""()=>{
      const {scene,renderer,persp}=__scene;
      const ground=scene.children.find(o=>o.userData.perspectiveMaterial?.userData.puddleOptics);
      ground.userData.perspectiveMaterial.userData.puddleOptics.value=0;
      renderer.render(scene,persp);
    }""")
    bilinear=optics.screenshot()
    crop=(880,1010,3370,2040)
    images=[Image.open(BytesIO(f)).convert("RGB").crop(crop) for f in [active,bilinear]]
    difference=np.abs(np.asarray(images[0],dtype=np.int16)-np.asarray(images[1],dtype=np.int16))
    changes=int((difference.max(2)>5).sum())
    assert changes>52000,changes
    pair=Image.new("RGB",(images[0].width*2,images[0].height))
    for i,image in enumerate(images):
        pair.paste(image,(i*image.width,0))
    pair.save(args.out/"03-same-frame-puddle-optics.jpg",quality=96)
    optics.close()

    if args.record:
        record=open_page(1)
        record.evaluate(CAMERA,PAVING)
        until(record,8)
        video=record.evaluate(RECORD,6100)
        (args.out/"tea-shop-runoff.webm").write_bytes(base64.b64decode(video))
        record.close()

    assert not errors,errors
    report={"peak":peak,"atStop":at_stop,"aftermath":aftermath,
        "4kIntervalsMs":signal,"river4kIntervalsMs":river_signal,"changedPixels":changes,"errors":errors}
    (args.out/"street-water-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    browser.close()
