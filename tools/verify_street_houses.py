"""Walk through the working gate and verify reconstructed facades, loading and LOD."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out",required=True,type=Path)
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
    errors=[]
    requested=set()
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.on("console",lambda msg:errors.append(msg.text) if msg.type=="error" else None)
    page.on("request",lambda r:requested.add(urlsplit(r.url).path.rsplit("/",1)[-1]) if ".glb" in r.url else None)
    page.goto(args.url,wait_until="domcontentloaded",timeout=65000)

    def wait(test,timeout=15000):
        page.wait_for_function(f"window.__scene && (m=>({test}))(__scene.mission())",timeout=timeout)

    def hold(key,goal,timeout=15000):
        page.keyboard.down(key)
        try:
            wait(goal,timeout)
        finally:
            page.keyboard.up(key)

    def shot(name):
        page.screenshot(path=args.out/f"{name}.jpg",quality=95,timeout=50000)

    page.locator("#missionBegin").wait_for(timeout=85000)
    page.wait_for_function("__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length",timeout=80000)
    before=page.evaluate("__scene.housing()")
    assert before["reconstructed"]==15 and len(before["wings"])==25,before
    assert before["lowDetailRoofs"]>18 and not before["workshop"]["lit"] and before["workshop"]["position"]==0
    replaced={w["id"]+".glb" for w in before["wings"]}
    assert not replaced & requested and len(requested)>10,(replaced,requested)
    page.locator("#missionBegin").click()
    hold("w","m.player.x>-71.97")
    hold("a","!document.querySelector('#missionWorkshop').hidden")
    page.keyboard.down("a")
    page.wait_for_timeout(1200)
    page.keyboard.up("a")
    closed=page.evaluate("__scene.mission()")
    assert closed["player"]["z"]>closed["workshop"]["face"] and closed["workshop"]["position"]==0
    page.keyboard.press("e")
    wait("m.workshop.position===1.465")
    hold("a","m.player.z<-49.59")
    page.keyboard.press("e")
    wait("m.workshop.blocked")
    blocked=page.evaluate("__scene.mission()")
    assert .1<blocked["workshop"]["position"]<1.4 and blocked["collision"]["bodyOverlap"] is None
    page.wait_for_timeout(650)
    still=page.evaluate("__scene.mission().workshop.position")
    assert still==blocked["workshop"]["position"],(still,blocked)
    hold("a","m.player.z<-51.08")
    wait("m.workshop.position===0 && !m.workshop.blocked")
    hold("s","document.querySelector('#missionWorkshop').textContent.includes('点亮')")
    page.keyboard.press("v")
    page.evaluate("""()=>{
      const cam=__scene.persp,update=cam.updateMatrixWorld;
      const oldFov=cam.fov;
      cam.fov=63;cam.updateProjectionMatrix();
      cam.updateMatrixWorld=function(force){
        this.position.set(-71.57,1.46,-49.94);
        this.lookAt(-72.83,1.02,-51.86);
        return update.call(this,force);
      };
      document.getElementById('missionHud').style.visibility='hidden';
      document.getElementById('missionRestart').style.visibility='hidden';
      document.getElementById('missionWaypoint').style.visibility='hidden';
      window.normalWorkshopCamera=()=>{
        cam.updateMatrixWorld=update;
        cam.fov=oldFov;
        cam.updateProjectionMatrix();
        for(const id of ['missionHud','missionRestart','missionWaypoint']) document.getElementById(id).style.visibility='';
      };
    }""")
    shot("03-workshop-unlit-4k")
    page.keyboard.press("e")
    wait("m.workshop.lit")
    lit=page.evaluate("__scene.mission()")
    assert abs(lit["player"]["y"]-.192)<.002 and lit["collision"]["bodyOverlap"] is None
    shot("04-workshop-lamp-4k")
    a=Image.open(args.out/"03-workshop-unlit-4k.jpg").convert("RGB")
    b=Image.open(args.out/"04-workshop-lamp-4k.jpg").convert("RGB")
    assert a.size==b.size==(3840,2160)
    visible_light=sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/3
    assert visible_light>3.0,visible_light
    page.evaluate("window.normalWorkshopCamera()")
    hold("a","m.player.z<-52.19")
    assert page.evaluate("__scene.mission().player.y")>=.191
    page.locator("#missionRestart").click()
    page.get_by_role("button",name="确认重开",exact=True).click()
    wait("!m.workshop.lit && m.workshop.position===0 && m.player.x===-73.18")

    page.evaluate("""()=>{
      const {setMode,walk}=__scene;
      setMode('walk');
      for(const id of ['hud','questEntry','seal','scene-background']) {
        const node=document.getElementById(id);
        if(node)node.style.visibility='hidden';
      }
      window.houseView=([x,y,z,tx,ty,tz])=>{
        walk.pos.set(x,y,z);
        walk.yaw=Math.atan2(x-tx,z-tz);
        walk.pitch=Math.atan2(ty-y,Math.hypot(x-tx,z-tz));
      };
    }""")
    for name,frame in [
        ("01-courtyard-4k",[-20.1,2.03,-38.5,-23.55,1.43,-46.7]),
        ("02-loft-4k",[11.3,2.34,-17.8,4.96,1.76,-26.4]),
        ("05-workshop-exterior-4k",[-68.65,1.60,-46.16,-71.72,1.55,-50.68]),
    ]:
        page.evaluate("window.houseView",frame)
        page.wait_for_timeout(270)
        shot(name)
    assert page.evaluate("""()=>!__scene.walkClear(-23.673,-47.662,.10) &&
        __scene.walkClear(-23.673,-44.42,.10)""")
    page.evaluate("__scene.setMode('paint')")
    assert page.evaluate("""()=>{
      const {scene}=__scene;
      const group=scene.getObjectByName("Hand-built street architecture");
      return !group.parent.visible && scene.children.filter(o=>o.isMesh && o.userData.id==="o0453").some(o=>o.visible);
    }""")
    assert not errors,errors
    report={"sourceHouses":before["reconstructed"],"fittedWings":len(before["wings"]),
        "lowDetailRoofsAtStart":before["lowDetailRoofs"],"legacyModelsSkipped":len(replaced),
        "legacyRequests":sorted(requested),"blockedGatePosition":still,"lampMeanDifference":visible_light,
        "passedPhysicalThreshold":True,"closedGateStopsPlayer":True,"resetClosedAndUnlit":True,
        "archiveCardRestored":True,"consoleErrors":errors}
    (args.out/"verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(report,ensure_ascii=False))
