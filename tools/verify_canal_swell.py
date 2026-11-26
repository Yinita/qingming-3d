"""Measure sustained travelling wakes and capture shoreline breakers at 4K."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&swell")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

NEAR = [[-67.00, .62, -50.06], [-66.17, .13, -46.20], 43]
WIDE = [[-68.00, 2.2, -50.80], [-63.50, .00, -45.80], 55]


def expose_frame(route):
    response = route.fetch()
    body = response.text()
    frame = "renderer.setAnimationLoop(now => {"
    clock = "const clock = new THREE.Clock();"
    assert body.count(frame) == body.count(clock) == 1
    body = body.replace(frame, "renderer.setAnimationLoop(window.swellFrame = now => {")
    body = body.replace(clock, clock + " window.swellClock = clock;")
    route.fulfill(response=response, body=body)


CAMERA = """([eye,look,fov]) => {
  const {persp}=__scene;
  if(!window.swellMatrix) window.swellMatrix=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    persp.position.set(...eye);
    persp.lookAt(...look);
    return swellMatrix(force);
  };
  persp.fov=fov;
  persp.updateProjectionMatrix();
}"""

RECORD = """ms => {
  const source=__scene.renderer.domElement;
  const canvas=document.createElement('canvas');
  canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d',{alpha:false});
  const recorder=new MediaRecorder(canvas.captureStream(30),{mimeType:'video/webm;codecs=vp8',
    videoBitsPerSecond:12000000});
  const chunks=[];
  return new Promise(resolve=>{
    recorder.ondataavailable=e=>chunks.push(e.data);
    recorder.onstop=()=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));
    };
    let start;
    function tick(t) {
      if(start===undefined) start=t;
      if(t-start>ms) {recorder.stop();return;}
      ctx.drawImage(source,0,0,1920,1080);
      requestAnimationFrame(tick);
    }
    recorder.start();
    requestAnimationFrame(tick);
  });
}"""


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    errors = []

    def open_page(scale, pose, frame_control):
        page = browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=scale)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda row: errors.append(row.text) if row.type == "error" else None)
        if frame_control:
            page.route(args.url,expose_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("__scene?.mission()?.water?.caustics?.passes>6",timeout=65000)
        page.evaluate(CAMERA,pose)
        return page

    page=open_page(2, NEAR, True)
    live=page.evaluate("""() => new Promise(resolve=>{
      const {renderer}=__scene, gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      const device={gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height]};
      const trace=[], frameTime=[];
      let start, previous;
      function tick(t) {
        if(start===undefined) start=t;
        if(previous!==undefined) frameTime.push(t-previous);
        previous=t;
        const {time,simulation,breakers,swash}=__scene.mission().water;
        const a=__scene.waterSample(-63.42,-47.77), b=__scene.waterSample(-65.86,-47.77);
        trace.push({time,deep:a.height,shallow:b.height,rolling:breakers.rolled,shape:breakers.openings,
          height:simulation.peakHeight,velocity:simulation.peakSpeed,swash:swash.liveReach,darkened:swash.darkened});
        if(t-start>=8050) {
          frameTime.sort((a,b)=>a-b);
          resolve({device,trace,frames:frameTime.length,p95_ms:frameTime[Math.ceil(frameTime.length*.95)-1],
            last:__scene.mission().water});
        } else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })""")
    assert live["device"]["resolution"] == [3840, 2160]
    events=live["last"]["breakers"]["events"]
    assert len(events)>=3 and live["last"]["breakers"]["maxWidth"]>2.2,live["last"]["breakers"]
    cadence=[right["time"]-left["time"] for left,right in zip(events,events[1:])]
    assert all(1.39<duration<1.95 for duration in cadence),(cadence,events)
    assert max(row["rolling"] for row in live["trace"])>9
    assert max(row["shape"] for row in live["trace"])>24
    assert max(row["height"] for row in live["trace"])<.28
    assert all(event["depth"]<.53 and event["velocity"]<-.23 for event in events),events
    assert live["last"]["breakers"]["spray"]>45
    assert live["last"]["submerged"]["bubbles"]["emitters"]["breaker"]>=8
    assert live["last"]["swash"]["widest"]>.22 and live["last"]["swash"]["maxRetained"]>.15

    frame=page.evaluate("""() => {
      const {renderer}=__scene;
      renderer.setAnimationLoop(null);
      swellClock.getDelta=()=>1/110;
      let now=performance.now();
      window.swellTick=()=>{ now+=1000/110; swellFrame(now); };
      const state=()=>__scene.mission().water;
      for(let i=0;i<217;i++) {
        swellTick();
        if(state().breakers.rolled>=10 && state().breakers.openings>8) return state();
      }
      throw Error('An overturning crest did not cross the close camera');
    }""")
    audit=page.evaluate(Path(__file__).with_name("swell_surface_audit.js").read_text())
    print("GPU surface audit",json.dumps(audit),flush=True)
    assert audit["meshNames"]==1 and not audit["separateCrest"] and not audit["separateShore"],audit
    assert audit["invalidEdges"]==0 and audit["exteriorEdges"]==audit["expectedExterior"],audit
    assert audit["rowsChecked"]>=5 and audit["joinGap"]<.0001,audit
    assert audit["joinNormal"]<10 and audit["reversalWidth"]>.055 and audit["crestRise"]>.10,audit
    assert audit["inverseUnderestimate"]<.022,audit
    page.screenshot(path=args.out/"01-overturning.png",timeout=45000)
    page.evaluate("""() => {
      const {scene,persp,renderer}=__scene;
      const river=scene.getObjectByName('Canal surface');
      river.material.uniforms.breakingBlend.value=0;
      renderer.render(scene,persp);
    }""")
    page.screenshot(path=args.out/"02-heightfield-only.png",timeout=45000)
    page.evaluate("""()=>{
      __scene.scene.getObjectByName('Canal surface').material.uniforms.breakingBlend.value=1;
      for(let i=0;i<25;i++) swellTick();
    }""")
    page.screenshot(path=args.out/"03-breaking-foam.png",timeout=45000)
    wet=page.evaluate("""()=>{
      for(let i=0;i<190;i++) {
        swellTick();
        const swash=__scene.mission().water.swash;
        if(swash.darkened>15 && swash.liveReach<.16) return swash;
      }
      throw Error('Wet ground was not exposed behind the retreating water');
    }""")
    page.screenshot(path=args.out/"04-retreated.png",timeout=45000)
    page.evaluate("""() => {
      const {scene,persp,renderer}=__scene;
      scene.traverse(o=>{
        const wet=o.material?.userData.shoreWetting;
        if(wet) wet.bankWetOptics.value=0;
      });
      renderer.render(scene,persp);
    }""")
    page.screenshot(path=args.out/"05-wetness-disabled.png",timeout=45000)
    crop=(850,860,3160,2100)
    a,b=[np.asarray(Image.open(args.out/name).crop(crop),dtype=np.int16)
         for name in ('01-overturning.png','02-heightfield-only.png')]
    changed=np.abs(a-b).mean(axis=-1)
    image={"crop":crop,"fractionAboveFour":float((changed>4).mean()),"peak":float(changed.max())}
    assert image["fractionAboveFour"]>.010 and image["peak"]>29,image
    shore=(1420,1160,3290,2130)
    a,b=[np.asarray(Image.open(args.out/name).crop(shore),dtype=np.int16)
         for name in ('04-retreated.png','05-wetness-disabled.png')]
    wet_delta=np.abs(a-b).mean(axis=-1)
    wet_pixels={"crop":shore,"fractionAboveFour":float((wet_delta>4).mean()),"peak":float(wet_delta.max())}
    assert wet_pixels["fractionAboveFour"]>.002 and wet_pixels["peak"]>12,wet_pixels

    if args.record:
        page.close()
        page=open_page(1, NEAR, False)
        for name,pose,length in (("bank",NEAR,6850),("canal",WIDE,5990)):
            page.evaluate(CAMERA,pose)
            clip=page.evaluate(RECORD,length)
            (args.out/f"{name}.webm").write_bytes(base64.b64decode(clip))
    assert not errors,errors
    result={"live":live,"fixedFrame":frame,"pixels":image,"cadence":cadence,"surfaceAudit":audit,
            "retreat":wet,"wetPixels":wet_pixels,"errors":errors}
    (args.out/"swell-verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"cadence":cadence,"width":live["last"]["breakers"]["maxWidth"],
                      "height":max(row["height"] for row in live["trace"]),"p95_ms":live["p95_ms"],
                      "pixels":image,"spray":live["last"]["breakers"]["spray"],"wet":wet_pixels},ensure_ascii=False),flush=True)
    browser.close()
