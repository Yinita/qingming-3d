"""Check the player rig's fixed leg lengths and contact phases in the 4K viewer."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_canal_inflow import RECORD


CAMERA = """()=>{
  const {scene,persp}=__scene, body=scene.getObjectByName('Player body');
  const update=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    const {x,y,z}=body.position;
    persp.position.set(x+2.42,y+1.16,z-.84);
    persp.lookAt(x+.04,y+.83,z);
    return update(force);
  };
  persp.fov=39;
  persp.updateProjectionMatrix();
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
}"""

TRACK = """()=>new Promise(resolve=>{
  const {scene,renderer}=__scene, body=scene.getObjectByName('Player body');
  const legs=['Left','Right'].map(side=>['thigh','shin','sole'].map(name=>body.getObjectByName(side+' '+name)));
  const points=legs.map(()=>Array.from({length:3},()=>body.position.clone()));
  const stride=[];
  let start,frames=0,heel=-Infinity,toe=Infinity,thighError=0,shinError=0,plantedDrift=0;
  let soleDrift=0,soleSamples=0;
  const stance=[null,null];
  let previous=null;
  function tick(now) {
    start??=now;
    const state=__scene.mission();
    for(let i=0;i<2;i++){
      const f=state.gait.feet[i],last=previous?.[i];
      if(f.planted && last?.planted && f.plantAge>=last.plantAge)
        plantedDrift=Math.max(plantedDrift,Math.hypot(last.x-f.x,last.z-f.z));
      heel=Math.max(heel,f.pitch);
      toe=Math.min(toe,f.pitch);
      const [a,b,c]=points[i];
      legs[i][0].getWorldPosition(a);
      legs[i][1].getWorldPosition(b);
      legs[i][2].parent.getWorldPosition(c);
      thighError=Math.max(thighError,Math.abs(a.distanceTo(b)-.351));
      shinError=Math.max(shinError,Math.abs(b.distanceTo(c)-.326));
      if(!f.planted || !last?.planted || f.plantAge<last.plantAge) stance[i]=null;
      if(f.planted && f.plantAge>.115 && Math.abs(f.pitch)<.012) {
        stance[i]??=[c.x,c.z];
        soleSamples++;
        soleDrift=Math.max(soleDrift,Math.hypot(c.x-stance[i][0],c.z-stance[i][1]));
      }
    }
    previous=state.gait.feet;
    if(frames++%5===0) stride.push({x:state.player.x,landings:state.gait.landings,
      feet:state.gait.feet.map(f=>({x:f.x,planted:f.planted,pitch:f.pitch}))});
    if(now-start<2650){requestAnimationFrame(tick);return;}
    resolve({heel,toe,thighError,shinError,plantedDrift,soleDrift,soleSamples,frames,phase:state.phase,
      size:[renderer.domElement.width,renderer.domElement.height],stride});
  }
  requestAnimationFrame(tick);
})"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--record", action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("""window.__scene?.mission()?.water?.reflectionPasses>2 &&
            __scene.scene.getObjectByName('Player body').getObjectByName('Outer robe shell').material.userData.surfaceReady""",
            timeout=65000)
        if page.locator("#missionBegin").is_visible():
            page.locator("#missionBegin").click()
        page.keyboard.down("w")
        try:
            page.wait_for_function("__scene.mission().player.x>-72.39",timeout=12000)
        finally:
            page.keyboard.up("w")
        page.keyboard.press("e")
        page.wait_for_function("__scene.mission().phase==='carrying'")
        page.evaluate(CAMERA)
        page.keyboard.down("w")
        try:
            movement=page.evaluate(TRACK)
            page.screenshot(path=args.out/"01-walking-up-the-bridge-4k.jpg",quality=95)
            if args.record:
                (args.out/"bridge-step.webm").write_bytes(base64.b64decode(page.evaluate(RECORD)))
        finally:
            page.keyboard.up("w")
        movement["errors"]=errors
        (args.out/"gait-verification.json").write_text(json.dumps(movement,indent=2)+"\n")
        assert movement["size"]==[3840,2160] and not errors,movement
        assert movement["heel"]>.13 and movement["toe"]<-.14,movement
        assert max(movement["thighError"],movement["shinError"])<.00008,movement
        assert movement["plantedDrift"]<.0001 and movement["stride"][-1]["x"]> -69,movement
        assert movement["soleSamples"]>20 and movement["soleDrift"]<.012,movement
        browser.close()


if __name__=="__main__":
    main()
