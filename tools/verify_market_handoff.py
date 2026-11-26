"""Exercise market parcel cancellation, visible handoff, persistence, and reset."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


PALMS = """() => {
    const {scene,mission}=__scene;
    const {market}=mission();
    const packet=scene.getObjectByName('Parcel exchanged with the market shopper');
    const names=['Player body','Market errand shopper'];
    const holds=[
      [[-.087,.059,.051],[.083,.052,.053]],
      [[.085,.047,-.058],[-.085,.042,-.060]]
    ];
    const point=packet.position.clone();
    const gaps=names.map((name,i)=>{
      const figure=scene.getObjectByName(name);
      return figure.getObjectsByProperty('name','Articulated hand').map((hand,j)=>{
        const anchor=packet.localToWorld(point.clone().set(...holds[i][j]));
        return hand.localToWorld(point.clone().set(0,-.060,0)).distanceTo(anchor);
      });
    });
    return {gaps,age:market.handoff.age,visible:packet.visible,
      corner:packet.localToWorld(point.set(.11,.05,.07)).toArray()};
}"""

PHOTO = """side => {
    const {renderer,scene,persp}=__scene;
    const giver=scene.getObjectByName('Player body');
    const receiver=scene.getObjectByName('Market errand shopper');
    const mid=giver.position.clone().lerp(receiver.position,.5);
    const along=receiver.position.clone().sub(giver.position).setY(0).normalize();
    const cross=along.clone().set(-along.z,0,along.x);
    const eye=persp.position.clone(),orientation=persp.quaternion.clone(),fov=persp.fov;
    persp.position.copy(mid).addScaledVector(cross,side*1.98).addScaledVector(along,-.22);
    persp.position.y+=1.60;
    persp.lookAt(mid.x,mid.y+1.069,mid.z);
    persp.fov=48;
    persp.updateProjectionMatrix();
    renderer.render(scene,persp);
    const data=renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    persp.position.copy(eye);
    persp.quaternion.copy(orientation);
    persp.fov=fov;
    persp.updateProjectionMatrix();
    return data;
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)

    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda message:errors.append(message.text) if message.type=="error" else None)
        # Start with an existing purchase so retrying the gesture does not repeat the delivery and sale.
        page.add_init_script("""(() => {
          if(sessionStorage.getItem('primedMarketTest')) return;
          localStorage.setItem('qingming-bridge-mission-v1',JSON.stringify({
            phase:'delivered',crate:{x:-43.69,z:-42.772,yaw:0},coins:10,method:'self',
            started:true,cakeBought:true,cakeClaimed:true}));
          sessionStorage.setItem('primedMarketTest','1');
        })();""")
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)

        def wait(condition,timeout=16000):
            page.wait_for_function(f"window.__scene && (m=>({condition}))(__scene.mission())",timeout=timeout)

        def walk(key,condition,timeout=16000):
            page.keyboard.down(key)
            try:
                wait(condition,timeout)
            finally:
                page.keyboard.up(key)

        def snapshot():
            return page.evaluate("""()=>{
              const {scene,mission}=__scene, m=mission();
              return {player:m.player,coins:m.coins,bodyOverlap:m.collision.bodyOverlap,
                cake:m.cake,handoff:m.market.handoff,stock:m.market.stock,
                shopper:m.market.people.find(p=>p.role==='shopper'),
                belt:scene.getObjectByName('Player body').getObjectByName('Twine and folded rice paper parcel').visible,
                receipt:scene.getObjectByName('Parcel exchanged with the market shopper').visible};
            }""")

        def photo(name,side):
            data=page.evaluate(PHOTO,side)
            (args.out/f"{name}-4k.jpg").write_bytes(base64.b64decode(data))

        wait("m?.water.refractionPasses>1",65000)
        page.get_by_role("button",name="继续逛").click()
        walk("w","m.player.x>-42.73",48000)
        walk("d","m.player.z>-39.36")
        action=page.locator("#missionShareCake")
        action.wait_for(timeout=18000)
        assert page.locator("#missionWaypoint.market-waypoint").is_visible()
        initial=snapshot()
        page.keyboard.press("h")
        wait("['approach','offering'].includes(m.market.handoff.stage)")
        page.keyboard.press("Escape")
        wait("m.market.handoff.stage==='idle'")
        cancelled=snapshot()
        assert cancelled["cake"]["owned"] and cancelled["belt"] and not cancelled["receipt"]

        action.wait_for(timeout=18000)
        action.click()
        wait("m.market.handoff.stage==='offering' && m.market.handoff.age>1.25",11000)
        offered=snapshot()
        palms=page.evaluate(PALMS)
        photo("passing-the-parcel",1)
        wait("m.cake.gifted && m.market.handoff.stage==='accepted'")
        accepted=snapshot()
        wait("m.market.handoff.stage==='carried'")
        try:
            wait("m.market.people.find(p=>p.role==='shopper').speed>.62",25000)
        except Exception:
            print("Shopper did not resume", snapshot(), flush=True)
            raise
        carried=snapshot()
        photo("walking-on-with-the-parcel",1)
        page.locator("#missionUndo").click()
        wait("m.cake.owned && m.market.handoff.stage==='idle'")
        undone=snapshot()

        action.wait_for(timeout=22000)
        page.locator("#missionCamera").click()
        page.keyboard.press("h")
        wait("m.firstPerson && m.market.handoff.stage==='offering' && m.market.handoff.age>1.20",11000)
        first_person=page.evaluate("""()=>{
          const figure=__scene.scene.getObjectByName('Player body');
          return {visible:figure.visible,headHidden:!figure.getObjectByName('Sculpted face').visible,
            sleeves:figure.getObjectsByProperty('name','Tailored articulated sleeve').every(part=>part.visible)};
        }""")
        first_person_frame=page.evaluate("__scene.renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1]")
        (args.out/"first-person-handoff-4k.jpg").write_bytes(base64.b64decode(first_person_frame))
        wait("m.cake.gifted",11000)
        page.reload(wait_until="domcontentloaded",timeout=65000)
        wait("m.cake.gifted && m.market.handoff.stage==='carried'",65000)
        restored=snapshot()
        page.keyboard.press("Shift+KeyR")
        page.get_by_role("button",name="确认重开").click()
        wait("m.market.stock===7 && m.coins===6")
        reset=snapshot()
        browser.close()

    report={"initial":initial,"cancel":cancelled,"offered":offered,"accepted":accepted,"carried":carried,
        "undo":undone,"reload":restored,"reset":reset,"palms":palms,"firstPerson":first_person,"errors":errors}
    (args.out/"handoff-verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(palms),flush=True)
    assert not errors,errors
    assert all(first_person.values()),first_person
    assert offered["cake"]["owned"] and offered["receipt"] and not offered["belt"],offered
    assert not offered["bodyOverlap"] and not offered["shopper"]["overlap"],offered
    assert all(gap<.056 for pair in palms["gaps"] for gap in pair),palms
    for stage in [accepted,carried,restored]:
        assert stage["cake"]["gifted"] and not stage["cake"]["owned"] and stage["receipt"] and not stage["belt"],stage
        assert stage["coins"]==10 and stage["stock"]==6,stage
    assert carried["shopper"]["distance"]>accepted["shopper"]["distance"]
    assert undone["cake"]["owned"] and undone["belt"] and not undone["receipt"],undone
    assert not reset["cake"]["gifted"] and not reset["receipt"] and not reset["belt"],reset


if __name__=="__main__":
    main()
