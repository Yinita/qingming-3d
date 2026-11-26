"""Validate directional ripple energy and compare the same captured water frame."""

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


ENERGY = """async()=>{
  const THREE=await import('three');
  const {riverRippleGLSL}=await import('./bridge-water-ripples.js');
  const {renderer}=__scene;
  const width=144,height=128;
  const material=new THREE.ShaderMaterial({
    uniforms:{wind:{value:new THREE.Vector2()},pixel:{value:0},gain:{value:0}},
    vertexShader:'void main(){gl_Position=vec4(position,1.);}',
    fragmentShader:`
      uniform vec2 wind;
      uniform float pixel,gain;
      ${riverRippleGLSL}
      void main() {
        vec2 point=vec2(.281,.317)*gl_FragCoord.xy;
        RippleField field=RippleField(point,vec2(pixel,0.),vec2(0.,pixel),wind,gain,5.3);
        RipplePacket packet=shortRipplePacket(field);
        vec3 sampleValue=broadRiverRipples(field)+shortRiverRipples(field,packet)+fineRiverRipples(field,packet);
        gl_FragColor=vec4(sampleValue,1.);
      }`,
  });
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const quad=new THREE.Mesh(geo,material);
  quad.frustumCulled=false;
  const scene=new THREE.Scene(), camera=new THREE.Camera();
  scene.add(quad);
  const target=new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false});
  const data=new Float32Array(width*height*4);
  const original=renderer.getRenderTarget();
  function measure(x,z,pixel,gain) {
    material.uniforms.wind.value.set(x,z);
    material.uniforms.pixel.value=pixel;
    material.uniforms.gain.value=gain;
    renderer.setRenderTarget(target);
    renderer.render(scene,camera);
    renderer.readRenderTargetPixels(target,0,0,width,height,data);
    let xx=0,zz=0,unresolved=0;
    for(let i=0;i<data.length;i+=4) {
      xx+=data[i]**2;zz+=data[i+1]**2;unresolved+=data[i+2];
    }
    const samples=width*height;
    return {samples,pixel,eastFraction:xx/(xx+zz),slope:(xx+zz)/samples,
      unresolved:unresolved/samples,total:(xx+zz+unresolved)/samples};
  }
  try {
    return {east:measure(1,0,.003,1),north:measure(0,1,.003,1),shelter:measure(1,0,.003,0),
      broad:measure(1,0,.12,1),distant:measure(1,0,.28,1)};
  } finally {
    renderer.setRenderTarget(original);
    target.dispose();material.dispose();geo.dispose();
  }
}"""

REPLAY = """async poses=>{
  const {fragmentShader}=await import('./bridge-water-prior-ripples.js');
  const {renderer,scene,persp}=__scene;
  const mat=scene.getObjectByName('Canal surface').material;
  const current=mat.fragmentShader, prior=fragmentShader(rippleAuditHull);
  leafClock.getDelta=()=>1/60;
  let frame=0;
  const output={};
  for(const [name,{eye,look,fov,at}] of Object.entries(poses)) {
    capturePose([eye,look]);persp.fov=fov;persp.updateProjectionMatrix();
    while(frame<at) leafFrame(++frame*1000/60);
    const time=mat.uniforms.time.value;
    const shadow=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    const shot=()=>{
      captureDraw(scene,persp);
      return renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    };
    try {
      const after=shot();
      mat.fragmentShader=prior;mat.needsUpdate=true;
      const before=shot();
      if(mat.uniforms.time.value!==time) throw Error('Water replay changed during comparison');
      output[name]={before,after,time};
    } finally {
      mat.fragmentShader=current;mat.needsUpdate=true;
      renderer.shadowMap.autoUpdate=shadow;
    }
  }
  return output;
}"""

POSES = {
    "bridge-pile": {"eye": [-65.86, .76, -44.97], "look": [-63.22, .02, -41.59], "fov": 43, "at": 272},
    "open-water": {"eye": [-64.8, 2.61, -53.0], "look": [-57.48, .13, -43.72], "fov": 53, "at": 314},
    "rain-at-waterline": {"eye": [-63.76, .88, -47.60], "look": [-59.19, .04, -43.87], "fov": 51, "at": 344},
    "rain-shallows": {"eye": [-65.77, .70, -47.83], "look": [-67.64, .048, -48.91], "fov": 53, "at": 389},
}


def expose_water(route):
    response = route.fetch()
    source = response.text()
    marker = "  const surfaceFoam=createFoamTransport(uniforms,piers,skiff,leafField);"
    assert source.count(marker) == 1
    route.fulfill(response=response, body=source.replace(
        marker, marker + "\n  window.rippleAuditHull=surfaceFoam.obstacles.hullGLSL;"))


def save_comparison(directory, name, pair):
    before, after = [Image.open(BytesIO(base64.b64decode(pair[side]))).convert("RGB")
                     for side in ("before", "after")]
    assert before.size == after.size == (3840, 2160)
    delta = np.abs(np.asarray(before, dtype=np.int16)-np.asarray(after, dtype=np.int16)).max(axis=2)
    comparison = Image.new("RGB", (1920, 540))
    for i, image in enumerate((before, after)):
        comparison.paste(image.resize((960, 540), Image.Resampling.LANCZOS), (i*960, 0))
    comparison.save(directory/f"{name}-comparison.jpg", quality=94)
    after.save(directory/f"{name}-4k.jpg", quality=94)
    return {"time": pair["time"], "changedAtLeast8": int(np.sum(delta>=8))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--reference", type=Path, required=True,
                        help="Viewer directory from before the ripple shader change.")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    prior = (args.reference/"bridge-water.js").read_text()
    errors, visuals = [], {}
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        for wet in (False, True):
            url = args.url + ("&rain" if wet else "")
            page = browser.new_page(viewport={"width":1920,"height":1080}, device_scale_factor=2)
            page.on("pageerror",lambda error: errors.append(str(error)))
            page.on("console",lambda msg: errors.append(msg.text) if msg.type=="error" else None)
            page.route(url,expose_paused_frame)
            page.route("**/bridge-water.js",expose_water)
            page.route("**/bridge-water-prior-ripples.js",lambda route: route.fulfill(
                body=prior+"\nexport {fragmentShader};",content_type="text/javascript"))
            page.goto(url,wait_until="networkidle",timeout=65000)
            page.evaluate(INSTALL)
            if not wet:
                energy=page.evaluate(ENERGY)
            poses={k:v for k,v in POSES.items() if k.startswith("rain")==wet}
            for k,v in page.evaluate(REPLAY,poses).items():
                visuals[k]=save_comparison(args.out,k,v)
            page.close()
        browser.close()
    report={"energy":energy,"render":visuals,"poses":POSES,"errors":errors}
    (args.out/"river-ripple-verification.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors, errors
    assert energy["east"]["eastFraction"] > energy["north"]["eastFraction"]+.18,energy
    assert energy["shelter"]["total"] < energy["east"]["total"]*.68,energy
    assert energy["distant"]["unresolved"] > .60*energy["distant"]["total"],energy
    for footprint in ("broad","distant"):
        assert abs(energy[footprint]["total"]/energy["east"]["total"]-1)<.07,energy
    assert min(v["changedAtLeast8"] for v in visuals.values())>5000,visuals


if __name__ == "__main__":
    main()
