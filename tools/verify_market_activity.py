"""Walk to the market, test pedestrian yielding, and buy and claim a cake parcel."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


RIG = """() => {
    const {scene}=__scene;
    const vendor=scene.getObjectByName('Market rice cake seller');
    const porter=scene.getObjectByName('Market basket porter');
    const counter=scene.getObjectByName('Rice cake stall');
    const packet=counter.getObjectByName('Twine and folded rice paper parcel');
    const basket=porter.getObjectByName("Porter's hand-held wicker basket");
    const hands=person=>person.getObjectsByProperty('name','Articulated hand');
    const point=vendor.position.clone();
    const age=__scene.market().wrapAge;
    function gaps(person,prop,local){
      return hands(person).map((hand,i)=>{
        const target=prop.localToWorld(point.clone().set(...local(i===0 ? -1 : 1)));
        return hand.localToWorld(point.clone().set(0,-.060,0)).distanceTo(target);
      });
    }
    return {visible:packet.visible,age,pitch:vendor.children.find(c=>c.isGroup)?.rotation.x,
      paperGaps:gaps(vendor,packet,side=>[side*.100,.054,.003+side*.020*Math.sin(age*11)]),
      wickerGaps:gaps(porter,basket,side=>[side*.158,.204,.008])};
}"""


STEAMER_RIG = """() => {
    const {scene}=__scene;
    const vendor=scene.getObjectByName('Market rice cake seller');
    const handle=scene.getObjectByName('Bent bamboo lifting handle');
    const tongs=scene.getObjectByName('Bamboo serving tongs');
    const cake=scene.getObjectByName('Rice cake being served');
    const hands=vendor.getObjectsByProperty('name','Articulated hand');
    const point=vendor.position.clone();
    const lid=handle.localToWorld(point.set(0,.036,0));
    const grip=tongs.localToWorld(point.clone().set(0,0,.014));
    const pinch=tongs.localToWorld(point.clone().set(0,-.021,-.198));
    const cakePoint=cake.localToWorld(point.clone().set(0,0,0));
    const palm=hand=>hand.localToWorld(point.clone().set(0,-.060,0));
    return {lidGap:palm(hands[0]).distanceTo(lid),toolGap:palm(hands[1]).distanceTo(grip),
      gripGap:pinch.distanceTo(cakePoint),cake:cakePoint.toArray(),visible:cake.visible,
      steamer:__scene.market().steamer};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out", type=Path, required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda msg:errors.append(msg.text) if msg.type=="error" else None)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)

        def wait(test, timeout=14000):
            page.wait_for_function(f"window.__scene && (m=>({test}))(__scene.mission())",timeout=timeout)

        def walk(key,test,timeout=14000):
            page.keyboard.down(key)
            try:
                wait(test,timeout)
            except Exception:
                print("Walk stopped", key, snapshot(), flush=True)
                raise
            finally:
                page.keyboard.up(key)

        def snapshot():
            return page.evaluate("""() => {
              const {market,player,phase,coins,collision,firstPerson}=__scene.mission();
              const actor=__scene.scene.getObjectByName('Player body');
              const envelope=actor.getObjectByName('Twine and folded rice paper parcel');
              return {market,player,phase,coins,collision,firstPerson,parcelOnBelt:envelope.visible};
            }""")

        def photo(name,eye,aim,fov):
            page.evaluate("""([eye,aim,fov])=>{
              const {persp}=__scene;
              window.marketCamera={fov:persp.fov,update:persp.updateMatrixWorld};
              persp.updateMatrixWorld=function(force) {
                this.position.set(...eye);
                this.lookAt(...aim);
                window.marketCamera.update.call(this,force);
              };
              persp.fov=fov;
              persp.updateProjectionMatrix();
              const mask=document.createElement('style');
              mask.id='marketPhoto';
              mask.textContent='#missionHud,#missionWaypoint,#missionTools,#missionRestart,#missionNotice{visibility:hidden}';
              document.head.appendChild(mask);
            }""",[eye,aim,fov])
            try:
                page.wait_for_timeout(200)
                page.screenshot(path=args.out/f"{name}-4k.jpg",quality=95)
            finally:
                page.evaluate("""()=>{
                  const {persp}=__scene;
                  persp.updateMatrixWorld=marketCamera.update;
                  persp.fov=marketCamera.fov;
                  persp.updateProjectionMatrix();
                  delete window.marketCamera;
                  document.getElementById('marketPhoto').remove();
                }""")

        wait("m?.water.refractionPasses>1",65000)
        page.locator("#missionBegin").click()
        walk("w","m.player.x>-72.42")
        page.keyboard.press("e")
        wait("m.phase==='carrying'")
        walk("w","m.player.x>-44.02",45000)
        page.keyboard.press("e")
        wait("m.phase==='delivered'")
        guide=page.locator("#missionMarketGuide")
        if guide.count():
            guide.click()
            assert "蒸糕摊" in page.locator("#missionWaypoint").text_content()
        walk("w","m.player.x>-42.73")
        walk("d","!document.querySelector('#missionCake').hidden")
        page.locator("#missionCake").wait_for()
        if guide.count():
            page.wait_for_function("!__scene.scene.getObjectByName('Mission objective beacon').visible")
        approach=snapshot()
        assert approach["coins"]==11 and approach["market"]["stock"]==7
        photo("market-lane",[-45.32,2.05,-41.42],[-42.54,1.14,-37.75],59)
        wait("""m.market.people.some(actor=>actor.role==='porter' &&
              actor.behavior==='yielding' && actor.blocked==='player' && actor.speed<.31)""",55000)
        yielding=snapshot()
        assert not yielding["collision"]["bodyOverlap"]
        page.keyboard.press("i")
        wait("m.market.preview && m.market.steamer.opening>1.20")
        preview=snapshot()
        opening_rig=page.evaluate(STEAMER_RIG)
        photo("open-bamboo-steamer",[-43.92,1.86,-38.64],[-43.07,1.09,-37.52],51)
        page.keyboard.press("b")
        assert snapshot()["coins"]==11
        assert page.locator("#missionCake").is_disabled()
        wait("!m.market.preview && m.market.steamer.opening===0")
        page.keyboard.press("b")
        wait("m.market.stage==='serving' && m.coins===10")
        wait("m.market.wrapAge>-1.04 && m.market.stage==='serving'")
        tongs_rig=page.evaluate(STEAMER_RIG)
        photo("lifting-steamed-cake",[-41.97,1.82,-38.59],[-43.02,1.16,-37.47],49)
        wait("m.market.stage==='wrapping' && m.coins===10")
        wait("m.market.wrapAge>1.26")
        rig=page.evaluate(RIG)
        photo("wrapping-rice-cake",[-42.55,1.52,-38.95],[-42.66,1.05,-37.45],54)
        wait("m.market.stage==='ready' && m.market.stock===6")
        ready=snapshot()
        porter=next(actor for actor in yielding["market"]["people"] if actor["role"]=="porter")
        wait(f"""m.market.people.some(actor=>actor.role==='porter' &&
              actor.distance>{porter['distance'] + 2.0} && actor.detours>{porter['detours']})""",42000)
        passed=snapshot()
        assert passed["player"]==yielding["player"] and not passed["collision"]["bodyOverlap"]
        page.keyboard.press("b")
        wait("m.market.stage==='claimed'")
        claimed=snapshot()
        assert claimed["parcelOnBelt"] and claimed["coins"]==10
        page.keyboard.press("b")
        assert snapshot()["coins"]==10
        page.locator("#missionUndo").click()
        wait("m.market.stage==='ready'")
        undone=snapshot()
        assert not undone["parcelOnBelt"] and undone["coins"]==10
        page.locator("#missionCake").click()
        wait("m.market.stage==='claimed'")
        page.reload(wait_until="domcontentloaded",timeout=65000)
        wait("m.market.stage==='claimed' && m.coins===10",65000)
        restored=snapshot()
        assert restored["parcelOnBelt"]
        page.keyboard.press("Shift+KeyR")
        page.get_by_role("button",name="确认重开").click()
        wait("m.market.stock===7 && m.coins===6")
        reset=snapshot()
        assert reset["phase"]=="waiting" and not reset["parcelOnBelt"]
        browser.close()

    report={"approach":approach,"yielding":yielding,"passed":passed,"ready":ready,"claimed":claimed,
            "undo":undone,"reload":restored,"reset":reset,"rig":rig,"preview":preview,
            "openingRig":opening_rig,"tongsRig":tongs_rig,"errors":errors}
    (args.out/"market-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"wrapping":rig,"open":opening_rig,"lifting":tongs_rig}),flush=True)
    assert preview["coins"]==11 and preview["market"]["stock"]==7
    assert opening_rig["lidGap"] < .055 and opening_rig["steamer"]["steam"] > .5,opening_rig
    assert tongs_rig["lidGap"] < .055 and tongs_rig["toolGap"] < .055,tongs_rig
    assert tongs_rig["gripGap"] < .023 and tongs_rig["visible"],tongs_rig
    assert reset["market"]["steamer"]["opening"]==0 and reset["market"]["steamer"]["steam"]==0
    for stage in (approach,yielding,passed,ready,claimed):
        assert all(person["overlap"] is None and person["gait"]["landings"]>0 for person in stage["market"]["people"])
    assert rig["visible"] and max(rig["wickerGaps"])<.07 and max(rig["paperGaps"])<.075,rig
    assert not errors,errors


if __name__=="__main__":
    main()
