"""Replay a physical wave packet overtopping the skiff, with a real willow leaf."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_canal_inflow import RECORD
from verify_leaf_flight_contact import expose_boat, expose_leaves
from verify_leaf_water import expose_frame


INSTALL = """async()=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  const boat=scene.getObjectByName('Moored timber skiff');
  const group=boat.getObjectByName('Skiff interior water');
  const update=persp.updateMatrixWorld.bind(persp);
  const eye=new THREE.Vector3(-1.85,1.43,-.88), target=new THREE.Vector3(0,.061,-.20);
  const cameraEye=new THREE.Vector3(), cameraTarget=new THREE.Vector3();
  persp.fov=48;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    persp.position.copy(boat.localToWorld(cameraEye.copy(eye)));
    persp.lookAt(boat.localToWorld(cameraTarget.copy(target)));
    return update(force);
  };
  for(const id of ['hud','missionHud','missionIntro','missionWaypoint','seal'])
    document.getElementById(id).style.display='none';
  return {THREE,renderer,scene,persp,boat,group};
}"""

AUDIT = """async({install,tugAt})=>{
  const {THREE,renderer,scene,persp,boat,group}=await eval(install)();
  const {leaf,stats}=flightFixture, {skiff}=flightSkiff;
  const starts=__scene.mission().water.time;
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let now=performance.now();
  leaf.position.set(-.026,.19,.57).applyMatrix4(boat.matrixWorld);
  leaf.scale.set(.175,.265,.202);
  leaf.flex.set(.016,-.033,.008);
  leaf.orientation.setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  leaf.velocity.set(0,-.30,0);
  leaf.spin.set(0,0,0);
  leaf.flexRate.set(0,0,0);
  Object.assign(leaf,{mode:'air',wet:0,id:-90,began:starts,onDeck:false,onFilm:false,stoneRest:false,
    broadside:null,disturbed:false,attachment:null,lastWoodAt:starts});
  window.flightAirFixture=window.deckWindFixture=[0,0];
  const trace=[],images={};
  let firstSheet=null, firstPool=null, drainedAt=null, dry=null, firstDeck=null, maxLeafWet=0, peakLift=0;
  let peak=0, balance=0, minimum=0, lowX=Infinity, highX=-Infinity, lastVolume=0, dryWarmup=0;
  let tugTime=null, beforePull=null, returningSheet=0;
  const local=new THREE.Vector3(), previous=new THREE.Vector3();
  function frame() {
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/jpeg',.96).split(',')[1];
  }
  function capture(name, compare=false) {
    const shadow=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    try {
      images[name]=frame();
      if(compare) {
        group.visible=false;
        images[name+'-off']=frame();
      }
    } finally {
      group.visible=true;
      renderer.shadowMap.autoUpdate=shadow;
    }
  }
  for(let i=0;i<570;i++) {
    leafFrame(now+=1000/60);
    const state=__scene.mission().water, {bilge,rotation}=state.skiff;
    if(tugAt!==null && tugTime===null && state.time>tugAt && bilge.volume>.08 && skiff.tug(state.time)) {
      tugTime=state.time;
      beforePull=bilge.discharged;
    }
    peak=Math.max(peak,bilge.volume);
    returningSheet=Math.max(returningSheet,bilge.sheetTransport?.outgoingVolume ?? 0);
    balance=Math.max(balance,Math.abs(bilge.balanceError));
    minimum=Math.min(minimum,bilge.minimum,bilge.inFlight);
    if(bilge.volume>.015) {
      lowX=Math.min(lowX,bilge.centroid[0]);
      highX=Math.max(highX,bilge.centroid[0]);
    }
    if(bilge.inFlight>.0012 && firstSheet===null) firstSheet=state.time;
    if(bilge.volume>.0012 && firstPool===null) firstPool=state.time;
    if(bilge.discharged>.0002 && drainedAt===null) drainedAt=state.time;
    if(state.time<1.15 && !bilge.poolVisible && !bilge.sheetsVisible) dryWarmup++;
    if(leaf.attachment?.support==='skiff') {
      if(!firstDeck) firstDeck={time:state.time,local:leaf.attachment.position.toArray()};
      local.copy(leaf.position);
      boat.worldToLocal(local);
      const rise=local.y-leaf.attachment.position.y;
      peakLift=Math.max(peakLift,rise);
      maxLeafWet=Math.max(maxLeafWet,leaf.wet);
    }
    if(i%4===0) {
      trace.push({time:state.time,volume:bilge.volume,pending:bilge.inFlight,incoming:bilge.incoming,
        discharged:bilge.discharged,centroid:bilge.centroid,rotation,
        leaf:{mode:leaf.mode,wet:leaf.wet,local:boat.worldToLocal(previous.copy(leaf.position)).toArray()}});
    }
    if(!images.dry && state.time<1.07 && i>=4) capture('dry');
    if(!images.overtopping && bilge.volume>.016 && bilge.inFlight>.0025 && bilge.sheetsVisible)
      capture('overtopping',true);
    if(!images.slosh && state.time>4.54 && bilge.volume>.051 && !bilge.sheetsVisible)
      capture('slosh');
    if(!images.receded && state.time>8.38 && bilge.volume>.060 && Math.abs(bilge.volume-lastVolume)<1e-7)
      capture('receded');
    lastVolume=bilge.volume;
  }
  const final=__scene.mission().water;
  return {images,trace,firstSheet,firstPool,drainedAt,tugTime,beforePull,returningSheet,dryWarmup,peak,balance,minimum,lowX,highX,
    firstDeck,maxLeafWet,peakLift,wood:stats.woodContacts,final:final.skiff.bilge,exchange:final.simulation.skiffExchange,
    raster:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell=storm")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--tug-at", type=float, help="Pull the loaded skiff after this simulation time")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda e: errors.append(e.text) if e.type == "error" else None)
        page.route(args.url, expose_frame)
        page.route("**/bridge-water.js", expose_boat)
        page.route("**/bridge-canal-leaves.js", lambda route: expose_leaves(route, False))
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("__scene?.mission()?.water.skiff?.wetting.updates>4", timeout=35000)
        result = page.evaluate(AUDIT, {"install": INSTALL, "tugAt": args.tug_at})
        if args.record:
            movie = browser.new_page(viewport={"width": 1920, "height": 1080})
            movie.goto(args.url, wait_until="domcontentloaded", timeout=65000)
            movie.wait_for_function("__scene?.mission()?.water.skiff?.wetting.updates>4", timeout=35000)
            movie.evaluate("async install=>{await eval(install)();}",INSTALL)
            recorder=RECORD.replace("now-start>4400", "now-start>9600")
            (args.out/"wave-packet.webm").write_bytes(base64.b64decode(movie.evaluate(recorder)))
    images = result.pop("images")
    for name, data in images.items():
        (args.out/f"{name}-4k.jpg").write_bytes(base64.b64decode(data))
    result["errors"] = errors
    if "overtopping" in images:
        pair = Image.new("RGB", (2000, 562))
        pixels = []
        for i, name in enumerate(("overtopping-off", "overtopping")):
            raw = Image.open(BytesIO(base64.b64decode(images[name]))).convert("RGB")
            pair.paste(raw.resize((1000, 562), Image.Resampling.LANCZOS), (1000*i, 0))
            pixels.append(np.asarray(raw, dtype=np.int16))
        pair.save(args.out/"same-frame.jpg", quality=95)
        result["changedPixels"] = int((np.abs(pixels[0]-pixels[1]).max(2)>12).sum())
    (args.out/"skiff-bilge.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({k:v for k,v in result.items() if k!="trace"}),flush=True)
    assert errors==[] and result["raster"]==[3840,2160],errors
    assert result["dryWarmup"]>5 and result["firstSheet"]<result["firstPool"],result
    assert result["peak"]>.080,result
    if args.tug_at is None:
        # A closed skiff retains most of the water once the exterior packet
        # recedes. Check that a natural slosh still transfers real volume.
        assert result["final"]["discharged"]>.000015,result
    else:
        assert result["tugTime"] is not None and result["drainedAt"] is not None,result
        assert result["drainedAt"]>result["tugTime"],result
        assert result["final"]["discharged"]-result["beforePull"]>.0002,result
        if "sheetTransport" in result["final"]:
            assert result["returningSheet"]>0,result
    assert abs(result["exchange"]["intoBoat"]-result["final"]["incoming"])<1e-9,result
    assert abs(result["exchange"]["backToCanal"]-result["final"]["discharged"])<1e-9,result
    assert result["balance"]<1e-9 and result["minimum"]>-1e-9,result
    assert result["highX"]-result["lowX"]>.20,result
    assert result["firstDeck"] and result["peakLift"]>.004 and result["maxLeafWet"]>.37,result
    assert result["changedPixels"]>10000 and {"dry","overtopping","slosh","receded"}<=images.keys(),result


if __name__ == "__main__":
    main()
