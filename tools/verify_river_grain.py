"""Measure GPU surface trajectories and compare the same 4K water views."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_canal_inflow import RECORD


def expose_scene(route):
    response = route.fetch()
    source = response.text()
    marker = "  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert source.count(marker) == 1
    source = source.replace("const steadyLow=closeReflection", "const steadyLow=!window.grainLegacy && closeReflection")
    source = source.replace("seesCanal && surfaceGrain.update", "seesCanal && !window.grainLegacy && surfaceGrain.update")
    source = source.replace(marker, "  window.grainScene={piers,skiff};\n" + marker)
    route.fulfill(response=response, body=source)


INSTALL = """()=>{
  const {renderer}=__scene;
  const render=renderer.render.bind(renderer);
  window.grainPass={render};
  renderer.render=(world,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Canal surface material trajectories') Object.assign(grainPass,{world,camera,target});
    return render(world,camera);
  };
}"""

GPU = """async()=>{
  const THREE=await import('three');
  const {channelVelocityLimit}=await import('./bridge-channel-flow.js');
  const {renderer}=__scene;
  renderer.setAnimationLoop(null);
  const {world,camera,target,render}=grainPass;
  const {uniforms}=world.children[0].material;
  const {width,height}=target, bounds=uniforms.simulationBounds.value;
  const {piers,skiff}=grainScene;
  const pile=piers.slice().sort((a,b)=>Math.hypot(a.x+63.56,a.y+42.48)-Math.hypot(b.x+63.56,b.y+42.48))[0];
  const {x:boatX,y:boatZ,z:boatAxisX,w:boatAxisZ}=skiff.wake;
  const boat=[boatX,boatZ], beam=[boatAxisZ,-boatAxisX], along=[boatAxisX,boatAxisZ];
  const targets=[0,1].map(()=>new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,depthBuffer:false}));
  const zero=new THREE.DataTexture(new Uint16Array(4),1,1,THREE.RGBAFormat,THREE.HalfFloatType);
  zero.needsUpdate=true;
  const raw=new Uint16Array(width*height*4);
  const readKeys=['channelFlow','previousGrain','stepSeconds'];
  const saved=Object.fromEntries(readKeys.map(key=>[key,uniforms[key].value]));
  const retain=uniforms.retain.value.clone();
  const toFloat=(at)=>THREE.DataUtils.fromHalfFloat(raw[at]);
  const dt=.041;

  function source(x,z) {
    const encode=n=>Math.round(128+n*127/channelVelocityLimit);
    const texture=new THREE.DataTexture(new Uint8Array([encode(x),encode(z),0,0]),1,1);
    texture.needsUpdate=true;
    return texture;
  }

  function launch(flow,steps,reset=false) {
    uniforms.channelFlow.value=flow;
    uniforms.stepSeconds.value=dt;
    for(let i=0;i<steps;i++) {
      uniforms.retain.value.set(reset&&i===steps-1 ? 0 : 1,1);
      uniforms.previousGrain.value=i ? targets[(i-1)%2].texture : zero;
      renderer.setRenderTarget(targets[i%2]);
      render(world,camera);
    }
    renderer.readRenderTargetPixels(targets[(steps-1)%2],0,0,width,height,raw);
  }

  function point(x,z) {
    const col=Math.floor((x-bounds.x)*bounds.z*width);
    const row=Math.floor((z-bounds.y)*bounds.w*height);
    const at=(row*width+col)*4;
    return Array.from({length:4},(_,i)=>toFloat(at+i));
  }

  function hullInside(x,z) {
    const ring=uniforms.foamHullPoints.value;
    let inside=false,distance=Infinity;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[j],b=ring[i],dx=b.x-a.x,dz=b.y-a.y;
      if((a.y>z)!==(b.y>z) && x<a.x+(z-a.y)*dx/dz) inside=!inside;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.y)*dz)/Math.max(1e-10,dx*dx+dz*dz)));
      distance=Math.min(distance,Math.hypot(x-a.x-t*dx,z-a.y-t*dz));
    }
    return inside && distance>.035;
  }

  function range(center,shape,axis) {
    let minimum=Infinity,maximum=-Infinity,interior=0,interiorPeak=0,near=0;
    for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
      const x=bounds.x+(col+.5)/(width*bounds.z), z=bounds.y+(row+.5)/(height*bounds.w);
      const dx=x-center[0], dz=z-center[1];
      if(Math.abs(dx)>2.1 || Math.abs(dz)>2.1) continue;
      const at=(row*width+col)*4, vx=toFloat(at),vz=toFloat(at+1);
      const inside=shape==='skiff' ? hullInside(x,z) : Math.abs(dx)<.066 && Math.abs(dz)<.073;
      if(inside) {
        interior++;
        interiorPeak=Math.max(interiorPeak,Math.hypot(vx,vz));
      } else if(Math.hypot(dx,dz)<(shape==='skiff' ? 1.80 : .62)) {
        const side=vx*axis[0]+vz*axis[1];
        minimum=Math.min(minimum,side);
        maximum=Math.max(maximum,side);
        near++;
      }
    }
    return {minimum,maximum,interior,interiorPeak,near};
  }

  const uniform=source(.34,.73), pierStream=source(0,.84), shipStream=source(.85*beam[0],.85*beam[1]);
  const open=[-57.3,-49.0];
  try {
    launch(uniform,19);
    const constant={value:point(...open),expected:[-.34*dt*19,-.73*dt*19],elapsed:dt*19};
    launch(uniform,19,true);
    const phaseReset=point(...open);
    launch(pierStream,22);
    const pier=range([pile.x,pile.y],'pier',[1,0]);
    launch(shipStream,22);
    const hull=range(boat,'skiff',along);
    launch(saved.channelFlow,7);
    const natural={
      pier:range([pile.x,pile.y],'pier',[1,0]),
      skiff:range(boat,'skiff',[1,0]),
      elapsed:dt*7,
    };
    return {constant,phaseReset,pier,hull,natural,target:[width,height]};
  } finally {
    renderer.setRenderTarget(null);
    for(const key of readKeys) uniforms[key].value=saved[key];
    uniforms.retain.value.copy(retain);
    for(const item of [...targets,uniform,pierStream,shipStream,zero]) item.dispose();
  }
}"""

CAMERA = """({location})=>{
  const {persp}=__scene;
  window.grainCamera??=persp.updateMatrixWorld.bind(persp);
  const viewpoints={
    pier:[[-65.86,.77,-44.97],[-63.22,.02,-41.59]],
    skiff:[[-66.13,1.13,-51.20],[-63.97,.01,-48.97]],
    channel:[[-68.05,2.45,-48.90],[-62.40,1.06,-45.30]],
  };
  persp.updateMatrixWorld=force=>{
    const [eye,aim]=viewpoints[location];
    persp.position.set(...eye);
    persp.lookAt(...aim);
    return grainCamera(force);
  };
  persp.fov=location==='channel' ? 54 : 43;
  persp.updateProjectionMatrix();
  for(const id of ['missionHud','missionWaypoint','missionIntro','seal']) {
    const node=document.getElementById(id);
    if(node) node.style.display='none';
  }
}"""

SAME_FRAME = """()=>{
  const {renderer,scene,persp}=__scene;
  const amount=scene.getObjectByName('Canal surface').material.uniforms.riverGrainAmount;
  const result={};
  amount.value=0;
  try {
    renderer.render(scene,persp);
    result.before=renderer.domElement.toDataURL('image/png').split(',')[1];
    amount.value=1;
    renderer.render(scene,persp);
    result.after=renderer.domElement.toDataURL('image/png').split(',')[1];
  } finally {
    amount.value=1;
  }
  return result;
}"""

TIMING = """async({legacy=false,duration=5700})=>{
  const water=__scene.scene.getObjectByName('Canal surface').material;
  window.grainLegacy=legacy;
  if(legacy && water.defines.RIVER_GRAIN) {
    delete water.defines.RIVER_GRAIN;
    water.needsUpdate=true;
  }
  await new Promise(resolve=>setTimeout(resolve,900));
  return new Promise(resolve=>{
    const spans=[],start=performance.now();
    let last,previous=__scene.mission().water;
    let combined=0,reflections=0,refractions=0;
    function step(now) {
      if(last!==undefined) spans.push(now-last);
      last=now;
      const state=__scene.mission().water;
      const reflected=state.reflectionPasses!==previous.reflectionPasses;
      const refracted=state.refractionPasses!==previous.refractionPasses;
      combined+=Number(reflected&&refracted);
      reflections+=Number(reflected);
      refractions+=Number(refracted);
      previous=state;
      if(now-start<duration) {requestAnimationFrame(step);return;}
      spans.sort((a,b)=>a-b);
      resolve({frames:spans.length,p50:spans[Math.ceil(.50*spans.length)-1],slow:spans.filter(span=>span>21).length,
        p95:spans[Math.ceil(.95*spans.length)-1],combined,reflections,refractions,
        grain:state.flowGrain});
    }
    requestAnimationFrame(step);
  });
}"""


def save_pair(images, destination, name):
    before, after = (Image.open(BytesIO(base64.b64decode(images[key]))).convert("RGB") for key in ("before", "after"))
    assert before.size == after.size == (3840, 2160)
    delta = np.abs(np.array(after, dtype=np.int16) - np.array(before, dtype=np.int16))
    changed = int(np.count_nonzero(delta.max(axis=2) >= 8))
    comparison = Image.new("RGB", (1920, 540))
    for index, frame in enumerate([before, after]):
        comparison.paste(frame.resize((960, 540), Image.Resampling.LANCZOS), (960*index, 0))
    comparison.save(destination / f"{name}-same-frame.jpg", quality=94)
    after.save(destination / f"{name}-4k.jpg", quality=95)
    assert changed > 24000, (name, changed)
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page = browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type=="error" else None)
        page.route("**/bridge-water.js", expose_scene)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.flowGrain?.passes>1",timeout=35000)
        page.evaluate(INSTALL)
        visuals = {}
        for name in ("pier","skiff"):
            page.evaluate(CAMERA, dict(location=name))
            page.wait_for_timeout(600)
            visuals[name] = save_pair(page.evaluate(SAME_FRAME), args.out, name)
        if args.record:
            page.evaluate("grainScene.skiff.tug(__scene.mission().water.time)")
            video = args.out / "water-grain.webm"
            video.write_bytes(base64.b64decode(page.evaluate(RECORD,4800)))
        timing = {"low": {"before": page.evaluate(TIMING, {"legacy": True}),
                          "after": page.evaluate(TIMING, {})}}
        page.evaluate(CAMERA, {"location":"channel"})
        timing["channel"] = {"before":page.evaluate(TIMING, {"legacy":True}),
                             "after":page.evaluate(TIMING, {})}
        gpu = page.evaluate(GPU)
        browser.close()
    if args.record:
        subprocess.run(["ffmpeg","-loglevel","error","-y","-i",str(video),"-vf","fps=30","-c:v","libx264",
            "-pix_fmt","yuv420p","-crf","19","-movflags","+faststart",str(video.with_suffix(".mp4"))],check=True)
        video.unlink()
    report = {"gpu":gpu,"visuals":visuals,"timing":timing,"errors":errors}
    (args.out/"grain-verification.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors, errors
    assert max(abs(a-b) for a,b in zip(gpu["constant"]["value"],gpu["constant"]["expected"])) < .016
    assert max(abs(n) for n in gpu["phaseReset"][:2]) < .0001 and abs(gpu["phaseReset"][3]) > .42
    for name in ("pier","hull"):
        result=gpu[name]
        assert result["interior"]>0 and result["interiorPeak"]<.0001, result
        assert result["minimum"]<-.022 and result["maximum"]>.022, result
    assert gpu["natural"]["pier"]["minimum"]<-.011 and gpu["natural"]["pier"]["maximum"]>.014
    before,after=(timing["low"][phase] for phase in ("before","after"))
    assert before["combined"]>70 and after["combined"]<before["combined"]*.12,timing["low"]
    assert after["refractions"]>50 and after["reflections"]>50,after
    assert after["p95"]<=before["p95"]+.3,timing["low"]
    before,after=(timing["channel"][phase] for phase in ("before","after"))
    assert after["p50"]<=before["p50"]+.3 and after["frames"]>=before["frames"]*.86,timing["channel"]
    assert after["grain"]["renewals"]>=5,after


if __name__ == "__main__":
    main()
