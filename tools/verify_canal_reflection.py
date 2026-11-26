"""Measure the reflected source edges and update cadence, and capture the 4K water surface."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_canal_inflow import RECORD


CAMERA = """()=>{
  const {persp}=__scene;
  const update=persp.updateMatrixWorld.bind(persp);
  window.reflectionCameraMatrix=update;
  window.mirrorTravel=0;
  window.mirrorHeight=.82;
  persp.updateMatrixWorld=force=>{
    const t=window.mirrorTravel;
    persp.position.set(-63.86+t,window.mirrorHeight+.09*t,-46.73+t*.57);
    persp.lookAt(-58.87,.43,-40.35);
    return update(force);
  };
  persp.fov=48;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
}"""

TRACE = """detail=>new Promise(resolve=>{
  const {scene}=__scene;
  scene.getObjectByName('Canal surface').material.uniforms.reflectionDetail.value=detail;
  const intervals=[], ages=[];
  let from,previous;
  function sample(now) {
    from??=now;
    const t=(now-from)/1000;
    if(t>.25 && previous!==undefined) {
      intervals.push(now-previous);
      const state=__scene.mission().water;
      ages.push(Math.max(0,1000*(state.time-state.lastReflectionTime)));
    }
    previous=now;
    window.mirrorTravel=.52*Math.sin(t*1.7);
    if(t<2.65) { requestAnimationFrame(sample); return; }
    const state=__scene.mission().water;
    const p95=values=>values.sort((a,b)=>a-b)[Math.floor(.95*values.length)];
    resolve({intervalP95:p95(intervals),mirrorAgeP95:p95(ages),ages,frames:intervals.length,
      size:state.reflectionSize,samples:state.reflectionSamples});
  }
  requestAnimationFrame(sample);
})"""

WIDE_STEADY = """()=>new Promise(resolve=>{
  const {persp}=__scene;
  const original=persp.updateMatrixWorld;
  persp.updateMatrixWorld=force=>{
    persp.position.set(-68.05,2.45,-48.90);
    persp.lookAt(-62.40,1.06,-45.30);
    return reflectionCameraMatrix(force);
  };
  let start,previous=null,frames=0,reflected=0,refracted=0,together=0,age=0;
  function poll(now){
    start??=now;
    const state=__scene.mission().water;
    if(previous && now-start>500) {
      const mirror=state.reflectionPasses>previous.reflectionPasses;
      const through=state.refractionPasses>previous.refractionPasses;
      frames++;
      reflected+=Number(mirror);
      refracted+=Number(through);
      together+=Number(mirror && through);
      age=Math.max(age,state.time-state.lastReflectionTime);
    }
    previous=state;
    if(now-start<2800){requestAnimationFrame(poll);return;}
    persp.updateMatrixWorld=original;
    resolve({frames,reflected,refracted,together,largestAgeMs:age*1000,size:state.reflectionSize,
      samples:state.reflectionSamples});
  }
  requestAnimationFrame(poll);
})"""

COMPARE = """async()=>{
  const THREE=await import('./vendor/three/build/three.module.js');
  const {scene,renderer}=__scene;
  const material=scene.getObjectByName('Canal surface').material;
  const {reflection,reflectionDetail,mirrorOverscan}=material.uniforms;
  renderer.setAnimationLoop(null);
  window.mirrorClock.getDelta=()=>0;
  window.mirrorTravel=0;
  const render=renderer.render.bind(renderer);
  const result={}, raster=new THREE.WebGLRenderTarget(3072,1728,{samples:4});

  function rgba(target) {
    const {width,height}=target;
    const data=new Uint8Array(width*height*4);
    renderer.readRenderTargetPixels(target,0,0,width,height,data);
    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    const context=canvas.getContext('2d');
    const pixels=context.createImageData(width,height);
    for(let y=0;y<height;y++)
      pixels.data.set(data.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
    context.putImageData(pixels,0,0);
    return canvas.toDataURL('image/png').split(',')[1];
  }

  renderer.render=(root,camera)=>{
    const target=renderer.getRenderTarget();
    render(root,camera);
    if(target?.texture!==reflection.value) return;
    const label=reflectionDetail.value===1 ? 'new' : 'old';
    result[label+'Mirror']=rgba(target);
    if(label==='new') {
      const reference=camera.clone();
      reference.projectionMatrix.elements[0]/=mirrorOverscan.value;
      reference.projectionMatrix.elements[5]/=mirrorOverscan.value;
      reference.projectionMatrixInverse.copy(reference.projectionMatrix).invert();
      renderer.setRenderTarget(raster);
      render(root,reference);
      result.reference=rgba(raster);
      renderer.setRenderTarget(target);
      result.overscan=mirrorOverscan.value;
    }
  };
  try {
    // Toggle the real render target, rather than scaling copies of the same texture.
    for(const detail of [0,1]) {
      reflectionDetail.value=detail;
      window.mirrorFrame(performance.now());
      const label=detail===1 ? 'new' : 'old';
      result[label]=renderer.domElement.toDataURL('image/png').split(',')[1];
      result[label+'Time']=__scene.mission().water.time;
    }
  } finally {
    renderer.render=render;
    raster.dispose();
  }
  return result;
}"""


def expose_frame(route):
    response = route.fetch()
    body = response.text()
    body = body.replace("renderer.setAnimationLoop(now => {", "renderer.setAnimationLoop(window.mirrorFrame = now => {")
    body = body.replace("const clock = new THREE.Clock();", "const clock = new THREE.Clock(); window.mirrorClock=clock;")
    route.fulfill(response=response, body=body)


def decode(value):
    return Image.open(BytesIO(base64.b64decode(value))).convert("RGB")


def compare_edges(frames):
    size = (1920, 1080)
    reference = decode(frames["reference"]).resize(size, Image.Resampling.LANCZOS)
    old = decode(frames["oldMirror"]).resize(size, Image.Resampling.BILINEAR)
    mirror = decode(frames["newMirror"])
    trim = (1-frames["overscan"])/2
    box = (mirror.width*trim,mirror.height*trim,mirror.width*(1-trim),mirror.height*(1-trim))
    new = mirror.transform(size,Image.Transform.EXTENT,box,Image.Resampling.BILINEAR)
    luma = np.asarray(reference.convert("L"),dtype=float)
    dy,dx = np.gradient(luma)
    edge = np.hypot(dx,dy) > 10
    edge[:55] = edge[-55:] = False
    edge[:,:65] = edge[:,-65:] = False
    target = np.asarray(reference,dtype=float)
    def metrics(image):
        difference = abs(np.asarray(image,dtype=float)-target).mean(axis=2)[edge]
        return {"mae":float(difference.mean()),"p95":float(np.percentile(difference,95))}
    return {"edgePixels":int(edge.sum()),"legacy":metrics(old),"updated":metrics(new)}


def check_tiers(page):
    def detail(expected):
        page.wait_for_function("close=>__scene.mission().water.closeReflection===close",arg=expected)
        return page.evaluate("""()=>{
          const state=__scene.mission().water;
          return {size:state.reflectionSize,samples:state.reflectionSamples};
        }""")

    page.evaluate("window.mirrorHeight=4.6")
    raised = detail(False)
    page.evaluate("window.mirrorHeight=.82")
    returned = detail(True)
    assert raised == {"size":[1280,720],"samples":0},raised
    assert returned["size"] == [1920,1080] and returned["samples"] > 0,returned
    return {"raised":raised,"returned":returned}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust")
    parser.add_argument("--out",required=True,type=Path)
    parser.add_argument("--record",action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda event:errors.append(event.text) if event.type=="error" else None)
        page.route(args.url,expose_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("typeof mirrorFrame==='function' && __scene.mission().water.time>2.8",timeout=65000)
        page.evaluate(CAMERA)
        legacy=page.evaluate(TRACE,0)
        updated=page.evaluate(TRACE,1)
        steady=page.evaluate(WIDE_STEADY)
        tiers=check_tiers(page)
        if args.record:
            page.evaluate("""()=>{
              let start;
              function follow(t){
                start??=t;
                window.mirrorTravel=.60*Math.sin((t-start)*.0008-1.3);
                if(t-start<4550) requestAnimationFrame(follow);
              }
              requestAnimationFrame(follow);
            }""")
            (args.out/"mirror-pan.webm").write_bytes(base64.b64decode(page.evaluate(RECORD)))
        device=page.evaluate("""()=>{
          const {renderer}=__scene, gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
          return {gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
            resolution:[renderer.domElement.width,renderer.domElement.height]};
        }""")
        frames=page.evaluate(COMPARE)
        new,old=[decode(frames[key]) for key in ("new","old")]
        new.save(args.out/"01-bridge-reflection-4k.jpg",quality=95)
        crop=(580,1160,1750,2020)
        width,height=crop[2]-crop[0],crop[3]-crop[1]
        pair=Image.new("RGB",(width*2,height))
        for i,image in enumerate((new,old)):
            pair.paste(image.crop(crop),(i*width,0))
        pair.save(args.out/"02-reflection-same-frame.jpg",quality=96)
        edge=compare_edges(frames)
        report={"device":device,"sameSceneTime":frames["newTime"]==frames["oldTime"],
            "legacy":legacy,"updated":updated,"steadyWide":steady,
            "qualityTiers":tiers,"mirrorSourceEdges":edge,"errors":errors}
        (args.out/"reflection-verification.json").write_text(json.dumps(report,indent=2)+"\n")
        print(json.dumps({key:value for key,value in report.items() if key not in ("legacy","updated")}),flush=True)
        assert not errors and device["resolution"]==[3840,2160] and report["sameSceneTime"],report
        assert updated["size"]==[1920,1080] and updated["samples"]>0 and legacy["size"]==[960,540],report
        assert updated["mirrorAgeP95"]<2.0 and legacy["mirrorAgeP95"]>16,report
        assert steady["size"]==[1920,1080] and steady["samples"]==4,steady
        assert steady["frames"]*.32<steady["reflected"]<steady["frames"]*.69,steady
        assert steady["refracted"]>20 and steady["together"]<5 and steady["largestAgeMs"]<85,steady
        assert edge["edgePixels"]>4000 and edge["updated"]["mae"]<.80*edge["legacy"]["mae"],edge
        browser.close()


if __name__=="__main__":
    main()
