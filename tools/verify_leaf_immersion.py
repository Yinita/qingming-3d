"""Replay the bank crest, then isolate its leaf in the native refraction capture."""

import argparse
import base64
import json
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from verify_rain_wave_packets import expose_paused_frame


def expose(route, marker, hook, switches=()):
    response = route.fetch()
    source = response.text()
    assert source.count(marker) == 1
    for before, after in switches:
        assert source.count(before) == 1
        source = source.replace(before, after)
    route.fulfill(response=response, body=source.replace(marker, hook + marker))


def expose_water(route):
    expose(route, "  return {\n    prepare,\n    caustics:", """
  window.immersionWater={refraction,refractedCamera,leafField,leaves,uniforms};
""", [
        ("    const oldTarget=renderer.getRenderTarget();",
         "    if(window.forceLeafCapture) {refract=true;reflect=false;}\n    const oldTarget=renderer.getRenderTarget();"),
        ("transmitLeaves?.(!!crossingInView);",
         "transmitLeaves?.(!!crossingInView && !window.hideLeafTransmission);"),
    ])


REPLAY = """async(record)=>{
  const THREE=await import('three');
  const {flexBlade}=await import('./bridge-leaf-light.js');
  const {canal,skiff,bed}=immersionCanal;
  const {data,immersion}=immersionLeaves;
  const {refraction,refractedCamera,leafField,leaves}=immersionWater;
  const {renderer,scene,persp}=__scene;
  leafClock.getDelta=()=>1/60;
  leafFrame(1000/60);
  const dt=1/60;
  const trace=[], stills={}, frames=[];
  const view=new THREE.Vector3(), matrix=new THREE.Matrix4(), raw=new THREE.Vector3();
  const bent=new THREE.Vector3();
  const width=renderer.domElement.width,height=renderer.domElement.height;
  const gl=renderer.getContext();
  const mask=leaves.mesh.geometry.getAttribute('bladeImmersion');
  const blade=leaves.mesh.geometry.getAttribute('position');
  const shot=()=>renderer.domElement.toDataURL('image/jpeg',.96).split(',')[1];
  const clip=document.createElement('canvas');
  clip.width=1080; clip.height=720;
  const clipInk=record ? clip.getContext('2d',{alpha:false}) : null;
  const target=new THREE.Vector3(-67.395,.076,-52.001);
  persp.position.set(-66.92,.669,-51.314);
  persp.lookAt(target);
  persp.fov=43;
  persp.updateProjectionMatrix();
  function draw(){
    canal.prepare(renderer,scene,persp);
    renderer.render(scene,persp);
  }
  function imagePatch(camera,w,h,windowSize,leaf) {
    const pos=view.copy(leaf.position).project(camera);
    return [Math.round((pos.x*.5+.5)*w-windowSize*.5),
      Math.round((pos.y*.5+.5)*h-windowSize*.5),windowSize,windowSize];
  }
  function changed(a,b) {
    let pixels=0, peak=0;
    for(let i=0;i<a.length;i+=4) {
      const delta=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
      pixels+=Number(delta>3);
      peak=Math.max(peak,delta);
    }
    return {pixels,peak};
  }
  const leaf=data[0];
  let optics;
  for(let tick=2;tick<=450;tick++) {
    const time=tick*dt;
    skiff.update(time,dt,canal.field);
    bed.frame(time);
    canal.frame(time,dt);
    const {position:p,dive}=leaf;
    const waterY=leafField.height(p.x,p.z,time);
    const visible=mask.getX(leaf.index);
    if(time>=2.97 && time<=3.75) trace.push({time,position:p.toArray(),waterY,
      depth:waterY-p.y,roll:dive.roll,speed:dive.speed,active:dive.active,
      mask:visible,orientation:leaf.orientation.toArray(),mode:leaf.mode});
    if(tick===183) {draw();stills.approach=shot();}
    if(tick===195) {
      draw();
      const captureAge=time-canal.inspect().lastRefractionTime;
      leaves.mesh.getMatrixAt(leaf.index,matrix);
      let wetVertices=0, smallestDepth=Infinity;
      for(let i=0;i<blade.count;i++) {
        raw.fromBufferAttribute(blade,i);
        flexBlade(raw,.47,leaf.flex,bent).applyMatrix4(matrix);
        const gap=leafField.height(bent.x,bent.z,time)-bent.y;
        wetVertices+=Number(gap>.002);
        smallestDepth=Math.min(smallestDepth,gap);
      }
      const targetCrop=imagePatch(refractedCamera, refraction.width, refraction.height,64,leaf);
      const screenCrop=imagePatch(persp,width,height,270,leaf);
      function raster(){
        const capture=new Uint8Array(targetCrop[2]**2*4);
        const screen=new Uint8Array(screenCrop[2]**2*4);
        renderer.readRenderTargetPixels(refraction,...targetCrop,capture);
        gl.readPixels(...screenCrop,gl.RGBA,gl.UNSIGNED_BYTE,screen);
        return {capture,screen};
      }
      const normal=raster();
      stills.immersed=shot();
      window.forceLeafCapture=window.hideLeafTransmission=true;
      draw();
      const omitted=raster();
      stills.omitted=shot();
      window.hideLeafTransmission=false;
      draw();
      const restored=raster();
      window.forceLeafCapture=false;
      optics={capture:changed(normal.capture,omitted.capture),screen:changed(normal.screen,omitted.screen),
        restoredCapture:changed(normal.capture,restored.capture),restoredScreen:changed(normal.screen,restored.screen),
        captureAge,normalMask:visible,wetVertices,vertexCount:blade.count,smallestDepth,raster:[width,height],
        crop:[screenCrop[0],height-screenCrop[1]-screenCrop[3],screenCrop[2]]};
    }
    if(tick===213) {draw();stills.resurfacing=shot();}
    if(tick===226) {draw();stills.afloat=shot();}
    if(clipInk && tick>=178 && tick<=230 && tick%2===0) {
      draw();
      clipInk.drawImage(renderer.domElement,width*.5-840,height*.5-500,1680,1120,0,0,1080,720);
      frames.push(clip.toDataURL('image/jpeg',.92).split(',')[1]);
    }
  }
  const stats=canal.inspect();
  return {trace,stills,frames,optics,immersion,
    breakerPasses:stats.breakers.passes,waves:stats.leafWater,glError:gl.getError()};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell=storm")
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
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.route(lambda url: url == args.url, expose_paused_frame)
        page.route("**/bridge-look.js*", lambda route: expose(route, "  return {\n    setVisible(visible)",
            "  window.immersionCanal={canal,skiff,bed};\n"))
        page.route("**/bridge-canal-leaves.js", lambda route: expose(route, "  return { mesh:leaves, frame,",
            "  window.immersionLeaves={data,immersion};\n"))
        page.route("**/bridge-water.js", expose_water)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("!!window.__scene && typeof window.leafFrame==='function'", timeout=35000)
        result = page.evaluate(REPLAY, args.record)
        browser.close()

    for label, encoded in result.pop("stills").items():
        (args.out / f"{label}-4k.jpg").write_bytes(base64.b64decode(encoded))
    frames = result.pop("frames")
    report = {**result, "errors": errors}
    (args.out / "leaf-immersion.json").write_text(json.dumps(report, indent=2) + "\n")
    stats, optics, trace = result["immersion"], result["optics"], result["trace"]
    print(json.dumps({"entries": stats["entries"], "returns": stats["returns"], "peakDepth": stats["peakDepth"],
        "peakRoll": stats["peakRoll"], "optics": optics, "errors": errors}), flush=True)
    assert not errors and result["glError"] == 0, errors or result["glError"]
    assert stats["entries"] >= 2 and stats["returns"] >= 2 and stats["peakDepth"] > .075, stats
    assert max(abs(row["roll"]) for row in trace) > .65 and trace[-1]["mode"] == "water", trace
    for a,b in zip(trace,trace[1:]):
        assert abs(a["position"][1]-b["position"][1]) < .043, (a,b)
    assert trace[0]["depth"] < 0 and trace[-1]["depth"] < 0, trace
    assert optics["normalMask"] == 1 and optics["wetVertices"] == optics["vertexCount"], optics
    assert abs(optics["captureAge"]) < .0001, optics
    assert optics["capture"]["pixels"] > 10 and optics["screen"]["pixels"] > 10, optics
    assert optics["restoredCapture"]["pixels"] == 0 and optics["restoredScreen"]["pixels"] == 0, optics
    assert optics["raster"] == [3840,2160], optics
    assert result["waves"]["totals"]["resurface"] >= 2, result["waves"]

    comparison = Image.new("RGB", (1260,630))
    x,y,n = optics["crop"]
    for i,label in enumerate(("omitted","immersed")):
        image = Image.open(args.out / f"{label}-4k.jpg").crop((x,y,x+n,y+n))
        comparison.paste(image.resize((630,630),Image.Resampling.LANCZOS),(i*630,0))
    comparison.save(args.out / "transmission-compare.jpg",quality=95)
    if frames:
        with tempfile.TemporaryDirectory(prefix="qingming-leaf-crossing-") as folder:
            for index, encoded in enumerate(frames):
                (Path(folder) / f"{index:03}.jpg").write_bytes(base64.b64decode(encoded))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "8",
                "-i", str(Path(folder) / "%03d.jpg"), "-vf", "fps=24", "-c:v", "libx264",
                "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart",
                str(args.out / "crest-leaf-slow.mp4")], check=True)


if __name__ == "__main__":
    main()
