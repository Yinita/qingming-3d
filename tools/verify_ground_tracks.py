"""Walk the west bridge approach in dry and rainy conditions and check sole marks."""

import argparse
import base64
import json
from math import hypot
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright


PHOTO = """async ([eye,aim,fov])=>{
    const {persp,renderer,scene}=__scene;
    const previous=persp.updateMatrixWorld;
    const lastFov=persp.fov;
    persp.updateMatrixWorld=function(force) {
      this.position.set(...eye);
      this.lookAt(...aim);
      previous.call(this,force);
    };
    persp.fov=fov;
    persp.updateProjectionMatrix();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try {
      const layer=scene.getObjectByName("Clay impressions and wet sole transfers");
      const withTracks=renderer.domElement.toDataURL("image/jpeg",.95).split(",")[1];
      layer.visible=false;
      renderer.render(scene,persp);
      const clean=renderer.domElement.toDataURL("image/jpeg",.95).split(",")[1];
      layer.visible=true;
      return {withTracks,clean};
    } finally {
      persp.updateMatrixWorld=previous;
      persp.fov=lastFov;
      persp.updateProjectionMatrix();
    }
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)

    errors=[]
    presentation={}
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])

        def launch(rain=False):
            page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
            page.on("pageerror",lambda error:errors.append(str(error)))
            page.on("console",lambda item:errors.append(item.text) if item.type=="error" else None)
            url=args.url+("&rain" if rain else "")
            page.goto(url,wait_until="domcontentloaded",timeout=65000)
            page.locator("#missionBegin").wait_for(timeout=65000)
            if rain:
                page.wait_for_function("__scene.rainSample(-73.18,-39.70)?.wet>.32",timeout=65000)
            page.locator("#missionBegin").click()
            return page

        def wait(page,condition,timeout=18000):
            page.wait_for_function(f"window.__scene && (m=>({condition}))(__scene.mission())",timeout=timeout)

        def walk(page,key,condition):
            page.keyboard.down(key)
            try:
                wait(page,condition)
            finally:
                page.keyboard.up(key)

        def state(page):
            return page.evaluate("""()=>{
              const {player,tracks,gait,collision}=__scene.mission();
              return {player,tracks,landings:gait.landings,bodyOverlap:collision.bodyOverlap};
            }""")

        def photo(page,name,eye,aim,fov=49):
            results=page.evaluate(PHOTO,[eye,aim,fov])
            for kind,encoded in results.items():
                suffix="-4k.jpg" if kind=="withTracks" else "-clean-4k.jpg"
                (args.out/(name+suffix)).write_bytes(base64.b64decode(encoded))
            with Image.open(args.out/(name+"-4k.jpg")) as first, Image.open(args.out/(name+"-clean-4k.jpg")) as second:
                pixels_a=np.asarray(first,dtype=np.int16)
                pixels_b=np.asarray(second,dtype=np.int16)
                delta=np.max(np.abs(pixels_a-pixels_b),axis=2)
                presentation[name]={"changedPixels":int((delta>15).sum()),"maxDifference":int(delta.max())}

        dry=launch()
        walk(dry,"d","m.player.z>-39.55")
        wait(dry,"m.tracks.recent.filter(mark=>mark.actor==='player' && mark.kind==='dust').length>=3")
        wait(dry,"m.gait.feet.every(foot=>foot.planted && foot.plantAge>.43)")
        dry_batch=state(dry)
        drains=dry.evaluate("""()=>{
          const {scene,streetHeight}=__scene;
          const count=scene.getObjectsByProperty('name','Hand-set roadside drain').length;
          const depths=[[-72.59,-38.73,7401],[-43.39,-37.68,19408]].map(([x,z,seed])=>{
            const axis=z-(.090*Math.sin(seed)+.066);
            const bottom=streetHeight(x,axis);
            return Math.max(streetHeight(x,axis+.25),streetHeight(x,axis-.25))-bottom;
          });
          const soles=scene.getObjectByName('Individual sole contact shadows');
          const fades=soles.geometry.attributes.contactOpacity.array;
          const floor=scene.children.find(part=>part.userData.perspectiveMaterial);
          floor.geometry.computeBoundingBox();
          const extent=floor.geometry.boundingBox.max.x-floor.geometry.boundingBox.min.x;
          return {count,depths,contactShadows:fades.filter(a=>a>.10).length,
            paintedWidth:floor.userData.archiveGeometry.parameters.width,perspectiveWidth:extent};
        }""")
        photo(dry,"dry-road",[-72.56,1.73,-41.04],[-73.20,.062,-39.89],43)
        dry.keyboard.press("Tab")
        wait(dry,"m.view==='missionScroll' && !m.tracks.visible")
        dry.keyboard.press("Tab")
        wait(dry,"m.view==='mission' && m.tracks.visible")
        wait(dry,"!m.tracks.byActor.player",26000)
        faded=state(dry)
        dry.close()

        rain=launch(rain=True)
        walk(rain,"d","m.player.z>-39.55")
        wait(rain,"m.tracks.recent.filter(mark=>mark.actor==='player' && mark.kind==='mud').length>=3")
        mud=state(rain)
        photo(rain,"stone-drain",[-73.06,1.95,-39.88],[-72.82,.032,-38.66],49)
        photo(rain,"mud-road",[-72.56,1.73,-41.04],[-73.20,.062,-39.89],43)
        walk(rain,"a","m.player.z<-41.31")
        walk(rain,"w","m.player.x>-72.41")
        rain.keyboard.press("e")
        wait(rain,"m.phase==='carrying'")
        walk(rain,"w","m.player.x>-67.88")
        wait(rain,"m.tracks.recent.some(mark=>mark.actor==='player' && mark.kind==='transfer' && mark.medium==='wood')")
        transferred=state(rain)
        wood=[mark for mark in transferred["tracks"]["recent"] if mark["actor"]=="player" and mark["medium"]=="wood"]
        stone=[mark for mark in transferred["tracks"]["recent"] if mark["actor"]=="player" and mark["medium"]=="stone"]
        person=transferred["player"]
        for medium,marks in (("wood",wood),("stone",stone)):
            if not marks:
                continue
            clear=[mark for mark in marks if hypot(mark["x"]-person["x"],mark["z"]-person["z"])>.68]
            spot=max(clear or marks,key=lambda mark:mark["strength"])
            x,y,z=(spot[key] for key in ("x","y","z"))
            photo(rain,f"{medium}-transfer",[x-.29,y+.92,z+.34],[x,y,z],41)
        rain.keyboard.press("Shift+KeyR")
        rain.get_by_role("button",name="确认重开").click()
        wait(rain,"m.phase==='waiting' && m.tracks.active===0 && Object.keys(m.tracks.boots).length===0")
        reset=state(rain)
        browser.close()

    result={"dry":dry_batch,"faded":faded,"mud":mud,"transfer":transferred,"reset":reset,
        "drains":drains,"presentation":presentation,"errors":errors}
    (args.out/"tracks-verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    assert not errors,errors
    assert drains["count"]==2 and min(drains["depths"])>.035 and drains["contactShadows"]>10,drains
    assert drains["perspectiveWidth"]>drains["paintedWidth"]+60,drains
    for name,minimum in {"dry-road":300,"mud-road":2500,"stone-transfer":1100,"wood-transfer":1100}.items():
        assert presentation[name]["changedPixels"]>minimum,presentation[name]
    assert dry_batch["tracks"]["dust"]["particles"]>0
    assert dry_batch["tracks"]["totals"]["mud"]==0
    assert not faded["tracks"]["byActor"].get("player") and faded["landings"]==dry_batch["landings"]
    assert {mark["side"] for mark in mud["tracks"]["recent"] if mark["actor"]=="player" and mark["kind"]=="mud"}=={-1,1}
    assert stone and all(mark["kind"]=="transfer" for mark in [*stone,*wood])
    assert not any(state["bodyOverlap"] for state in [dry_batch,mud,transferred])
    print({key:result[key]["tracks"]["totals"] for key in ("dry","faded","mud","transfer","reset")})


if __name__=="__main__":
    main()
