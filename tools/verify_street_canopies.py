"""Check the street tree assets, wind and shade in the browser, and walk around a trunk."""

import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8271/viewer/")
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path="/usr/bin/google-chrome", headless=True,
        args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(e.stack))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(args.url, wait_until="domcontentloaded", timeout=85000)
    page.wait_for_function("window.__scene?.foliage && !document.body.classList.contains('scene-loading')",
                           timeout=85000)

    page.evaluate("""()=>{
      __scene.setMode('walk');
      for(const id of ['hud','questEntry','seal','scene-background']) {
        const node=document.getElementById(id);
        if(node) node.style.visibility='hidden';
      }
      window.treeView=([x,y,z,tx,ty,tz])=>{
        const {walk,persp}=__scene;
        walk.pos.set(x,y,z);
        walk.yaw=Math.atan2(x-tx,z-tz);
        walk.pitch=Math.atan2(ty-y,Math.hypot(x-tx,z-tz));
        persp.fov=55;
        persp.updateProjectionMatrix();
      };
      window.frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }""")
    page.wait_for_function("__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length",
                           timeout=85000)
    data = page.evaluate("__scene.foliage()")
    assert data["treeCount"] >= 45 and data["leaves"] > 100000 and data["branches"] > 10000, data
    assert data["barkVertices"] > 60000 and data["litter"] == data["treeCount"] * 30, data
    assert len({tree["form"] for tree in data["trees"]}) == 3
    assert data["farLeaves"] < .34 * data["leaves"], data

    support = page.evaluate("""() => {
      const {foliage,streetHeight,walkClear}=__scene;
      const tree=foliage().trees.find(t=>t.id==='o0445');
      const reached=[];
      for(let a=0;a<Math.PI*2;a+=.06) for(let r=tree.radius+.29;r<=1.04;r+=.018) {
        const x=tree.x+r*Math.cos(a),z=tree.z+r*Math.sin(a);
        const top=streetHeight.rootHeight(x,z);
        if(!Number.isFinite(top) || top-tree.y<.022 || !walkClear(x,z,streetHeight(x,z))) continue;
        reached.push({top,support:streetHeight(x,z)});
      }
      return {samples:reached.length,maxError:Math.max(0,...reached.map(r=>r.top-r.support))};
    }""")
    assert support["samples"] > 10 and support["maxError"] < .001, support

    def image():
        return Image.open(io.BytesIO(page.screenshot(type="png"))).convert("RGB")

    def change(first, second, crop):
        a, b = first.crop(crop), second.crop(crop)
        diff = ImageChops.difference(a, b).convert("L").histogram()
        return sum(diff[14:]) / (a.width * a.height)

    page.evaluate("treeView", [25.1, 4.46, -24.64, 28.41, 7.62, -29.79])
    page.evaluate("frames()")
    near_count = page.evaluate("__scene.foliage().nearChunks")
    first = image()
    wind_at = page.evaluate("__scene.foliage().windTime")
    page.wait_for_function("t=>__scene.foliage().windTime>t+1.25", arg=wind_at)
    second = image()
    wind = change(first, second, (120, 0, 1320, 560))
    assert wind > .007, (wind, data)
    first.save(args.out / "canopy-wind-a.png")
    second.save(args.out / "canopy-wind-b.png")

    page.evaluate("treeView", [29.79, 1.42, -27.58, 28.409, .95, -29.794])
    page.evaluate("frames()")
    shaded = image()
    page.evaluate("""()=>{
      const root=__scene.scene.getObjectByName('Volumetric perspective streets');
      window.shadowMeshes=root.children.filter(m=>m.isMesh && m.castShadow &&
        /Street (crown|trunks)|Curved street trunks|Simplified street crown/.test(m.name));
      for(const mesh of shadowMeshes) mesh.castShadow=false;
      __scene.renderer.shadowMap.needsUpdate=true;
    }""")
    page.evaluate("frames()")
    unshaded = image()
    shade = change(shaded, unshaded, (0, 435, 1440, 900))
    assert shade>.016 and page.evaluate("shadowMeshes.length")>15, shade
    page.evaluate("""()=>{
      for(const mesh of shadowMeshes) mesh.castShadow=true;
      __scene.renderer.shadowMap.needsUpdate=true;
    }""")
    shaded.save(args.out / "shade.png")
    unshaded.save(args.out / "shade-base-pass.png")

    route = page.evaluate("""()=>{
      const {walk,walkClear,streetHeight,foliage}=__scene;
      const p=foliage().trees.find(t=>t.id==='o0445');
      for(const turn of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
        const ux=Math.sin(turn),uz=Math.cos(turn),sx=uz,sz=-ux;
        const point=(depth,side=0)=>[p.x+ux*depth+sx*side,p.z+uz*depth+sz*side];
        const check=(depth,lateral=0)=>{
          const [x,z]=point(depth,lateral);
          return walkClear(x,z,streetHeight(x,z));
        };
        const gap=p.radius+.31;
        if(![gap+.08,gap+.30,1.30,2.05].every(d=>check(d))) continue;
        const side=[1,-1].find(sign=>[gap+.04,.40,-.24,-.75].every(d=>check(d,sign*1.06)));
        if(!side || check(0)) continue;
        const [x,z]=point(2.05);
        walk.pos.set(x,1.54+streetHeight(x,z),z);
        walk.yaw=turn;walk.pitch=-.045;
        return {...p,gap,ux,uz,sx,sz,side};
      }
      return null;
    }""")
    assert route, "No open route to the market tree trunk"

    def hold(key, condition, timeout=11000):
        page.keyboard.down(key)
        try:
            page.wait_for_function(condition, arg=route, timeout=timeout)
        finally:
            page.keyboard.up(key)

    hold("w", "r=>Math.hypot(__scene.walk.pos.x-r.x,__scene.walk.pos.z-r.z)<r.gap+.07")
    page.keyboard.down("w")
    try:
        page.wait_for_timeout(480)
    finally:
        page.keyboard.up("w")
    distance = page.evaluate("r=>Math.hypot(__scene.walk.pos.x-r.x,__scene.walk.pos.z-r.z)", route)
    assert route["gap"]-.018 < distance < route["gap"]+.07, (route,distance)
    hold("d" if route["side"]>0 else "a", "r=>r.side*((__scene.walk.pos.x-r.x)*r.sx+(__scene.walk.pos.z-r.z)*r.sz)>1.04")
    hold("w", "r=>(__scene.walk.pos.x-r.x)*r.ux+(__scene.walk.pos.z-r.z)*r.uz<-.62")

    page.evaluate("treeView", [230, 18, 30, 28.409, 2.0, -29.794])
    page.wait_for_function("__scene.foliage().nearChunks===0")
    assert 0 < near_count < data["totalChunks"], (near_count, data)
    page.evaluate("__scene.setMode('paint')")
    assert not page.evaluate("__scene.scene.getObjectByName('Volumetric perspective streets').visible")
    assert not errors, errors
    report = {
        **{key: data[key] for key in ("treeCount", "leaves", "farLeaves", "branches", "barkVertices", "litter", "totalChunks")},
        "windChangedPixels": wind, "shadeChangedPixels": shade, "nearChunksAtMarket": near_count,
        "stopDistance": distance, "rootSupport": support, "walkedAroundTrunk": True, "archiveViewRestored": True, "errors": errors,
    }
    (args.out / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    browser.close()
