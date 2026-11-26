"""Play the delivery and exercise door collision, indoor tea service and replay."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


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
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda item: errors.append(item.text) if item.type=="error" else None)

        def inspect():
            return page.evaluate("""() => {
                const {phase,coins,player,teaRoom,collision,firstPerson}=__scene.mission();
                return {phase,coins,player,teaRoom,collision,firstPerson};
            }""")

        def wait(test, timeout=16000):
            page.wait_for_function(f"window.__scene && (m=>({test}))(__scene.mission())",timeout=timeout)

        def walk(key,test,timeout=16000):
            page.keyboard.down(key)
            try:
                wait(test,timeout)
            finally:
                page.keyboard.up(key)

        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        wait("m?.water.reflectionPasses>2",65000)
        page.locator("#missionBegin").click()
        walk("w","m.player.x>-72.4")
        page.keyboard.press("e")
        wait("m.phase==='carrying'")
        walk("w","m.player.x>-44.01",48000)
        page.keyboard.press("e")
        wait("m.phase==='delivered'")
        walk("s","m.player.x<m.teaRoom.entrance.x+.09")
        walk("a","m.player.z<m.teaRoom.entrance.z+.62")
        page.keyboard.down("a")
        page.wait_for_timeout(530)
        page.keyboard.up("a")
        closed=inspect()
        assert not closed["teaRoom"]["inside"] and closed["teaRoom"]["door"]["angle"]==0
        assert .32<closed["player"]["z"]-closed["teaRoom"]["entrance"]["z"]<.58,closed
        door=page.locator("#missionDoor")
        assert door.is_visible()
        page.keyboard.press("e")
        wait("m.teaRoom.door.angle>1.65")
        open_door=inspect()
        walk("a","m.teaRoom.inside && m.teaRoom.atTable")
        entry=inspect()
        assert not entry["collision"]["bodyOverlap"] and entry["player"]["y"]>.10,entry

        door.click()
        wait("m.teaRoom.door.blocked && m.teaRoom.door.target===0")
        blocked=inspect()
        assert not blocked["collision"]["bodyOverlap"] and "阻挡" in door.text_content() and blocked["coins"]==11
        page.wait_for_timeout(300)
        assert abs(inspect()["teaRoom"]["door"]["angle"]-blocked["teaRoom"]["door"]["angle"])<.04
        walk("d","m.player.z>m.teaRoom.entrance.z+.48")
        wait("m.teaRoom.door.angle===0 && !m.teaRoom.door.blocked")
        closed_after_obstacle=inspect()
        page.keyboard.press("e")
        wait("m.teaRoom.door.angle>1.65")
        walk("a","m.teaRoom.inside && m.teaRoom.atTable")
        page.keyboard.press("v")
        page.mouse.move(1244,490)
        page.mouse.down()
        page.mouse.move(887,548,steps=12)
        page.mouse.up()
        wait("m.firstPerson && Math.abs(m.player.yaw)<.13")
        page.locator("#missionRoomTea").click()
        wait("m.teaRoom.tea.stream && m.teaRoom.tea.age>1.25")
        pouring=inspect()
        assert pouring["coins"]==10 and pouring["teaRoom"]["served"]
        grip_gap=page.evaluate("""() => {
            const room=__scene.scene.getObjectByName("Bridge tea room");
            const pot=room.getObjectByName("Kettle handle contact");
            const hand=room.getObjectByName("Tea grasp contact");
            return hand.getWorldPosition(hand.position.clone()).distanceTo(pot.getWorldPosition(pot.position.clone()));
        }""")
        assert grip_gap<.006,grip_gap
        page.screenshot(path=args.out/"tea-room-pour-4k.jpg",quality=95)

        page.locator("#missionUndo").click()
        undone=inspect()
        assert undone["coins"]==11 and not undone["teaRoom"]["served"] and undone["teaRoom"]["door"]["angle"]>1.65
        page.keyboard.press("c")
        wait("m.teaRoom.served && m.coins===10")
        page.reload(wait_until="domcontentloaded",timeout=65000)
        wait("m?.teaRoom.tea.fill===1 && m.coins===10",65000)
        page.locator("#missionContinue").click()
        recovered=inspect()
        assert page.locator("#missionIntro").is_hidden() and recovered["teaRoom"]["served"]
        page.keyboard.press("Shift+KeyR")
        page.get_by_role("button",name="确认重开").click()
        reset=inspect()
        assert reset["phase"]=="waiting" and reset["coins"]==6 and not reset["teaRoom"]["served"]
        assert reset["teaRoom"]["door"]["angle"]==0 and reset["teaRoom"]["tea"]["fill"]==0
        camera_swing=page.evaluate("""async () => {
            const {createStreetCollision}=await import("./bridge-collision.js?v=tearoom1");
            const physics=createStreetCollision();
            const panel=physics.orientedBox('test door',1,.065,2);
            panel.yaw=Math.PI*.25;
            const at=__scene.persp.position.clone();
            const guard=at.clone();
            const grazing=physics.cameraDistance(at.set(.57,1,.62),guard.set(1.4,1,.62));
            const across=physics.cameraDistance(at.set(.4,1,.42),guard.set(-.5,1,-.58));
            return {grazing,across};
        }""")
        assert camera_swing["grazing"]["obstacle"] is None and camera_swing["across"]["obstacle"]=="test door"
        browser.close()

    report={"closed":closed,"open":open_door,"entry":entry,"blocked":blocked,"pour":pouring,
            "clearedDoor":closed_after_obstacle,"cameraSwing":camera_swing,
            "gripGapMetres":grip_gap,"undo":undone,"reload":recovered,"reset":reset,"errors":errors}
    (args.out/"tea-room-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    assert not errors,errors


if __name__=="__main__":
    main()
