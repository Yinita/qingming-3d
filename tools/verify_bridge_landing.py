"""Check visible bridge setts and the courier's response using the game controls."""

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
        page = browser.new_page(viewport={"width": 1440, "height": 810})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda item: errors.append(item.text) if item.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("""window.__scene?.mission()?.water.reflectionPasses>2 &&
            __scene.scene.getObjectsByProperty('name','Setts and repairs at bridge landing')
                .every(street=>street.material.userData.surfaceReady)""",timeout=65000)
        begin = page.locator("#missionBegin")
        ask = page.locator("#missionTalk")
        assert ask.is_hidden()
        begin.click()
        assert ask.is_visible() and ask.is_enabled()
        before = page.evaluate("__scene.mission()")
        feet = """() => {
            const actor=__scene.scene.getObjectByName('Bridge courier');
            return ['Left sole','Right sole'].map(name=>{
              const shoe=actor.getObjectByName(name);
              return shoe.getWorldPosition(shoe.position.clone()).toArray();
            });
        }"""
        planted = page.evaluate(feet)
        page.keyboard.press("t")
        assert "左手边" in page.locator("#missionSpeech").text_content()
        assert ask.is_disabled()
        page.wait_for_function("__scene.mission().guide.point>.91",timeout=6000)
        gesture = page.evaluate("""() => {
            const m=__scene.mission();
            const actor=__scene.scene.getObjectByName('Bridge courier');
            const finger=actor.getObjectsByProperty('name','index finger')[1];
            const joint=finger.children[1].children[1];
            const tip=joint.localToWorld(joint.position.clone().set(0,-.014,0));
            const hand=finger.parent.getWorldPosition(tip.clone());
            const guide=tip.sub(hand).setY(0).normalize();
            const toBridge=actor.position.clone().set(-48.2,0,-41.422).sub(actor.position).setY(0).normalize();
            return {mouth:m.guide.mouth,point:m.guide.point,
                direction:guide.dot(toBridge),bodyOverlap:m.collision.bodyOverlap,
                coins:m.coins,phase:m.phase,crate:m.crate};
        }""")
        moving = page.evaluate(feet)
        page.screenshot(path=args.out/"ask-courier.jpg",quality=94)
        page.wait_for_function("__scene.mission().guide.mouth>.22",timeout=5000)
        opening = page.evaluate("""() => {
            const face=__scene.scene.getObjectByName('Bridge courier').getObjectByName('Sculpted face');
            return face.morphTargetInfluences[face.morphTargetDictionary.speak];
        }""")
        assert opening>.11
        ask.wait_for(state="visible")
        page.wait_for_function("!document.getElementById('missionTalk').disabled")
        page.locator("#missionTalk").click()
        page.wait_for_function("__scene.mission().guide.point>.22")
        page.keyboard.press("Shift+KeyR")
        page.get_by_role("button",name="确认重开").click()
        after = page.evaluate("__scene.mission()")
        assert ask.is_hidden() and begin.is_visible()
        assert after["guide"]["point"]==after["guide"]["mouth"]==0
        assert (after["phase"],after["coins"],after["crate"])==("waiting",6,before["crate"])
        assert not errors,errors

        ground = page.evaluate("""() => {
          const roads=__scene.scene.getObjectsByProperty('name','Setts and repairs at bridge landing');
          return roads.map(({geometry,material,children})=>{
            const p=geometry.attributes.position, indices=geometry.index.array;
            let surfaces=0, probes=0, missed=0;
            for(let i=0;i<indices.length;i+=3) {
                const [a,b,c]=indices.subarray(i,i+3);
                const xs=[a,b,c].map(k=>p.getX(k)), zs=[a,b,c].map(k=>p.getZ(k));
                const twiceArea=(xs[1]-xs[0])*(zs[2]-zs[0])-(xs[2]-xs[0])*(zs[1]-zs[0]);
                // Sample broad exposed faces and skip loose chips scattered at the joints.
                if(twiceArea>-.020) continue;
                surfaces++;
                if(surfaces%7) continue;
                const sum=values=>values.reduce((a,b)=>a+b,0);
                const x=sum(xs)/3,z=sum(zs)/3;
                const rendered=(p.getY(a)+p.getY(b)+p.getY(c))/3;
                probes++;
                if(rendered-__scene.streetHeight(x,z)>.001) missed++;
            }
            return {faces:surfaces,probes,missed,joints:children.length,
              albedo:[material.map.image.width,material.map.image.height]};
          });
        }""")
        browser.close()
    assert gesture["phase"]=="waiting" and gesture["coins"]==6 and gesture["crate"]==before["crate"]
    assert gesture["point"]>.80 and gesture["direction"]>.83 and not gesture["bodyOverlap"],gesture
    drift=max(abs(a-b) for foot,rest in zip(planted,moving) for a,b in zip(foot,rest))
    assert drift<.001,drift
    assert len(ground)==2 and all(m["probes"]>35 and m["missed"]==0 and m["joints"]==1 for m in ground),ground
    data={"gesture":gesture,"mouthOpening":opening,"maxSoleDriftMetres":drift,
          "reset":after["guide"],"landingSurfaces":ground,"errors":errors}
    (args.out/"verification.json").write_text(json.dumps(data,indent=2)+"\n")
    print(json.dumps(data,ensure_ascii=False))


if __name__=="__main__":
    main()
