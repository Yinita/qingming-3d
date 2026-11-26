"""Compare the live willow shoot layout and leaf deformation at the same pose."""

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


def foreground_variant(route):
    response = route.fetch()
    body = response.text()
    marker = "  const growth=newShoots.map("
    assert body.count(marker) == 1
    body = body.replace(marker, "  const oldBranchIndices=parts.reduce((sum,g)=>sum+g.index.count,0);\n" + marker)
    marker = '  branches.name="Willow hanging branches and shoots";'
    assert body.count(marker) == 1
    body = body.replace(marker, marker + "\n  branches.userData.oldIndexCount=oldBranchIndices;")
    route.fulfill(response=response, body=body)


def wind_variant(route):
    response = route.fetch()
    body = response.text()
    replacements = {
        '  const earlier=material.onBeforeCompile;':
            '  const earlier=material.onBeforeCompile;\n  window.willowLegacy ??= {value:0};',
        'if(blade) Object.assign(shader.uniforms,airUniforms);':
            'if(blade) Object.assign(shader.uniforms,airUniforms,{willowLegacy:window.willowLegacy});',
        '${blade ? airGLSL+willowBladeGLSL+leafFlexGLSL : ""}':
            '${blade ? airGLSL+canopyGLSL+willowBladeGLSL+leafFlexGLSL+"uniform float willowLegacy;" : ""}',
        'vec3 bladeSway=willowLeafResponse(willowBase+posedStem*willowWorldScale,plateNormal);':
            'vec3 stemWorld=willowBase+posedStem*willowWorldScale;\n'
            '    vec3 bladeSway=willowLegacy>.5 ? leafResponse(stemWorld) : willowLeafResponse(stemWorld,plateNormal);',
    }
    for old, new in replacements.items():
        assert body.count(old) == 1, old
        body = body.replace(old, new)
    route.fulfill(response=response, body=body)


REPLAY = """async(record)=>{
  const THREE=await import('three');
  const {airUniforms}=await import('./bridge-air.js');
  const {willowFlutter}=await import('./bridge-wind.js');
  const {renderer,scene,persp}=__scene;
  const crowns=scene.getObjectsByProperty('name','Volumetric riverside willow').map(tree=>({
    leaves:tree.getObjectByName('Willow canopy leaf instances'),
    wood:tree.getObjectByName('Willow hanging branches and shoots'),
  }));
  const lit=[[-64.58,4.84,-48.54],[-66.73,4.46,-46.77]];
  const arch=[[-64.86,2.84,-43.73],[-66.89,4.14,-46.89]];
  const frames=[], stills={};
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
  const ink=record ? canvas.getContext('2d',{alpha:false}) : null;
  const shot=()=>renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
  const view=(pose,fov)=>{capturePose(pose);persp.fov=fov;persp.updateProjectionMatrix();};
  const gl=renderer.getContext();
  let counts;
  function pair(read) {
    const current=crowns.map(({leaves})=>leaves.count);
    const render=()=>{
      const start=performance.now();
      captureDraw(scene,persp);
      return read(start);
    };
    try {
      willowLegacy.value=1;
      crowns.forEach(({leaves,wood},i)=>{
        leaves.count=Math.min(current[i],3168);
        wood.geometry.setDrawRange(0,wood.userData.oldIndexCount);
      });
      const before=render();
      willowLegacy.value=0;
      crowns.forEach(({leaves,wood},i)=>{
        leaves.count=current[i];
        wood.geometry.setDrawRange(0,Infinity);
      });
      const after=render();
      return [before,after];
    } finally {
      willowLegacy.value=0;
      crowns.forEach(({leaves,wood},i)=>{
        leaves.count=current[i];
        wood.geometry.setDrawRange(0,Infinity);
      });
    }
  }
  leafClock.getDelta=()=>1/60;
  view(lit,43);
  for(let tick=1;tick<=234;tick++) {
    leafFrame(tick*1000/60);
    if(tick===123) {
      stills.crown=pair(shot);
      counts=crowns.map(({leaves,wood})=>({active:leaves.count,old:Math.min(3168,leaves.count),
        total:leaves.instanceMatrix.count,minimum:leaves.userData.minimumVisible,
        woodTriangles:wood.geometry.index.count/3,oldWoodTriangles:wood.userData.oldIndexCount/3}));
      view(arch,43);
    }
    if(tick===125) stills.under=pair(shot);
    if(tick===126) view(lit,43);
    if(ink && tick>=135 && tick%3===0) {
      frames.push(pair(()=>{
        ink.drawImage(renderer.domElement,0,0,960,540);
        return canvas.toDataURL('image/jpeg',.91).split(',')[1];
      }));
    }
  }

  const pixel=new Uint8Array(4), cost=[];
  for(let i=0;i<20;i++) {
    const measured=pair(start=>{
      gl.readPixels(1920,1080,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return performance.now()-start;
    });
    if(i>=4) cost.push(measured);
  }

  // Evaluate the production blade response in uniform wind. Vary only the
  // normal. Keeping the same phase and stiffness isolates the directional load.
  const {windTime,windMap,windWakeMix,windStrength,windOrigin}=airUniforms;
  const bytes=windMap.value.image.data, saved=bytes.slice();
  const old=[windTime.value,windWakeMix.value,windStrength.value];
  const at=new THREE.Vector3(-66.8,4.12,-46.3);
  const actual=new THREE.Vector4(-.124,.16,.11,.98);
  const wind=new THREE.Vector3(1,0,0), inverse=wind.clone().negate(), edge=new THREE.Vector3(0,0,1);
  const out=new THREE.Vector3();
  let mean=0, reversed=0, faceTwist=0, edgeTwist=0;
  try {
    windWakeMix.value=0;
    windStrength.value=1;
    for(let i=0;i<bytes.length;i+=4) {bytes[i]=224; bytes[i+1]=128;}
    for(let i=0;i<240;i++){
      const t=windTime.value=i/60;
      willowFlutter(at,t,windOrigin.value,actual,wind,out);
      mean+=out.x-actual.x;faceTwist+=(out.y-actual.y)**2;
      willowFlutter(at,t,windOrigin.value,actual,inverse,out);
      reversed+=out.x-actual.x;
      willowFlutter(at,t,windOrigin.value,actual,edge,out);
      edgeTwist+=(out.y-actual.y)**2;
    }
  } finally {
    bytes.set(saved);
    [windTime.value,windWakeMix.value,windStrength.value]=old;
  }
  const directions={forwardBend:mean/240,reverseBend:reversed/240,
    broadsideTwistRMS:Math.sqrt(faceTwist/240),edgeTwistRMS:Math.sqrt(edgeTwist/240)};
  return {counts,directions,stills,frames,cost,raster:[gl.drawingBufferWidth,gl.drawingBufferHeight],
    gpu:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
    glError:gl.getError()};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
        page.route(lambda incoming: incoming == args.url, expose_paused_frame)
        page.route("**/bridge-wind.js", wind_variant)
        page.route("**/bridge-foreground.js*", foreground_variant)
        page.goto(args.url, wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("!!window.__scene && typeof window.leafFrame==='function'", timeout=35000)
        page.evaluate(INSTALL)
        report = page.evaluate(REPLAY,args.record)
        browser.close()

    for name, stills in report.pop("stills").items():
        pair = Image.new("RGB",(1920,540))
        images = []
        for i, encoded in enumerate(stills):
            path = args.out / f"{name}-{'after' if i else 'before'}-4k.jpg"
            path.write_bytes(base64.b64decode(encoded))
            im=Image.open(path).convert("RGB").resize((960,540),Image.Resampling.LANCZOS)
            images.append(np.asarray(im).astype(np.int16))
            pair.paste(im,(i*960,0))
        report[name+"ChangedFraction"]=float(np.mean(np.abs(images[0]-images[1]).max(axis=2)>5))
        pair.save(args.out/f"{name}-compare.jpg",quality=95)
    frames=report.pop("frames")
    durations=np.asarray(report.pop("cost"))
    report["renderReadbackMs"]={label:{f"p{p}":float(np.percentile(durations[:,i],p))
        for p in (50,95)} for i,label in enumerate(("before","after"))}
    (args.out/"willow-blades.json").write_text(json.dumps({**report,"errors":errors},indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors and report["raster"]==[3840,2160] and report["glError"]==0, errors or report
    crown=report["counts"][0]
    assert 3168<crown["active"]<=crown["total"]==4032 and crown["minimum"]==1248,report
    assert report["crownChangedFraction"]>.02 and report["underChangedFraction"]>.02,report
    direction=report["directions"]
    assert direction["forwardBend"]>.13 and direction["reverseBend"]<-.13,direction
    assert direction["broadsideTwistRMS"]>direction["edgeTwistRMS"]*2.8,direction
    if frames:
        with tempfile.TemporaryDirectory(prefix="qingming-willow-blades-") as temp:
            for i, views in enumerate(frames):
                for j, image in enumerate(views):
                    pair.paste(Image.open(BytesIO(base64.b64decode(image))),(960*j,0))
                pair.save(Path(temp)/f"{i:03d}.jpg",quality=92)
            subprocess.run(["ffmpeg","-loglevel","error","-y","-framerate","8","-i",str(Path(temp)/"%03d.jpg"),
                "-vf","fps=24","-c:v","libx264","-pix_fmt","yuv420p","-crf","17","-movflags","+faststart",
                str(args.out/"willow-blades-ab.mp4")],check=True)


if __name__=="__main__":
    main()
