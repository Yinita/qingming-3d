"""Compare solver-driven vortices with steady obstacle deflection in a fixed replay."""

import argparse
import base64
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_foam_barriers import INSTALL as READ_FOAM
from verify_rain_capture_budget import INSTALL as CAPTURE
from verify_rain_wave_packets import expose_paused_frame

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

def expose_solver(route):
    response = route.fetch()
    source = response.text()
    simulation = "depthAt:fluidDepth,piers,current:flowSpeed,waveMaker,"
    assert source.count(simulation) == 1
    source = source.replace(simulation, simulation + "wakeStrength:window.disableCurrentWakes ? 0 : 1,")
    route.fulfill(response=response, body=source)

POSES = {
    "pier": [[-65.25, 1.58, -39.40], [-63.60, .025, -41.51]],
    "skiff": [[-66.21, 1.61, -45.59], [-63.98, .04, -47.23]],
}
PATCHES = {
    "pier": [-63.56, -41.20, .57, .73],
    "skiff": [-63.96, -47.15, .94, .87],
}

STEP = """({frames,record}) => {
  const captured=[];
  for(let i=0;i<frames;i++) {
    leafFrame(window.wakeReplayTick+=1000/60);
    if(record && i%4===3) captured.push(__scene.renderer.domElement.toDataURL('image/jpeg',.90).split(',')[1]);
  }
  return captured;
}"""

SAMPLE = """(patch) => {
  const {renderer}=__scene;
  const {world,target}=foamPass;
  const [x,z,rx,rz]=patch;
  const {x:minX,y:minZ,z:invX,w:invZ}=world.children[0].material.uniforms.simulationBounds.value;
  const {width,height}=target;
  const pixels=new Uint8Array(width*height*4);
  renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
  const values=[];
  for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
    const wx=minX+(col+.5)/(width*invX), wz=minZ+(row+.5)/(height*invZ);
    if(Math.abs(wx-x)>rx || Math.abs(wz-z)>rz) continue;
    const at=(row*width+col)*4;
    values.push((pixels[at]*256+pixels[at+1])/65535);
  }
  const {simulation,foam,time,skiff}=__scene.mission().water;
  return {time,foil:skiff.position,packets:simulation.wakes?.packets ?? [],
    values,passes:foam.passes,size:[width,height],gl:renderer.getContext().getError()};
}"""

FLOW = """() => {
  const {uniforms}=foamPass.world.children[0].material;
  return Array.from(uniforms.channelFlow.value.image.data);
}"""

TRACK = """async ({patch,baseline}) => {
  const THREE=await import('three');
  const {renderer}=__scene;
  const {world,camera,target,render}=foamPass;
  const {uniforms}=world.children[0].material;
  const {width,height}=target, bounds=uniforms.simulationBounds.value;
  const {wakes}=__scene.mission().water.simulation;
  const [x,z]=patch;
  const packets=wakes.packets.filter(p=>p.age>.38 &&
    (patch[2]>.8 ? p.source==='skiff' : p.source!=='skiff'));
  packets.sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));
  const core=packets[0];
  if(!core) throw new Error('No separated wake core in the replay');
  const actual=uniforms.channelFlow.value.image, dt=.04, frames=18;
  const seedData=new Uint8Array(width*height*4), output=new Uint8Array(seedData.length);
  const dx=1/(width*bounds.z), dz=1/(height*bounds.w);
  function location(col,row) {
    return [bounds.x+(col+.5)*dx-core.x, bounds.y+(row+.5)*dz-core.z];
  }
  for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
    const [x,z]=location(col,row);
    const value=Math.round(58300*Math.exp(-((x/.18)**2+(z/.052)**2)));
    const at=(row*width+col)*4;
    seedData[at]=value>>>8; seedData[at+1]=value&255; seedData[at+3]=255;
  }
  function texture(data,width,height) {
    const image=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
    image.minFilter=image.magFilter=THREE.LinearFilter;
    image.needsUpdate=true;
    return image;
  }
  function densityOnly(input) {
    const data=new Uint8Array(input);
    for(let i=2;i<data.length;i+=4) data[i]=0; // Keep velocity, zero new foam production.
    return texture(data,actual.width,actual.height);
  }
  const drawings=[densityOnly(baseline),densityOnly(actual.data)];
  const seed=texture(seedData,width,height);
  const quiet=texture(new Uint8Array([128,0,0,0]),1,1);
  const buffers=[0,1].map(()=>new THREE.WebGLRenderTarget(width,height,{depthBuffer:false}));
  const saved=Object.fromEntries(['channelFlow','waterState','stepSeconds',
    'previousFoam','initialized','time','windStrength'].map(key=>[key,uniforms[key].value]));
  function moment(data) {
    let mass=0,x=0,z=0,xx=0,zz=0,xz=0;
    for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
      const at=(row*width+col)*4;
      const value=(data[at]*256+data[at+1])/65535;
      if(value<.0003) continue;
      const [u,v]=location(col,row);
      mass+=value; x+=value*u; z+=value*v; xx+=value*u*u; zz+=value*v*v; xz+=value*u*v;
    }
    x/=mass; z/=mass;
    return {mass,x,z,angle:.5*Math.atan2(2*(xz/mass-x*z),(xx-zz)/mass-x*x+z*z)};
  }
  let after;
  try {
    uniforms.waterState.value=quiet;
    uniforms.windStrength.value=0;
    uniforms.initialized.value=1;
    uniforms.stepSeconds.value=dt;
    after=drawings.map(field=>{
      uniforms.channelFlow.value=field;
      for(let i=0;i<frames;i++) {
        uniforms.time.value=saved.time+(i+1)*dt;
        uniforms.previousFoam.value=i ? buffers[(i-1)%2].texture : seed;
        renderer.setRenderTarget(buffers[i%2]);
        render(world,camera);
      }
      renderer.readRenderTargetPixels(buffers[(frames-1)%2],0,0,width,height,output);
      return moment(output);
    });
  } finally {
    renderer.setRenderTarget(null);
    for(const [key,value] of Object.entries(saved)) uniforms[key].value=value;
    for(const resource of [seed,quiet,...drawings,...buffers]) resource.dispose();
  }
  return {core,seconds:dt*frames,initial:moment(seedData),steady:after[0],wake:after[1],
    gl:renderer.getContext().getError()};
}"""

def crop_change(on, off):
    a, b = [np.asarray(Image.open(path), dtype=np.int16) for path in (on, off)]
    h, w = a.shape[:2]
    difference = np.abs(a[h//3:5*h//6, w//4:3*w//4] - b[h//3:5*h//6, w//4:3*w//4]).mean(axis=2)
    return {"fractionAboveFour": float((difference > 4).mean()), "peak": float(difference.max())}

with TemporaryDirectory(prefix="qingming-wake-frames-") as scratch, sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
        args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    errors = []
    result = {}
    for shot, pose in POSES.items():
        runs = {}
        for enabled in (False, True):
            page = browser.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda row: errors.append(row.text) if row.type == "error" else None)
            page.add_init_script(f"window.disableCurrentWakes = {str(not enabled).lower()};")
            page.route(args.url, expose_paused_frame)
            page.route("**/bridge-water.js", expose_solver)
            page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
            page.wait_for_function("""window.__scene && window.leafFrame &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",
                timeout=65000)
            page.evaluate(CAPTURE)
            page.evaluate(READ_FOAM)
            page.evaluate("""pose=>{
              capturePose(pose);
              const {renderer,persp}=__scene;
              window.wakeReplayTick=0;
              leafClock.getDelta=()=>1/60;
              persp.fov=39;persp.updateProjectionMatrix();
              for(const id of ['missionRestart','questEntry','missionIntroShade']) {
                const el=document.getElementById(id);
                if(el) el.style.display='none';
              }
            }""", pose)
            page.evaluate(STEP, {"frames": 45, "record": False})
            tag = "wake" if enabled else "steady"
            work = Path(scratch) / f"{shot}-{tag}"
            work.mkdir()
            index = 0
            samples = []
            for _ in range(8):
                frames = page.evaluate(STEP, {"frames": 28, "record": True})
                for frame in frames:
                    (work / f"{index:03d}.jpg").write_bytes(base64.b64decode(frame))
                    index += 1
                samples.append(page.evaluate(SAMPLE, PATCHES[shot]))
            still = args.out / f"{shot}-{tag}-4k.jpg"
            page.evaluate("""()=>{
              const {renderer,scene,persp}=__scene;
              renderer.setPixelRatio(3);
              renderer.setSize(1280,720);
              leafFrame(window.wakeReplayTick+=1000/60);
              captureDraw(scene,persp);
            }""")
            image = page.evaluate("() => __scene.renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1]")
            still.write_bytes(base64.b64decode(image))
            runs[enabled] = {"samples": samples, "work": work, "still": still}
            if enabled:
                passive = page.evaluate(TRACK, {"patch": PATCHES[shot], "baseline": runs[False]["flow"]})
                print(shot,"passive tracer",passive,flush=True)
            else:
                runs[False]["flow"] = page.evaluate(FLOW)
            assert Image.open(still).size == (3840,2160)
            print(shot,tag,[(s["time"],sum(s["values"]),len(s["packets"])) for s in samples],flush=True)
            page.close()

        before, after = runs[False], runs[True]
        difference = []
        for a, b in zip(after["samples"], before["samples"]):
            assert a["time"] == b["time"] and a["passes"] == b["passes"] and a["passes"] > 27
            assert a["size"] == b["size"] == [512,856] and a["gl"] == b["gl"] == 0
            a_values, b_values = a.pop("values"), b.pop("values")
            a_mass, b_mass = sum(a_values), sum(b_values)
            delta = np.abs(np.asarray(a_values) - b_values)
            difference.append({"time":a["time"],"wakeFoam":a_mass,"steadyFoam":b_mass,
                "meanChange":float(delta.mean()),"fractionAbove002":float((delta>.02).mean())})
        result[shot] = {"gpuFoam":difference, "image":crop_change(after["still"],before["still"]),
            "wakeReplay":after["samples"],"passiveTracer":passive}
        print(shot,"gpu",difference,"image",result[shot]["image"],flush=True)
        subprocess.run(["ffmpeg","-loglevel","error","-y","-filter_complex_threads","1","-framerate","15","-i",str(before["work"]/"%03d.jpg"),
            "-framerate","15","-i",str(after["work"]/"%03d.jpg"),"-filter_complex",
            "[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2",
            "-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-movflags","+faststart",
            str(args.out/f"{shot}-comparison.mp4")],check=True)
    assert not errors, errors
    browser.close()

for shot, data in result.items():
    assert max(row["fractionAbove002"] for row in data["gpuFoam"]) > .03, (shot,data["gpuFoam"])
    assert data["image"]["fractionAboveFour"] > .001, (shot,data["image"])
    tracer = data["passiveTracer"]
    turn = abs(tracer["wake"]["angle"] - tracer["steady"]["angle"])
    data["passiveTracer"]["extraTurnDegrees"] = float(np.rad2deg(min(turn,np.pi-turn)))
    assert data["passiveTracer"]["extraTurnDegrees"] > 12 and tracer["gl"] == 0, tracer
    assert .26 < tracer["wake"]["mass"] / tracer["initial"]["mass"] < .72, tracer
(args.out/"render.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
