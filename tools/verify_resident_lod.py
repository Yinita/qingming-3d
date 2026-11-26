"""Check that distant resident batching preserves the near street and canal reflection."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_canal_reflection import expose_frame


CAPTURE = """async shot=>{
  const {scene,renderer,persp,walk,setMode}=__scene;
  const water=scene.getObjectByName('Canal surface').material.uniforms;
  const lods=scene.getObjectsByProperty('name','Street resident detail by projected size');
  const update=persp.updateMatrixWorld;
  const render=renderer.render;
  const hooks=[];
  let draw=null,pass=null;
  const [position,look,fov]=shot.camera;
  if(shot.walk) {
    setMode('walk');
    walk.pos.set(...position);
    const aim=persp.position.clone().set(...look).sub(walk.pos).normalize();
    walk.yaw=Math.atan2(-aim.x,-aim.z);
    walk.pitch=Math.asin(aim.y);
  } else {
    persp.updateMatrixWorld=force=>{
      persp.position.set(...position);
      persp.lookAt(...look);
      update.call(persp,force);
    };
  }
  persp.fov=fov;
  persp.updateProjectionMatrix();
  for(const id of ['hud','missionHud','missionWaypoint','seal']) {
    const label=document.getElementById(id);
    if(label)label.hidden=true;
  }
  for(const lod of lods) for(const {object:group} of lod.levels) for(const mesh of group.children) {
    const before=mesh.onBeforeRender;
    hooks.push([mesh,before]);
    mesh.onBeforeRender=function(...args) {
      before.apply(this,args);
      if(!draw || !pass)return;
      const tag=mesh.name;
      const bucket=(draw[pass][tag]??={calls:0,triangles:0,instances:0});
      bucket.calls++;
      bucket.triangles+=mesh.geometry.index.count*mesh.count/3;
      bucket.instances+=mesh.count;
    };
  }
  renderer.render=function(...args) {
    const target=renderer.getRenderTarget();
    pass=!target ? 'main' : target.texture.name==='Canal reflection' ? 'mirror' : null;
    if(pass && draw)draw[pass]={};
    try { return render.apply(this,args); }
    finally { pass=null; }
  };

  function snapshot(forceNear, fullMirror=false) {
    window.fullMirrorAudit=fullMirror;
    for(const lod of lods) {
      lod.autoUpdate=!forceNear;
      if(forceNear) {
        lod.levels[0].object.visible=true;
        lod.levels[1].object.visible=false;
      }
    }
    if(!shot.walk) {
      // Rebuild the full-detail target at the same water time and position.
      water.reflectionDetail.value=0;
      mirrorFrame(performance.now());
      water.reflectionDetail.value=1;
    }
    draw={};
    mirrorFrame(performance.now());
    const state=__scene.mission().water;
    const result={draw,time:state.time, viewport:state.reflectionViewport,mirrorSize:state.reflectionSize,
      image:renderer.domElement.toDataURL('image/png').split(',')[1]};
    draw=null;
    return result;
  }
  try {
    const result={optimized:snapshot(false),full:snapshot(true),clusters:lods.length};
    if(!shot.walk)result.uncropped=snapshot(false,true);
    return result;
  } finally {
    renderer.render=render;
    persp.updateMatrixWorld=update;
    delete window.fullMirrorAudit;
    for(const lod of lods)lod.autoUpdate=true;
    for(const [mesh,before] of hooks)mesh.onBeforeRender=before;
  }
}"""


def comparison(image_a, image_b, crop=None):
    if crop:
        image_a, image_b = image_a.crop(crop), image_b.crop(crop)
    difference = np.abs(np.asarray(image_a, dtype=np.int16) - np.asarray(image_b, dtype=np.int16))
    return {
        "meanPerChannel": float(difference.mean()),
        "strongPixelFraction": float((difference.max(2) > 18).mean()),
        "pixelCount": image_a.width * image_a.height,
    }


def total(draw, field):
    return sum(group[field] for group in draw.values())


def expose_full_mirror(route):
    response = route.fetch()
    source = response.text()
    marker = "if(windowed) {"
    assert source.count(marker) == 1
    route.fulfill(response=response, body=source.replace(marker,
        "if(windowed && !window.fullMirrorAudit) {"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    shots = {
        "canal": {"camera": [[-68.05, 2.45, -48.90], [-62.40, 1.06, -45.30], 54]},
        "street": {"camera": [[25.55, 1.60, -20.78], [25.39, 1.02, -24.75], 54], "walk": True},
    }
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.route(args.url, expose_frame)
        page.route("**/bridge-water.js", expose_full_mirror)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("""window.__scene?.mission()?.water?.time>2.0 &&
            __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""", timeout=65000)
        page.evaluate("""()=>{
          __scene.renderer.setAnimationLoop(null);
          mirrorClock.getDelta=()=>0;
        }""")
        report = {}
        for name, shot in shots.items():
            frames = page.evaluate(CAPTURE, shot)
            images = [
                Image.open(BytesIO(base64.b64decode(frames[tier].pop("image")))).convert("RGB")
                for tier in ("optimized", "full")
            ]
            assert frames["optimized"]["time"] == frames["full"]["time"], frames
            images[0].save(args.out / f"{name}-4k.jpg", quality=95)
            thumbnail = Image.new("RGB", (2400, 675))
            for index, image in enumerate(images):
                thumbnail.paste(image.resize((1200, 675), Image.Resampling.LANCZOS), (1200 * index, 0))
            thumbnail.save(args.out / f"{name}-same-frame.jpg", quality=96)
            report[name] = {
                **frames,
                "difference": comparison(*images),
                "foreground": comparison(*images, crop=(900, 580, 2940, 2100)),
            }
            if "uncropped" in frames:
                assert frames["uncropped"]["time"] == frames["optimized"]["time"], frames
                uncropped=Image.open(BytesIO(base64.b64decode(frames["uncropped"].pop("image")))).convert("RGB")
                report[name]["mirrorCropDifference"]=comparison(images[0],uncropped)
        report["errors"] = errors
        (args.out / "lod-verification.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2), flush=True)
        assert not errors, errors
        canal = report["canal"]
        assert canal["clusters"] > 50
        optimized, full = [canal[tier]["draw"]["mirror"] for tier in ("optimized", "full")]
        assert total(optimized, "calls") < total(full, "calls") * .45
        assert total(optimized, "triangles") < total(full, "triangles") * .50
        assert canal["difference"]["strongPixelFraction"] < .005
        assert canal["optimized"]["viewport"][3] < canal["uncropped"]["viewport"][3]
        assert canal["mirrorCropDifference"]["strongPixelFraction"] < .003
        assert report["street"]["foreground"]["strongPixelFraction"] < .012
        browser.close()


if __name__ == "__main__":
    main()
