"""Replay a strong wave and isolate skiff refraction, sheet thickness and impact spray."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_flight_contact import expose_boat, expose_leaves
from verify_rain_wave_packets import expose_paused_frame
from verify_skiff_bilge import INSTALL


REPLAY = """async({install,enhanced,releaseTick,tearTick})=>{
  const {THREE,renderer,scene,persp,boat,group}=await eval(install)();
  const {leaf}=flightFixture, {skiff}=flightSkiff;
  const sheet=group.getObjectByName('Water spilling across the skiff gunwale');
  const pool=group.getObjectByName('Water pooled inside the skiff');
  const spray=group.getObjectByName('Ballistic splashes inside the skiff');
  const gl=renderer.getContext();
  const photos={},trajectory=[],checks={},transport=[],tears=[];
  const position=new THREE.Vector3(), localEye=new THREE.Vector3(-1.52,1.18,-.76);
  const localAim=new THREE.Vector3(.04,.11,.13);
  const cameraUpdate=THREE.PerspectiveCamera.prototype.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    persp.position.copy(boat.localToWorld(position.copy(localEye)));
    persp.lookAt(boat.localToWorld(position.copy(localAim)));
    return cameraUpdate(force);
  };
  leafClock.getDelta=()=>1/60;
  let tick=0, peak=0, firstDeposit=null, firstSpray=null, releaseScore=0, tearScore=0;
  function step() {
    leafFrame(++tick*1000/60);
    return __scene.mission().water;
  }
  const photo=()=>renderer.domElement.toDataURL('image/jpeg',.96).split(',')[1];
  function modified(names,transform) {
    const original=names.map(mesh=>mesh.material.fragmentShader);
    const shadow=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    try {
      names.forEach((mesh,i)=>{
        mesh.material.fragmentShader=transform(original[i]);
        mesh.material.needsUpdate=true;
      });
      renderer.render(scene,persp);
      return photo();
    } finally {
      names.forEach((mesh,i)=>{
        mesh.material.fragmentShader=original[i];
        mesh.material.needsUpdate=true;
      });
      renderer.shadowMap.autoUpdate=shadow;
    }
  }

  while(tick<53) step();
  leaf.position.set(-.026,.19,.57).applyMatrix4(boat.matrixWorld);
  leaf.scale.set(.175,.265,.202);
  leaf.flex.set(.016,-.033,.008);
  leaf.orientation.setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  leaf.velocity.set(0,-.30,0);
  leaf.spin.set(0,0,0);
  leaf.flexRate.set(0,0,0);
  Object.assign(leaf,{mode:'air',wet:0,id:-90,began:tick/60,onDeck:false,onFilm:false,stoneRest:false,
    broadside:null,disturbed:false,attachment:null,lastWoodAt:tick/60});
  window.flightAirFixture=window.deckWindFixture=[0,0];

  while(tick<381) {
    if(tick===295) {
      localEye.set(-.62,.70,.59);
      localAim.set(.38,.18,.96);
      persp.fov=42;
      persp.updateProjectionMatrix();
    }
    if(tick===335) {
      persp.fov=48;
      persp.updateProjectionMatrix();
      localEye.set(-1.83,1.38,.17);
      localAim.set(.02,.08,.07);
    }
    const state=step(), b=state.skiff.bilge;
    peak=Math.max(peak,b.volume);
    if(firstDeposit===null && b.volume>.00001) firstDeposit=state.time;
    if(firstSpray===null && b.spray?.spawned>0) firstSpray=state.time;
    if(tick===54) checks.dry=b.optics?.passes;
    if(tick%10===0) trajectory.push({time:state.time,volume:b.volume,pending:b.inFlight,
      incoming:b.incoming,spent:b.discharged,position:state.skiff.position,rotation:state.skiff.rotation,
      leaf:leaf.position.toArray()});
    if(b.sheetTransport && enhanced) {
      const {incomingVolume,outgoingVolume,detached,gaps}=b.sheetTransport;
      transport.push({tick,time:state.time,incomingVolume,outgoingVolume,detached,gaps,
        simulatedInFlight:b.inFlight,gauge:b.sheetGauge});
      const score=detached>0 ? detached + Math.min(.95,incomingVolume*32) : 0;
      if(score>releaseScore) {
        releaseScore=score;
        releaseTick=tick;
        photos.release=photo();
        checks.release={time:state.time,detached,gaps,incomingVolume};
      }
    }
    if(enhanced && b.breakup) {
      const {nodes,rims,openings}=b.breakup;
      const {torn,divided,returned,woodHits,lastTear}=b.spray.fragments;
      tears.push({time:state.time,tick,nodes,rims,openings,torn,divided,returned,woodHits});
      if(tick>=297 && tick<=334 && nodes>0) {
        const score=nodes+rims*.29;
        if(score>tearScore) {
          tearScore=score;
          tearTick=tick;
          photos.tear=photo();
          checks.tear={time:state.time,nodes,rims,openings,torn,divided,lastTear};
        }
      }
    }
    if(!enhanced && tick===releaseTick) photos.release=photo();
    if(!enhanced && tick===tearTick) photos.tear=photo();
    const key={174:'arrival',236:'crest',243:'spray',282:'pool',327:'fringe',340:'side'}[tick];
    if(!key) continue;
    photos[key]=photo();
    checks[key]={time:state.time,volume:b.volume,pending:b.inFlight,sheetGauge:b.sheetGauge,
      activeSpans:b.runningSpans,spray:b.spray,optics:b.optics};
    if(!enhanced) continue;
    if(key==='pool') {
      photos.straightTransmission=modified([pool,sheet],source=>{
        const marker='worldPoint+shift';
        if(!source.includes(marker)) throw Error('Missing transmission shift');
        return source.replace(marker,'worldPoint');
      });
    }
    if(key==='spray' && spray?.count) {
      spray.visible=false;
      try {
        renderer.render(scene,persp);
        photos.withoutSpray=photo();
      } finally { spray.visible=true; }
    }
    if(key==='crest' && sheet.visible) {
      const {index,attributes}=sheet.geometry;
      const stripVertices=sheet.geometry.userData.stripVertices ?? 105, layout=2*stripVertices;
      let widest=0, maxGaugeError=0, weldedFaces=0;
      for(let i=0;i<index.count;i++) {
        const n=index.getX(i), k=n%layout<stripVertices ? n : n-stripVertices;
        const {position,waterDepth}=attributes;
        const width=Math.hypot(position.getX(k)-position.getX(k+stripVertices),
          position.getY(k)-position.getY(k+stripVertices),position.getZ(k)-position.getZ(k+stripVertices));
        widest=Math.max(widest,width);
        maxGaugeError=Math.max(maxGaugeError,Math.abs(width-waterDepth.getX(k)));
      }
      for(let i=0;i<index.count;i+=3) {
        const a=Math.floor(index.getX(i)/layout), b=Math.floor(index.getX(i+1)/layout);
        const c=Math.floor(index.getX(i+2)/layout);
        weldedFaces+=Number(a!==b || b!==c);
      }
      checks.shell={widest,maxGaugeError,weldedFaces,indexCount:index.count};
    }
  }

  const final=__scene.mission().water.skiff.bilge;
  if(enhanced) {
    const before=final.optics.passes;
    localEye.set(-18,3,-4);
    step();
    checks.distant=__scene.mission().water.skiff.bilge.optics.passes-before;
  }
  return {photos,trajectory,checks,firstDeposit,firstSpray,peak,transport,releaseTick,tears,tearTick,
    raster:[gl.drawingBufferWidth,gl.drawingBufferHeight],error:gl.getError(),
    final};
}"""


def disable_sheet_breakup(route):
    response=route.fetch()
    source=response.text()
    opening="if(inward && t>.2 && t<.95 && baseThickness>.00125) {"
    assert source.count(opening)==1
    route.fulfill(response=response,body=source.replace(opening,"if(false) {"))


def read_picture(encoded):
    return Image.open(BytesIO(base64.b64decode(encoded))).convert("RGB")


def save_pair(out, name, left, right):
    pictures = [read_picture(left), read_picture(right)]
    assert all(p.size==(3840,2160) for p in pictures)
    delta=np.abs(np.asarray(pictures[0],dtype=np.int16)-np.asarray(pictures[1],dtype=np.int16)).max(axis=2)
    preview=Image.new("RGB",(1920,540))
    for i,picture in enumerate(pictures):
        preview.paste(picture.resize((960,540),Image.Resampling.LANCZOS),(960*i,0))
    preview.save(out/f"{name}-comparison.jpg",quality=94)
    pictures[1].save(out/f"{name}-4k.jpg",quality=95)
    return {"above8":int((delta>=8).sum()),"mean":float(delta.mean())}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell=storm")
    parser.add_argument("--reference",required=True)
    parser.add_argument("--isolate-breakup",action="store_true",
        help="Disable only fracture and fragments on the reference page")
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        results=[]
        for enhanced,url in ((True,args.url),(False,args.reference)):
            page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
            page.on("pageerror",lambda error:errors.append(str(error)))
            page.on("console",lambda row:errors.append(row.text)
                if row.type=="error" or "GL_INVALID" in row.text else None)
            page.route(url,expose_paused_frame)
            page.route("**/bridge-water.js",expose_boat)
            page.route("**/bridge-canal-leaves.js",lambda route:expose_leaves(route,False))
            if args.isolate_breakup and not enhanced:
                page.route("**/bridge-bilge.js",disable_sheet_breakup)
            page.goto(url,wait_until="networkidle",timeout=65000)
            page.wait_for_function("""window.__scene && window.flightFixture &&
              __scene.scene.getObjectByName('Moored timber skiff').children.some(o=>o.material?.userData.surfaceReady) &&
              __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            results.append(page.evaluate(REPLAY,{"install":INSTALL,"enhanced":enhanced,
                "releaseTick":None if enhanced else results[0]["releaseTick"],
                "tearTick":None if enhanced else results[0]["tearTick"]}))
            page.close()
        browser.close()
    after,before=results
    left,right=before.pop("photos"),after.pop("photos")
    frames={name:save_pair(args.out,name,left[name],right[name]) for name in left}
    frames["refraction"]=save_pair(args.out,"refraction",right["straightTransmission"],right["pool"])
    if "withoutSpray" in right:
        frames["splash"]=save_pair(args.out,"splash",right["withoutSpray"],right["spray"])
    phase_delta=max(abs(a["volume"]-b["volume"]) for a,b in zip(before["trajectory"],after["trajectory"]))
    spilling=after["transport"]
    transport_error=max(abs(row["incomingVolume"]-row["simulatedInFlight"]) for row in spilling)
    detached_frames=sum(row["detached"]>0 for row in spilling)
    report={"before":before,"after":after,"frames":frames,"volumeDelta":phase_delta,
        "transportError":transport_error,"detachedFrames":detached_frames,
        "isolatedBreakup":args.isolate_breakup,"errors":errors}
    (args.out/"bilge-volume.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({"frames":frames,"volumeDelta":phase_delta,"checks":after["checks"],"errors":errors}),flush=True)
    assert not errors and before["error"]==after["error"]==0,report
    assert before["raster"]==after["raster"]==[3840,2160],report
    assert all(a==b for a,b in zip(before["trajectory"],after["trajectory"])),phase_delta
    assert after["checks"]["dry"]==after["checks"]["distant"]==0,after["checks"]
    assert after["checks"]["shell"]["widest"]>.006 and after["checks"]["shell"]["maxGaugeError"]<2e-7,after["checks"]
    spray=after["final"]["spray"]
    assert after["firstDeposit"]<=after["firstSpray"] and spray["returned"]>0 and spray["woodHits"]>0,spray
    assert frames["refraction"]["above8"]>600 and frames["splash"]["above8"]>200,frames
    assert transport_error<1e-12 and detached_frames>5,(transport_error,detached_frames)
    assert frames["release"]["above8"]>1000,frames["release"]
    if after["tears"]:
        tear=after["final"]["spray"]["fragments"]
        assert tear["torn"]==after["final"]["breakup"]["openings"] and tear["torn"]>15,tear
        assert tear["divided"]>5 and tear["returned"]>10 and tear["woodHits"]>0,tear
        assert tear["lastTear"]["velocity"][1]<0,tear
        assert after["checks"]["shell"]["weldedFaces"]>30,after["checks"]["shell"]
        assert after["checks"]["tear"]["nodes"]>0 and frames["tear"]["above8"]>1000,frames
        if args.isolate_breakup:
            assert before["final"]["spray"]["fragments"]["torn"]==0, before["final"]["spray"]


if __name__=="__main__":
    main()
