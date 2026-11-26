"""Check the canal, willow and tea close-up using real browser keyboard and pointer input."""
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


def image_motion(first, second, box):
    images = [np.asarray(Image.open(file).crop(box).convert("L"), dtype=np.int16) for file in (first, second)]
    diff = np.abs(images[0] - images[1])
    return {"mean_luminance_difference": round(float(diff.mean()), 3),
            "pixels_changed_by_at_least_8_pct": round(float((diff >= 8).mean() * 100), 2)}


with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda entry: errors.append(entry.text)
            if entry.type == "error" and "Failed to load resource" not in entry.text else None)
    page.on("response", lambda response: errors.append(f"{response.status} {response.url}")
            if response.status >= 400 and not response.url.endswith("/favicon.ico") else None)
    page.goto(args.url, wait_until="networkidle", timeout=60000)
    page.wait_for_function("__scene?.mission() && __scene.models.some(m => m.userData.label === 'bridge')")
    page.evaluate("document.fonts.ready")
    result = {"errors": errors}
    result["device"] = page.evaluate("""() => {
      const r=__scene.renderer, gl=r.getContext(), ext=gl.getExtension("WEBGL_debug_renderer_info");
      return {gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
        dimensions:[r.domElement.width,r.domElement.height]};
    }""")

    def inspect():
        return page.evaluate("__scene.mission()")

    def move(until):
        page.keyboard.down("w")
        try:
            page.wait_for_function(until, timeout=35000)
        finally:
            page.keyboard.up("w")

    def drag(dx, dy):
        page.mouse.move(950, 560)
        page.mouse.down()
        page.mouse.move(950 + dx, 560 + dy, steps=8)
        page.mouse.up()

    def screenshot(file):
        target = args.out / file
        page.screenshot(path=target, quality=95, timeout=45000)
        return target

    def recording(file, ms, action=None):
        if args.record:
            page.evaluate("""ms => {
              const buffer = document.createElement("canvas");
              buffer.width=1920; buffer.height=1080;
              const ctx=buffer.getContext("2d",{alpha:false});
              const original=__scene.renderer.domElement;
              const recorder=new MediaRecorder(buffer.captureStream(30), {
                mimeType:"video/webm;codecs=vp8",videoBitsPerSecond:10000000
              });
              window.effectsVideo = new Promise(resolve=>{
                const frames=[];
                recorder.ondataavailable=e=>frames.push(e.data);
                recorder.onstop=()=>{
                  const reader=new FileReader();
                  reader.onload=()=>resolve(reader.result.split(",")[1]);
                  reader.readAsDataURL(new Blob(frames,{type:"video/webm"}));
                };
                const started=performance.now();
                function sample(){
                  if(performance.now()-started>=ms){ recorder.stop(); return; }
                  ctx.drawImage(original,0,0,1920,1080);
                  requestAnimationFrame(sample);
                }
                recorder.start();
                requestAnimationFrame(sample);
              });
            }""", ms)
        if action:
            action()
        if args.record:
            data = page.evaluate("window.effectsVideo")
            (args.out / file).write_bytes(base64.b64decode(data))

    move("__scene.mission().player.x > -72.28")
    page.keyboard.press("e")
    assert inspect()["phase"] == "carrying"
    move("__scene.mission().player.x > -63.90")
    page.keyboard.press("v")
    drag(-333, 58)
    page.wait_for_timeout(500)
    water1 = screenshot("01-canal-4k.jpg")
    phase1 = inspect()
    page.wait_for_timeout(740)
    water2 = screenshot("02-canal-later-4k.jpg")
    phase2 = inspect()
    assert phase2["water"]["reflectionPasses"] > phase1["water"]["reflectionPasses"] > 0
    assert phase2["wind"]["time"] > phase1["wind"]["time"]
    assert phase2["wind"]["leafCounts"] == phase1["wind"]["leafCounts"]
    assert phase2["player"] == phase1["player"]
    result["fixed_camera"] = {"before": phase1, "after": phase2}
    recording("canal.webm", 4000)
    drag(333, -58)
    page.keyboard.press("v")
    move("__scene.mission().player.x > -44.10")
    page.keyboard.press("e")
    assert inspect()["phase"] == "delivered"
    assert inspect()["tea"]["fill"] == 0
    page.locator("#missionTea").click()
    page.wait_for_function("__scene.mission().tea.age > 1.58 && __scene.mission().tea.stream")
    first_pour = inspect()["tea"]
    tea1 = screenshot("03-tea-in-flight-4k.jpg")
    page.wait_for_function("__scene.mission().tea.age > 2.71 && __scene.mission().tea.stream")
    late_pour = inspect()["tea"]
    tea2 = screenshot("04-tea-impact-4k.jpg")
    page.wait_for_function("__scene.mission().tea.fill === 1 && !__scene.mission().tea.closeUp")
    finished = inspect()["tea"]
    assert first_pour["fill"] < late_pour["fill"] < finished["fill"]
    assert late_pour["peakDroplets"] > 0
    assert not finished["stream"] and finished["droplets"] == 0 and finished["steam"] > 0
    result["tea"] = {"early": first_pour, "late": late_pour, "after": finished}
    recording("tea.webm", 5650, lambda: page.locator("#missionTea").click())
    if not args.record:
        page.wait_for_function("__scene.mission().tea.closeUp")
    else:
        page.locator("#missionTea").click()
    page.keyboard.down("d")
    page.wait_for_function("!__scene.mission().tea.closeUp")
    page.keyboard.up("d")
    page.locator("#missionUndo").click()
    page.wait_for_function("__scene.mission().phase === 'waiting'")
    assert inspect()["tea"]["fill"] == 0 and not inspect()["tea"]["stream"] and not inspect()["tea"]["steam"]
    result["checks"] = {"repeat": True, "movement_dismisses": True, "undo_clears_fluid": True}
    # Crop regions use native output pixels and exclude the HUD and paper seal.
    result["motion"] = {
        "water": image_motion(water1, water2, (2150, 1560, 3250, 2050)),
        "willow": image_motion(water1, water2, (790, 105, 1690, 515)),
        "tea": image_motion(tea1, tea2, (1120, 690, 2430, 1650)),
    }
    assert result["motion"]["water"]["pixels_changed_by_at_least_8_pct"] > 2
    assert result["motion"]["willow"]["pixels_changed_by_at_least_8_pct"] > 2
    assert result["motion"]["tea"]["pixels_changed_by_at_least_8_pct"] > 1
    (args.out / "effects-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    assert not errors, errors
    print(json.dumps({"device": result["device"], "motion": result["motion"], "tea": result["tea"]},
                     ensure_ascii=False, indent=2))
    browser.close()
