"""Audit wave-derived caustics and thin-leaf lighting on the actual 4K renderer."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out",type=Path,required=True)
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)


def changed(before,after,region,threshold):
    images=[np.asarray(Image.open(p).crop(region),dtype=np.int16) for p in (before,after)]
    delta=np.abs(images[0]-images[1]).mean(axis=2)
    return {"fraction":float((delta>threshold).mean()),"mean":float(delta.mean()),"maximum":float(delta.max())}


with sync_playwright() as api:
    browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
    page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
    page.wait_for_function("window.__scene?.mission()?.water?.caustics.passes>2",timeout=55000)
    page.evaluate("""async () => {
      const THREE=await import("./vendor/three/build/three.module.js");
      const {renderer,scene,persp}=__scene;
      const render=renderer.render.bind(renderer);
      const inspect={ THREE, render, renderer, scene, persp };
      window.lightAudit=inspect;
      renderer.render=(world,camera)=>{
        const rt=renderer.getRenderTarget();
        if(rt?.texture.name==="Refracted sunlight on canal bed"){
          inspect.lightTarget=rt;
          inspect.lightScene=world;
          inspect.lightCamera=camera;
        }
        if(rt?.texture.name==="Canal refraction color"){
          inspect.bedTarget=rt;
          inspect.underwaterCamera=camera;
        }
        return render(world,camera);
      };
      inspect.refract=()=>{
        const water=scene.getObjectByName("Canal surface");
        const previous=renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate=false;
        water.visible=false;
        renderer.setRenderTarget(inspect.bedTarget);
        render(scene,inspect.underwaterCamera);
        renderer.setRenderTarget(null);
        water.visible=true;
        renderer.shadowMap.autoUpdate=previous;
        render(scene,persp);
      };
      inspect.sample=()=>{
        const {lightTarget}=inspect;
        const size=lightTarget.width*lightTarget.height;
        const data=new Uint8Array(size*4);
        renderer.readRenderTargetPixels(lightTarget,0,0,lightTarget.width,lightTarget.height,data);
        const band=Uint8Array.from({length:size},(_,i)=>data[4*i]);
        return {sum:band.reduce((a,b)=>a+b,0),peak:band.reduce((a,b)=>Math.max(a,b),0),band};
      };
    }""")

    def move(key,predicate):
        page.keyboard.down(key)
        try:
            page.wait_for_function(predicate,timeout=15000)
        finally:
            page.keyboard.up(key)

    def drag(dx,dy):
        page.mouse.move(1040,555)
        page.mouse.down()
        page.mouse.move(1040+dx,555+dy,steps=10)
        page.mouse.up()

    def shot(name):
        target=args.out/(name+".png")
        page.screenshot(path=target,timeout=45000)
        return target

    move("a","__scene.mission().player.z < -44.42")
    move("w","__scene.mission().player.x > -67.69")
    page.keyboard.press("v")
    drag(0,132)
    page.wait_for_timeout(360)
    page.evaluate("window.lightBefore=lightAudit.sample()")
    page.keyboard.press("f")
    page.wait_for_function("__scene.mission().water.contacts.totals.stone===1")
    page.wait_for_timeout(330)
    proof=page.evaluate("""() => {
      const a=lightBefore,b=lightAudit.sample();
      let changed=0;
      for(let i=0;i<a.band.length;i++) if(Math.abs(a.band[i]-b.band[i])>=5) changed++;
      return {texels:a.band.length,changed,peak:Math.max(a.peak,b.peak),sum:b.sum,
        water:__scene.mission().water, pose:__scene.mission().player};
    }""")
    assert proof["sum"]>20000 and proof["changed"]>800,proof
    page.evaluate("__scene.renderer.setAnimationLoop(null)")
    isolated=page.evaluate("""() => {
      const a=lightAudit, {THREE,renderer,render,lightTarget,lightScene,lightCamera}=a;
      const saved=a.sample();
      const material=lightScene.children[0].material;
      const input=material.uniforms.waterState;
      const bytes=new Uint8Array(4);
      bytes[0]=128;
      const flat=new THREE.DataTexture(bytes,1,1,THREE.RGBAFormat);
      flat.needsUpdate=true;
      material.uniforms.waterState={value:flat};
      renderer.setRenderTarget(lightTarget);
      render(lightScene,lightCamera);
      const reference=a.sample();
      material.uniforms.waterState=input;
      render(lightScene,lightCamera);
      renderer.setRenderTarget(null);
      flat.dispose();
      let changed=0,maximum=0;
      for(let i=0;i<saved.band.length;i++){
        const d=Math.abs(saved.band[i]-reference.band[i]);
        if(d>=4) changed++;
        maximum=Math.max(d,maximum);
      }
      return {changed,maximum};
    }""")
    assert isolated["changed"]>60 and isolated["maximum"]>8,isolated
    caustics_on=shot("01-bank-caustics-on")
    page.evaluate("""() => {
      __scene.scene.getObjectByName("Recessed canal bed").material.uniforms.causticStrength.value=0;
      lightAudit.refract();
    }""")
    caustics_off=shot("02-bank-caustics-off")
    light_delta=changed(caustics_on,caustics_off,(850,1090,3370,2060),3)
    assert light_delta["fraction"]>.014,light_delta

    flora=page.evaluate("""() => {
      const {THREE,renderer,scene,persp,render}=lightAudit;
      const canopy=scene.getObjectByName("Volumetric riverside willow");
      const blades=canopy.getObjectByName("Willow canopy leaf instances");
      const material=blades.material;
      const center=canopy.position.clone();
      persp.position.copy(center).add(new THREE.Vector3(1.85,2.95,2.65));
      persp.lookAt(center.clone().add(new THREE.Vector3(.62,4.31,-.87)));
      persp.fov=41;
      persp.updateProjectionMatrix();
      render(scene,persp);
      return {heros:blades.count, street:__scene.street().foliage,
        underside:material.side===THREE.DoubleSide, bladeVertices:blades.geometry.attributes.position.count};
    }""")
    foliage_on=shot("03-willow-transmission-on")
    page.evaluate("""() => {
      const {scene,persp,render}=lightAudit;
      scene.traverse(o=>{
        if(o.material?.userData.leafTransmission) o.material.userData.leafTransmission.value=0;
      });
      render(scene,persp);
    }""")
    foliage_off=shot("04-willow-transmission-off")
    leaf_delta=changed(foliage_on,foliage_off,(930,310,3340,1730),3)
    assert leaf_delta["fraction"]>.012 and flora["bladeVertices"]>20,leaf_delta
    assert flora["street"]["leaves"]>30000 and flora["underside"]
    assert not errors,errors
    result={"lightingMap":{k:v for k,v in proof.items() if k not in ("water","pose")},
        "sameWaveTimeSimulationInput":isolated,"causticsFrozenAB":light_delta,"leafFrozenAB":leaf_delta,"flora":flora,
        "water":proof["water"],"errors":errors}
    (args.out/"lighting-verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({k:v for k,v in result.items() if k!="water"},ensure_ascii=False,indent=2),flush=True)
    browser.close()
