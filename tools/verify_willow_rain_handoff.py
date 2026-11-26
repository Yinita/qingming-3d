"""Replay one rain impact on the real blade and follow its water through release."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame


def expose_catcher(route):
    response = route.fetch()
    body = response.text()
    marker = "  return {refresh,intercept,store,drain,pending:"
    hook = """  if(!street) {
    window.rainBlades ??= new Map();
    window.rainBlades.set(tree,{
      state:index=>pending.find(bead=>bead.leaf.index===index),
      pose(index,u,v){
        const leaf=samples[index];
        bladePose(leaf);
        const p=bladePoint(leaf,u,v,new THREE.Vector3());
        const du=u<.96 ? .036 : -.036,dv=v<.96 ? .036 : -.036;
        const a=bladePoint(leaf,u+du,v,new THREE.Vector3()).sub(p).multiplyScalar(1/du);
        const b=bladePoint(leaf,u,v+dv,new THREE.Vector3()).sub(p).multiplyScalar(1/dv);
        const normal=a.clone().cross(b).normalize();
        if(normal.y<0) normal.negate();
        return {p,normal,across:a.normalize()};
      },
      inject(index,time){
        refresh(time);
        const leaf=samples[index];
        for(const u of [.43,.56,.29]) for(const v of [.45,.32,.56]) {
          const {p,normal,across}=this.pose(index,u,v);
          const start=p.clone().addScaledVector(normal,.006), end=p.clone().addScaledVector(normal,-.006);
          const event=intercept(start,end.x,end.y,end.z,1.00001);
          if(!event || event.leaf!==leaf) continue;
          const hit=bladePoint(leaf,event.u,event.v,new THREE.Vector3());
          const gap=hit.distanceTo(start.clone().lerp(end,event.f));
          const outside=p.clone().addScaledVector(across,.039);
          const localA=outside.clone().addScaledVector(normal,.015).applyMatrix4(leaf.inverse);
          const localB=outside.clone().addScaledVector(normal,-.015).applyMatrix4(leaf.inverse);
          const falseHit=shape.intersect(localA,localB,leaf.flex,1.00001,{});
          store(event,time,.67,1.28);
          return {u:event.u,v:event.v,gap,falseHit,knownPoint:hit.toArray()};
        }
        return null;
      },
    });
  }
"""
    assert body.count(marker) == 1
    route.fulfill(response=response, body=body.replace(marker, hook+marker))


def expose_foreground(route):
    response = route.fetch()
    body = response.text()
    marker = "      const water=tree.userData.takeRainBead?.(item.index);"
    assert body.count(marker) == 1
    route.fulfill(response=response, body=body.replace(marker,
        "      if(window.rainBladeTrial && !window.rainBladeTrial(tree,item.index,time)) return false;\n"+marker))


def expose_flight(route):
    response = route.fetch()
    body = response.text()
    marker = "  return { mesh:leaves, frame,"
    assert body.count(marker) == 1
    route.fulfill(response=response, body=body.replace(marker,
        "  window.rainFlightLeaves=data;\n"+marker))


AUDIT = """async()=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  const detachedMesh=scene.getObjectByName('Floating and falling willow leaves');
  const beads=scene.getObjectByName('Water beads held at willow leaf tips');
  const streaks=scene.getObjectByName('Wind-driven rain and runoff streaks');
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let now=performance.now(), selected=null, transferred=null;
  let wetAtRelease=null, capturePose=null, empty=0, peakFlightWet=0, carriedFrames=0;
  const history=[], images={};
  const update=persp.updateMatrixWorld.bind(persp);
  persp.fov=39;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    if(capturePose) {
      persp.position.copy(capturePose.p).addScaledVector(capturePose.normal,.14).addScaledVector(capturePose.across,.027);
      persp.lookAt(capturePose.p);
    } else {
      persp.position.set(-64.25,1.41,-38.78);
      persp.lookAt(-65.55,2.80,-40.39);
    }
    return update(force);
  };
  for(const id of ['hud','missionHud','missionIntro','missionWaypoint','seal'])
    document.getElementById(id).style.display='none';
  window.rainBladeTrial=(tree,index,time)=>{
    if(transferred) return true;
    const catcher=rainBlades.get(tree);
    if(!selected) {
      if(time<2.65) return false;
      const hit=catcher.inject(index,time);
      if(!hit) { empty++; return false; }
      selected={index,tree,catcher,hit,time};
      return false;
    }
    if(time-selected.time<.15 || index!==selected.index) return false;
    const leaf=catcher.state(index);
    transferred={time,mass:leaf?.mass ?? 0};
    if(leaf) {
      const attached=catcher.pose(index,leaf.u,leaf.v);
      const r=.004+.007*Math.sqrt(Math.min(2.1,leaf.mass));
      transferred.position=attached.p.addScaledVector(attached.normal,r*.66).toArray();
    }
    const mesh=tree.getObjectByName('Willow canopy leaf instances');
    wetAtRelease=mesh.geometry.attributes.bladeMoisture.getX(index);
    return true;
  };
  function shot() {
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
  }
  function compare() {
    const material=selected.tree.getObjectByName('Willow canopy leaf instances').material;
    const opt=material.userData.leafCoating;
    const shadows=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    streaks.visible=false;
    try {
      images.wet=shot();
      opt.value=0;
      beads.visible=false;
      images.dry=shot();
    } finally {
      opt.value=1;beads.visible=true;streaks.visible=true;
      renderer.shadowMap.autoUpdate=shadows;
    }
  }
  for(let i=0;i<610;i++) {
    leafFrame(now+=1000/60);
    const state=__scene.mission();
    if(selected && !transferred) {
      const bead=selected.catcher.state(selected.index);
      if(bead) {
        history.push({time:state.water.time,u:bead.u,v:bead.v});
        if(!images.wet) {
          capturePose=selected.catcher.pose(selected.index,bead.u,bead.v);
          compare();
          capturePose=null;
        }
      }
    }
    if(transferred && !transferred.leaf) {
      const emitted=state.water.foliage.events.findLast(e=>e.kind==='release' && e.canopyIndex===selected.index);
      if(emitted) transferred.leaf=emitted;
    }
    const flight=transferred?.leaf ? rainFlightLeaves[transferred.leaf.index] : null;
    if(flight?.rainBead && flight.mode==='air') {
      if(carriedFrames===0 && transferred.position) {
        const {x,y,z}=flight.rainBead;
        transferred.beadGap=Math.hypot(x-transferred.position[0],y-transferred.position[1],z-transferred.position[2]);
      }
      carriedFrames++;
      peakFlightWet=Math.max(peakFlightWet,flight.wet);
      if(!images.flight && carriedFrames>=2) {
        const b=flight.rainBead;
        capturePose={p:new THREE.Vector3(b.x,b.y,b.z),
          normal:new THREE.Vector3(.05,.71,.70),across:new THREE.Vector3(.96,.2,-.21)};
        images.flight=shot();
        capturePose=null;
      }
    }
    if(i===609) images.canopy=shot();
  }
  const game=__scene.mission();
  const reports=game.rain.canopies.filter(c=>c.label==='Volumetric riverside willow').map(c=>c.bladeWater);
  const report={raster:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),caught:reports,
    first:selected ? {...selected.hit,time:selected.time,index:selected.index} : null,
    transferred,wetAtRelease,peakFlightWet,carriedFrames,empty,history,
    flying:game.water.foliage.rain,impactEvents:game.water.foliage.events.filter(e=>e.kind==='rain-bead-release'),
    waterImpacts:game.rain.carriedImpacts};
  return {report,images};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&rain&gust")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda e: errors.append(e.text) if e.type == "error" else None)
        page.route(args.url, expose_frame)
        page.route("**/bridge-rain-canopy.js", expose_catcher)
        page.route("**/bridge-foreground.js*", expose_foreground)
        page.route("**/bridge-canal-leaves.js", expose_flight)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("__scene?.mission()?.rain?.time>.3",timeout=35000)
        result = page.evaluate(AUDIT)
    report, images = result["report"], result["images"]
    report["errors"] = errors
    for name, photo in images.items():
        (args.out/f"{name}-4k.jpg").write_bytes(base64.b64decode(photo))
    if {"dry","wet"} <= images.keys():
        raw = [Image.open(BytesIO(base64.b64decode(images[k]))).convert("RGB") for k in ("dry","wet")]
        contact = Image.new("RGB",(1920,540))
        for i, photo in enumerate(raw):
            contact.paste(photo.resize((960,540),Image.Resampling.LANCZOS),(i*960,0))
        contact.save(args.out/"same-frame.jpg",quality=95)
        delta = np.abs(np.asarray(raw[0],dtype=np.int16)-np.asarray(raw[1],dtype=np.int16)).max(2)
        report["changedPixels"] = int((delta>6).sum())
    (args.out/"willow-rain.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report))
    assert not errors and report["raster"]==[3840,2160],errors
    assert report["first"]["gap"]<.00003 and not report["first"]["falseHit"],report
    assert report["transferred"]["mass"]>=.67 and abs(report["wetAtRelease"]-
        report["transferred"]["leaf"]["wetness"])<1e-6,report
    assert report["transferred"]["beadGap"]<.001,report
    assert report["carriedFrames"]>=2 and report["peakFlightWet"]>.4 and report["impactEvents"],report
    assert any(event["leaf"]==report["transferred"]["leaf"]["id"] and event["kind"]=="river" and
               abs(event["mass"]-report["transferred"]["mass"])<1e-7 for event in report["waterImpacts"]),report
    assert report["changedPixels"]>1000 and max(c["maximumSlide"] for c in report["caught"])>.025,report
    for crown in report["caught"]:
        assert abs(crown["caughtMass"]-crown["heldMass"]-crown["transferredMass"]-crown["drainedMass"])<1e-7,crown
    flying=report["flying"]
    assert abs(flying["receivedMass"]-flying["drainedMass"]-flying["queuedMass"]-flying["heldMass"])<1e-7,flying


if __name__ == "__main__":
    main()
