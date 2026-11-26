"""Verify the interactive river with a real route, 4K views and frame timing."""
import argparse
import base64
import json
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--record", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as api:
    browser = api.chromium.launch(
        executable_path="/usr/bin/google-chrome", headless=True,
        args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"],
    )
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
    page.goto(args.url, wait_until="networkidle", timeout=60000)
    page.wait_for_function("window.__scene?.mission()?.water.refractionPasses > 1", timeout=20000)
    device = page.evaluate("""() => {
      const r=__scene.renderer, gl=r.getContext(), ext=gl.getExtension("WEBGL_debug_renderer_info");
      return { gpu:ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), resolution:[r.domElement.width,r.domElement.height] };
    }""")
    assert device["resolution"] == [3840,2160]
    print(device, flush=True)

    def state():
        return page.evaluate("__scene.mission()")

    def move(key, until):
        page.keyboard.down(key)
        try:
            page.wait_for_function(until, timeout=12000)
        finally:
            page.keyboard.up(key)

    def drag(dx, dy):
        page.mouse.move(980, 560)
        page.mouse.down()
        page.mouse.move(980 + dx, 560 + dy, steps=8)
        page.mouse.up()

    def shot(name):
        page.screenshot(path=args.out / f"{name}.jpg", quality=95, timeout=45000)

    def record_start(ms):
        if not args.record:
            return
        page.evaluate("""duration => {
          const original=__scene.renderer.domElement;
          const target=document.createElement("canvas");
          target.width=1920; target.height=1080;
          const ctx=target.getContext("2d",{alpha:false});
          const capture=new MediaRecorder(target.captureStream(30),{
            mimeType:"video/webm;codecs=vp8",videoBitsPerSecond:9800000
          });
          window.captureCanal=new Promise(resolve=>{
            const frames=[];
            capture.ondataavailable=e=>frames.push(e.data);
            capture.onstop=()=>{
              const reader=new FileReader();
              reader.onload=()=>resolve(reader.result.split(",")[1]);
              reader.readAsDataURL(new Blob(frames,{type:"video/webm"}));
            };
            let start;
            function sample(t){
              if(start===undefined) start=t;
              if(t-start>=duration){ capture.stop(); return; }
              ctx.drawImage(original,0,0,1920,1080);
              requestAnimationFrame(sample);
            }
            capture.start(); requestAnimationFrame(sample);
          });
        }""", ms)

    def record_end(filename):
        if args.record:
            data = page.evaluate("window.captureCanal")
            (args.out / filename).write_bytes(base64.b64decode(data))

    move("a", "__scene.mission().player.z < -44.42")
    move("w", "__scene.mission().player.x > -68.55")
    assert not state()["wading"]
    assert page.locator("#missionPebble").is_enabled()
    page.keyboard.press("v")
    drag(8, 101)
    page.wait_for_timeout(240)
    shot("01-shore-before")
    on_bank = state()

    record_start(4400)
    page.keyboard.press("f")
    page.wait_for_function("__scene.mission().stones.inFlight === 1")
    in_flight = state()
    page.wait_for_function("""(() => {
      const {water}=__scene.mission(), hit=water.contacts;
      return hit.totals.stone===1 && hit.crowns>0 && hit.spray>20 && water.time-hit.lastByKind.stone.time>.10;
    })()""")
    impact = state()
    shot("02-pebble-impact")
    page.wait_for_function("__scene.mission().stones.lastPosition[1] < -.44")
    submerged = state()
    page.wait_for_timeout(450)
    shot("03-immersed-stone")
    page.keyboard.press("f")
    page.wait_for_function("__scene.mission().water.contacts.totals.stone===2")
    record_end("pebble.webm")

    page.keyboard.press("v")
    drag(-8, -69)
    record_start(6800)
    move("w", "__scene.mission().waterDepth > .30")
    entered = state()
    assert entered["wading"] and entered["player"]["y"] < -.26
    page.keyboard.down("w")
    try:
        page.wait_for_function("__scene.mission().waterDepth>.48 && __scene.mission().water.contacts.spray>10")
        shot("04-wading")
        page.wait_for_timeout(360)
    finally:
        page.keyboard.up("w")
    deepest = state()
    assert .48 < deepest["waterDepth"] < .57 and deepest["walkable"]
    assert deepest["water"]["contacts"]["totals"]["step"] >= 3
    assert deepest["water"]["contacts"]["activeRipples"] > 0
    move("s", "!__scene.mission().wading && __scene.mission().player.x < -67.25")
    exited = state()
    shot("07-wet-on-bank")
    assert not exited["wading"] and exited["dampness"] > .65 and exited["wetLine"] > .39
    record_end("wading.webm")

    page.wait_for_function("""__scene.mission().water.foliage.wetLandings >= 2
                              && __scene.mission().water.foliage.pushed >= 1""", timeout=25000)
    leaves = state()["water"]["foliage"]
    assert leaves["releases"] >= leaves["wetLandings"]
    assert leaves["maximumImpulse"] > .052
    assert in_flight["stones"]["lastPosition"][1] > .1
    stone_hit = impact["water"]["contacts"]["lastByKind"]["stone"]
    assert stone_hit["strength"] > .50 and impact["water"]["time"] - stone_hit["time"] < .54
    assert submerged["stones"]["lastPosition"][1] < -.44
    assert on_bank["player"] == impact["player"]
    assert deepest["water"]["refractionPasses"] > on_bank["water"]["refractionPasses"]
    assert exited["water"]["contacts"]["peakSpray"] >= 35

    # Verify an actual pixel change after entry. The center crop excludes the HUD.
    a, b = [np.asarray(Image.open(args.out / filename).crop((1240,780,2760,1800)),dtype=np.int16)
            for filename in ("01-shore-before.jpg","02-pebble-impact.jpg")]
    changed = float((np.abs(a-b).mean(axis=-1) > 10).mean())
    assert changed > .01

    # Benchmark without recording or screenshot overhead.
    move("w", "__scene.mission().waterDepth > .29")
    page.wait_for_timeout(320)
    timing = page.evaluate("""() => new Promise(resolve => {
      let start, prev;
      const deltas=[];
      function sample(t){
        if(start===undefined) start=t;
        if(prev!==undefined) deltas.push(t-prev);
        prev=t;
        if(t-start<3500) requestAnimationFrame(sample);
        else {
          deltas.sort((a,b)=>a-b);
          resolve({count:deltas.length,p95_ms:deltas[Math.ceil(deltas.length*.95)-1],max_ms:deltas.at(-1)});
        }
      }
      requestAnimationFrame(sample);
    })""")
    # Render the same frozen scene with the transmission pass toggled. World state,
    # the camera, and reflection/foam uniforms stay identical between captures.
    page.evaluate("""() => {
      __scene.renderer.setAnimationLoop(null);
      const water=__scene.scene.getObjectByName("Canal surface");
      water.material.uniforms.refractionReady.value=1;
      __scene.renderer.render(__scene.scene,__scene.persp);
    }""")
    shot("05-refraction-on")
    page.evaluate("""() => {
      __scene.scene.getObjectByName("Canal surface").material.uniforms.refractionReady.value=0;
      __scene.renderer.render(__scene.scene,__scene.persp);
    }""")
    shot("06-refraction-off")
    boot_roi = page.evaluate("""() => {
      const {persp,renderer,mission}=__scene, p=mission().player;
      const foot=persp.position.clone().set(p.x,p.y+.123,p.z).project(persp);
      const x=Math.round((foot.x*.5+.5)*renderer.domElement.width);
      const y=Math.round((.5-foot.y*.5)*renderer.domElement.height);
      return [x-172,y-154,x+172,y+132];
    }""")
    on, off = [np.asarray(Image.open(args.out / filename).crop(tuple(boot_roi)),dtype=np.int16)
               for filename in ("05-refraction-on.jpg","06-refraction-off.jpg")]
    changed_by_refraction=float((np.abs(on-off).mean(axis=-1)>8).mean())
    assert changed_by_refraction>.12, (boot_roi,changed_by_refraction)

    # Compare the original scroll before a mission exists and after leaving it.
    scroll = browser.new_page(viewport={"width":1280,"height":720},device_scale_factor=1)
    scroll.on("pageerror",lambda error:errors.append(str(error)))
    parts=urlsplit(args.url)
    scroll.goto(urlunsplit(parts._replace(query="")),wait_until="networkidle",timeout=60000)
    scroll.wait_for_function("window.__scene?.renderer.info.render.calls>0")
    scroll.wait_for_timeout(600)
    before=scroll.locator("canvas").first.screenshot()
    scroll.locator("#bMission").click()
    scroll.wait_for_function("window.__scene?.mission()?.view==='mission'")
    scroll.locator("#missionExit").click()
    scroll.wait_for_function("window.__scene?.mission()?.view==='paint'")
    scroll.wait_for_timeout(280)
    after=scroll.locator("canvas").first.screenshot()
    before_pixels,after_pixels=(np.asarray(Image.open(BytesIO(raw))) for raw in (before,after))
    assert np.array_equal(before_pixels,after_pixels), "The source scroll changes after using the playable canal."
    scroll.close()

    assert not errors, errors
    result = {"device":device,"errors":errors,"sourceScrollPixelIdentical":True,"timing":timing,"leafTransport":leaves,
              "sameViewPixelChangeFraction":changed,"refractionPixelChangeFraction":changed_by_refraction,"poses":{"dry":on_bank,"inFlight":in_flight,
                 "impact":impact,"submerged":submerged,"wading":entered,"deepLimit":deepest,"leftWater":exited}}
    (args.out / "canal-verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"timing":timing,"leaves":leaves,"changed":changed,"refraction":changed_by_refraction,
                      "contacts":deepest["water"]["contacts"]},ensure_ascii=False),flush=True)
    browser.close()
