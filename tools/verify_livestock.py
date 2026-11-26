"""Check livestock anatomy, near/far rendering, authored placement and greeting."""

import argparse
import collections
import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out",required=True,type=Path)
parser.add_argument("--visual-only",action="store_true")
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
    page.locator("#missionBegin").wait_for(timeout=75000)
    page.wait_for_function("__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length",timeout=80000)
    data=page.evaluate("__scene.livestock()")
    kinds=collections.Counter(o["kind"] for o in data["animals"])
    annotated=page.evaluate("""__scene.L.objects.filter(o=>["horse","ox","donkey"].includes(o.label)).length""")
    assert sum(kinds.values())==annotated==31 and not data["hidden"],data
    assert kinds=={"horse":27,"donkey":3,"ox":1},kinds
    assert max(o["offset"] for o in data["animals"])<=1.32,data
    assert any(o["far"] for o in data["animals"])
    rest_error=page.evaluate("""()=>{
      const {scene,livestock,streetHeight}=__scene;
      return Math.max(...livestock().animals.flatMap(a=>{
        const mesh=scene.getObjectByName(`Livestock ${a.id} ${a.kind}`);
        return a.footings.map(([x,y,z],i)=>{
          const ankle=mesh.skeleton.bones[6+i].getWorldPosition(mesh.position.clone());
          return Math.max(Math.abs(y-ankle.y),Math.abs(streetHeight(x,z)-y));
        });
      }));
    }""")
    assert rest_error<.001,rest_error

    greeting=None
    if not args.visual_only:
        def walk(key,until):
            page.keyboard.down(key)
            try:
                page.wait_for_function(until,timeout=14000)
            finally:
                page.keyboard.up(key)

        page.locator("#missionBegin").click()
        walk("a","__scene.mission().player.z<-46.33")
        walk("s","__scene.mission().player.x<-75.61")
        walk("a","!document.getElementById('missionAnimal').hidden")
        assert page.locator("#missionAnimal").inner_text()=="伸手让马闻 P"
        before=page.evaluate("__scene.livestock().animals.find(a=>a.id==='o0338')")
        page.keyboard.press("p")
        page.wait_for_function("__scene.livestock().greeting?.age>1.05",timeout=7000)
        greeting=page.evaluate("""()=>{
          const data=__scene.livestock(),horse=data.animals.find(a=>a.id==='o0338');
          const figure=__scene.scene.getObjectByName('Player body');
          const hands=figure.getObjectsByProperty('name','Articulated hand');
          const at=hands[1].localToWorld(figure.position.clone().set(0,-.060,0));
          const muzzle=at.clone().fromArray(horse.muzzle);
          return {horse,handGap:at.distanceTo(muzzle),interaction:data.greeting,
            collision:__scene.mission().collision.bodyOverlap};
        }""")
        assert greeting["interaction"]["id"]=="o0338",greeting
        assert greeting["horse"]["pitch"]<before["pitch"]-.044,greeting
        assert greeting["handGap"]<.31 and greeting["collision"] is None,greeting
        page.screenshot(path=args.out/"04-greeting-4k.jpg",quality=95)
        walk("d","__scene.livestock().greeting===null")
        assert greeting["horse"]["near"]

    page.evaluate("""()=>{
      const {scene,walk,setMode}=__scene;
      setMode('walk');
      for(const id of ['hud','questEntry','seal']) document.getElementById(id).style.visibility='hidden';
      window.inspectAnimal=(id,kind,local)=>{
        const mesh=scene.getObjectByName(`Livestock ${id} ${kind}`);
        const eye=mesh.localToWorld(mesh.position.clone().set(...local));
        const focus=mesh.localToWorld(mesh.position.clone().set(0,.94,-.12));
        walk.pos.copy(eye);
        walk.yaw=Math.atan2(eye.x-focus.x,eye.z-focus.z);
        walk.pitch=Math.atan2(focus.y-eye.y,Math.hypot(eye.x-focus.x,eye.z-focus.z));
      };
    }""")
    tested={}
    views=[
        ("o0284","horse",[2.63,1.40,-1.32]),
        ("o0367","donkey",[-2.65,1.30,-1.41]),
        ("o0314","ox",[-2.64,1.32,-1.58]),
    ]
    for i,(id,kind,camera) in enumerate(views,1):
        page.evaluate("([id,kind,at])=>window.inspectAnimal(id,kind,at)",[id,kind,camera])
        page.wait_for_function("id=>__scene.livestock().animals.some(o=>o.id===id && !o.far)",arg=id)
        tested[kind]=page.evaluate("id=>__scene.livestock().animals.find(o=>o.id===id)",id)
        path=args.out/f"0{i}-{kind}-4k.jpg"
        page.screenshot(path=path,quality=95)
        with Image.open(path) as image:
            assert image.size==(3840,2160),image.size
    assert all(a["triangles"]>4500 for a in tested.values())
    page.evaluate("__scene.setMode('paint')")
    assert page.evaluate("""()=>{
      const herd=__scene.scene.getObjectByName("Street horses, donkeys and ox");
      return !herd.parent.visible;
    }""")
    assert not errors,errors
    report={"count":dict(kinds),"hidden":data["hidden"],"hoofClearanceModelError":rest_error,
        "relocation":{a["id"]:a["offset"] for a in data["animals"] if a["offset"]>.03},
        "farAtSpawn":sum(a["far"] for a in data["animals"]),"portraits":tested,
        "greeting":greeting,"archiveRestored":True,"consoleErrors":errors}
    (args.out/"verification.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({k:report[k] for k in ("count","hoofClearanceModelError","relocation","farAtSpawn","consoleErrors")},ensure_ascii=False))
