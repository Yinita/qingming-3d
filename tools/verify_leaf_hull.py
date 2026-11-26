"""Check rendered floating willow blades against the skiff's real side triangles."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import subprocess
import tempfile

from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame


def expose_leaves(route, baseline=False):
    response=route.fetch()
    body=response.text()
    marker="  return { mesh:leaves, frame,"
    assert body.count(marker)==1
    if baseline and "const resolveHull=" in body:
        body=body.replace("    const hull=floating ? resolveHull(leaf,oldPosition,oldRotation,oldFlex,time,dt) : null;",
            "    const hull=null;")
        body=body.replace("      avoidPiers(leaf);","      avoidPiers(leaf,flow);")
        previous="  function avoidPiers(leaf) {\n    const {position:p,velocity:v,scale}=leaf;"
        assert body.count(previous)==1
        body=body.replace(previous,"""  function avoidPiers(leaf,horizontalTarget) {
    const {position:p,velocity:v,scale}=leaf;
    const hull=window.hullTestSkiff.wake;
    const boatX=p.x-hull.x, boatZ=p.z-hull.y;
    const bow=boatX*hull.z+boatZ*hull.w;
    const beam=boatX*hull.w-boatZ*hull.z;
    const reachAtBeam=.68-.42*smooth(Math.abs(bow),.41,1.64);
    if(Math.abs(bow)<1.78 && Math.abs(beam)<reachAtBeam) {
      const force=(beam>=0 ? 1 : -1)*(.37+.92*(reachAtBeam-Math.abs(beam)));
      horizontalTarget.x+=force*hull.w;
      horizontalTarget.y-=force*hull.z;
    }""")
    hook="  window.hullLeafFixture={leaf:data.at(-1),settle,frame,field,stats};\n"
    route.fulfill(response=response,body=body.replace(marker,hook+marker))


def expose_boat(route):
    response=route.fetch()
    body=response.text()
    marker="  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert body.count(marker)==1
    hook="  window.hullTestSkiff=skiff;\n"
    route.fulfill(response=response,body=body.replace(marker,hook+marker))


AUDIT = """async ({baseline,record})=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  renderer.setAnimationLoop(null);
  const {leaf,settle,frame,field,stats}=hullLeafFixture;
  const skiff=hullTestSkiff;
  const boat=scene.getObjectByName('Moored timber skiff');
  const blade=scene.getObjectByName('Floating and falling willow leaves');
  const skin=boat.children.filter(mesh=>mesh.isMesh);
  if(skin.length!==2) throw Error('Expected both rendered sides of the skiff');
  const {position}=blade.geometry.attributes;
  const vertices=Array.from({length:position.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(position,i));
  const {index}=blade.geometry;
  const wetClearance=field.height(skiff.wake.x,skiff.wake.y,__scene.mission().water.time);
  const ray=new THREE.Raycaster(), origin=new THREE.Vector3(), direction=new THREE.Vector3();
  const pose=new THREE.Matrix4();
  const points=vertices.map(v=>v.clone());
  const work=new THREE.Vector3(), touched=new THREE.Vector3();
  const inverse=new THREE.Matrix4();
  const approach=new THREE.Vector2();
  const saved=skin.map(mesh=>mesh.material.side);
  skin.forEach(mesh=>mesh.material.side=THREE.DoubleSide);
  const {height,velocity}=field;
  field.height=()=>wetClearance;
  field.velocity=(x,z,t,out)=>out.copy(approach);

  function seat(side,along,from){
    const out=new THREE.Vector2(skiff.wake.w,-skiff.wake.z).multiplyScalar(side);
    const axis=new THREE.Vector2(skiff.wake.z,skiff.wake.w);
    const x=skiff.wake.x+out.x*from+axis.x*along, z=skiff.wake.y+out.y*from+axis.y*along;
    const yaw=Math.atan2(out.x,out.y);
    leaf.position.set(x,wetClearance+.009,z);
    leaf.scale.set(.181,.282,.204);
    leaf.flex.set(.042,-.061,.036);
    leaf.orientation.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw).multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
    leaf.velocity.set(0,0,0);
    Object.assign(leaf,{mode:'water',wet:.94,id:-91,yaw,yawSpeed:0,began:0,onFilm:false,onDeck:false,
      stoneRest:false,stoneAt:-1,wakeAt:-1,pulseAt:-1});
    return {out,axis};
  }

  function clearance(side){
    blade.getMatrixAt(leaf.index,pose);
    inverse.copy(boat.matrixWorld).invert();
    const flex=blade.geometry.attributes.bladeFlex;
    const f=[flex.getX(leaf.index),flex.getY(leaf.index),flex.getZ(leaf.index)];
    for(let i=0;i<points.length;i++) {
      const vertex=vertices[i], y=vertex.y+.47;
      points[i].copy(vertex);
      points[i].z+=y*(y*f[0]+vertex.x*f[1]);
      points[i].x+=y*y*f[2];
      points[i].applyMatrix4(pose).applyMatrix4(inverse);
    }
    let deepest=0, count=0, peak=Infinity;
    const candidates=points.slice();
    for(let i=0;i<index.count;i+=3) candidates.push(points[index.getX(i)].clone().add(points[index.getX(i+1)])
      .add(points[index.getX(i+2)]).multiplyScalar(1/3));
    for(const point of candidates){
      origin.set(side*1.1,point.y,point.z).applyMatrix4(boat.matrixWorld);
      direction.set(-side,0,0).transformDirection(boat.matrixWorld);
      ray.set(origin,direction);
      const hits=ray.intersectObjects(skin,false);
      if(!hits.length)continue;
      touched.copy(hits[0].point).applyMatrix4(inverse);
      const distance=side*(point.x-touched.x);
      deepest=Math.max(deepest,-distance);
      peak=Math.min(peak,distance);
      count++;
    }
    return {deepest,count,nearest:Number.isFinite(peak) ? peak : null};
  }

  try {
    const state=__scene.mission().water;
    const earlierRipples=stats.hullContacts?.ripples ?? 0;
    const side=1;
    const {out,axis}=seat(side,.05,.68);
    approach.copy(out).multiplyScalar(-.87).addScaledVector(axis,.36);
    leaf.velocity.set(approach.x,0,approach.y);
    const trace=[];
    for(let step=0;step<38;step++){
      const time=state.time+(step+1)/60;
      settle(leaf,time,1/60);
      frame(time,0);
      const gap=clearance(side);
      work.copy(leaf.position).applyMatrix4(inverse);
      trace.push({time,position:work.toArray(),yaw:leaf.yaw,yawSpeed:leaf.yawSpeed,...gap});
    }
    const result={trace,maximum:Math.max(...trace.map(row=>row.deepest)),
      checked:trace.reduce((total,row)=>total+row.count,0),contacts:stats.hullContacts ?
        JSON.parse(JSON.stringify(stats.hullContacts)) : null,
      fixedRipples:(stats.hullContacts?.ripples ?? 0)-earlierRipples};
    if(baseline) return result;
    field.height=height;
    const turnSide=Math.sign((skiff.anchor.x-skiff.wake.x)*skiff.wake.w-(skiff.anchor.z-skiff.wake.y)*skiff.wake.z);
    const setup=seat(turnSide,.20,.585);
    leaf.position.y=height(leaf.position.x,leaf.position.z,state.time)+.010;
    approach.copy(setup.out).multiplyScalar(-.012).addScaledVector(setup.axis,.042);
    leaf.velocity.set(approach.x,0,approach.y);
    skiff.tug(state.time);
    const initialBoat=skiff.wake.clone(), initialLeaf=leaf.position.clone();
    const earlier=new Set(stats.hullContacts.events);
    const camera=persp.updateMatrixWorld.bind(persp);
    persp.updateMatrixWorld=force=>{
      const n=leaf.position;
      persp.position.set(n.x+setup.out.x*.97-setup.axis.x*.55,n.y+.47,n.z+setup.out.y*.97-setup.axis.y*.55);
      persp.lookAt(n.x-setup.out.x*.080,n.y-.014,n.z-setup.out.y*.080);
      return camera(force);
    };
    persp.fov=44;
    persp.updateProjectionMatrix();
    for(const id of ['missionHud','missionWaypoint','seal']) {
      const label=document.getElementById(id);if(label) label.style.display='none';
    }
    leafClock.getDelta=()=>1/60;
    let timestamp=performance.now();
    const motion=[];
    const pictures=[], movie=[];
    const video=record ? document.createElement('canvas') : null;
    if(video) {video.width=1920;video.height=1080;}
    const context=video?.getContext('2d',{alpha:false});
    for(let i=0;i<105;i++) {
      skin.forEach((mesh,j)=>mesh.material.side=saved[j]);
      leafFrame(timestamp+=1000/60);
      skin.forEach(mesh=>mesh.material.side=THREE.DoubleSide);
      const gap=clearance(turnSide), now=__scene.mission().water.time;
      const boatTravel=Math.hypot(skiff.wake.x-initialBoat.x,skiff.wake.y-initialBoat.y);
      const leafTravel=(leaf.position.x-initialLeaf.x)*setup.out.x+(leaf.position.z-initialLeaf.z)*setup.out.y;
      const above=leaf.position.y-height(leaf.position.x,leaf.position.z,now);
      motion.push({time:now,boatTravel,leafTravel,above,...gap});
      const contacts=stats.hullContacts.events.filter(event=>event.index===leaf.index && !earlier.has(event));
      if((i===2 || (pictures.length<2 && contacts.length) || i===90) && pictures.length<3)
        pictures.push(renderer.domElement.toDataURL('image/jpeg',.96).split(',')[1]);
      if(context && i%2===0){
        context.drawImage(renderer.domElement,0,0,video.width,video.height);
        movie.push(video.toDataURL('image/jpeg',.90).split(',')[1]);
      }
    }
    const contacts=stats.hullContacts.events.filter(event=>event.index===leaf.index && !earlier.has(event));
    return {...result,motion,contactsDuringTug:contacts,pictures,movie,fixtureIndex:leaf.index};
  } finally {
    field.height=height;field.velocity=velocity;
    skin.forEach((mesh,i)=>mesh.material.side=saved[i]);
  }
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--baseline",action="store_true")
    parser.add_argument("--record",action="store_true")
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
        page.route("**/bridge-canal-leaves.js",lambda route:expose_leaves(route,args.baseline))
        page.route(args.url,expose_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.foam?.passes>3",timeout=25000)
        result=page.evaluate(AUDIT,{"baseline":args.baseline,"record":args.record})
        browser.close()
    if not args.baseline:
        for i,encoded in enumerate(result.pop("pictures")):
            image=Image.open(BytesIO(base64.b64decode(encoded))).convert("RGB")
            image.save(args.out/f"skiff-leaf-{i+1}.jpg",quality=95)
        movie=result.pop("movie")
        if movie:
            with tempfile.TemporaryDirectory(prefix="qingming-leaf-hull-") as frames:
                for i,encoded in enumerate(movie):
                    (Path(frames)/f"{i:03d}.jpg").write_bytes(base64.b64decode(encoded))
                subprocess.run(["ffmpeg","-loglevel","error","-y","-framerate","30","-i",str(Path(frames)/"%03d.jpg"),
                    "-c:v","libx264","-threads","2","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart",
                    str(args.out/"skiff-leaf.mp4")],check=True)
    (args.out/"hull-contact.json").write_text(json.dumps({**result,"errors":errors},indent=2)+"\n")
    print(json.dumps({"maximum":result["maximum"],"checked":result["checked"],
        "contacts":result["contacts"]["hits"] if result["contacts"] else 0}),flush=True)
    assert not errors and result["checked"]>1000,errors or result["checked"]
    if args.baseline:
        assert result["maximum"]>.012,result["maximum"]
    else:
        assert result["maximum"]<.0015,result["maximum"]
        assert result["contacts"]["hits"]>0,result["contacts"]
        fixed=[event for event in result["contacts"]["events"] if event["index"]==result["fixtureIndex"]]
        assert len(fixed)>2 and max(abs(event["yaw"]) for event in fixed)>.055,fixed
        assert result["fixedRipples"]>0,result["fixedRipples"]
        assert result["trace"][-1]["position"][2]-result["trace"][0]["position"][2]>.095,result["trace"]
        motion=result["motion"]
        moving={"maximum":max(row["deepest"] for row in motion),"boat":max(row["boatTravel"] for row in motion),
            "leaf":max(row["leafTravel"] for row in motion),"rise":max(row["above"] for row in motion),
            "contacts":len(result["contactsDuringTug"]),"checked":sum(row["count"] for row in motion)}
        print(json.dumps(moving),flush=True)
        assert moving["boat"]>.18 and moving["leaf"]>.055 and moving["contacts"]>0,moving
        assert moving["checked"]>1000 and moving["maximum"]<.002 and moving["rise"]<.075,moving


if __name__=="__main__":
    main()
