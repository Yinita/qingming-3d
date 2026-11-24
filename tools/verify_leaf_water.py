"""Verify rendered leaf menisci, drift wakes and capillary impulses on wet contact."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_canal_inflow import RECORD


CAMERA = """input=>{
  const {persp,scene}=__scene;
  const leaves=scene.getObjectByName('Floating and falling willow leaves');
  const matrix=leaves.matrix.clone(),point=persp.position.clone();
  window.trackedBlade=typeof input==='number' ? input : input.index;
  window.filmCamera=typeof input!=='number';
  if(!window.trackBladeMatrix) {
    window.trackBladeMatrix=persp.updateMatrixWorld.bind(persp);
    persp.updateMatrixWorld=force=>{
      leaves.getMatrixAt(window.trackedBlade,matrix);
      point.setFromMatrixPosition(matrix);
      if(window.filmCamera) persp.position.set(point.x+.30,Math.max(.60,point.y+.87),point.z-.42);
      else persp.position.set(point.x+.57,Math.max(.24,point.y+.42),point.z-.54);
      persp.lookAt(point.x,point.y-.025,point.z+.062);
      return trackBladeMatrix(force);
    };
  }
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
  persp.fov=42;
  persp.updateProjectionMatrix();
}"""

LIVE = """()=>new Promise(resolve=>{
  const {renderer}=__scene, gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
  const device={gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    resolution:[renderer.domElement.width,renderer.domElement.height]};
  let first,previous;
  const frames=[];
  function tick(now) {
    if(first===undefined)first=now;
    if(previous!==undefined)frames.push(now-previous);
    previous=now;
    if(now-first<2250){requestAnimationFrame(tick);return;}
    frames.sort((a,b)=>a-b);
    const {leafWater,foliage}=__scene.mission().water;
    resolve({device,frames:frames.length,p95:frames[Math.floor(.95*frames.length)],leafWater,
      refloats:foliage.refloated, peakSlip:foliage.peakSlip, peakSpin:foliage.peakSpin});
  }
  requestAnimationFrame(tick);
})"""

INSTALL_AUDIT = """()=>{
  const {renderer}=__scene;
  const render=renderer.render.bind(renderer);
  renderer.render=(scene,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture?.name==='Floating leaf capillary slopes') {
      const geometry=scene.children[0].geometry;
      const {footprint,heading,life}=geometry.attributes;
      window.leafSlopes={target,footprint,heading,life,count:geometry.instanceCount};
    }
    return render(scene,camera);
  };
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let tick=performance.now();
  window.leafStep=()=>leafFrame(tick+=1000/60);
}"""

NEXT_PACKET = """kind=>{
  const {time,leafWater}=__scene.mission().water;
  const start=leafWater.totals[kind];
  for(let i=0;i<820;i++) {
    leafStep();
    const water=__scene.mission().water;
    if(water.time>time+.025 && water.leafWater.totals[kind]>start) {
      const recent=water.leafWater.latest, event=recent[kind];
      const moved=Math.hypot(event.u,event.v);
      if(kind==='impact' && moved<=.16) continue;
      if(kind==='drift' && (event.power<.067 || Math.abs(event.z+41.422)<2.7 || Math.abs(event.x+58.764)>6.55 ||
        [recent.impact,recent.refloat,recent.wash].some(other=>
        other && event.time-other.time<.72 && Math.hypot(event.x-other.x,event.z-other.z)<.69))) continue;
      return event;
    }
  }
  throw Error('No visible production '+kind+' source');
}"""

VISIBLE_BLADE = """()=>{
  const {renderer,scene,persp}=__scene;
  const leaves=scene.getObjectByName('Floating and falling willow leaves');
  const matrix=leaves.matrix.clone();
  leaves.getMatrixAt(window.trackedBlade,matrix);
  const {x,y}=persp.position.clone().setFromMatrixPosition(matrix).project(persp);
  const {width,height}=renderer.domElement;
  const gl=renderer.getContext(),side=256;
  const px=Math.round((x*.5+.5)*width-side/2),py=Math.round((y*.5+.5)*height-side/2);
  if(px<0 || py<0 || px+side>width || py+side>height) return 0;
  function read(visible){
    const rgba=new Uint8Array(side*side*4);
    leaves.visible=visible;
    renderer.render(scene,persp);
    gl.readPixels(px,py,side,side,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    return rgba;
  }
  try {
    const a=read(true),b=read(false);
    let changed=0;
    for(let i=0;i<a.length;i+=4)
      changed+=Number(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>9);
    return changed;
  } finally {leaves.visible=true;}
}"""

AUDIT = """event=>{
  const {renderer,scene}=__scene;
  const {target,footprint,heading,life,count}=leafSlopes;
  const {leafSlopeBounds}=scene.getObjectByName('Canal surface').material.uniforms;
  const bounds=leafSlopeBounds.value;
  const at=__scene.mission().water.time;
  const age=at-event.time, x=event.x+age*event.u,z=event.z+age*event.v;
  let nearest=Infinity,power=0,ground=Infinity,attached=0;
  const type=event.kind==='drift' ? 1 : 2;
  const leaves=scene.getObjectByName('Floating and falling willow leaves');
  const matrix=leaves.matrix.clone();
  leaves.getMatrixAt(event.index,matrix);
  const translation=matrix.elements.slice(12,15);
  for(let i=0;i<count;i++) {
    const wx=footprint.getX(i),wz=footprint.getY(i);
    if(heading.getW(i)===0) {
      attached++;
      ground=Math.min(ground,Math.hypot(wx-translation[0],wz-translation[2]));
    } else if(heading.getW(i)===type && Math.abs(life.getX(i)-age)<.00007) {
      const error=Math.hypot(wx-x,wz-z);
      if(error<nearest) {
        nearest=error;
        power=heading.getZ(i);
      }
    }
  }
  const side=64,startX=Math.round((x-bounds.x)*bounds.z*target.width)-side/2;
  const startZ=Math.round((z-bounds.y)*bounds.w*target.height)-side/2;
  const pixels=new Uint8Array(side*side*4);
  if(startX>=0 && startX+side<=target.width && startZ>=0 && startZ+side<=target.height)
    renderer.readRenderTargetPixels(target,startX,startZ,side,side,pixels);
  let covered=0,strongest=0;
  for(let i=0;i<pixels.length;i+=4) {
    const energy=Math.hypot(pixels[i]-pixels[i+1],pixels[i+2]-pixels[i+3]);
    covered+=Number(energy>4);
    strongest=Math.max(energy,strongest);
  }
  return {age,origin:[event.x,event.z],carried:[x,z],distance:Math.hypot(x-event.x,z-event.z),
    instanceError:nearest,leafContactOffset:ground,attached,count,power,covered,strongest};
}"""

COMPARE = """()=>{
  const {renderer,scene,persp}=__scene;
  const optics=scene.getObjectByName('Canal surface').material.uniforms.leafContactOptics;
  function capture(value) {
    optics.value=value;
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  try {return [capture(1),capture(0)];}
  finally {optics.value=1;}
}"""


def expose_frame(route):
    response=route.fetch()
    body=response.text().replace("renderer.setAnimationLoop(now => {","renderer.setAnimationLoop(window.leafFrame = now => {")
    body=body.replace("const clock = new THREE.Clock();","const clock = new THREE.Clock(); window.leafClock=clock;")
    route.fulfill(response=response,body=body)


def capture_pair(page,out,prefix):
    data=page.evaluate(COMPARE)
    images=[Image.open(BytesIO(base64.b64decode(frame))).convert("RGB") for frame in data]
    images[0].save(out/(prefix+"-4k.jpg"),quality=95)
    box=(1200,560,2650,1660)
    pair=Image.new("RGB",(2900,1100))
    crops=[image.crop(box) for image in images]
    for i,crop in enumerate(crops):
        pair.paste(crop,(1450*i,0))
    pair.save(out/(prefix+"-same-frame.jpg"),quality=95)
    delta=np.abs(np.asarray(crops[0],dtype=np.int16)-np.asarray(crops[1],dtype=np.int16)).max(axis=2)
    return {"changedPixels":int((delta>5).sum()),"peak":int(delta.max())}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
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
        page.on("console",lambda row:errors.append(row.text) if row.type=="error" else None)
        page.route(args.url,expose_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.leafWater?.totals?.impact>0",timeout=65000)
        index=page.evaluate("__scene.mission().water.leafWater.latest.impact.index")
        page.evaluate(CAMERA,index)
        live=page.evaluate(LIVE)
        page.evaluate(INSTALL_AUDIT)
        impact=page.evaluate(NEXT_PACKET,"impact")
        page.evaluate(CAMERA,impact["index"])
        page.evaluate("()=>{for(let i=0;i<15;i++)leafStep()}")
        impact_audit=page.evaluate(AUDIT,{**impact,"kind":"impact"})
        impact_visual=capture_pair(page,args.out,"01-landing-ripples")
        page.evaluate("()=>{for(let i=0;i<26;i++)leafStep()}")
        drift=page.evaluate(NEXT_PACKET,"drift")
        page.evaluate(CAMERA,drift["index"])
        page.evaluate("()=>{for(let i=0;i<8;i++)leafStep()}")
        drift_audit=page.evaluate(AUDIT,{**drift,"kind":"drift"})
        drift_visual=capture_pair(page,args.out,"02-floating-leaf-wake")
        for _ in range(10):
            refloat=page.evaluate(NEXT_PACKET,"refloat")
            page.evaluate(CAMERA,{"index":refloat["index"]})
            page.evaluate("()=>{for(let i=0;i<5;i++)leafStep()}")
            film_audit=page.evaluate(AUDIT,{**refloat,"kind":"refloat"})
            visible=page.evaluate(VISIBLE_BLADE)
            if visible>400 and film_audit["instanceError"] is not None and film_audit["covered"]>25:
                break
        assert visible>400,visible
        film_visual=capture_pair(page,args.out,"03-bank-film")
        report={"live":live,"impact":{"source":impact,"gpu":impact_audit,"image":impact_visual},
            "drift":{"source":drift,"gpu":drift_audit,"image":drift_visual},
            "refloat":{"source":refloat,"gpu":film_audit,"image":film_visual,"bladePixels":visible},"errors":errors}
        (args.out/"leaf-water-verification.json").write_text(json.dumps(report,indent=2)+"\n")
        assert not errors and live["device"]["resolution"]==[3840,2160],report
        for case in ("impact","drift","refloat"):
            values=report[case]["gpu"]
            assert values["instanceError"]<.00004 and values["covered"]>25 and values["strongest"]>15,report[case]
        assert impact_audit["distance"]>.035 and impact_audit["leafContactOffset"]<.030,impact_audit
        assert impact_visual["changedPixels"]>1800 and drift_visual["changedPixels"]>900,report
        assert live["leafWater"]["totals"]["drift"]>15 and live["peakSpin"]>.15 and live["p95"]<25,live
        if args.record:
            page.close()
            record=browser.new_page(viewport={"width":1920,"height":1080})
            record.goto(args.url,wait_until="domcontentloaded",timeout=65000)
            record.wait_for_function("""window.__scene?.mission()?.water?.foliage?.events?.some(e=>
                e.kind==='release' && e.id===0)""",timeout=65000)
            first=record.evaluate("__scene.mission().water.foliage.events.find(e=>e.kind==='release' && e.id===0).index")
            record.evaluate(CAMERA,first)
            (args.out/"leaf-contact.webm").write_bytes(base64.b64decode(record.evaluate(RECORD)))
        browser.close()


if __name__=="__main__":
    main()
