"""Measure rendered boot clearance during an uninterrupted NPC delivery."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as api:
    browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                  args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_function("""window.__scene?.mission()?.water.reflectionPasses>3 &&
      __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length &&
      __scene.models.filter(o=>o.userData.label==="house").every(o=>
        o.userData.finishFaces.every(f=>f.material.userData.surfaceReady))""", timeout=85000)
    page.locator("#missionHire").click()
    courier = page.evaluate("""() => new Promise(resolve => {
      const {renderer,scene,mission}=__scene;
      const worker=scene.getObjectByName("Bridge courier");
      const soles=["Left sole","Right sole"].map(name=>worker.getObjectByName(name));
      const point=worker.position.clone();
      const samples={uphill:0,level:0,downhill:0};
      let clearance=Infinity, worst, frames=0;
      const start=performance.now();
      function measure() {
        if(worker.position.x>-69.50 && worker.position.x<-48.52) {
          const section=worker.position.x<-61.63 ? "uphill" :
            worker.position.x>-55.39 ? "downhill" : "level";
          samples[section]++;
          for(const sole of soles) {
            const vertices=sole.geometry.attributes.position;
            for(let i=0;i<vertices.count;i++) {
              point.fromBufferAttribute(vertices,i).applyMatrix4(sole.matrixWorld);
              // Nominal bridge deck, with a 3 mm allowance for the board surfaces.
              const u=point.x+59.014;
              const deck=Math.max(0,Math.min(2.593,.3247*(u+10.607),.3711*(10.606-u)))+.003;
              const distance=point.y-deck;
              if(distance<clearance) { clearance=distance; worst=point.toArray(); }
            }
          }
        }
        frames++;
        const state=mission();
        if(state.phase==="delivered" || performance.now()-start>28000) {
          resolve({clearance,worst,samples,frames,phase:state.phase,method:state.method,
            size:[renderer.domElement.width,renderer.domElement.height]});
          return;
        }
        requestAnimationFrame(measure);
      }
      requestAnimationFrame(measure);
    })""")
    assert courier["phase"] == "delivered" and courier["method"] == "courier", courier
    assert min(courier["samples"].values()) > 18 and courier["clearance"] >= -.002, courier
    assert courier["size"] == [3840, 2160], courier
    materials = page.evaluate("""() => {
      const {scene,L,models}=__scene;
      const visibleCards=scene.children.filter(o=>o.visible&&o.userData.tex&&o.geometry?.type==="PlaneGeometry");
      const ground=scene.children.find(o=>o.geometry?.parameters.width===L.ground.width &&
          o.geometry?.parameters.height===L.ground.depth);
      const worker=scene.getObjectByName("Player body");
      const vendor=scene.getObjectByName("Tea merchant");
      return {visibleCards:visibleCards.length, houses:models.filter(o=>o.visible&&o.userData.label==="house").length,
              ground:ground.material.userData.surfaceReady,
              weave:!!worker.getObjectByName("Outer robe shell").material.normalMap,
              merchantHarness:vendor.getObjectByName("Cargo harness").visible};
    }""")
    assert materials["visibleCards"] == 0 and materials["houses"] >= 20 and materials["ground"] and materials["weave"], materials
    assert not materials["merchantHarness"], materials
    page.evaluate("""() => {
      const {renderer,scene,persp}=__scene;
      renderer.setAnimationLoop(null);
      document.querySelector("#missionHud").style.display="none";
      window.renderShot=(eye,target)=>{
        persp.position.set(...eye);
        persp.lookAt(...target);
        renderer.render(scene,persp);
      };
    }""")
    for name, eye, target in [
        ("01-bridge-deck-4k", [-53.65, 2.47, -42.50], [-53.95, 2.91, -40.95]),
        ("02-merchant-linen-4k", [-42.75, 1.68, -42.32], [-41.95, 1.30, -43.56]),
        ("03-riverside-materials-4k", [-46.65, 1.45, -50.4], [-46.76, 1.78, -54.77]),
    ]:
        page.evaluate("([eye,target])=>renderShot(eye,target)", [eye, target])
        page.screenshot(path=args.out / (name + ".jpg"), quality=94)
    assert not errors, errors
    report = {"courier": courier, "materials": materials, "errors": errors}
    (args.out / "character-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    browser.close()
