"""Check macro refraction, foreground rejection, and the native drop budget."""

import argparse
import base64
from io import BytesIO
from pathlib import Path
import json

from PIL import Image
from playwright.sync_api import sync_playwright
from verify_leaf_water import expose_frame


CONTROL = """async()=>{
  const THREE=await import('three');
  const {createRainBeads}=await import('./bridge-rain-beads.js');
  const {renderer}=__scene;
  renderer.setAnimationLoop(null);
  const group=new THREE.Group(), scene=new THREE.Scene();
  scene.background=new THREE.Color(0x433d46);
  scene.add(group,new THREE.HemisphereLight(0xe9e9d5,0x736459,1.7));
  const camera=new THREE.PerspectiveCamera(47,innerWidth/innerHeight,.05,60);
  const radius=.012, plane=-.059, eye=.268, n=1.333;
  camera.position.set(0,0,eye);
  camera.lookAt(0,0,0);
  camera.updateMatrixWorld();
  const beads=createRainBeads(group);
  beads.begin();beads.append(0,0,0,radius);beads.commit();
  const mesh=group.children[0], amount=mesh.material.userData.beadLens.beadLensAmount;
  function field(w,h,color,x,z){
    const tile=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color}));
    tile.position.set(x,0,z);
    scene.add(tile);
    return tile;
  }
  field(.30,.22,0x26b9c1,-.15,plane);
  field(.30,.22,0xd16d32,.15,plane);
  // In the equatorial ray, the ellipsoid is a circle. Solve the two
  // interfaces independently from the fragment shader and choose a pixel.
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());
  const pixel=new THREE.Vector2(Math.floor(size.x/2+53),Math.floor(size.y/2));
  const ray=new THREE.Vector3(2*(pixel.x+.5)/size.x-1,2*(pixel.y+.5)/size.y-1,.8)
    .unproject(camera).sub(camera.position).normalize();
  function turn(dir,normal,ratio) {
    const cosine=-normal.dot(dir);
    return dir.clone().multiplyScalar(ratio)
      .addScaledVector(normal,ratio*cosine-Math.sqrt(1-ratio*ratio*(1-cosine*cosine)));
  }
  const sphere=new THREE.Sphere(new THREE.Vector3(),radius);
  const front=new THREE.Ray(camera.position,ray).intersectSphere(sphere,new THREE.Vector3());
  const inside=turn(ray,front.clone().normalize(),1/n);
  const exit=front.clone().addScaledVector(inside,-2*inside.dot(front));
  const out=turn(inside,exit.clone().normalize().negate(),n);
  const source=exit.clone().addScaledVector(out,(plane-exit.z)/out.z);
  const sourceXY=source.clone().project(camera);
  const blockerDepth=.017;
  const blockerX=sourceXY.x*(eye-blockerDepth)/camera.projectionMatrix.elements[0];
  const blocker=field(.0048,.020,0xfa00e7,blockerX,blockerDepth);
  blocker.visible=false;
  const gl=renderer.getContext(), result=new Uint8Array(4);
  function sample(x,y){
    gl.readPixels(Math.round(x),Math.round(y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,result);
    return Array.from(result);
  }
  function capture(){
    const count=beads.inspect().passes;
    beads.prepare(renderer,scene,camera);
    renderer.render(scene,camera);
    return {pixel:sample(pixel.x,pixel.y),
      source:sample((sourceXY.x*.5+.5)*size.x,(sourceXY.y*.5+.5)*size.y),
      lens:beads.inspect(),passes:beads.inspect().passes-count};
  }
  amount.value=0;
  const off=capture();
  const offImage=renderer.domElement.toDataURL('image/png').split(',')[1];
  amount.value=1;
  const on=capture();
  const onImage=renderer.domElement.toDataURL('image/png').split(',')[1];
  blocker.visible=true;
  const guarded=capture();
  const guardImage=renderer.domElement.toDataURL('image/png').split(',')[1];
  camera.position.z=7;
  camera.updateMatrixWorld();
  const distant=capture();
  return {off,on,guarded,distant,source:source.toArray(),pixel:pixel.toArray(),size:size.toArray(),
    images:[offImage,onImage,guardImage]};
}"""


def expose_lens(route):
    response=route.fetch()
    body=response.text()
    marker="  const streaks=dropsMesh(group), beads=createRainBeads(group);"
    assert body.count(marker)==1
    hook="\n  window.beadLensFixture=beads;"
    route.fulfill(response=response,body=body.replace(marker,marker+hook))


NATURAL = """async()=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  const rain=scene.getObjectByName('Rain over the bridge district');
  const beads=rain.getObjectByName('Water beads held at willow leaf tips');
  const streaks=rain.getObjectByName('Wind-driven rain and runoff streaks');
  const optics=beads.material.userData.beadLens;
  for(const id of ['hud','seal','missionHud','missionWaypoint','missionIntro'])
    document.getElementById(id).style.display='none';
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let tick=performance.now();
  streaks.visible=false;
  const update=persp.updateMatrixWorld.bind(persp);
  const p=new THREE.Vector3(), normal=new THREE.Vector3(), transform=new THREE.Matrix4();
  let pose=null;
  persp.fov=42;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    if(pose) {
      persp.position.copy(pose.eye);
      persp.lookAt(pose.target);
    }
    return update(force);
  };
  const gl=renderer.getContext(), size=renderer.getDrawingBufferSize(new THREE.Vector2());
  const w=280,h=280, x=(size.x-w)/2,y=(size.y-h)/2;
  const a=new Uint8Array(w*h*4),b=new Uint8Array(a.length);
  let greatest=0, best=null;
  function render(enabled,buffer){
    optics.beadLensAmount.value=enabled;
    renderer.render(scene,persp);
    gl.readPixels(x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
  }
  const offsets=[[-.29,.084,.15],[.31,.11,.06],[-.16,-.27,.09],[.09,.053,-.31],[-.087,.32,.07],[.32,-.11,-.09]]
    .map(offset=>new THREE.Vector3(...offset));
  for(let attempt=0;attempt<7;attempt++){
    const support=beads.geometry.attributes.beadSupportNormal;
    for(let i=0;i<beads.count;i++){
      normal.fromBufferAttribute(support,i);
      if(normal.lengthSq()<.5) continue;
      beads.getMatrixAt(i,transform);
      p.setFromMatrixPosition(transform);
      if(p.x>-62 || p.z>-41 || p.z<-52) continue;
      const leafView=normal.clone().multiplyScalar(.31).add(new THREE.Vector3(.06,.04,.025));
      for(const offset of [leafView,...offsets]){
        pose={eye:p.clone().add(offset),target:p.clone()};
        beadLensFixture.prepare(renderer,scene,persp);
        render(0,a);render(1,b);
        let change=0;
        for(let j=0;j<a.length;j+=4)
          change+=Number(Math.max(Math.abs(a[j]-b[j]),Math.abs(a[j+1]-b[j+1]),Math.abs(a[j+2]-b[j+2]))>12);
        if(change<=greatest) continue;
        greatest=change;
        best={index:i,pose,lens:beadLensFixture.inspect()};
      }
    }
    if(best && greatest>1500 || attempt===6) break;
    greatest=0;
    best=null;
    for(let i=0;i<22;i++) leafFrame(tick+=1000/60);
    streaks.visible=false;
  }
  if(!best) return {greatest,count:beads.count};
  pose=best.pose;
  beadLensFixture.prepare(renderer,scene,persp);
  function photo(value){
    optics.beadLensAmount.value=value;
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  const off=photo(0),on=photo(1);
  optics.beadLensAmount.value=1;
  return {greatest,count:beads.count,best,off,on,size:size.toArray()};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&rain&gust")
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda e: errors.append(str(e)))
        page.on("console",lambda e: errors.append(e.text) if e.type=="error" else None)
        page.route(args.url,expose_frame)
        page.route("**/bridge-rain.js",expose_lens)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("__scene?.mission()?.rain?.time>5 && __scene.mission().rain.willowBeadSample?.x<-62",timeout=40000)
        natural=page.evaluate(NATURAL)
        control=page.evaluate(CONTROL)
    pair=Image.new("RGB",(960,480))
    for i,key in enumerate(("off","on")):
        if key not in natural:
            continue
        file=args.out/f"willow-bead-{key}-4k.png"
        file.write_bytes(base64.b64decode(natural.pop(key)))
        with Image.open(file) as image:
            pair.paste(image.crop((1680,840,2160,1320)).convert("RGB"),(480*i,0))
    pair.save(args.out/"bead-lens-same-frame.jpg",quality=96)
    calibration=Image.new("RGB",(1200,400))
    for i, photo in enumerate(control.pop("images")):
        with Image.open(BytesIO(base64.b64decode(photo))) as image:
            calibration.paste(image.crop((1720,880,2120,1280)).convert("RGB"),(400*i,0))
    calibration.save(args.out/"calibrated-refraction.jpg",quality=96)
    report={"control":control,"natural":natural,"errors":errors}
    (args.out/"bead-lens.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report))
    assert errors==[] and control["size"]==[3840,2160],report
    assert control["source"][0]<-.006 and control["on"]["passes"]==1,control
    assert control["off"]["pixel"][0]>control["off"]["pixel"][2]+50,control
    assert control["on"]["pixel"][2]>control["on"]["pixel"][0]+50,control
    assert control["guarded"]["source"][0]>205 and control["guarded"]["source"][1]<60,control
    assert control["guarded"]["pixel"][0]<175 or control["guarded"]["pixel"][2]<170,control
    assert control["distant"]["passes"]==0 and not control["distant"]["lens"]["active"],control
    assert natural["greatest"]>400 and natural["size"]==[3840,2160],natural


if __name__=="__main__":
    main()
