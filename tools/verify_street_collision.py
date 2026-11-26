"""Exercise world geometry and camera collision with actual key and pointer input."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out",type=Path,required=True)
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
    page.wait_for_function("window.__scene?.mission()?.water?.reflectionPasses>2",timeout=85000)
    read=lambda:page.evaluate("__scene.mission()")

    def move(key,until):
        page.keyboard.down(key)
        try:
            page.wait_for_function(until,timeout=16000)
        finally:
            page.keyboard.up(key)

    def hold(key,ms):
        page.keyboard.down(key)
        page.wait_for_timeout(ms)
        page.keyboard.up(key)

    def drag(dx,dy):
        page.mouse.move(1070,610)
        page.mouse.down()
        page.mouse.move(1070+dx,610+dy,steps=9)
        page.mouse.up()

    def shot(name):
        page.screenshot(path=args.out/(name+".jpg"),quality=95,timeout=45000)

    def geometry():
        return page.evaluate("""() => {
          const {scene,street}=__scene;
          const isVisible=o=>o.visible&&(!o.parent||isVisible(o.parent));
          const paper=scene.children.filter(o=>o.userData.tex&&o.isMesh&&o.geometry.type==="PlaneGeometry"&&isVisible(o));
          const city=scene.getObjectByName("Volumetric perspective streets");
          let residentMeshes=0;
          city.traverse(o=>{if(o.name==="Volumetric street residents"&&o.isInstancedMesh) residentMeshes++});
          const ground=scene.children.find(o=>o.userData.archiveGeometry);
          let tiledRoofs=0;
          scene.traverse(o=>{if (o.name==="Curved ceramic roof tiles" && isVisible(o)) tiledRoofs++});
          return {counts:street(),paper:paper.map(o=>o.userData.label),litGround:ground.material.isMeshStandardMaterial===true,
                  residentMeshes,tiledRoofs};
        }""")

    def robe_clearance():
        return page.evaluate("""() => {
          const {scene}=__scene;
          scene.updateMatrixWorld(true);
          const body=scene.getObjectByName("Player body");
          const robe=body.getObjectByName("Outer robe shell");
          const cargo=scene.getObjectByName("茶叶货箱");
          const point=body.position.clone(), lower=Infinity;
          let minZ=lower, minY=lower, maxY=-lower, outerRobe=-lower;
          function visit(mesh, callback) {
            const a=mesh.geometry.attributes.position;
            for(let i=0;i<a.count;i++) {
              point.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);
              body.worldToLocal(point);
              callback(point);
            }
          }
          cargo.traverse(o=>{
            if(o.isMesh) visit(o,p=>{
              minZ=Math.min(minZ,p.z);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
            });
          });
          visit(robe,p=>{if(p.y>=minY-.10&&p.y<=maxY+.10) outerRobe=Math.max(outerRobe,p.z)});
          return minZ-outerRobe;
        }""")

    world=geometry()
    assert world["residentMeshes"]>0 and world["litGround"] and world["tiledRoofs"]==10
    assert world["counts"]["bridgePeople"]==6 and world["counts"]["relocated"]>0
    assert world["paper"]==[],world
    hold("w",1450)
    crate_stop=read()
    assert crate_stop["phase"]=="waiting"
    assert -71.90<crate_stop["player"]["x"]<-71.52,crate_stop["player"]
    assert not crate_stop["collision"]["bodyOverlap"]
    page.keyboard.press("e")
    assert read()["phase"]=="carrying"
    move("w","__scene.mission().player.x>-63.7")
    page.wait_for_timeout(250)
    crossing_clearance=robe_clearance()
    assert crossing_clearance>.015,crossing_clearance
    shot("01-bridge-residents")
    hold("d",550)
    rail=read()
    assert abs(rail["player"]["z"]+41.422)<=.631
    assert not rail["collision"]["bodyOverlap"] and not rail["collision"]["carryOverlap"]
    move("a","__scene.mission().player.z<-41.36")
    move("w","__scene.mission().player.x>-43.98")
    page.keyboard.press("e")
    assert read()["phase"]=="delivered"
    page.keyboard.press("v")
    hold("a",950)
    counter=read()
    assert -42.13<counter["player"]["z"]<-41.69,counter["player"]
    assert not counter["collision"]["bodyOverlap"]
    drag(-352,0)
    shot("02-counter-first-person")

    # Spin the chase camera so the rendered boom would pass through the trunk.
    page.wait_for_function("__scene.models.length===__scene.L.objects.filter(o=>o.mesh).length",timeout=65000)
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("window.__scene?.mission()?.water?.reflectionPasses>1",timeout=85000)
    move("a","__scene.mission().player.z<-46.57")
    move("w","__scene.mission().player.x>-68.25")
    hold("w",280)
    trunk=read()
    assert -68.26<trunk["player"]["x"]<-67.89,trunk["player"]
    drag(-708,0)
    page.wait_for_function("__scene.mission().collision.cameraObstacle==='willow'")
    clipped=read()
    assert clipped["collision"]["cameraDistance"]<.55
    assert not clipped["collision"]["bodyOverlap"]
    page.keyboard.press("v")
    assert read()["firstPerson"]
    shot("03-bank-first-person")
    page.locator("#missionExit").click()
    paper=geometry()
    assert "person" in paper["paper"] and not paper["litGround"]
    page.locator("#bWalk").click()
    roaming=geometry()
    assert roaming["paper"]==[] and roaming["litGround"]
    assert not errors, errors
    result={"mission":world,"archivePaperCount":len(paper["paper"]),
        "roaming":roaming,"crate":crate_stop["player"],"rail":rail["player"],
        "counter":counter["player"],"tree":trunk["player"],"camera":clipped["collision"],
        "crateToRobeClearanceMetres":crossing_clearance,
        "errors":errors}
    (args.out/"street-verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
    browser.close()
