"""Measure elastic branch contacts and inspect the actual twig and leaf shaders."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

CROWN = [[-64.86,2.84,-43.73],[-66.89,4.14,-46.89],43]
RIVER = [[-69.70,2.45,-48.55],[-62.95,2.66,-44.50],54]

CAMERA = """([eye,focus,fov])=>{
  const {persp}=__scene;
  if(!window.willowMatrix) window.willowMatrix=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    persp.position.set(...eye);
    persp.lookAt(...focus);
    return willowMatrix(force);
  };
  persp.fov=fov;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
}"""

RECORD = """length=>new Promise(resolve=>{
  const canvas=document.createElement('canvas');
  canvas.width=1920; canvas.height=1080;
  const ctx=canvas.getContext('2d',{alpha:false});
  const recorder=new MediaRecorder(canvas.captureStream(30),
    {mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:10000000});
  const packets=[];
  recorder.ondataavailable=e=>packets.push(e.data);
  recorder.onstop=()=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(new Blob(packets,{type:'video/webm'}));
  };
  const original=__scene.renderer.domElement;
  let start;
  function frame(t) {
    if(start===undefined) start=t;
    if(t-start>length) {recorder.stop();return;}
    ctx.drawImage(original,0,0,1920,1080);
    requestAnimationFrame(frame);
  }
  recorder.start();
  requestAnimationFrame(frame);
})"""


def fixed_clock(route):
    response = route.fetch()
    html = response.text()
    replacements = {
        "const clock = new THREE.Clock();": "const clock = new THREE.Clock(); window.willowClock=clock;",
        "renderer.setAnimationLoop(now => {": "renderer.setAnimationLoop(window.willowFrame = now => {",
        "\nconst counts = {};": "\nrenderer.setAnimationLoop(null);\nconst counts = {};",
    }
    for old, new in replacements.items():
        assert html.count(old) == 1, old
        html = html.replace(old, new)
    route.fulfill(response=response, body=html)


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    errors = []

    def open_page(scale, fixed=False):
        page = browser.new_page(viewport={"width":1920,"height":1080}, device_scale_factor=scale)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda row: errors.append(row.text) if row.type=="error" else None)
        if fixed:
            page.route(args.url, fixed_clock)
        page.goto(args.url, wait_until="networkidle", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.wind?.branchMotion?.length===2", timeout=65000)
        if fixed:
            page.wait_for_function("typeof window.willowFrame==='function'", timeout=10000)
            page.evaluate("""()=>{
              willowClock.getDelta=()=>1/60;
              let time=performance.now();
              window.stepWillow=()=>{time+=1000/60;willowFrame(time);};
            }""")
        return page

    page = open_page(2)
    page.evaluate(CAMERA,CROWN)
    live = page.evaluate("""()=>new Promise(resolve=>{
      const {renderer}=__scene,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      const device={gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height]};
      const intervals=[],trace=[];
      let last;
      function sample(t) {
        if(last!==undefined) intervals.push(t-last);
        last=t;
        const state=__scene.mission();
        if(intervals.length%3===0) trace.push({time:state.water.time,branches:state.wind.branchMotion});
        if(state.water.time<13.1) {requestAnimationFrame(sample);return;}
        intervals.sort((a,b)=>a-b);
        resolve({device,intervals:intervals.length,p95_ms:intervals[Math.ceil(intervals.length*.95)-1],
          trace,state});
      }
      requestAnimationFrame(sample);
    })""")
    assert live["device"]["resolution"]==[3840,2160] and live["intervals"]>420,live["device"]
    assert live["p95_ms"]<21,live["p95_ms"]
    models=live["state"]["wind"]["branchMotion"]
    assert all(m["correctedFrames"]>120 and m["tipTravel"]>.16 and m["rootTravel"]<.00001 for m in models),models
    assert all(m["maximumSolved"]<.001 and m["maximumStretch"]<.010 for m in models),models
    assert live["state"]["water"]["foliage"]["wetLandings"]>=5
    page.screenshot(path=args.out/"01-west-canopy-4k.png",timeout=45000)
    page.close()

    def motion_state(page, enabled, frames, stop_at_contact=False):
        return page.evaluate("""({enabled,frames,stopAtContact})=>{
          const crown=__scene.scene.getObjectByName("Volumetric riverside willow");
          crown.userData.branchMotion.controls.collisions=enabled;
          for(let i=0;i<frames;i++) {
            stepWillow();
            const motion=crown.userData.branchMotion.inspect();
            if((stopAtContact&&motion.solved>.081)||i===frames-1) {
              return {time:__scene.mission().wind.time,frame:i+1,motion};
            }
          }
        }""",{"enabled":enabled,"frames":frames,"stopAtContact":stop_at_contact})

    def pose_contact(page, preset, shot):
        page.evaluate(CAMERA,preset)
        page.evaluate("""()=>{
          const crown=__scene.scene.getObjectByName("Volumetric riverside willow");
          crown.getObjectByName("Willow canopy leaf instances").visible=false;
          const {renderer,scene,persp}=__scene;
          persp.updateMatrixWorld();
          renderer.render(scene,persp);
        }""")
        page.screenshot(path=args.out/shot,timeout=45000)

    page = open_page(2,fixed=True)
    page.evaluate(CAMERA,CROWN)
    free=motion_state(page,False,400,stop_at_contact=True)
    assert free["motion"]["separation"] and free["motion"]["solved"]>.070,free
    ids=free["motion"]["separation"]["ids"]
    free_pair=page.evaluate("""ids=>{
      const tree=__scene.scene.getObjectByName("Volumetric riverside willow");
      const pair=tree.userData.branchMotion.probePair(ids);
      const focus=tree.localToWorld(pair.local).toArray();
      return {gap:pair.gap,restGap:pair.restGap,focus};
    }""",ids)
    x,y,z=free_pair["focus"]
    preset=[[x+.55,y+.16,z-.58],[x,y-.01,z],37]
    pose_contact(page,preset,"02-contact-off-4k.png")
    page.close()

    page = open_page(2,fixed=True)
    page.evaluate(CAMERA,CROWN)
    solved=motion_state(page,True,free["frame"])
    assert abs(solved["time"]-free["time"])<1e-10 and free["motion"]["correctedFrames"]==0
    solved_pair=page.evaluate("""ids=>{
      const tree=__scene.scene.getObjectByName("Volumetric riverside willow");
      const {gap,restGap}=tree.userData.branchMotion.probePair(ids);
      return {gap,restGap};
    }""",ids)
    assert free_pair["restGap"]>.003 and free_pair["gap"]<-.065 and solved_pair["gap"]>-.001,(
        free_pair,solved_pair)
    gpu=page.evaluate(Path(__file__).with_name("willow_pose_audit.js").read_text())
    print("Contact and shader audit",json.dumps({"free":free_pair,"solved":solved_pair,"shader":gpu}),flush=True)
    assert gpu["samples"]>65 and gpu["motion"]>.10,gpu
    assert max(gpu[x] for x in ("cpuGap","woodGap","shadowGap","branchShadowGap"))<.00005,gpu
    if gpu["collar"]:
        collar=gpu["collar"]
        assert collar["samples"]>300 and collar["posedError"]<.000025,collar
        assert collar["depthError"]<.00001 and collar["normalDegrees"]<.01,collar
    page.screenshot(path=args.out/"04-with-leaves-4k.png",timeout=45000)
    pose_contact(page,preset,"03-contact-on-4k.png")
    crop=(950,440,2900,1650)
    before,after=[np.asarray(Image.open(args.out/f"0{i}-contact-{mode}-4k.png").crop(crop),dtype=np.int16)
        for i,mode in ((2,"off"),(3,"on"))]
    delta=np.abs(before-after).mean(axis=-1)
    influence={"fractionAboveFour":float(np.mean(delta>4)),"peak":float(delta.max()),"crop":crop}
    assert influence["fractionAboveFour"]>.04 and influence["peak"]>35,influence

    if args.record:
        page.close()
        page=open_page(1)
        page.evaluate(CAMERA,CROWN)
        (args.out/"crown.webm").write_bytes(base64.b64decode(page.evaluate(RECORD,5100)))
        page.close()
        page=open_page(1)
        page.evaluate(CAMERA,RIVER)
        (args.out/"river.webm").write_bytes(base64.b64decode(page.evaluate(RECORD,5400)))
    assert not errors,errors
    report={"live":live,"free":{"state":free,"pair":free_pair},"solved":{"state":solved,"pair":solved_pair},
        "gpu":gpu,"image":influence,"errors":errors}
    (args.out/"willow-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"p95_ms":live["p95_ms"],"gap_without":free_pair["gap"],"gap_with":solved_pair["gap"],
        "gpu":gpu,"image":influence},ensure_ascii=False),flush=True)
    browser.close()
