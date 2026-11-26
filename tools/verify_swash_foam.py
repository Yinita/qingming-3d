"""Replay bankward foam, return flow, and exposed residue in the running 4K canal."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame
from verify_canal_inflow import RECORD


CAMERA = """()=> {
  const {persp}=__scene;
  const update=persp.updateMatrixWorld.bind(persp);
  window.cameraShore=0;
  persp.updateMatrixWorld=force=>{
    persp.position.set(-65.86+.17*cameraShore,.82-.070*cameraShore,-47.93+.16*cameraShore);
    persp.lookAt(-67.19,.04,-48.63);
    return update(force);
  };
  persp.fov=48;
  persp.updateProjectionMatrix();
  for(const id of ['missionHud','missionWaypoint','seal']) {
    const label=document.getElementById(id);
    if(label) label.style.display='none';
  }
}"""

LIVE = """()=>new Promise(resolve=>{
  const {renderer}=__scene;
  const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
  const device={gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    resolution:[renderer.domElement.width,renderer.domElement.height]};
  const intervals=[],history=[];
  let start,previous,frames=0;
  function frame(now){
    start??=now;
    const elapsed=now-start;
    window.cameraShore=.24*Math.sin(elapsed*.0013);
    if(elapsed>800) {
      if(previous) intervals.push(now-previous);
      previous=now;
      if(frames++%3===0) {
        const {time,swash,breakers}=__scene.mission().water;
        history.push({time,reach:swash.liveReach,waves:breakers.passes,...swash.foam});
      }
    }
    if(elapsed<11850){requestAnimationFrame(frame);return;}
    intervals.sort((a,b)=>a-b);
    resolve({device,frames:intervals.length,p95:intervals[Math.ceil(intervals.length*.95)-1],history});
  }
  requestAnimationFrame(frame);
})"""

SEEK = """kind=>{
  const {scene,renderer,persp}=__scene;
  const {bankFoamMap,bankFoamBounds,origin}=scene.getObjectByName('Canal surface').material.uniforms;
  const image=bankFoamMap.value.image, px=persp.position.clone();
  const water=()=>__scene.mission().water;
  const retreat=kind==='retreat';
  const bounds=bankFoamBounds.value;
  const find=(channel)=>{
    let visible=0,sum=0,dry=0,liquidInDry=0;
    const points=[];
    for(let z=0;z<image.height;z++) for(let x=0;x<image.width;x++) {
      const j=4*(z*image.width+x);
      if(channel===0 && image.data[j]>7 && image.data[j+2]===0) liquidInDry++;
      if(image.data[j+channel]<8 || (retreat && image.data[j+2]!==0)) continue;
      const along=bounds.y+(z+.5)/image.height/bounds.w;
      const across=bounds.x+(x+.5)/image.width/bounds.z;
      const local=along-origin.value.y;
      const radius=8.59+.43*Math.sin(.55*local)+.21*Math.cos(.91*local)+.14*Math.cos(.33*local);
      px.set(origin.value.x-radius+across,.032,along).project(persp);
      if(px.z>1 || Math.abs(px.x)>.90 || Math.abs(px.y)>.90) continue;
      visible++;
      sum+=image.data[j+channel];
      dry+=Number(image.data[j+2]===0);
      if(points.length<12) points.push([x,z,image.data[j+channel]]);
    }
    return {visible,sum,dry,liquidInDry,points};
  };

  let mark=null;
  for(let i=0;i<255;i++){
    leafStep();
    const {swash,time}=water();
    const motion=swash.liveReach;
    if(retreat ? motion>.095 || swash.foam.residue<.9 : motion<.20) continue;
    const packed=find(retreat ? 1 : 0);
    if(packed.visible>(retreat ? 12 : 26) && packed.sum>(retreat ? 135 : 530)) {
      mark={time,reach:motion,foam:swash.foam,packed};
      break;
    }
  }
  if(!mark) throw new Error('No visible '+kind+' foam found');
  function snapshot() {
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  const original=image.data.slice();
  const on=snapshot();
  let off;
  try {
    const channel=retreat ? 1 : 0;
    for(let i=channel;i<image.data.length;i+=4) image.data[i]=0;
    bankFoamMap.value.needsUpdate=true;
    off=snapshot();
  } finally {
    image.data.set(original);
    bankFoamMap.value.needsUpdate=true;
  }
  return {mark,on,off};
}"""


def capture(page, kind, out):
    result=page.evaluate(SEEK,kind)
    images=[Image.open(BytesIO(base64.b64decode(result[key]))).convert("RGB") for key in ("on","off")]
    images[0].save(out/f"{kind}-4k.jpg",quality=95)
    pairing=Image.new("RGB",(2400,675))
    for i,image in enumerate(images):
        pairing.paste(image.resize((1200,675),Image.Resampling.LANCZOS),(i*1200,0))
    pairing.save(out/f"{kind}-same-frame.jpg",quality=95)
    difference=np.abs(np.asarray(images[0],dtype=np.int16)-np.asarray(images[1],dtype=np.int16)).max(axis=2)
    detail_width,detail_height=1100,630
    mask=(difference>6).astype(np.int32)
    integral=np.pad(mask,((1,0),(1,0))).cumsum(0).cumsum(1)
    counts=(integral[detail_height:,detail_width:]-integral[:-detail_height,detail_width:]
        -integral[detail_height:,:-detail_width]+integral[:-detail_height,:-detail_width])
    top,left=np.unravel_index(counts[::20,::20].argmax(),counts[::20,::20].shape)
    box=(left*20,top*20,left*20+detail_width,top*20+detail_height)
    detail=Image.new("RGB",(detail_width*2,detail_height))
    for i,image in enumerate(images):
        detail.paste(image.crop(box),(i*detail_width,0))
    detail.save(out/f"{kind}-detail.jpg",quality=96)
    return {**result["mark"],"changedPixels":int((difference>6).sum()),"peakChannelDifference":int(difference.max())}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&swell")
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--record",action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda row:errors.append(row.text) if row.type=="error" else None)
        page.route(args.url,expose_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.swash?.foam?.passes>3",timeout=65000)
        page.evaluate(CAMERA)
        live=page.evaluate(LIVE)
        page.evaluate("""()=>{
          __scene.renderer.setAnimationLoop(null);
          window.cameraShore=0;
          leafClock.getDelta=()=>1/60;
          let now=performance.now();
          window.leafStep=()=>leafFrame(now+=1000/60);
        }""")
        advancing=capture(page,"advancing",args.out)
        retreat=capture(page,"retreat",args.out)
        if args.record:
            page.evaluate("""()=>{
              __scene.renderer.getContext().finish();
              delete leafClock.getDelta;
              leafClock.oldTime=performance.now();
              __scene.renderer.setAnimationLoop(leafFrame);
            }""")
            video=page.evaluate(RECORD)
            (args.out/"foam-wash.webm").write_bytes(base64.b64decode(video))
        final=live["history"][-1]
        report={"live":live,"advancing":advancing,"retreat":retreat,"errors":errors}
        (args.out/"swash-foam-verification.json").write_text(json.dumps(report,indent=2)+"\n")
        print(json.dumps({"fps":{"frames":live["frames"],"p95":live["p95"]},"final":final,
          "advancingPixels":advancing["changedPixels"],"retreatPixels":retreat["changedPixels"],"errors":errors}),flush=True)
        assert not errors and live["device"]["resolution"]==[3840,2160],errors
        assert live["p95"]<24 and live["frames"]>440,live["p95"]
        assert final["frontSource"]>2 and final["bankward"]>.18 and final["riverward"]>.18,final
        assert final["returned"]>.04 and final["stoneDeflection"]>.05 and final["rewetted"]>.10,final
        assert max(abs(row["massError"]) for row in live["history"])<.00004,final
        assert advancing["changedPixels"]>1200 and retreat["changedPixels"]>900,report
        assert advancing["packed"]["liquidInDry"]==0,advancing
        assert retreat["packed"]["dry"]>12 and retreat["reach"]<advancing["reach"]-.095,report
        browser.close()


if __name__=="__main__":
    main()
