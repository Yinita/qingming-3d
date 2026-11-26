"""Capture fixed-route WebGL frame intervals and one frame at each stop."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
p.add_argument("--out", type=Path, required=True)
p.add_argument("--chrome", default="/usr/bin/google-chrome")
p.add_argument("--pixel-ratio", type=float, default=2)
p.add_argument("--window-ms", type=int, default=3500)
p.add_argument("--software", action="store_true")
p.add_argument("--backend", choices=["gl", "vulkan"], default="gl")
args = p.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
flags = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] if args.software else (
    ["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"] if args.backend == "gl" else
    ["--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan"])

with sync_playwright() as api:
    browser = api.chromium.launch(executable_path=args.chrome, headless=True, args=flags)
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=args.pixel_ratio)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda e: errors.append(e.text) if e.type == "error" and "Shader" in e.text else None)
    page.goto(args.url, wait_until="networkidle",timeout=60000)
    page.wait_for_function("""__scene?.mission() && __scene.models.some(m=>m.userData.label==='bridge')
      && __scene.renderer.info.render.calls>0""", timeout=60000)
    gpu = page.evaluate("""() => {
      const r=__scene.renderer, c=r.getContext(), d=c.getExtension("WEBGL_debug_renderer_info");
      return {renderer:d&&c.getParameter(d.UNMASKED_RENDERER_WEBGL), resolution:[r.domElement.width,r.domElement.height],
        shadow:r.shadowMap.enabled};
    }""")
    result = {"device": gpu, "headless": True, "stops": [], "errors": errors}
    print(gpu, flush=True)

    def move(until):
        page.keyboard.down("w")
        try:
            page.wait_for_function(until, timeout=55000)
        finally:
            page.keyboard.up("w")

    def capture(label, moving=False):
        if not moving:
            page.wait_for_timeout(900)
        data = page.evaluate("""windowMs => new Promise(resolve => {
          const samples=[]; let start=null,prev=null;
          function next(t) {
            if(start===null) start=t;
            if (prev!==null) samples.push(t-prev);
            prev=t;
            if(t-start<windowMs) requestAnimationFrame(next);
            else {
              const ordered=samples.slice().sort((a,b)=>a-b);
              const pct=p=>ordered[Math.ceil(ordered.length*p)-1];
              const mean=samples.reduce((a,b)=>a+b,0)/samples.length;
              const {render,memory}=__scene.renderer.info;
              const leafCounts=[];
              __scene.scene.traverse(o=>{if(o.name==="Willow canopy leaf instances") leafCounts.push(o.count);});
              resolve({frames:samples.length,mean_ms:mean,p50_ms:pct(.5),p95_ms:pct(.95),
                maximum_ms:ordered.at(-1),draw_calls:render.calls,triangles:render.triangles,textures:memory.textures,
                willow_leaves:leafCounts,pose:__scene.mission()});
            }
          }
          requestAnimationFrame(next);
        })""", args.window_ms)
        data["stop"] = label
        print(label, {k:data[k] for k in ("frames","p95_ms","draw_calls","triangles")}, flush=True)
        result["stops"].append(data)
        if not moving:
            page.screenshot(path=args.out / f"{label}.jpg", quality=93, timeout=45000)

    capture("01-bridgehead")
    move("__scene.mission().player.x > -72.30")
    page.keyboard.press("e")
    assert page.evaluate("__scene.mission().phase") == "carrying"
    move("__scene.mission().player.y > 2.06")
    capture("02-crossing")
    page.keyboard.down("w")
    try:
        capture("walking-across-bridge", moving=True)
    finally:
        page.keyboard.up("w")
    move("__scene.mission().player.x > -44.10")
    page.keyboard.press("e")
    assert page.evaluate("__scene.mission().phase") == "delivered"
    page.mouse.move(1050, 630)
    page.mouse.down()
    page.mouse.move(908, 627, steps=7)
    page.mouse.up()
    capture("03-counter")
    page.locator("#missionTea").click()
    page.wait_for_function("__scene.mission().tea.closeUp")
    capture("04-tea-closeup", moving=True)
    (args.out / "profile.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    assert not errors, errors
    browser.close()
