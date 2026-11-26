"""Audit a travelling gust in branches, leaves, and the rendered water."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

FIXTURE = """async () => {
  const THREE=await import('./vendor/three/build/three.module.js');
  const {airAt,airFromMap,airUniforms,refreshAir}=await import('./bridge-air.js');
  const {canopyShift}=await import('./bridge-wind.js');
  const {scene,persp,renderer}=__scene;
  const render=renderer.render.bind(renderer);
  const original=persp.updateMatrixWorld.bind(persp);
  window.windAudit={THREE,airAt,airFromMap,airUniforms,refreshAir,canopyShift,scene,persp,renderer,render};
  renderer.render=(world,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Refracted sunlight on canal bed') windAudit.caustics={target,world,camera};
    if(target?.texture.name==='Canal refraction color') windAudit.refraction={target,world,camera};
    return render(world,camera);
  };
  windAudit.pose=(eye,target,fov)=>{
    persp.updateMatrixWorld=force=>{
      persp.position.set(...eye);
      persp.lookAt(...target);
      return original(force);
    };
    persp.fov=fov;
    persp.updateProjectionMatrix();
    persp.updateMatrixWorld();
  };
  windAudit.still=(time,enabled,refreshWater)=>{
    airUniforms.windTime.value=time;
    airUniforms.windStrength.value=enabled;
    scene.getObjectsByProperty('name','Volumetric riverside willow').forEach(tree=>{
      tree.userData.branchMotion.pose.amount.value=enabled;
    });
    refreshAir();
    if(refreshWater) {
      const shadow=renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate=false;
      try {
        renderer.setRenderTarget(windAudit.caustics.target);
        render(windAudit.caustics.world,windAudit.caustics.camera);
        renderer.setRenderTarget(windAudit.refraction.target);
        render(windAudit.refraction.world,windAudit.refraction.camera);
      } finally {
        renderer.setRenderTarget(null);
        renderer.shadowMap.autoUpdate=shadow;
      }
    }
    render(scene,persp);
  };
  windAudit.light=()=>{
    const {target}=windAudit.caustics, {width,height}=target;
    const rgba=new Uint8Array(width*height*4);
    renderer.readRenderTargetPixels(target,0,0,width,height,rgba);
    return Uint8Array.from({length:width*height},(_,i)=>rgba[i*4]);
  };
}"""

TRACE = """() => {
  const {THREE,airAt,airFromMap,airUniforms,refreshAir,canopyShift,scene}=windAudit;
  const western=scene.getObjectByName('Volumetric riverside willow');
  const east=[];
  scene.traverse(o=>{if(o.name===western.name && o.id!==western.id) east.push(o);});
  const sites=[['west',western.position.x,western.position.z],['canal',-59.,-43.17],
    ['east',east[0].position.x,east[0].position.z]];
  const air=new THREE.Vector2(), point=new THREE.Vector3(), bend=new THREE.Vector3();
  const trace=sites.map(([site,x,z])=>{
    const samples=Array.from({length:581},(_,i)=>({time:i*.02,speed:airAt(x,z,air,i*.02).length()}));
    const peak=samples.reduce((a,b)=>a.speed>b.speed ? a : b);
    return {site,x,z,peak,samples};
  });
  const root=new THREE.Vector4(western.position.x,0,western.position.z,4.8*western.scale.x);
  const heroLeaves=western.getObjectByName('Willow canopy leaf instances');
  const time=trace[0].peak.time+.15;
  const current=airUniforms.windTime.value;
  const wakes=airUniforms.windWakeMix.value;
  airUniforms.windWakeMix.value=0;
  airUniforms.windTime.value=time;
  refreshAir();
  point.set(root.x,0,root.z);
  const atGround=canopyShift(point,root,1.26,bend).length();
  point.set(root.x+.94,root.w*.94,root.z+.43);
  const atTip=canopyShift(point,root,1.26,bend).length();
  const mapError=trace.map(({x,z,peak})=>{
    airUniforms.windTime.value=peak.time;
    refreshAir();
    return Math.abs(airFromMap(x,z,air).length()-peak.speed);
  });
  airUniforms.windTime.value=current;
  airUniforms.windWakeMix.value=wakes;
  refreshAir();

  const wood=scene.getObjectByName('Volumetric perspective streets').children.filter(o=>
    o.name==='Street trunks and branching twigs');
  const crowns=scene.getObjectByName('Volumetric perspective streets').children.filter(o=>
    o.name==='Street crown individual blades');
  const matrix=new THREE.Matrix4(), from=new THREE.Vector3(), to=new THREE.Vector3(), row=new THREE.Vector3();
  const segment=new THREE.Line3();
  let checked=0, worst=0;
  for(const [index,crown] of crowns.entries()) {
    const branches=wood[index];
    const paths=Array.from({length:branches.count},(_,k)=>{
      branches.getMatrixAt(k,matrix);
      return [from.set(0,-.5,0).applyMatrix4(matrix).clone(),to.set(0,.5,0).applyMatrix4(matrix).clone()];
    });
    for(let i=0;i<crown.count;i+=Math.max(1,Math.floor(crown.count/7))) {
      crown.getMatrixAt(i,matrix);
      row.setFromMatrixPosition(matrix);
      let nearest=Infinity;
      for(const [a,b] of paths) {
        segment.set(a,b).closestPointToPoint(row,true,bend);
        nearest=Math.min(nearest,bend.distanceTo(row));
      }
      worst=Math.max(worst,nearest);
      checked++;
    }
  }
  const gl=windAudit.renderer.getContext(), extension=gl.getExtension('WEBGL_debug_renderer_info');
  return {trace,atGround,atTip,mapError,attachments:{checked,worst},windClock:airUniforms.windTime.value,
    bladeVertices:heroLeaves.geometry.attributes.position.count,
    gpu:extension&&gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
    resolution:[windAudit.renderer.domElement.width,windAudit.renderer.domElement.height]};
}"""


def difference(path, names, crop):
    left, right = [np.asarray(Image.open(path / f"{name}.png").crop(crop), dtype=np.int16) for name in names]
    delta = np.abs(left - right).mean(axis=-1)
    return {"fractionAboveFour": float((delta > 4).mean()), "peak": float(delta.max())}


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
    page.wait_for_function("__scene?.mission()?.water?.caustics?.passes > 5", timeout=65000)
    page.evaluate(FIXTURE)
    trace = page.evaluate(TRACE)
    peaks = [site["peak"]["time"] for site in trace["trace"]]
    assert trace["resolution"] == [3840, 2160]
    assert all(site["peak"]["speed"] > 2.3 for site in trace["trace"]), peaks
    assert peaks[0] + 1.4 < peaks[1] and peaks[1] + 2.5 < peaks[2], peaks
    assert trace["atGround"] == 0 and trace["atTip"] > .17, trace["atTip"]
    assert max(trace["mapError"]) < .14, trace["mapError"]
    assert trace["bladeVertices"] > 60
    assert trace["attachments"]["checked"] > 50 and trace["attachments"]["worst"] < .001, trace["attachments"]

    def screenshot(name):
        page.screenshot(path=args.out / f"{name}.png", timeout=45000)

    water_pose = [[-66.72, 1.24, -44.73], [-61.26, .024, -42.71], 46]
    page.evaluate("pose=>windAudit.pose(...pose)", water_pose)
    page.wait_for_function("__scene.mission().water.time>3.45",timeout=14000)
    tip=page.evaluate("__scene.mission().wind.branchMotion[0]")
    assert tip["tipTravel"]>.055 and tip["rootTravel"]<.00001,tip
    page.evaluate("windAudit.renderer.setAnimationLoop(null)")
    page.evaluate("""() => windAudit.pose([-65.35,2.95,-43.992],[-66.58,4.31,-47.512],41)""")
    page.evaluate("t=>windAudit.still(t,1,false)", peaks[0]+.15)
    screenshot("01-willow-gust")
    page.evaluate("t=>windAudit.still(t,0,false)", peaks[0]+.15)
    screenshot("02-willow-still")
    foliage = difference(args.out, ("01-willow-gust", "02-willow-still"), (850,300,3190,1740))
    assert foliage["fractionAboveFour"] > .055 and foliage["peak"] > 45, foliage

    page.evaluate("pose=>windAudit.pose(...pose)", water_pose)
    page.evaluate("t=>{windAudit.still(t,1,true);windAudit.gustLight=windAudit.light();}", peaks[1])
    screenshot("03-water-gust")
    lighting = page.evaluate("""t=>{
      windAudit.still(t,0,true);
      const quiet=windAudit.light(), hot=windAudit.gustLight;
      let changed=0,sum=0;
      for(let i=0;i<quiet.length;i++) {
        const delta=Math.abs(hot[i]-quiet[i]);
        changed+=Number(delta>5); sum+=delta;
      }
      return {texels:quiet.length,changed,sum};
    }""", peaks[1])
    screenshot("04-water-still")
    water = difference(args.out, ("03-water-gust", "04-water-still"), (800,960,3300,1980))
    assert lighting["changed"] > 9800 and water["fractionAboveFour"] > .010, (water, lighting)

    if args.record:
        page.close()
        page = browser.new_page(viewport={"width":1920,"height":1080})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("__scene?.mission()?.water?.refractionPasses>6",timeout=65000)
        page.evaluate(FIXTURE)
        record = """async ([eye,look,fov,start,length]) => {
          const target=document.createElement('canvas');
          target.width=1920; target.height=1080;
          const ctx=target.getContext('2d',{alpha:false});
          const recorder=new MediaRecorder(target.captureStream(30),{mimeType:'video/webm;codecs=vp8',
            videoBitsPerSecond:12000000});
          const chunks=[];
          const ready=new Promise(resolve=>{
            recorder.ondataavailable=e=>chunks.push(e.data);
            recorder.onstop=()=>{
              const reader=new FileReader();
              reader.onload=()=>resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));
            };
          });
          const {pose,airUniforms,refreshAir,renderer}=windAudit;
          pose(eye,look,fov);
          airUniforms.windTime.value=start;
          refreshAir();
          recorder.start();
          let begin;
          function capture(stamp) {
            if(begin===undefined) begin=stamp;
            const time=(stamp-begin)*.001;
            if(time>length) { recorder.stop(); return; }
            ctx.drawImage(renderer.domElement,0,0,1920,1080);
            requestAnimationFrame(capture);
          }
          requestAnimationFrame(capture);
          return ready;
        }"""
        shots = [
            ("wind-willow", [[-65.35,2.95,-43.992],[-66.58,4.31,-47.512],41,1.1,4.3]),
            ("wind-river", [[-68.52,2.71,-48.57],[-61.,1.63,-45.19],59,2.05,9.1]),
        ]
        for title, parameters in shots:
            clip = page.evaluate(record, parameters)
            (args.out / f"{title}.webm").write_bytes(base64.b64decode(clip))
    assert not errors, errors
    result = {"physical": trace, "willow": foliage, "water": water, "causticTexture": lighting, "errors": errors}
    (args.out / "wind-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"peaks": peaks, "tipDeflection": trace["atTip"], "attachments": trace["attachments"],
                      "willow": foliage, "water": water, "caustics": lighting}, ensure_ascii=False), flush=True)
    browser.close()
