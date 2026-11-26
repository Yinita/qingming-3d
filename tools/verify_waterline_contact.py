"""Replay a mooring pull and isolate bubble and reflection detail at the waterline."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_rain_capture_budget import INSTALL
from verify_rain_wave_packets import expose_paused_frame


REPLAY = """async candidate=>{
  const {renderer,scene,persp}=__scene;
  const gl=renderer.getContext();
  const river=scene.getObjectByName('Canal surface'), mat=river.material;
  const {piers,skiff,simulation}=waterlineFixture;
  const images={}, samples={};
  const photo=()=>renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
  function without(marker) {
    const source=mat.fragmentShader;
    if(!source.includes(marker)) throw Error("Missing waterline shader: "+marker);
    const update=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    try {
      mat.fragmentShader=source.replace(marker,'if(false) {');
      mat.needsUpdate=true;
      captureDraw(scene,persp);
      return photo();
    } finally {
      mat.fragmentShader=source;mat.needsUpdate=true;
      renderer.shadowMap.autoUpdate=update;
    }
  }
  let ticks=0;
  const step=()=>leafFrame(++ticks*1000/60);
  const camera=(eye,look,fov)=>{
    capturePose([eye,look]);persp.fov=fov;persp.updateProjectionMatrix();
  };
  leafClock.getDelta=()=>1/60;
  camera([-66.18,.61,-50.22],[-63.80,.018,-48.85],48);
  while(ticks<162) step();
  if(!skiff.tug(mat.uniforms.time.value)) throw Error('The mooring did not move');
  for(const stop of [199,237,281]) {
    while(ticks<stop) step();
    const time=mat.uniforms.time.value, at=skiff.inspect(time);
    const field=[];
    for(let i=0;i<15;i++)
      field.push(simulation.sample(-65.12+i*.094,-49.80+(i%4)*.14).height);
    const name='hull-'+stop;
    samples[name]={time,position:at.position,yaw:at.rotation[1],velocity:at.velocity,
      pulls:at.pulls,field};
    images[name]=photo();
    if(candidate && stop===237) images.hullWithoutBubbles=without('if(contactFoam>.004) {');
  }
  const pile=piers.slice().sort((a,b)=>Math.hypot(a.x+63.56,a.y+42.48)-Math.hypot(b.x+63.56,b.y+42.48))[0];
  camera([pile.x-1.18,.28,pile.y-.91],[pile.x+.033,.053,pile.y+.035],47);
  while(ticks<312) step();
  images.pier=photo();
  if(candidate) {
    images.pierWithoutBand=without('if(pile.x>-.003 && pile.x<.128) {');
    images.pierWithoutBubbles=without('if(contactFoam>.004) {');
  }
  return {images,samples,raster:[gl.drawingBufferWidth,gl.drawingBufferHeight],error:gl.getError()};
}"""


def expose_waterline(route):
    response = route.fetch()
    source = response.text()
    marker = "  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert source.count(marker)==1
    route.fulfill(response=response,body=source.replace(
        marker,"  window.waterlineFixture={skiff,piers,simulation};\n"+marker))


def save_pair(directory,name,old,new):
    images = [Image.open(BytesIO(base64.b64decode(key))).convert("RGB") for key in (old,new)]
    assert all(image.size==(3840,2160) for image in images)
    delta = np.abs(np.asarray(images[0],dtype=np.int16)-np.asarray(images[1],dtype=np.int16)).max(axis=2)
    comparison = Image.new("RGB",(1920,540))
    for i,image in enumerate(images):
        comparison.paste(image.resize((960,540),Image.Resampling.LANCZOS),(i*960,0))
    comparison.save(directory/f"{name}-comparison.jpg",quality=94)
    images[1].save(directory/f"{name}-4k.jpg",quality=94)
    return {"mean":float(delta.mean()),"above8":int(np.sum(delta>=8))}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--reference",required=True)
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        results=[]
        for candidate,url in enumerate((args.reference,args.url)):
            page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
            page.on("pageerror",lambda error:errors.append(str(error)))
            page.on("console",lambda msg:errors.append(msg.text) if msg.type=="error" else None)
            page.route(url,expose_paused_frame)
            page.route("**/bridge-water.js",expose_waterline)
            page.goto(url,wait_until="networkidle",timeout=65000)
            page.wait_for_function("""window.__scene &&
                __scene.scene.getObjectByName('Moored timber skiff').children
                  .some(o=>o.material?.userData.hullWetting && o.material.userData.surfaceReady) &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            page.evaluate(INSTALL)
            results.append(page.evaluate(REPLAY,bool(candidate)))
            page.close()
        browser.close()
    before,after=results
    frames={name:save_pair(args.out,name,before["images"][name],after["images"][name])
            for name in before["images"]}
    frames["pier-contact"]=save_pair(args.out,"pier-contact",after["images"]["pierWithoutBand"],
                                     after["images"]["pier"])
    frames["hull-bubbles"]=save_pair(args.out,"hull-bubbles",after["images"]["hullWithoutBubbles"],
                                      after["images"]["hull-237"])
    frames["pier-bubbles"]=save_pair(args.out,"pier-bubbles",after["images"]["pierWithoutBubbles"],
                                      after["images"]["pier"])
    waves=max(abs(x-y) for name,a in before["samples"].items()
              for x,y in zip(a["field"],after["samples"][name]["field"]))
    report={"frames":frames,"waveDifferenceMetres":waves,"before":before["samples"],"after":after["samples"],
            "raster":after["raster"],"errors":errors}
    (args.out/"waterline-contact.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors and before["error"]==after["error"]==0,report
    assert before["raster"]==after["raster"]==[3840,2160],report
    assert all(a["time"]==after["samples"][name]["time"] and a["pulls"]==1
               for name,a in before["samples"].items()),report
    assert waves>.003 and frames["pier-contact"]["above8"]>500,report
    assert frames["hull-bubbles"]["above8"]>500 and frames["pier-bubbles"]["above8"]>150,report


if __name__=="__main__":
    main()
