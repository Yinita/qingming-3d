"""Deliver the tea by ferry with normal player controls and inspect the moving rig."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


POSE = """() => {
    const {scene}=__scene;
    const boat=scene.getObjectByName('Moored timber skiff');
    const crate=scene.getObjectByName('茶叶货箱');
    const player=scene.getObjectByName('Player body');
    const p=crate.position.clone();
    const oars=boat.getObjectsByProperty('name','Ferry oar shaft');
    const hands=player.getObjectsByProperty('name','Articulated hand');
    const palmGaps=hands.map((hand,i)=>{
      const oar=oars[1-i].parent;
      const target=oar.localToWorld(p.clone().set(-(i===0 ? 1 : -1)*.408,0,0));
      return hand.localToWorld(p.clone().set(0,-.06,0)).distanceTo(target);
    });
    return {
      crateLocal:boat.worldToLocal(crate.getWorldPosition(p.clone())).toArray(),
      crateAttitude:Math.abs(boat.getWorldQuaternion(crate.quaternion.clone())
        .dot(crate.getWorldQuaternion(crate.quaternion.clone()))),
      feet:['Left sole','Right sole'].map(name=>{
        const sole=player.getObjectByName(name);
        return boat.worldToLocal(sole.getWorldPosition(p.clone())).toArray();
      }),
      palmGaps,
    };
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda e: errors.append(e.text) if e.type=="error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)

        def wait(test, timeout=16000):
            page.wait_for_function(f"window.__scene && (m=>({test}))(__scene.mission())",timeout=timeout)

        def walk(key,test,timeout=16000):
            page.keyboard.down(key)
            try:
                wait(test,timeout)
            finally:
                page.keyboard.up(key)

        def inspect():
            return page.evaluate("""() => {
              const {phase,coins,player,ferry,water,crate,firstPerson,collision}=__scene.mission();
              const {position,rotation,velocity,stage,oarEntries,spray}=water.skiff;
              return {phase,coins,player,ferry,crate,firstPerson,collision,
                boat:{position,rotation,velocity,stage,oarEntries,spray}};
            }""")

        def frame(name,eye,aim,fov):
            page.evaluate("""([eye,aim,fov])=>{
                const {scene,persp}=__scene, boat=scene.getObjectByName("Moored timber skiff");
                window.ferryCamera={fov:persp.fov,update:persp.updateMatrixWorld};
                persp.updateMatrixWorld=function(force){
                  const p=boat.position;
                  this.position.set(p.x+eye[0],p.y+eye[1],p.z+eye[2]);
                  this.lookAt(p.x+aim[0],p.y+aim[1],p.z+aim[2]);
                  window.ferryCamera.update.call(this,force);
                };
                persp.fov=fov;
                persp.updateProjectionMatrix();
                document.body.classList.add('ferry-capture');
                const hide=document.createElement('style');
                hide.id='ferryCaptureStyle';
                hide.textContent='.ferry-capture #missionHud,.ferry-capture #missionWaypoint,.ferry-capture #missionTools,.ferry-capture #missionRestart,.ferry-capture #missionDialogue{visibility:hidden}';
                document.head.appendChild(hide);
            }""",[eye,aim,fov])
            try:
                page.wait_for_timeout(220)
                page.screenshot(path=args.out/f"{name}-4k.jpg",quality=95)
            finally:
                page.evaluate("""()=>{
                    const {persp}=__scene;
                    persp.updateMatrixWorld=ferryCamera.update;
                    persp.fov=ferryCamera.fov;
                    persp.updateProjectionMatrix();
                    document.body.classList.remove('ferry-capture');
                    document.querySelector('#ferryCaptureStyle').remove();
                    delete window.ferryCamera;
                }""")

        wait("m?.water.refractionPasses>2",65000)
        page.locator("#missionBegin").click()
        context=page.locator("#missionContext")
        public=page.locator("#missionFerryGuide").count()>0
        if public:
            assert "问伙计" in context.inner_text()
            page.keyboard.press("e")
            page.wait_for_function("document.querySelector('#missionCaption b').textContent==='伙计'")
            assert page.evaluate("__scene.mission().phase==='waiting'")
        walk("w","m.player.x>-72.45")
        page.keyboard.press("e")
        wait("m.phase==='carrying'")
        if public:
            page.locator("#missionFerryGuide").click()
            assert "西岸渡口" in page.locator("#missionWaypoint").text_content()
        walk("a","m.player.z<-47.45")
        walk("w","m.player.x>-68.34")
        walk("a","m.player.z<-50.61")
        walk("w","m.ferry.near===0")
        west=inspect()
        assert west["player"]["y"]==.258 and not west["collision"]["bodyOverlap"]
        key=page.locator("#missionFerry")
        assert "叫渡船" in key.text_content()
        if public:
            assert "叫渡船" in context.inner_text()
        page.keyboard.press("e" if public else "g")
        wait("m.ferry.docked===0")
        wait("document.getElementById('missionFerry').textContent.includes('登船')")
        frame("west-landing",[-3.4,1.88,-2.5],[-.98,.40,.88],58)
        page.keyboard.press("e" if public else "g")
        wait("m.ferry.phase==='aboard'")
        boarded=inspect()
        assert boarded["phase"]=="carrying"

        page.keyboard.down("w")
        try:
            wait("m.ferry.progress>.32 && m.ferry.stroke>.98 && m.water.skiff.oarEntries>=4")
            moving=inspect()
            pose=page.evaluate(POSE)
            frame("rowing",[.2,1.58,-3.25],[.04,.30,.09],54)
        finally:
            page.keyboard.up("w")
        page.keyboard.press("g")
        wait("m.ferry.phase==='aboard'")
        wait("Math.abs(m.ferry.speed)<.04")
        stopped=inspect()
        if public:
            page.keyboard.press("Tab")
            wait("m.view==='missionScroll'")
            assert page.evaluate("__scene.scene.getObjectByName('Moored timber skiff').parent.name==='Bridge delivery'")
            page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
            frozen=inspect()
            page.wait_for_timeout(480)
            assert inspect()["boat"]["position"]==frozen["boat"]["position"]
            assert inspect()["crate"]==frozen["crate"]
            page.keyboard.press("Tab")
            wait("m.view==='mission'")
        page.keyboard.press("v")
        wait("m.firstPerson")
        walk("s","m.ferry.progress<.28")
        reversing=inspect()
        page.screenshot(path=args.out/"first-person-4k.jpg",quality=95)
        page.keyboard.press("v")
        walk("w","m.ferry.docked===1 && m.ferry.trips===1",22000)
        east=inspect()
        frame("east-landing",[1.85,1.44,-2.3],[.78,.39,.90],54)
        if public:
            assert "下船" in context.inner_text()
        page.keyboard.press("e" if public else "g")
        wait("m.ferry.phase==='ashore'")
        landed=inspect()
        assert not landed["collision"]["bodyOverlap"] and not landed["collision"]["carryOverlap"]
        assert landed["phase"]=="carrying" and landed["player"]["y"]==.258
        walk("w","m.player.x>-40.20")
        walk("d","m.player.z>-41.45")
        walk("s","m.player.x<-42.3")
        page.keyboard.press("e")
        wait("m.phase==='delivered'")
        delivered=inspect()
        assert delivered["coins"]==11
        if public:
            assert page.evaluate("__scene.mission().ferryDelivery")
            assert '运茶过河' in page.evaluate("localStorage.getItem('qingming-bridge-mission-v1')")
            caption=page.locator("#missionCaption")
            assert caption.is_visible() and "掌柜" in caption.inner_text()
            assert page.evaluate("""async()=>{
              await document.fonts.load('22px "Qingming Caption Serif"','掌柜');
              return document.fonts.check('22px "Qingming Caption Serif"','掌柜');
            }""")
            bounds=caption.bounding_box()
            assert bounds and bounds["y"]+bounds["height"]>1020
            page.screenshot(path=args.out/"dialogue-4k.jpg",quality=95)
        page.keyboard.press("Shift+KeyR")
        page.get_by_role("button",name="确认重开").click()
        reset=inspect()
        assert reset["coins"]==6 and not reset["ferry"]["engaged"] and reset["ferry"]["trips"]==0
        assert reset["boat"]["stage"]=="moored" and reset["boat"]["oarEntries"]==0
        browser.close()

    data={"west":west,"boarded":boarded,"moving":moving,"stopped":stopped,"reversing":reversing,
          "east":east,"landed":landed,"delivered":delivered,"reset":reset,"pose":pose,"errors":errors}
    (args.out/"ferry-route.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(pose),flush=True)
    assert stopped["ferry"]["speed"]<.04 and .28<stopped["ferry"]["progress"]<.90
    assert reversing["firstPerson"] and reversing["ferry"]["speed"]<-.60
    assert east["boat"]["position"][0]-boarded["boat"]["position"][0]>12.85
    assert moving["boat"]["spray"]["peak"]>5 and moving["boat"]["spray"]["emitted"]>25
    assert reset["boat"]["spray"]["emitted"]==0
    assert moving["boat"]["oarEntries"]>=4 and east["boat"]["oarEntries"]>moving["boat"]["oarEntries"]
    assert max(abs(x-y) for x,y in zip(pose["crateLocal"],[0,.229,.05]))<.002
    assert pose["crateAttitude"]>.9999
    assert all(.021<foot[1]<.11 for foot in pose["feet"]),pose
    assert max(pose["palmGaps"])<.04,pose
    assert not errors,errors


if __name__=="__main__":
    main()
