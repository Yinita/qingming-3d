"""Replay the freight route with real input, including boarding, collision and reset."""

import argparse
import json
import math
from pathlib import Path
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
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.on("console",lambda msg:errors.append(msg.text) if msg.type=="error" else None)
    page.goto(args.url,wait_until="domcontentloaded",timeout=65000)

    def wait(predicate,timeout=18000):
        page.wait_for_function(f"window.__scene && (m=>({predicate}))(__scene.mission())",timeout=timeout)

    def read():
        return page.evaluate("""()=>{
          const {player,freight,collision,phase,coins,firstPerson}=__scene.mission();
          return {player,freight,collision,phase,coins,firstPerson};
        }""")

    def walk(key,goal,timeout=18000,faster=False):
        if faster:
            page.keyboard.down("Shift")
        page.keyboard.down(key)
        try:
            wait(goal,timeout)
        except Exception:
            print(f"Walk {key} stalled at {read()['player']}",flush=True)
            raise
        finally:
            page.keyboard.up(key)
            if faster:
                page.keyboard.up("Shift")

    def receive_delivery():
        page.locator("#missionBegin").click()
        walk("w","m.player.x>-72.51")
        page.keyboard.press("e")
        wait("m.phase==='carrying'")
        walk("w","m.player.x>-44.72",45000,True)
        page.keyboard.press("e")
        wait("m.phase==='delivered'")

    def restart():
        page.locator("#missionRestart").click()
        page.get_by_role("button",name="确认重开",exact=True).click()
        wait("m.freight.passenger==='ground' && m.freight.travelled===0 && m.phase==='waiting'")

    def photo(stem):
        page.screenshot(path=args.out/f"{stem}.jpg",quality=95,timeout=45000)

    def side_photo():
        page.evaluate("""()=>{
          const {persp,scene}=__scene;
          const cart=scene.getObjectByName('Freight cart axle and deck');
          const animal=scene.getObjectByName('Articulated pack donkey');
          const update=persp.updateMatrixWorld;
          const fov=persp.fov;
          const eye=cart.position.clone(),aim=eye.clone();
          const hud=document.getElementById('missionHud');
          const reset=document.getElementById('missionRestart');
          const prior=[hud.style.visibility,reset.style.visibility];
          hud.style.visibility=reset.style.visibility="hidden";
          persp.updateMatrixWorld=function(force) {
            cart.localToWorld(eye.set(2.63,1.04,.49));
            aim.copy(cart.position).lerp(animal.position,.38);
            aim.y+=.51;
            this.position.copy(eye);
            this.lookAt(aim);
            return update.call(this,force);
          };
          persp.fov=54;
          persp.updateProjectionMatrix();
          window.restoreFreightCamera=()=>{
            persp.updateMatrixWorld=update;
            persp.fov=fov;
            persp.updateProjectionMatrix();
            [hud.style.visibility,reset.style.visibility]=prior;
          };
        }""")
        try:
            page.wait_for_timeout(200)
            photo("02-cart-from-the-lane-4k")
        finally:
            page.evaluate("window.restoreFreightCamera()")

    page.locator("#missionBegin").wait_for(timeout=65000)
    wait("m?.water.refractionPasses>2",65000)
    start=read()
    assert start["freight"]["stop"]=="蒸糕摊后街"
    receive_delivery()
    walk("d","m.player.z>-35.17")
    page.locator("#missionFreight").wait_for(timeout=9000)
    assert "上车" in page.locator("#missionFreight").inner_text()
    photo("01-board-at-the-rear-4k")
    page.locator("#missionFreight").click()
    wait("m.freight.passenger==='seated'")
    assert read()["freight"]["seatsTaken"]==1
    assert page.locator("#missionUndo").is_disabled()
    wait("m.freight.speed>.5 && m.freight.travelled>.65",30000)
    page.keyboard.press("x")
    assert "下一站" in page.locator("#missionSpeech").inner_text()
    side_photo()
    page.keyboard.press("v")
    wait("m.firstPerson && m.freight.travelled>2.4")
    photo("03-first-person-4k")
    page.keyboard.press("v")
    moving=read()
    assert not moving["firstPerson"] and moving["freight"]["passenger"]=="seated"
    wheels=moving["freight"]["wheels"]
    assert all(abs(angle)>1 for angle in wheels) and abs(wheels[0]-wheels[1])>.20,moving
    assert max(map(abs,moving["freight"]["wheelError"]))<.003,moving
    assert min(moving["freight"]["hoofClearance"])>-.013,moving
    assert moving["freight"]["axleSideSlip"]<.08,moving
    wait("m.freight.stop==='北巷' && m.freight.speed===0",45000)
    at_stop=read()
    assert at_stop["freight"]["travelled"]>8
    # The actual camera and body ride the chassis, using one continuous relative seat transform.
    seat=page.evaluate("""()=>{
      const cart=__scene.scene.getObjectByName("Freight cart axle and deck");
      return cart.children[0].localToWorld(cart.position.clone().set(0,.443,.544)).toArray();
    }""")
    assert math.hypot(at_stop["player"]["x"]-seat[0],at_stop["player"]["z"]-seat[2])<.002,at_stop
    page.keyboard.press("x")
    wait("m.freight.passenger==='ground'")
    landed=read()
    assert landed["collision"]["bodyOverlap"] is None
    assert landed["phase"]=="delivered" and landed["coins"]==11
    assert "已下货车" in page.locator("#missionSpeech").inner_text()
    page.keyboard.press("x")
    wait("m.freight.passenger==='seated'")
    restart()
    reset=read()
    assert reset["freight"]["wheels"]==[0,0] and reset["freight"]["seatsTaken"]==0
    assert reset["player"]==start["player"] and reset["coins"]==6
    print("Completed both-stop ride, dismount, and reset",flush=True)

    receive_delivery()
    walk("w","m.player.x>-38.12",faster=True)
    walk("d","m.player.z>-34.65",faster=True)
    walk("s","m.player.x<-39.09",faster=True)
    wait("m.freight.blocked==='player' && m.freight.speed<.025",38000)
    traffic=read()
    assert traffic["collision"]["bodyOverlap"] is None
    page.wait_for_timeout(800)
    paused=read()
    assert paused["freight"]["travelled"]-traffic["freight"]["travelled"]<.05,(traffic,paused)
    walk("w","m.player.x>-38.35",faster=True)
    wait("m.freight.travelled>"+str(paused["freight"]["travelled"]+.65),22000)
    resumed=read()
    wait("m.freight.loops>=1",55000)
    assert not errors,errors
    report={"boarding":True,"thirdAndFirstPerson":True,"moving":moving,"arrival":at_stop,
        "dismount":landed,"reset":reset,"yield":paused,"resume":resumed,"completeLoop":True,"errors":errors}
    (args.out/"verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print("Freight yielded to a player in its lane and completed its loop",flush=True)
