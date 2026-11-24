"""Check street-to-canal water accounting, drifting leaves and same-frame 4K optics."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright


CAMERA = """async()=>{
  const {persp,scene}=__scene;
  const {canalShoreRadius,canalDepth}=await import('./bridge-canal-bed.js');
  const origin=scene.getObjectByName('Canal surface').material.uniforms.origin.value;
  let best=null;
  for(let z=origin.y-12;z<origin.y+12;z+=.19) {
    if(Math.abs(z-origin.y-1.75)<4.3) continue;
    for(const side of [-1,1]) for(let margin=.25;margin<1.6;margin+=.18) {
      const x=origin.x+side*(canalShoreRadius(z-origin.y,side)-margin);
      const sample=__scene.waterSample(x,z);
      if(canalDepth(origin,x,z)<.044 || (best && best.runoff>=sample.runoff)) continue;
      best={x,z,side,runoff:sample.runoff};
    }
  }
  const original=persp.updateMatrixWorld.bind(persp);
  const {x,z,side}=best;
  const towardCenter=Math.sign(origin.y-z);
  persp.updateMatrixWorld=force=>{
    persp.position.set(x-side*1.23,1.59,z-towardCenter*2.2);
    persp.lookAt(x-side*.52,.065,z+towardCenter*.41);
    return original(force);
  };
  persp.fov=48;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
  return best;
}"""

STATE = """()=>{
  const {rain,water}=__scene.mission();
  const leaves=water.foliage;
  return {time:rain.time,intensity:rain.intensity,street:rain.wetness.runoff,thread:rain.wetness.thread,
    canal:water.simulation.runoff,entryRings:rain.counts.runoffEntryWaves,
    leaves:{contacts:leaves.runoffContacts,travel:leaves.distanceThroughRunoff,peak:leaves.peakRunoffExposure}};
}"""

FRAMES = """()=>new Promise(resolve=>{
  const times=[];
  let first,previous;
  function frame(now){
    first??=now;
    if(previous!==undefined) times.push(now-previous);
    previous=now;
    if(now-first<2200) { requestAnimationFrame(frame); return; }
    times.sort((a,b)=>a-b);
    resolve({frames:times.length,p50:times[Math.floor(.5*times.length)],p95:times[Math.floor(.95*times.length)]});
  }
  requestAnimationFrame(frame);
})"""

SAME_FRAME = """shoreline=>{
  const {renderer,scene,persp}=__scene;
  const uniforms=scene.getObjectByName('Canal surface').material.uniforms;
  const optics=uniforms.runoffOptics;
  const bed=scene.getObjectByName('Recessed canal bed').material.userData.bankFinish;
  function shot(value){
    optics.value=value;
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  try {
    const frames=[shot(1),shot(0)];
    if(shoreline) {
      uniforms.shorelineOptics.value=bed.value=0;
      frames.push(shot(1));
    }
    return frames;
  }
  finally {
    optics.value=1;
    uniforms.shorelineOptics.value=bed.value=1;
  }
}"""

AUDIT_BANK = """async()=>{
  const {scene}=__scene;
  const {Raycaster,Vector3}=await import('./vendor/three/build/three.module.js');
  const {canalShoreRadius,canalTerrainHeight,waterHeight}=await import('./bridge-canal-bed.js');
  const bed=scene.getObjectByName('Recessed canal bed');
  const origin=scene.getObjectByName('Canal surface').material.uniforms.origin.value;
  const ray=new Raycaster(), down=new Vector3(0,-1,0), eye=new Vector3();
  const errors=[];
  let floodedGrooves=0, dryRidges=0, wetBanks=0;
  for(const side of [-1,1]) for(let j=0;j<82;j++) {
    const along=-10.76+j*.267, z=origin.y+along;
    const lip=canalShoreRadius(along,side);
    const x=origin.x+side*(lip-.032);
    const expected=canalTerrainHeight(origin,x,z);
    const depth=waterHeight-expected;
    if(depth>.003 && depth<.035) floodedGrooves++;
    if(depth<-.004) dryRidges++;
    if(__scene.rainSample(origin.x+side*(lip+.30),z)?.wet>.22) wetBanks++;
    if(j%4) continue;
    ray.set(eye.set(x,.4,z),down);
    const hit=ray.intersectObject(bed,false)[0];
    if(hit) errors.push(Math.abs(hit.point.y-expected));
  }
  errors.sort((a,b)=>a-b);
  return {floodedGrooves,dryRidges,wetBanks,rayHits:errors.length,
    heightP95M:errors[Math.floor(.95*errors.length)],materialReady:!!bed.material.userData.surfaceReady};
}"""

RECORD = """()=>new Promise(resolve=>{
  const video=document.createElement('canvas');
  video.width=1920;
  video.height=1080;
  const context=video.getContext('2d',{alpha:false});
  const recorder=new MediaRecorder(video.captureStream(30),
    {mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:9600000});
  const source=__scene.renderer.domElement, chunks=[];
  let start;
  recorder.ondataavailable=event=>chunks.push(event.data);
  recorder.onstop=()=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(new Blob(chunks,{type:recorder.mimeType}));
  };
  function draw(now) {
    start??=now;
    if(now-start>4400) { recorder.stop(); return; }
    context.drawImage(source,0,0,video.width,video.height);
    requestAnimationFrame(draw);
  }
  recorder.start();
  requestAnimationFrame(draw);
})"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&rain&gust")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--shoreline", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda event: errors.append(event.text) if event.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.rain?.time>8", timeout=90000)
        target = page.evaluate(CAMERA)
        intervals = page.evaluate(FRAMES)
        peak = page.evaluate(STATE)
        device = page.evaluate("""()=>{
          const {renderer}=__scene, gl=renderer.getContext(), info=gl.getExtension('WEBGL_debug_renderer_info');
          return {gpu:info&&gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
            resolution:[renderer.domElement.width,renderer.domElement.height]};
        }""")
        assert device["resolution"] == [3840, 2160], device
        images = [Image.open(BytesIO(base64.b64decode(data))).convert("RGB")
            for data in page.evaluate(SAME_FRAME,args.shoreline)]
        images[0].save(args.out / "01-bank-outflow-4k.jpg", quality=95)
        region = (650, 425, 3180, 1830)

        def compare(first, second, filename):
            crops = [image.crop(region) for image in (first, second)]
            delta = np.abs(np.asarray(crops[0], dtype=np.int16) - np.asarray(crops[1], dtype=np.int16))
            panels = [crop.resize((1265, 702), Image.Resampling.LANCZOS) for crop in crops]
            pair = Image.new("RGB", (2530, 702))
            for i, panel in enumerate(panels):
                pair.paste(panel, (1265*i, 0))
            pair.save(args.out / filename, quality=96)
            return {"changedPixels": int((delta.max(2) >= 5).sum()), "largestDelta": int(delta.max())}

        contrast = compare(images[0],images[1],"02-same-frame-turbidity.jpg")
        bank_optics = compare(images[0],images[2],"03-shoreline-optics.jpg") if args.shoreline else None
        if args.record:
            (args.out / "bank-outflow.webm").write_bytes(base64.b64decode(page.evaluate(RECORD)))
        page.wait_for_function("__scene.mission().rain.time>22", timeout=90000)
        after = page.evaluate(STATE)
        report = {"device": device, "target": target, "peak": peak, "after": after,
            "4kIntervalsMs": intervals, "sameFrame": contrast, "errors": errors}
        if args.shoreline:
            bank = page.evaluate(AUDIT_BANK)
            report["shoreline"] = {**bank,"sameFrame":bank_optics}
        (args.out / "canal-inflow-verification.json").write_text(json.dumps(report, indent=2)+"\n")
        assert peak["thread"] == "worker" and not errors, report
        for state in [peak, after]:
            canal = state["canal"]
            assert canal["acceptedLitres"] > 0 and canal["appliedLitres"] > 0, state
            assert abs(canal["acceptedLitres"] + canal["rejectedLitres"] - state["street"]["riverLitres"]) < 1e-5, state
            assert abs(canal["appliedLitres"] + canal["pendingLitres"] - canal["acceptedLitres"]) < 1e-5, state
        assert contrast["changedPixels"] > 300, report
        assert after["canal"]["appliedLitres"] > peak["canal"]["appliedLitres"], report
        assert after["leaves"]["contacts"] > 0 and after["leaves"]["travel"] > .1, report
        if args.shoreline:
            assert bank["rayHits"] == 42 and bank["heightP95M"] < .011 and bank["materialReady"], bank
            assert bank["floodedGrooves"] >= 12 and bank["dryRidges"] >= 12 and bank["wetBanks"] >= 15, bank
            assert bank_optics["changedPixels"] > 1200, bank_optics
        browser.close()


if __name__ == "__main__":
    main()
