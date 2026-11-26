"""Check the continuous willow mesh and render matching 4K fork and tip views."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_rain_capture_budget import INSTALL
from verify_rain_wave_packets import expose_paused_frame


REPLAY = """async(record)=>{
  const {airUniforms}=await import('./bridge-air.js');
  const {renderer,scene,persp}=__scene;
  const trees=scene.getObjectsByProperty('name','Volumetric riverside willow');
  // Use the same incident wind in each run, independent of wake worker timing.
  airUniforms.windWakeMix.value=0;
  renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  const views={crown:[[-64.58,4.84,-48.54],[-66.73,4.46,-46.77]],
    fork:[[-65.31,3.81,-45.13],[-67.43,3.80,-46.50]]};
  function pose(name) {capturePose(views[name]);persp.fov=43;persp.updateProjectionMatrix();}
  const gl=renderer.getContext();
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
  const ink=record ? canvas.getContext('2d',{alpha:false}) : null;
  const frames=[], images={}, poseState={};
  const photo=()=>renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
  function hashPose(){
    return trees.map(tree=>{
      const data=tree.userData.branchMotion.pose.texture.value.image.data;
      const bytes=new Uint32Array(data.buffer,data.byteOffset,data.length);
      return bytes.reduce((k,i)=>Math.imul(k^i,16777619),2166136261)>>>0;
    });
  }
  leafClock.getDelta=()=>1/60;
  pose('crown');
  for(let tick=1;tick<=252;tick++) {
    leafFrame(tick*1000/60);
    if(tick===108) {
      images.crown=photo();
      poseState.crown=hashPose();
      pose('fork');
    }
    if(tick===109) {
      images.fork=photo();
      poseState.fork=hashPose();
      pose('crown');
    }
    if(ink && tick>=153 && tick%3===0) {
      ink.drawImage(renderer.domElement,0,0,960,540);
      frames.push(canvas.toDataURL('image/jpeg',.91).split(',')[1]);
    }
  }
  poseState.last=hashPose();
  const pixels=new Uint8Array(4), samples=[];
  const shadows=renderer.shadowMap.autoUpdate;
  for(let i=0;i<24;i++){
    const start=performance.now();
    captureDraw(scene,persp);
    gl.readPixels(1920,1080,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(i>=6) samples.push(performance.now()-start);
  }
  function topology(tree) {
    const {geometry:g}=tree.getObjectByName('Willow trunk and branches');
    const n=g.attributes.position.count, edges=new Map(), parent=new Int32Array(n);
    for(let i=0;i<n;i++) parent[i]=i;
    function root(i) {while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    for(let i=0;i<g.index.count;i+=3){
      const a=g.index.array[i],b=g.index.array[i+1],c=g.index.array[i+2],body=root(a);
      parent[root(b)]=body;
      parent[root(c)]=body;
      for(const [start,end] of [[a,b],[b,c],[c,a]]) {
        const key=Math.min(start,end)*n+Math.max(start,end);
        const edge=edges.get(key)??{count:0,orientation:0};
        edge.count++;
        edge.orientation+=start<end ? 1 : -1;
        edges.set(key,edge);
      }
    }
    const components=new Set();
    for(let i=0;i<n;i++) components.add(root(i));
    const counts=[...edges.values()];
    return {vertices:n,triangles:g.index.count/3,components:components.size,
      open:counts.filter(e=>e.count===1).length,nonManifold:counts.filter(e=>e.count>2).length,
      twisted:counts.filter(e=>e.count===2 && e.orientation!==0).length,
      skin:g.userData.junctions??null};
  }
  return {images,frames,topology:trees.map(topology),poseState,samples,shadows,
    device:[gl.drawingBufferWidth,gl.drawingBufferHeight],glError:gl.getError()};
}"""


def capture(browser, base, record):
    url = base.rstrip("/") + "/?mission&gust&swell"
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda log: errors.append(log.text) if log.type=="error" else None)
    page.route(lambda address:address==url,expose_paused_frame)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("""!!window.__scene && typeof window.leafFrame==='function' &&
          !!__scene.scene.getObjectByName('Willow trunk and branches').material.normalMap""",
            timeout=45000)
        page.evaluate(INSTALL)
        state=page.evaluate(REPLAY,record)
        assert not errors and not state["glError"],errors or state["glError"]
        state["renderReadbackMs"] = {f"p{q}":float(np.percentile(state["samples"],q)) for q in (50,95)}
        return state
    finally:
        page.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/")
    parser.add_argument("--before",required=True)
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--record",action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)

    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        before=capture(browser,args.before,args.record)
        after=capture(browser,args.url,args.record)
        browser.close()

    pair=Image.new("RGB",(1920,540))
    for name in before["images"]:
        for i,(label,state) in enumerate((("before",before),("after",after))):
            path=args.out/f"{name}-{label}-4k.jpg"
            path.write_bytes(base64.b64decode(state["images"][name]))
            pair.paste(Image.open(path).resize((960,540),Image.Resampling.LANCZOS),(i*960,0))
        pair.save(args.out/f"{name}-compare.jpg",quality=95)

    previous,current=before.pop("frames"),after.pop("frames")
    before.pop("images")
    after.pop("images")
    report={"before":before,"after":after}
    (args.out/"joined-bark.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({label:{k:case[k] for k in ("topology","poseState","renderReadbackMs")}
        for label,case in report.items()}),flush=True)
    assert before["poseState"]==after["poseState"]
    assert before["device"]==after["device"]==[3840,2160]
    for mesh in after["topology"]:
        assert mesh["components"]==1 and mesh["open"]==mesh["nonManifold"]==mesh["twisted"]==0,mesh
        assert mesh["skin"]["blendVertices"]>2000 and mesh["triangles"]<95_000,mesh

    if previous:
        assert len(previous)==len(current)
        with tempfile.TemporaryDirectory(prefix="qingming-joined-bark-") as folder:
            for i,(a,b) in enumerate(zip(previous,current)):
                for j,view in enumerate((a,b)):
                    pair.paste(Image.open(BytesIO(base64.b64decode(view))),(j*960,0))
                pair.save(Path(folder)/f"{i:03d}.jpg",quality=92)
            subprocess.run(["ffmpeg","-loglevel","error","-y","-framerate","8",
                "-i",str(Path(folder)/"%03d.jpg"),"-vf","fps=24","-c:v","libx264",
                "-pix_fmt","yuv420p","-crf","17","-movflags","+faststart",
                str(args.out/"joined-bark-ab.mp4")],check=True)


if __name__=="__main__":
    main()
