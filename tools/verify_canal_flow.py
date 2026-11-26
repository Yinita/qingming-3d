"""Capture 4K obstacle flow and verify foam transport through the renderer."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--before-url")
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

SETUP_CAMERA = """() => {
  const {persp,renderer}=__scene;
  const updateMatrix=persp.updateMatrixWorld.bind(persp);
  const render=renderer.render.bind(renderer);
  window.flowAudit={render};
  renderer.render=(world,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Advected canal foam') Object.assign(flowAudit,{world,camera,target});
    return render(world,camera);
  };
  window.inspectCanal=(position,target)=>{
    persp.updateMatrixWorld=force=>{
      persp.position.set(...position);
      persp.lookAt(...target);
      return updateMatrix(force);
    };
    persp.fov=39;
    persp.updateProjectionMatrix();
  };
}"""

GPU_TRANSPORT = """async () => {
  const THREE=await import('./vendor/three/build/three.module.js');
  const {channelVelocityLimit}=await import('./bridge-channel-flow.js');
  const {renderer}=__scene;
  const {world,camera,target,render}=flowAudit;
  const uniforms=world.children[0].material.uniforms;
  const {width,height}=target;
  const {z:inverseWidth,w:inverseLength}=uniforms.simulationBounds.value;
  const fieldScale=channelVelocityLimit/127;
  const encodedX=Math.round(128+.19/fieldScale), encodedZ=Math.round(128+.53/fieldScale);
  const velocity=new THREE.DataTexture(new Uint8Array([encodedX,encodedZ,0,255]),1,1,THREE.RGBAFormat);
  const dry=new THREE.DataTexture(new Uint8Array([128,0,0,0]),1,1,THREE.RGBAFormat);
  velocity.needsUpdate=dry.needsUpdate=true;
  const initial=new Uint8Array(width*height*4);
  for(let j=0;j<height;j++) for(let i=0;i<width;i++) {
    const x=((i+.5)/width-.48)/inverseWidth, z=((j+.5)/height-.43)/inverseLength;
    const value=Math.round(58000*Math.exp(-(x*x+z*z)/.0144));
    const at=(j*width+i)*4;
    initial[at]=value>>>8;
    initial[at+1]=value&255;
    initial[at+3]=255;
  }
  const seed=new THREE.DataTexture(initial,width,height,THREE.RGBAFormat);
  seed.minFilter=seed.magFilter=THREE.LinearFilter;
  seed.needsUpdate=true;
  const buffers=[0,1].map(()=>new THREE.WebGLRenderTarget(width,height,{depthBuffer:false}));
  const originals={};
  for(const key of ['channelFlow','waterState','previousFoam','initialized','stepSeconds','time'])
    originals[key]=uniforms[key].value;
  const pixels=new Uint8Array(initial.length);
  try {
    uniforms.channelFlow.value=velocity;
    uniforms.waterState.value=dry;
    uniforms.initialized.value=1;
    uniforms.stepSeconds.value=.04;
    for(let i=0;i<21;i++) {
      uniforms.time.value=originals.time+i*.04;
      uniforms.previousFoam.value=i ? buffers[(i-1)%2].texture : seed;
      renderer.setRenderTarget(buffers[i%2]);
      render(world,camera);
    }
    renderer.readRenderTargetPixels(buffers[0],0,0,width,height,pixels);
  } finally {
    renderer.setRenderTarget(null);
    for(const [key,value] of Object.entries(originals)) uniforms[key].value=value;
    for(const object of [velocity,dry,seed,...buffers]) object.dispose();
  }
  function moment(data) {
    let mass=0, x=0, z=0;
    for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
      const at=(row*width+col)*4, density=(data[at]*256+data[at+1])/65535;
      mass+=density;
      x+=density*(col+.5)/width;
      z+=density*(row+.5)/height;
    }
    return {mass,x:x/mass,z:z/mass};
  }
  const start=moment(initial), end=moment(pixels);
  const dt=21*.04;
  return {dt, moved:[(end.x-start.x)/inverseWidth,(end.z-start.z)/inverseLength],
    expected:[(encodedX-128)*fieldScale*dt,(encodedZ-128)*fieldScale*dt],
    massFraction:end.mass/start.mass};
}"""

PIER = [[-65.25, 1.58, -39.40], [-63.41, .025, -41.81]]
SKIFF = [[-66.31, 1.34, -51.32], [-64.09, .06, -49.1]]

with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    errors = []

    def capture(url, prefix):
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.caustics?.passes > 10", timeout=65000)
        page.evaluate(SETUP_CAMERA)
        page.evaluate("pose => inspectCanal(...pose)", PIER)
        page.wait_for_function("__scene.mission().water.time>5.3", timeout=22000)
        page.screenshot(path=args.out / f"{prefix}-pier.png")
        page.evaluate("pose => inspectCanal(...pose)", SKIFF)
        page.wait_for_timeout(800)
        page.screenshot(path=args.out / f"{prefix}-skiff.png")
        return page

    if args.before_url:
        capture(args.before_url, "before").close()
    page = capture(args.url, "current")
    live = page.evaluate("""() => {
      const {renderer,scene,persp}=__scene;
      renderer.setAnimationLoop(null);
      flowAudit.render(scene,persp);
      const x=-63.564,z=-42.332;
      const sample=(u,v)=>__scene.waterSample(x+u,z+v);
      const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        resolution:[renderer.domElement.width,renderer.domElement.height],
        upstream:[sample(-.25,-.30).meanU,sample(.25,-.30).meanU],
        downstream:sample(.25,.30).meanU,
        stopped:sample(0,0).meanV,
        simulation:__scene.mission().water.simulation,foam:__scene.mission().water.foam};
    }""")
    assert live["resolution"] == [3840, 2160] and live["foam"]["passes"] > 80, live
    assert live["upstream"][0] < -.025 and live["upstream"][1] > .025 and live["downstream"] < -.025, live
    assert abs(live["stopped"]) < .15, live
    page.screenshot(path=args.out / "foam-on.png")
    page.evaluate("""() => {
      const {scene,persp}=__scene;
      scene.getObjectByName('Canal surface').material.uniforms.foamDetail.value=0;
      flowAudit.render(scene,persp);
    }""")
    page.screenshot(path=args.out / "foam-off.png")
    crop = (1960, 990, 2830, 1480)
    on, off = [np.asarray(Image.open(args.out / name).crop(crop), dtype=np.int16)
               for name in ("foam-on.png", "foam-off.png")]
    difference = np.abs(on - off).mean(axis=-1)
    image = {"crop": crop, "fractionAboveFour": float((difference > 4).mean()), "peak": float(difference.max())}
    assert image["fractionAboveFour"] > .006 and image["peak"] > 14, image
    transport = page.evaluate(GPU_TRANSPORT)
    assert all(abs(a - b) < .035 for a, b in zip(transport["moved"], transport["expected"])), transport
    assert .34 < transport["massFraction"] < .68, transport
    assert not errors, errors
    result = {"live": live, "fixedFrameFoam": image, "detachedTransport": transport, "errors": errors}
    (args.out / "flow-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    browser.close()
