"""Measure the wake of live canopies and walls in air, water ripples, and leaf flight."""
import argparse
import base64
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
parser.add_argument("--out",type=Path,required=True)
parser.add_argument("--record",action="store_true")
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

RIVER=[[-63.88,2.48,-49.58],[-64.01,.07,-44.36],54]
WIDE=[[-70.13,3.22,-51.25],[-62.49,2.16,-46.19],57]
CAMERA="""([eye,focus,fov])=>{
  const {persp}=__scene;
  if(!window.windCamera)window.windCamera=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
      persp.position.set(...eye);
      persp.lookAt(...focus);
      return windCamera(force);
  };
  persp.fov=fov;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
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
  }
  capture.start();
  requestAnimationFrame(frame);
})"""

with sync_playwright() as api:
    browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    errors=[]

    def open_page(scale,camera):
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=scale)
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.refractionPasses>4",timeout=65000)
        page.evaluate(CAMERA,camera)
        return page

    page=open_page(2,RIVER)
    live=page.evaluate("""async()=>{
      const {Vector3,Vector2}=await import('./vendor/three/build/three.module.js');
      const {airWakeAt,inspectWakes}=await import('./bridge-air-wakes.js');
      const {airFromMap,prevailingWind}=await import('./bridge-air.js');
      const {renderer}=__scene, gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      const device={gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height]};
      const intervals=[],trace=[];
      const air=new Vector2(),consequence=new Vector3();
      const hx=prevailingWind.x,hz=prevailingWind.y;
      return new Promise(resolve=>{
        let last;
        function tick(t){
          if(last!==undefined)intervals.push(t-last);
          last=t;
          const m=__scene.mission(),time=m.water.time;
          if(intervals.length%6===0) {
            const {sources}=inspectWakes();
            const west=sources.find(s=>s.name==='West willow');
            const [x,z]=west.position;
            const leeX=x+hx*3.55,leeZ=z+hz*3.55;
            const wake=airWakeAt(leeX,leeZ,.10,consequence).toArray();
            trace.push({time,west:west.position,offset:west.offset,
              ground:airFromMap(leeX,leeZ,air).length(),cover:airWakeAt(leeX,leeZ,2.55,consequence).x,
              groundWake:wake});
          }
          if(time<13.1){requestAnimationFrame(tick);return;}
          intervals.sort((a,b)=>a-b);
          resolve({device,trace,intervals:intervals.length,p95_ms:intervals[Math.ceil(.95*intervals.length)-1],
            reedsAndLeaves:m.water.foliage,breakers:m.water.breakers,wind:m.wind,atlas:inspectWakes()});
        }
        requestAnimationFrame(tick);
      });
    }""")
    assert live["device"]["resolution"]==[3840,2160] and live["intervals"]>430,live["device"]
    assert live["p95_ms"]<21,live["p95_ms"]
    assert live["atlas"]["trees"]>=64 and live["atlas"]["walls"]>=9 and live["atlas"]["moving"]==2
    assert max(math.hypot(*s["offset"]) for s in live["trace"])>.115
    assert min(s["groundWake"][0] for s in live["trace"])<.70
    assert live["reedsAndLeaves"]["wetLandings"]>=4 and live["breakers"]["passes"]>=5
    page.wait_for_function("__scene.mission().water.time>14.82",timeout=18000)
    page.evaluate("__scene.renderer.setAnimationLoop(null)")
    audit=page.evaluate(Path(__file__).with_name("wind_wake_audit.js").read_text())
    print("Wind wake audit",json.dumps({k:v for k,v in audit.items() if k not in ("trace","atlas","mapping")}),flush=True)
    c,b,g=audit["canopy"],audit["building"],audit["gpu"]
    assert c["upstream"][0]>.96 and .45<c["shelter"][0]<.89 and c["inside"][0]<c["shelter"][0]
    assert c["left"][1]<-.07 and c["right"][1]>.07 and c["recovery"][0]>c["inside"][0]+.22
    assert c["farTime"]-c["nearTime"]>1.2 and math.hypot(*c["moved"])>.25
    assert c["above"]==[1,0,0] and b["behind"][0]<.53 and b["roof"]==[1,0,0]
    assert b["left"][1]<-.10 and b["right"][1]>.10
    assert g["samples"]>500 and g["error"]<.08 and g["deflection"]>6,g
    assert g["ratio"]<.90,g
    test=audit["leaf"]
    assert test["sheltered"]["travel"]<.92*test["exposed"]["travel"]
    assert math.hypot(*test["sheltered"]["surfaceSlip"])<.85*math.hypot(*test["exposed"]["surfaceSlip"])

    crop=page.evaluate("""async ([x,z])=>{
      const {Vector3}=await import('./vendor/three/build/three.module.js');
      const {persp,renderer}=__scene;
      persp.updateMatrixWorld();
      const q=new Vector3(x,.08,z).project(persp);
      const w=renderer.domElement.width,h=renderer.domElement.height;
      const sx=(q.x*.5+.5)*w, sy=(.5-q.y*.5)*h;
      return [Math.max(0,Math.round(sx-600)),Math.max(0,Math.round(sy-420)),
        Math.min(w,Math.round(sx+600)),Math.min(h,Math.round(sy+420))];
    }""",audit["region"])

    async_uniform="""async gain=>{
      const {airUniforms}=await import('./bridge-air.js');
      airUniforms.windWakeMix.value=gain;
      const {renderer,scene,persp}=__scene;
      renderer.render(scene,persp);
      return __scene.mission().water.time;
    }"""
    t1=page.evaluate(async_uniform,1)
    page.screenshot(path=args.out/"01-sheltered-water.png",timeout=45000)
    t2=page.evaluate(async_uniform,0)
    page.screenshot(path=args.out/"02-exposed-water.png",timeout=45000)
    assert t1==t2
    files=("01-sheltered-water.png","02-exposed-water.png")
    before,after=[np.asarray(Image.open(args.out/f).crop(tuple(crop)),dtype=np.int16) for f in files]
    d=np.abs(before-after).mean(axis=-1)
    difference={"fractionAboveFour":float((d>4).mean()),"peak":float(d.max()),"crop":crop,"time":t1}
    assert difference["fractionAboveFour"]>.012 and difference["peak"]>28,difference

    if args.record:
        page.close()
        page=open_page(1,RIVER)
        (args.out/"surface.webm").write_bytes(base64.b64decode(page.evaluate(RECORD,7050)))
        page.close()
        page=open_page(1,WIDE)
        (args.out/"canopy.webm").write_bytes(base64.b64decode(page.evaluate(RECORD,6200)))
    assert not errors,errors
    out={"live":live,"audit":audit,"difference":difference,"errors":errors}
    (args.out/"wind-wake-verification.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"p95_ms":live["p95_ms"],"gpu":g,"image":difference},ensure_ascii=False),flush=True)
    browser.close()
