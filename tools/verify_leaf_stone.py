"""Replay a real floating blade touching a bank rock and audit the drawn meshes."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import AUDIT as WATER_AUDIT
from verify_leaf_water import INSTALL_AUDIT, LIVE, VISIBLE_BLADE, expose_frame, expose_packets


FIND = """async ()=>{
  const {Quaternion,Vector3}=await import('three');
  const {leaf,stoneSolver,surface,settle,waterContact,stats,foliage}=leafStoneFixture;
  const time=__scene.mission().water.time;
  const up=new Vector3(0,1,0), anchor=new Vector3();
  const horizontal=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
  const trial={...leaf,position:anchor.clone(),scale:new Vector3(.163,.224,.184),
    velocity:new Vector3(),orientation:new Quaternion(),flex:new Vector3()};
  const saved={...stats,events:stats.events.slice()};
  const savedFoliage={...foliage,events:foliage.events.slice()};
  const {attach,emit}=waterContact;
  const sheet={};
  let packet=null;
  waterContact.attach=()=>{};
  waterContact.emit=(kind,index,x,z,at)=>{if(kind==='graze') packet={at};};
  const lanes=[[-.66,.42],[-.55,-.45],[-.78,.33]];
  const candidates=[];
  function place(blade,fixture) {
    const {x,y,z,yaw,vx,vz}=fixture;
    blade.position.set(x,y,z);
    blade.velocity.set(vx,0,vz);
    blade.orientation.setFromAxisAngle(up,yaw).multiply(horizontal);
    blade.scale.copy(trial.scale);
    blade.flex.set(.058,-.084,.051);
    Object.assign(blade,{yaw,yawSpeed:0,wet:.96,mode:'water',id:null,began:time,
      onDeck:false,onFilm:false,inRunoff:false,stoneRest:false,disturbed:false,
      stoneAt:-1,pulseAt:-1,wakeAt:-1});
  }
  try {
    for(let iz=0;iz<49;iz++) for(let ix=0;ix<43;ix++) {
      const x=-67.19+.024*ix,z=-48.31+.031*iz;
      surface(x,z,time,sheet);
      if(sheet.depth<.010 || sheet.height>.14) continue;
      const y=sheet.height+.010;
      if(!leafStoneFixture.stones.nearby(x,z,x-.075,z,.15,y-.028)) continue;
      for(const [vx,vz] of lanes) for(const yaw of [1.26,2.4,.75]) {
        const candidate={x,y,z,yaw,vx,vz};
        place(trial,candidate);
        stoneSolver.seat(trial);
        if(trial.position.y>y+.001) continue;
        stats.events.length=0;
        packet=null;
        for(let frame=1;frame<=13;frame++) {
          settle(trial,time+frame/60,1/60);
          const event=stats.events.at(-1);
          if(!event || !packet || Math.abs(packet.at-event.time)>.00001) continue;
          if(event.wet && event.normal[0]>.28 && event.rejected>.0032 && Math.abs(event.yaw)>.08) {
            candidates.push({candidate,score:event.rejected*Math.abs(event.yaw),frame});
          }
          break;
        }
      }
    }
  } finally {
    waterContact.attach=attach;
    waterContact.emit=emit;
    Object.assign(stats,saved);
    Object.assign(foliage,savedFoliage);
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(!candidates.length) throw Error('No renderable wet rock contact in the controlled fixture');
  window.placeLeafStone=fixture=>place(leaf,fixture);
  return candidates.slice(0,20);
}"""

PLAY = """cases=>{
  const {leaf}=leafStoneFixture;
  for(const {candidate} of cases) {
    placeLeafStone(candidate);
    const start=__scene.mission().water.time;
    const before=__scene.mission().water.leafWater.totals.graze;
    for(let i=0;i<16;i++) {
      leafStep();
      const {time,foliage,leafWater}=__scene.mission().water;
      const event=foliage.stoneContacts.events.at(-1), packet=leafWater.latest.graze;
      if(event?.index!==leaf.index || packet?.index!==leaf.index || time-event.time>.0001 ||
          event.time<=start || Math.abs(packet.time-event.time)>.0001 || leafWater.totals.graze<=before) continue;
      if(event.wet && event.rejected>.0032 && Math.abs(event.yaw)>.06) return {event,packet,candidate};
    }
  }
  throw Error('The wet leaf did not emit a contact wave on replay');
}"""


def expose_fixture(route):
    response=route.fetch()
    source=response.text()
    marker="  return { mesh:leaves, frame,"
    assert source.count(marker)==1
    source=source.replace(marker,"  window.leafStoneFixture={leaf:data.at(-1),surface,settle,waterContact,"
        "stats:stoneContacts,foliage:stats,stoneSolver,stones};\n"+marker)
    route.fulfill(response=response,body=source)

CAMERA = """event=>{
  const {scene,persp}=__scene;
  const blades=scene.getObjectByName('Floating and falling willow leaves');
  const matrix=blades.matrix.clone(), point=persp.position.clone();
  const [nx,,nz]=event.normal, axis=Math.hypot(nx,nz);
  const ox=.43*nx/axis+.11*nz/axis, oz=.43*nz/axis-.11*nx/axis;
  window.trackedBlade=event.index;
  window.lookAtLeafStone={ox,oz,index:event.index};
  if(!window.originalLeafView){
    window.originalLeafView=persp.updateMatrixWorld.bind(persp);
    persp.updateMatrixWorld=force=>{
      const view=window.lookAtLeafStone;
      blades.getMatrixAt(view.index,matrix);
      point.setFromMatrixPosition(matrix);
      persp.position.set(point.x+view.ox,Math.max(.25,point.y+.36),point.z+view.oz);
      persp.lookAt(point.x,point.y-.019,point.z);
      return originalLeafView(force);
    };
  }
  persp.fov=37;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld(true);
  document.querySelector('#missionHud').style.display='none';
  document.querySelector('#seal').style.display='none';
}"""

AUDIT = """async event=>{
  const THREE=await import('./vendor/three/build/three.module.js');
  const {renderer,scene,persp}=__scene;
  const blades=scene.getObjectByName('Floating and falling willow leaves');
  const stones=scene.getObjectByName('Damp shoreline stones');
  const current=new THREE.Matrix4(), matrix=new THREE.Matrix4();
  blades.getMatrixAt(event.index,current);
  const proposal=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(event.proposed),
    new THREE.Quaternion().fromArray(event.proposedOrientation),new THREE.Vector3().fromArray(event.scale));
  const geometry=blades.geometry, buffer=geometry.attributes.position;
  const flexAttribute=geometry.attributes.bladeFlex;
  const getFlex=i=>[flexAttribute.getX(i),flexAttribute.getY(i),flexAttribute.getZ(i)];
  const currentFlex=getFlex(event.index);
  const points=Array.from({length:buffer.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(buffer,i));
  const index=geometry.index;
  function surfaceSamples([bend,twist,lean]) {
    const vertices=points.map(point=>{
      const y=point.y+.47;
      return new THREE.Vector3(point.x+y*y*lean,point.y,point.z+y*(y*bend+point.x*twist));
    });
    const samples=vertices.slice();
    for(let i=0;i<index.count;i+=3) {
      const a=vertices[index.getX(i)],b=vertices[index.getX(i+1)],c=vertices[index.getX(i+2)];
      samples.push(a.clone().add(b).add(c).multiplyScalar(1/3));
      samples.push(a.clone().multiplyScalar(.6).addScaledVector(b,.2).addScaledVector(c,.2));
    }
    return samples;
  }
  const ray=new THREE.Raycaster(), down=new THREE.Vector3(0,-1,0), eye=new THREE.Vector3();
  const point=new THREE.Vector3(), leavesWorld=blades.matrixWorld;
  function intersect(x,z){
    ray.set(eye.set(x,.75,z),down);
    return ray.intersectObject(stones,false);
  }
  function clearance(pose,flex){
    let gap=Infinity,vertices=Infinity,rays=0,intrusions=0;
    const world=matrix.multiplyMatrices(leavesWorld,pose);
    const samples=surfaceSamples(flex);
    for(let i=0;i<samples.length;i++){
      point.copy(samples[i]).applyMatrix4(world);
      const hits=intersect(point.x,point.z);
      if(!hits.length)continue;
      let above=0,below=0,d=Infinity;
      for(const hit of hits) {
        const y=hit.point.y, facing=Math.sign(hit.face.normal.y);
        if(y>point.y) above+=facing;
        else below+=facing;
        d=Math.min(d,Math.abs(point.y-y));
      }
      if(above>0 && below<0) d=-d;
      gap=Math.min(gap,d);
      if(i<points.length)vertices=Math.min(vertices,d);
      rays++;
      intrusions+=Number(d<-.0015);
    }
    return {gap:Number.isFinite(gap) ? gap : null,vertices:Number.isFinite(vertices) ? vertices : null,rays,intrusions};
  }
  function findClearOverhang() {
    const {stones,surface}=leafStoneFixture;
    const {time}=__scene.mission().water;
    const water={};
    for(let i=0;i<36;i++) for(let j=0;j<44;j++) {
      const x=event.x-.09+i*.006,z=event.z-.13+j*.006;
      surface(x,z,time,water,false,.025);
      const y=water.height+.004;
      if(water.depth<.007 || stones.height(x,z)-y<.045) continue;
      const hits=intersect(x,z);
      if(!hits.length || hits.at(-1).point.y-y<.012) continue;
      const clearance=stones.separation(x,y,z,.0015);
      return {point:[x,y,z],upper:hits[0].point.y,underside:hits.at(-1).point.y,
        blocked:clearance<.0015,support:water.ground};
    }
    return null;
  }
  function snapshot(pose,flex){
    blades.setMatrixAt(event.index,pose);
    flexAttribute.setXYZ(event.index,...flex);
    flexAttribute.needsUpdate=true;
    blades.instanceMatrix.needsUpdate=true;
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  const sided=stones.material.side;
  stones.material.side=THREE.DoubleSide;
  let resolved,unresolved,overhang,neighbors=[];
  try {
    resolved=clearance(current,currentFlex);
    unresolved=clearance(proposal,event.proposedFlex);
    overhang=findClearOverhang();
    const pose=new THREE.Matrix4();
    for(let i=0;i<blades.count;i++) {
      if(i===event.index) continue;
      blades.getMatrixAt(i,pose);
      const [x,y,z]=pose.elements.slice(12,15);
      if(Math.hypot(x-event.x,z-event.z)>.45 || Math.abs(y-event.y)>.3 || pose.elements[0]**2+pose.elements[1]**2+pose.elements[2]**2<.0001) continue;
      neighbors.push({index:i,center:[x,y,z],...clearance(pose,getFlex(i))});
    }
  }
  finally {stones.material.side=sided;}
  const tracking=persp.updateMatrixWorld;
  persp.updateMatrixWorld=window.originalLeafView;
  let on,off;
  try {on=snapshot(current,currentFlex);off=snapshot(proposal,event.proposedFlex);}
  finally {
    blades.setMatrixAt(event.index,current);
    blades.instanceMatrix.needsUpdate=true;
    flexAttribute.setXYZ(event.index,...currentFlex);
    flexAttribute.needsUpdate=true;
    persp.updateMatrixWorld=tracking;
  }
  const offset=Math.hypot(event.position[0]-event.x,event.position[2]-event.z);
  return {resolved,unresolved,overhang,neighbors,pointOffset:offset,flex:currentFlex,
    samples:points.length+index.count/3*2,on,off};
}"""

RIPPLE = """async packet=>{
  const {Color}=await import('three');
  const layer=leafSlopes;
  const {target,footprint,heading,count}=layer;
  const {scene,persp,renderer}=__scene;
  const bounds=scene.getObjectByName('Canal surface').material.uniforms.leafSlopeBounds.value;
  const id=window.leafInstances.slice(0,count).findIndex(p=>
    p.index===packet.index && p.time===packet.time && p.type===3);
  if(id<0) throw Error('Missing graze pulse instance');
  const x=footprint.getX(id),z=footprint.getY(id);
  const half=48,side=2*half, pixelsInMetre=bounds.z*target.width;
  const ix=Math.round((x-bounds.x)*pixelsInMetre),iz=Math.round((z-bounds.y)*pixelsInMetre);
  const full=new Uint8Array(side*side*4), without=full.slice();
  const wasClear=renderer.autoClear,current=renderer.getRenderTarget();
  const alpha=renderer.getClearAlpha(), color=renderer.getClearColor(new Color());
  const strength=heading.getZ(id);
  function capillary(value) {
    heading.setZ(id,value);
    heading.needsUpdate=true;
    renderer.autoClear=false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0,0);
    renderer.clear(true,false,false);
    renderer.render(layer.scene,layer.camera);
    renderer.setRenderTarget(current);
    renderer.autoClear=wasClear;
    renderer.setClearColor(color,alpha);
  }
  function image() {
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/jpeg',.96).split(',')[1];
  }
  const on=image();
  renderer.readRenderTargetPixels(target,ix-half,iz-half,side,side,full);
  let off;
  try {
    capillary(0);
    renderer.readRenderTargetPixels(target,ix-half,iz-half,side,side,without);
    off=image();
  } finally {capillary(strength);}
  let outward=0,towardStone=0;
  for(let row=0;row<side;row++) for(let col=0;col<side;col++) {
    const p=(row*side+col)*4;
    const energy=Math.hypot(full[p]-full[p+1]-without[p]+without[p+1],full[p+2]-full[p+3]-without[p+2]+without[p+3]);
    const sideOfRock=(col-half)*packet.dx+(row-half)*packet.dz;
    if(sideOfRock>2) outward+=energy;
    if(sideOfRock< -2) towardStone+=energy;
  }
  return {outward,towardStone,on,off};
}"""

FOLLOW = """async ({index,record})=>{
  const {scene,renderer}=__scene;
  const blades=scene.getObjectByName('Floating and falling willow leaves');
  const matrix=blades.matrix.clone(), point=blades.position.clone(), last=point.clone();
  const first=blades.quaternion.clone(), turn=first.clone(), scale=point.clone();
  blades.getMatrixAt(index,matrix);
  matrix.decompose(last,first,scale);
  let travel=0,rotation=0,vertical=0,largestStep=0;
  let video=null,track=null,recorder=null,done=null;
  if(record) {
    video=document.createElement('canvas');
    video.width=1920;
    video.height=1080;
    const stream=video.captureStream(0), parts=[];
    track=stream.getVideoTracks()[0];
    recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:8500000});
    done=new Promise(resolve=>{
      recorder.ondataavailable=event=>parts.push(event.data);
      recorder.onstop=()=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(new Blob(parts,{type:recorder.mimeType}));
      };
    });
    recorder.start();
  }
  for(let i=0;i<38;i++) {
    if(record) await new Promise(resolve=>setTimeout(resolve,32));
    leafStep();
    if(record) {
      video.getContext('2d',{alpha:false}).drawImage(renderer.domElement,0,0,video.width,video.height);
      track.requestFrame();
    }
    blades.getMatrixAt(index,matrix);
    matrix.decompose(point,turn,scale);
    const step=point.distanceTo(last);
    travel+=step;
    largestStep=Math.max(largestStep,step);
    vertical=Math.max(vertical,Math.abs(point.y-last.y));
    rotation=Math.max(rotation,first.angleTo(turn));
    last.copy(point);
  }
  const state=__scene.mission().water;
  const {events,...contacts}=state.foliage.stoneContacts;
  recorder?.stop();
  const movie=record ? await done : null;
  track?.stop();
  return {travel,rotation,vertical,largestStep,contacts,graze:state.leafWater.totals.graze,movie};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out",required=True,type=Path)
    parser.add_argument("--record",action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda event:errors.append(event.text) if event.type=="error" else None)
        page.route(args.url,expose_frame)
        page.route("**/bridge-leaf-water.js",expose_packets)
        page.route("**/bridge-canal-leaves.js",expose_fixture)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.time>1.45 && window.leafStoneFixture",timeout=65000)
        page.evaluate(INSTALL_AUDIT)
        cases=page.evaluate(FIND)
        replay=page.evaluate(PLAY,cases)
        event,packet=replay["event"],replay["packet"]
        page.evaluate(CAMERA,event)
        visible=page.evaluate(VISIBLE_BLADE)
        audit=page.evaluate(AUDIT,event)
        images=[Image.open(BytesIO(base64.b64decode(audit.pop(key)))).convert("RGB") for key in ("on","off")]
        images[0].save(args.out/"01-blade-at-stone-4k.jpg",quality=95)
        crop=(1270,580,2570,1560)
        pair=Image.new("RGB",(2600,980))
        panels=[image.crop(crop) for image in images]
        for i,panel in enumerate(panels):
            pair.paste(panel,(1300*i,0))
        pair.save(args.out/"02-contact-same-frame.jpg",quality=96)
        delta=np.abs(np.asarray(panels[0],dtype=np.int16)-np.asarray(panels[1],dtype=np.int16))
        page.evaluate("()=>{for(let i=0;i<5;i++) leafStep();}")
        wave=page.evaluate(WATER_AUDIT,{**packet,"kind":"graze"})
        pulse=page.evaluate(RIPPLE,packet)
        pulse_images=[Image.open(BytesIO(base64.b64decode(pulse.pop(key)))).convert("RGB") for key in ("on","off")]
        pulse_images[0].save(args.out/"03-ripple-out-from-stone-4k.jpg",quality=95)
        pulse_crop=[image.crop(crop) for image in pulse_images]
        ripple_pair=Image.new("RGB",(2600,980))
        for i,panel in enumerate(pulse_crop):
            ripple_pair.paste(panel,(1300*i,0))
        ripple_pair.save(args.out/"04-contact-wave-same-frame.jpg",quality=96)
        ripple_diff=np.abs(np.asarray(pulse_crop[0],dtype=np.int16)-np.asarray(pulse_crop[1],dtype=np.int16))
        pulse["changedPixels"]=int((ripple_diff.max(2)>5).sum())
        audited={"initialConditions":replay["candidate"],"contact":event,"clearance":audit,
            "graze":{"packet":packet,"gpu":wave,"isolation":pulse},"changedPixels":int((delta.max(2)>5).sum()),
            "visibleBladePixels":visible}
        motion=page.evaluate(FOLLOW,{"index":event["index"],"record":args.record})
        movie=motion.pop("movie")
        if args.record:
            (args.out/"leaf-glancing-rock.webm").write_bytes(base64.b64decode(movie))
        # Drain the scripted replay's queued draws before sampling live frame intervals.
        page.evaluate("""()=>{
          __scene.renderer.getContext().finish();
          delete leafClock.getDelta;
          leafClock.oldTime=performance.now();
          __scene.renderer.setAnimationLoop(leafFrame);
        }""")
        page.wait_for_timeout(650)
        live=page.evaluate(LIVE)
        report={**audited,"motion":motion,"frames":{k:live[k] for k in ("device","p95","frames")},"errors":errors}
        (args.out/"leaf-stone-verification.json").write_text(json.dumps(report,indent=2)+"\n")
        assert not errors and live["device"]["resolution"]==[3840,2160],report
        assert audit["pointOffset"]>.02 and audit["unresolved"]["gap"] is not None and audit["unresolved"]["gap"]<-.003,audit
        assert audit["resolved"]["rays"]>0 and audit["resolved"]["intrusions"]==0,audit
        assert all(leaf["intrusions"]==0 for leaf in audit["neighbors"]),audit
        assert audit["overhang"] is not None and not audit["overhang"]["blocked"],audit
        assert visible>850 and audited["changedPixels"]>1500,report
        assert wave["instanceError"] is not None and wave["instanceError"]<.00004 and wave["strongest"]>15,wave
        assert pulse["outward"]>1000 and pulse["towardStone"]<pulse["outward"]*.07 and pulse["changedPixels"]>600,pulse
        assert motion["vertical"]<.068 and motion["rotation"]>.026 and live["p95"]<25,report
        browser.close()


if __name__=="__main__":
    main()
