"""Drop the production willow blade onto a skiff bench and a bridge rail."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def expose_leaves(route, baseline):
    response=route.fetch()
    source=response.text()
    marker="  return { mesh:leaves, frame,"
    assert source.count(marker)==1
    hook=("  window.flightFixture={leaf:data.at(-1),falling,frame,field,stats,"
        "followDeck:typeof followDeck==='function' ? followDeck : null,settle};\n")
    sample="    airFromMap(leaf.position.x,leaf.position.z,air,0,leaf.position.y);"
    if sample in source:
        source=source.replace(sample,
            "    if(window.deckWindFixture) air.set(...window.deckWindFixture);\n"
            "    else "+sample.lstrip())
    sample="    airFromMap(p.x,p.z,air,0,p.y);"
    if sample in source:
        source=source.replace(sample,
            "    if(window.flightAirFixture) air.set(...window.flightAirFixture);\n"
            "    else "+sample.lstrip())
    if baseline:
        for line in (
            '    consider(bridgeSolver.resolve(leaf,oldPosition,oldRotation,oldFlex,dt,false),"bridge");\n',
            '    consider(resolveHull(leaf,oldPosition,oldRotation,oldFlex,time,dt,true),"skiff");\n',
        ):
            assert source.count(line)==1
            source=source.replace(line,"")
    route.fulfill(response=response,body=source.replace(marker,hook+marker))


def expose_boat(route):
    response=route.fetch()
    source=response.text()
    marker="  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert source.count(marker)==1
    route.fulfill(response=response,body=source.replace(marker,"  window.flightSkiff={skiff,field};\n"+marker))


AUDIT = """async({baseline,photos})=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  renderer.setAnimationLoop(null);
  const {leaf,falling,followDeck,settle,frame,stats}=flightFixture;
  const {skiff,field}=flightSkiff;
  const boat=scene.getObjectByName('Moored timber skiff');
  const deck=scene.getObjectByName('Wooden bridge deck');
  const sleeve=deck.parent.children.find(mesh=>mesh.isMesh && mesh!==deck && mesh.layers.isEnabled(1));
  const blade=scene.getObjectByName('Floating and falling willow leaves');
  const shadow=scene.getObjectByName('Willow leaf contact shadows on wood');
  const vertices=Array.from({length:blade.geometry.attributes.position.count},(_,i)=>
    new THREE.Vector3().fromBufferAttribute(blade.geometry.attributes.position,i));
  const world=new THREE.Vector3(), down=new THREE.Vector3(0,-1,0), probe=new THREE.Vector3();
  const intoBoat=new THREE.Matrix4(), local=new THREE.Vector3(), vertical=new THREE.Vector3();
  const ray=new THREE.Raycaster();
  const bladeMatrix=new THREE.Matrix4();
  const axes=new THREE.Vector3(1,0,0);
  const flat=new THREE.Quaternion().setFromAxisAngle(axes,-Math.PI/2);
  function surface(meshes,x,z) {
    ray.set(probe.set(x,5,z),down);
    return ray.intersectObjects(meshes,false)[0]?.point.y ?? -Infinity;
  }
  function seat(x,y,z) {
    leaf.position.set(x,y,z);
    leaf.scale.set(.184,.276,.211);
    leaf.flex.set(.036,-.051,.031);
    leaf.orientation.copy(flat);
    leaf.velocity.set(0,-1.24,0);
    leaf.spin.set(.37,.12,.21);
    leaf.flexRate.set(0,0,0);
    Object.assign(leaf,{mode:'air',wet:0,id:-92,began:0,onDeck:false,onFilm:false,stoneRest:false,
      broadside:null,disturbed:false,attachment:null,lastWoodAt:-Infinity});
  }
  function benchClearance(meshes,world) {
    local.copy(world).applyMatrix4(intoBoat);
    const y=local.y;
    probe.set(local.x,.59,local.z).applyMatrix4(boat.matrixWorld);
    ray.set(probe,vertical.copy(down).transformDirection(boat.matrixWorld));
    for(const hit of ray.intersectObjects(meshes,false)) {
      local.copy(hit.point).applyMatrix4(intoBoat);
      // The midpoint seat occupies z = .05 ± .086 in the rendered hull. The
      // oar can be above a blade over this seat when viewed vertically.
      if(local.y>=.209 && local.y<=.225 && Math.abs(local.z-.05)<=.0861) return y-local.y;
    }
    return Infinity;
  }
  function measure(meshes,bench=false) {
    blade.getMatrixAt(leaf.index,bladeMatrix);
    if(bench) intoBoat.copy(boat.matrixWorld).invert();
    const f=blade.geometry.attributes.bladeFlex;
    const u=f.getX(leaf.index),v=f.getY(leaf.index),w=f.getZ(leaf.index);
    let minimum=Infinity,covered=0;
    for(const raw of vertices) {
      const y=raw.y+.47;
      world.copy(raw);
      world.x+=y*y*w;
      world.z+=y*(y*u+raw.x*v);
      world.applyMatrix4(bladeMatrix);
      const gap=bench ? benchClearance(meshes,world) : world.y-surface(meshes,world.x,world.z);
      if(!Number.isFinite(gap)) continue;
      minimum=Math.min(minimum,gap);
      covered++;
    }
    return {gap:Number.isFinite(minimum) ? minimum : null,covered};
  }
  const start=__scene.mission().water.time;
  function drop(kind,meshes,x,z,offset,t0=start) {
    const y=surface(meshes,x,z);
    if(!Number.isFinite(y)) throw Error('Expected visible wood in the '+kind+' fixture');
    seat(x,y+offset,z);
    const trace=[];
    const previousEvents=new Set(stats.events??[]);
    for(let i=0;i<53;i++) {
      const time=t0+(i+1)/60;
      if(leaf.mode==='air') falling(leaf,time,1/60);
      frame(time,0);
      const check=measure(meshes);
      trace.push({time,mode:leaf.mode,position:leaf.position.toArray(),...check});
    }
    const events=(stats.events??[]).filter(event=>event.index===leaf.index&&!previousEvents.has(event));
    return {surface:y,trace,finalMode:leaf.mode,events,
      minimum:Math.min(...trace.filter(row=>row.gap!==null).map(row=>row.gap))};
  }
  world.set(0,.22,.05).applyMatrix4(boat.matrixWorld);
  const hullParts=boat.children.filter(m=>m.isMesh);
  window.flightAirFixture=[.62,.31];
  const skiffDrop=drop('skiff',hullParts,world.x,world.z,.43);
  const bounds=new THREE.Box3().setFromObject(deck);
  const x=(bounds.min.x+bounds.max.x)*.5-.56, z=bounds.max.z-.060;
  const images={};
  function capture(name,offset,shift) {
    if(!photos) return;
    for(const id of ['missionHud','missionWaypoint','missionIntro','seal']) {
      const node=document.getElementById(id);
      if(node) node.style.display='none';
    }
    const p=leaf.position;
    persp.fov=38;
    persp.position.set(p.x+offset[0],p.y+offset[1],p.z+offset[2]);
    persp.lookAt(p.x+shift[0],p.y+shift[1],p.z+shift[2]);
    persp.updateProjectionMatrix();
    renderer.render(scene,persp);
    images[name]=renderer.domElement.toDataURL('image/jpeg',.94).split(',')[1];
  }
  if(baseline || leaf.mode!=='deck') {
    return {skiff:skiffDrop,bridge:drop('bridge rail',[sleeve],x,z,.43)};
  }
  window.deckWindFixture=[0,0];
  let time=start+53/60;
  const before=boat.position.clone(), bladeStart=leaf.position.clone(), angleStart=boat.quaternion.clone();
  const anchor=leaf.attachment.position.clone();
  const rotation=leaf.attachment.rotation.clone();
  const skiffRide=[];
  const worldAnchor=new THREE.Vector3(), drawn=new THREE.Vector3();
  skiff.tug(time);
  for(let i=1;i<=99;i++) {
    time+=1/60;
    skiff.update(time,1/60,field);
    boat.updateMatrixWorld(true);
    if(leaf.mode==='deck') followDeck(leaf,time,1/60);
    else if(leaf.mode==='air') falling(leaf,time,1/60);
    frame(time,0);
    blade.getMatrixAt(leaf.index,bladeMatrix);
    drawn.setFromMatrixPosition(bladeMatrix);
    const attachment=leaf.attachment;
    if(attachment) worldAnchor.copy(attachment.position).applyMatrix4(boat.matrixWorld);
    skiffRide.push({time,mode:leaf.mode,carry:before.distanceTo(boat.position),angle:angleStart.angleTo(boat.quaternion),
      travel:drawn.distanceTo(bladeStart),error:attachment ? worldAnchor.distanceTo(drawn) : null,
      slip:attachment ? Math.hypot(attachment.position.x-anchor.x,attachment.position.z-anchor.z) : null,
      local:attachment?.position.toArray(), support:attachment?.planePoint.toArray(),
      settleAngle:attachment?.rotation.angleTo(rotation)??null,
      shade:shadow.visible ? shadow.geometry.drawRange.count/3 : 0,...measure(hullParts,true)});
    if(i===37) capture('01-leaf-on-skiff-bench-4k',[.65,.45,.55],[-.07,-.025,-.02]);
  }
  const bridgeDrop=drop('bridge rail',[sleeve],x,z,.43,time);
  time+=53/60;
  window.flightAirFixture=[0,0];
  const supportedRail=drop('rail span',[sleeve],x+1.15,z+.072,.37,time);
  time+=53/60;
  delete window.flightAirFixture;
  const trace=[], railStart=leaf.position.clone(), railSlideBefore=stats.woodContacts.slideMetres;
  const beforeGust=new Set(stats.events);
  let edge=null, downstream=null;
  for(let i=1;i<=450;i++) {
    time+=1/60;
    window.deckWindFixture=[0,0.38+5.6*THREE.MathUtils.smoothstep(i,39,81)];
    const mode=leaf.mode;
    if(mode==='deck') followDeck(leaf,time,1/60);
    else if(mode==='air') falling(leaf,time,1/60);
    else if(mode==='water') settle(leaf,time,1/60);
    frame(time,0);
    const moved=Math.hypot(leaf.position.x-railStart.x,leaf.position.z-railStart.z);
    if(i===38) capture('02-leaf-on-bridge-rail-4k',[.61,.31,.35],[0,-.017,0]);
    if(!edge && mode==='deck' && leaf.mode==='air') {
      edge={frame:i,time,position:leaf.position.toArray(),velocity:leaf.velocity.toArray(),moved};
      capture('03-leaf-leaving-rail-4k',[.61,.31,.35],[0,-.017,0]);
    }
    if(mode==='air' && leaf.mode==='water' && edge) {
      downstream={frame:i,time,position:leaf.position.toArray()};
      break;
    }
    trace.push({frame:i,time,mode:leaf.mode,moved,
      clearance:leaf.mode==='deck' ? measure([sleeve]).gap : null,
      shade:shadow.visible ? shadow.geometry.drawRange.count/3 : 0});
  }
  delete window.deckWindFixture;
  return {skiff:skiffDrop,bridge:bridgeDrop,skiffRide,supportedRail,
    railGust:{trace,edge,downstream,woodTravel:stats.woodContacts.slideMetres-railSlideBefore,
      events:stats.events.filter(event=>event.index===leaf.index&&!beforeGust.has(event))},
    size:[renderer.domElement.width,renderer.domElement.height],images};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--baseline",action="store_true")
    parser.add_argument("--photos",action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("console",lambda m:errors.append(m.text) if m.type=="error" else None)
        page.route("**/bridge-water.js",expose_boat)
        page.route("**/bridge-canal-leaves.js",lambda route: expose_leaves(route,args.baseline))
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.foam?.passes>3",timeout=25000)
        report=page.evaluate(AUDIT,dict(baseline=args.baseline,photos=args.photos))
        browser.close()
    for name,body in report.pop("images",{}).items():
        (args.out/(name+".jpg")).write_bytes(base64.b64decode(body))
    (args.out/"flight-contact.json").write_text(json.dumps({**report,"errors":errors},indent=2)+"\n")
    summary={kind:(report[kind]["surface"],report[kind]["minimum"],report[kind]["finalMode"])
        for kind in ("skiff","bridge")}
    print(json.dumps(summary),flush=True)
    assert not errors,errors
    if args.baseline:
        assert report["skiff"]["minimum"]<-.05 and report["bridge"]["minimum"]<-.10,summary
    else:
        assert all(gap>-.003 and mode=="deck" for _,gap,mode in summary.values()),summary
        ride=report["skiffRide"]
        ride_summary={key:max(row[key] for row in ride if row[key] is not None)
            for key in ("carry","angle","travel","error","slip","settleAngle","shade")}
        ride_summary["minGap"]=min(row["gap"] for row in ride if row["gap"] is not None)
        gust=report["railGust"]
        print(json.dumps(dict(skiff=ride_summary,edge=gust["edge"],water=gust["downstream"],
            woodTravel=gust["woodTravel"])),flush=True)
        assert report["size"]==[3840,2160]
        assert all(row["mode"]=="deck" and row["covered"]>40 for row in ride),ride_summary
        assert ride_summary["carry"]>.13 and ride_summary["travel"]>.11 and ride_summary["angle"]>.025,ride_summary
        assert ride_summary["error"]<3e-5 and ride_summary["minGap"]>-.003,ride_summary
        assert ride_summary["settleAngle"]>.045,ride_summary
        assert ride_summary["shade"]>10,ride_summary
        calm=[row for row in gust["trace"] if row["frame"]<=38]
        assert all(row["mode"]=="deck" for row in calm) and calm[-1]["moved"]<.024,calm[-1]
        assert any(row["shade"]>6 for row in calm),calm[-1]
        assert gust["edge"] and gust["downstream"] and gust["woodTravel"]>.022,gust["edge"]
        assert all(row["clearance"]>-.003 for row in gust["trace"] if row["clearance"] is not None)


if __name__=="__main__":
    main()
