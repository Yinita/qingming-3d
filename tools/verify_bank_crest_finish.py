"""Compare welded crest tessellation and reflected contrast in a paired 4K replay."""

import argparse
import base64
import json
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_immersion import expose, expose_water
from verify_rain_wave_packets import expose_paused_frame


REPLAY = """async({meshAudit,record})=>{
  const {canal,skiff,bed}=immersionCanal;
  const {uniforms}=immersionWater;
  const {renderer,scene,persp}=__scene;
  const river=scene.getObjectByName('Canal surface');
  const dt=1/60;
  leafClock.getDelta=()=>dt;
  leafFrame(1000/60);
  persp.position.set(-66.92,.669,-51.314);
  persp.lookAt(-67.395,.076,-52.001);
  persp.fov=43;
  persp.updateProjectionMatrix();

  const gl=renderer.getContext();
  const width=renderer.domElement.width,height=renderer.domElement.height;
  const roi=[1212,1080,756,576];
  function raster() {
    const pixels=new Uint8Array(roi[2]*roi[3]*4);
    gl.readPixels(roi[0],height-roi[1]-roi[3],roi[2],roi[3],gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    return pixels;
  }
  function encode(pixels) {
    let output='';
    for(let start=0;start<pixels.length;start+=16384)
      output+=String.fromCharCode(...pixels.subarray(start,start+16384));
    return btoa(output);
  }
  function hash(data) {
    const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    let value=2166136261;
    for(const byte of bytes) value=Math.imul(value^byte,16777619);
    return value>>>0;
  }
  const canvas=document.createElement('canvas');
  canvas.width=768;canvas.height=512;
  const context=record ? canvas.getContext('2d',{alpha:false}) : null;
  const frames=[];
  let comparison;
  for(let tick=2;tick<=230;tick++) {
    const time=tick*dt;
    skiff.update(time,dt,canal.field);
    bed.frame(time);
    canal.frame(time,dt);
    const recording=context && tick>=176 && tick%2===0;
    if(tick!==195 && !recording) continue;
    canal.prepare(renderer,scene,persp);
    renderer.render(scene,persp);
    if(recording) {
      context.drawImage(renderer.domElement,1056,546,1728,1152,0,0,768,512);
      frames.push(canvas.toDataURL('image/jpeg',.91).split(',')[1]);
    }
    if(tick!==195) continue;
    const photo=renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    const reference=raster();
    const shadowUpdate=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    const mirror=uniforms.reflectionReady;
    const ready=mirror.value;
    mirror.value=0;
    renderer.render(scene,persp);
    const noMirror=raster();
    mirror.value=ready;

    // These samples measure a frozen scene draw with its existing captures.
    // Readback flushes the GPU so the samples include completed raster work.
    const cost=[];
    const pixel=new Uint8Array(4);
    for(let i=0;i<30;i++) {
      const start=performance.now();
      renderer.render(scene,persp);
      gl.readPixels(width>>1,height>>1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      if(i>=8) cost.push(performance.now()-start);
    }
    renderer.shadowMap.autoUpdate=shadowUpdate;
    const meshes=await eval(meshAudit)([-68.0,-65.7,-52.24,-51.42]);
    const keys=['waterState','breakingRows','bankWash'];
    comparison={photo,reference:encode(reference),noMirror:encode(noMirror),roi,meshes,cost,
      triangles:river.geometry.index.count/3,
      state:keys.map(key=>hash(uniforms[key].value.image.data)),
      leaf:immersionLeaves.data[0].position.toArray(),
      device:[width,height],gpu:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
      glError:gl.getError()};
  }
  return {comparison,frames};
}"""


def capture(browser, base, mesh_audit, record):
    url = base.rstrip("/") + "/?mission&gust&swell=storm"
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda log: errors.append(log.text) if log.type == "error" else None)
    page.route(lambda incoming: incoming == url, expose_paused_frame)
    page.route("**/bridge-look.js*", lambda route: expose(route, "  return {\n    setVisible(visible)",
        "  window.immersionCanal={canal,skiff,bed};\n"))
    page.route("**/bridge-canal-leaves.js", lambda route: expose(route, "  return { mesh:leaves, frame,",
        "  window.immersionLeaves={data};\n"))
    page.route("**/bridge-water.js", expose_water)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("!!window.__scene && typeof window.leafFrame==='function'", timeout=35000)
        result = page.evaluate(REPLAY, {"meshAudit": mesh_audit, "record": record})
        assert not errors, errors
        comparison = result["comparison"]
        assert comparison["glError"] == 0
        width, height = comparison["roi"][2:]
        def patch(key):
            return np.frombuffer(base64.b64decode(comparison.pop(key)), np.uint8).reshape(height,width,4)[:,:,:3].astype(float)
        mirror = (patch("reference") - patch("noMirror")) @ np.array([.2126,.7152,.0722])
        edges = np.hypot(mirror[3:,3:] - mirror[:-3,3:],mirror[3:,3:] - mirror[3:,:-3])
        comparison["reflectionEdges"] = {"p99": float(np.percentile(edges,99)), "above6": int(np.count_nonzero(edges>6))}
        comparison["renderReadbackMs"] = {f"p{p}":float(np.percentile(comparison["cost"],p)) for p in (50,95)}
        return comparison, result["frames"]
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/")
    parser.add_argument("--before", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--record", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(exist_ok=True, parents=True)
    audit = Path(__file__).with_name("swell_surface_audit.js").read_text()
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        before,before_frames=capture(browser,args.before,audit,args.record)
        after,after_frames=capture(browser,args.url,audit,args.record)
        browser.close()

    pair=Image.new("RGB",(1536,512))
    for i,(label,case) in enumerate((("before",before),("after",after))):
        path=args.out / f"{label}-4k.jpg"
        path.write_bytes(base64.b64decode(case.pop("photo")))
        crop=Image.open(path).crop((1056,546,2784,1698)).resize((768,512),Image.Resampling.LANCZOS)
        pair.paste(crop,(i*768,0))
    pair.save(args.out / "matched-crest.jpg",quality=94)
    (args.out / "crest-finish.json").write_text(json.dumps({"before":before,"after":after},indent=2)+"\n")
    print(json.dumps({label:{key:case[key] for key in ("triangles","reflectionEdges","renderReadbackMs","meshes")}
        for label,case in (("before",before),("after",after))}),flush=True)
    assert before["state"]==after["state"] and before["leaf"]==after["leaf"]
    assert before["device"]==after["device"]==[3840,2160]
    for case in (before,after):
        mesh=case["meshes"]
        assert mesh["invalidEdges"]==0 and mesh["exteriorEdges"]==mesh["expectedExterior"]
        assert mesh["joinGap"]<.0001 and mesh["reversalWidth"]>.055
    assert after["meshes"]["interpolation"]["p95"]<before["meshes"]["interpolation"]["p95"]*.65
    assert after["reflectionEdges"]["p99"]<before["reflectionEdges"]["p99"]*.65
    if args.record:
        assert len(before_frames)==len(after_frames)>20
        with tempfile.TemporaryDirectory(prefix="qingming-crest-finish-") as folder:
            for index,frames in enumerate(zip(before_frames,after_frames)):
                for side,frame in enumerate(frames):
                    pair.paste(Image.open(BytesIO(base64.b64decode(frame))),(side*768,0))
                pair.save(Path(folder)/f"{index:03d}.jpg",quality=93)
            subprocess.run(["ffmpeg","-loglevel","error","-y","-framerate","8","-i",str(Path(folder)/"%03d.jpg"),
                "-vf","fps=24","-c:v","libx264","-pix_fmt","yuv420p","-crf","16","-movflags","+faststart",
                str(args.out/"crest-finish-ab.mp4")],check=True)


if __name__=="__main__":
    main()
