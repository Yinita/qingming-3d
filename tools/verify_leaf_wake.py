"""Follow one rendered leaf through a calm-water skiff wake and its return to the surface."""

import argparse
import base64
import json
import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_immersion import expose
from verify_rain_wave_packets import expose_paused_frame


def water_hook(route):
    expose(route,"  return {\n    prepare,\n    caustics:", """
  window.wakeWater={simulation,refraction,refractedCamera,leafField,leaves};
""",[
        ("    const oldTarget=renderer.getRenderTarget();",
         "    if(window.forceWakeCapture) {refract=true;reflect=false;}\n    const oldTarget=renderer.getRenderTarget();"),
        ("transmitLeaves?.(!!crossingInView);",
         "transmitLeaves?.(!!crossingInView && !window.omitWakeBlade);"),
    ])


REPLAY = """async({enabled,unassisted})=>{
  const THREE=await import('three');
  const {flexBlade}=await import('./bridge-leaf-light.js');
  const {rainBladeSurface}=await import('./bridge-rain-blade.js');
  const {canal,skiff,bed}=immersionCanal;
  const {data}=immersionLeaves;
  const {simulation,refraction,refractedCamera,leafField,leaves}=wakeWater;
  const {renderer,scene,persp}=__scene;
  const gl=renderer.getContext();
  const dt=1/60;
  leafClock.getDelta=()=>dt;
  leafFrame(1000/60);
  let tick=1,time=dt;
  function step(){
    time=(++tick)*dt;
    skiff.update(time,dt,canal.field);bed.frame(time);canal.frame(time,dt);
  }
  if(unassisted) {
    while(tick<1800) step();
    return {leaves:canal.inspect().foliage.immersion,drain:canal.inspect().contacts.leafDrain};
  }
  while(tick<56) step();
  let anchor;
  simulation.visitWakes((p,radius)=>{
    if(p.source==='skiff' && !anchor) anchor={...p,radius};
  });
  if(!anchor) throw new Error('Missing early skiff wake');
  const leaf=data[3];
  const {x,z}=anchor, y=leafField.height(x,z,time);
  leaf.position.set(x,y+.018,z);
  leaf.velocity.set(0,0,0);
  leaf.mode='water';leaf.wet=1;leaf.dive.time=-Infinity;
  leaf.scale.set(.143,.196,.175);
  leaf.yaw=.33;
  persp.position.set(x-.59,y+.40,z+.52);
  persp.lookAt(x+.05,y-.014,z+.23);
  persp.fov=43;persp.updateProjectionMatrix();
  for(const id of ['missionRestart','missionHud','missionIntro','questEntry','missionWaypoint','seal','hud']) {
    const element=document.getElementById(id);
    if(element) element.style.display='none';
  }

  const frames=[],stills={},trace=[];
  const canvas=renderer.domElement, matrix=new THREE.Matrix4(), point=new THREE.Vector3();
  const local=new THREE.Vector3(), temp=new THREE.Vector3();
  const blade=leaves.mesh.geometry.attributes.position;
  const beadMesh=scene.getObjectByName('Water beads carried by resurfacing leaves');
  const mask=leaves.mesh.geometry.attributes.bladeImmersion;
  const beadFoot=rainBladeSurface(leaves.mesh.geometry,.47);
  function draw(){
    canal.prepare(renderer,scene,persp);
    renderer.render(scene,persp);
  }
  function raster(width,height,camera,center,extent,target=null){
    point.set(...center).project(camera);
    const fromX=Math.max(0,Math.min(width-extent,Math.floor((point.x*.5+.5)*width-extent*.5)));
    const fromY=Math.max(0,Math.min(height-extent,Math.floor((point.y*.5+.5)*height-extent*.5)));
    const bytes=new Uint8Array(extent*extent*4);
    if(target) renderer.readRenderTargetPixels(target,fromX,fromY,extent,extent,bytes);
    else gl.readPixels(fromX,fromY,extent,extent,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    return {bytes,box:[fromX,height-fromY-extent,extent]};
  }
  function delta(a,b){
    let pixels=0,peak=0;
    for(let i=0;i<a.length;i+=4) {
      const change=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
      pixels+=Number(change>3);peak=Math.max(peak,change);
    }
    return {pixels,peak};
  }
  const snapshot=()=>canvas.toDataURL('image/jpeg',.95).split(',')[1];
  function full(){
    renderer.setSize(1920,1080,false);
    window.forceWakeCapture=true;
    draw();
  }
  function smaller() {
    window.forceWakeCapture=false;
    renderer.setSize(720,405,false);
  }
  smaller();
  let optics=null, carried=null, peakBead=-Infinity;
  for(let i=57;i<=174;i++){
    step();
    const {dive,position:p,drainBead}=leaf;
    const surface=leafField.height(p.x,p.z,time);
    let clearance=null, offsetError=null;
    if(drainBead) {
      const b=drainBead;
      clearance=b.y-leafField.height(b.x,b.z,time);
      beadFoot.at(b.u,b.v,leaf.flex,temp).multiply(leaf.scale).applyQuaternion(leaf.orientation).add(p);
      const expected=.66*b.radius;
      offsetError=Math.abs(temp.distanceTo(point.set(b.x,b.y,b.z))-expected);
    }
    trace.push({time,p:p.toArray(),depth:surface-p.y,roll:dive.roll,active:dive.active,cause:dive.cause,
      mask:mask.getX(leaf.index),clearance,offsetError});
    if(i===60 || i===76 || i===104 || i===137){
      const section={60:'approach',76:'deep',104:'drain',137:'returned'}[i];
      full();stills[section]=snapshot();smaller();
    }
    if(enabled && !optics && surface-p.y>.089) {
      full();
      // Let the resized capture and its cached lighting settle before the A/B.
      draw();
      const center=p.toArray();
      const capture=raster(refraction.width,refraction.height,refractedCamera,center,110,refraction);
      const image=raster(canvas.width,canvas.height,persp,center,380);
      leaves.mesh.getMatrixAt(leaf.index,matrix);
      let submerged=0;
      for(let k=0;k<blade.count;k++){
        local.fromBufferAttribute(blade,k);
        flexBlade(local,.47,leaf.flex,point).applyMatrix4(matrix);
        submerged+=Number(point.y<leafField.height(point.x,point.z,time)-.002);
      }
      stills.visible=snapshot();
      window.omitWakeBlade=true;
      draw();
      stills.omitted=snapshot();
      const absent=raster(refraction.width,refraction.height,refractedCamera,center,110,refraction);
      const noImage=raster(canvas.width,canvas.height,persp,center,380);
      window.omitWakeBlade=false;
      draw();
      const restored=raster(refraction.width,refraction.height,refractedCamera,center,110,refraction);
      const restoredImage=raster(canvas.width,canvas.height,persp,center,380);
      optics={time,submerged,totalVertices:blade.count,
        capture:delta(capture.bytes,absent.bytes),image:delta(image.bytes,noImage.bytes),patch:image.box,
        restored:delta(capture.bytes,restored.bytes),restoredImage:delta(image.bytes,restoredImage.bytes),
        captureAge:time-canal.inspect().lastRefractionTime,mask:mask.getX(leaf.index),
        transmission:[refraction.width,refraction.height],samples:refraction.samples};
      smaller();
    }
    if(enabled && clearance!==null && clearance>Math.max(.001,peakBead)) {
      peakBead=clearance;
      full();
      const center=[drainBead.x,drainBead.y,drainBead.z];
      const near=raster(canvas.width,canvas.height,persp,center,100);
      stills.bead=snapshot();
      beadMesh.visible=false;
      renderer.render(scene,persp);
      const clear=raster(canvas.width,canvas.height,persp,center,100);
      beadMesh.visible=true;
      carried={time,clearance,offsetError,pixels:delta(near.bytes,clear.bytes),patch:near.box};
      smaller();
    }
    if(i%2===0){
      draw();
      frames.push(snapshot());
    }
  }
  const report=canal.inspect();
  return {anchor,trace,frames,stills,optics,carried,leaves:report.foliage.immersion,
    drain:report.contacts.leafDrain,waves:report.leafWater.totals,glError:gl.getError()};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission")
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with tempfile.TemporaryDirectory(prefix="qingming-leaf-wake-") as folder, sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])

        def opened(enabled):
            page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
            page.add_init_script(f"window.noLeafWake={str(not enabled).lower()};")
            page.on("pageerror",lambda error:errors.append(str(error)))
            page.on("console",lambda entry:errors.append(entry.text) if entry.type=="error" else None)
            page.route(args.url,expose_paused_frame)
            page.route("**/bridge-water.js",water_hook)
            page.route("**/bridge-look.js*",lambda route:expose(route,"  return {\n    setVisible(visible)",
                "  window.immersionCanal={canal,skiff,bed};\n"))
            page.route("**/bridge-canal-leaves.js",lambda route:expose(route,"  return { mesh:leaves, frame,",
                "  window.immersionLeaves={data};\n"))
            page.route("**/bridge-water-field.js",lambda route:expose(route,"    wakeIntake(x,z,out) {",
                "",[("      const depth=simulation.columnAt(x,z);\n      return wakeVolume.at",
                     "      if(window.noLeafWake) return out.set(0,0,0);\n      const depth=simulation.columnAt(x,z);\n      return wakeVolume.at")]))
            page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
            page.wait_for_function("""window.__scene && window.wakeWater &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            return page

        results={}
        for mode,enabled in (("steady",False),("wake",True)):
            page=opened(enabled)
            result=page.evaluate(REPLAY,{"enabled":enabled,"unassisted":False})
            page.close()
            directory=Path(folder)/mode
            directory.mkdir()
            for index,encoded in enumerate(result.pop("frames")):
                (directory/f"{index:03d}.jpg").write_bytes(base64.b64decode(encoded))
            for label,encoded in result.pop("stills").items():
                file=args.out/f"{mode}-{label}-4k.jpg"
                file.write_bytes(base64.b64decode(encoded))
                assert Image.open(file).size==(3840,2160)
            results[mode]=result
        natural=opened(True)
        results["unassisted"]=natural.evaluate(REPLAY,{"enabled":True,"unassisted":True})
        natural.close()
        browser.close()
        (args.out/"replay.json").write_text(json.dumps({**results,"errors":errors},ensure_ascii=False,indent=2)+"\n")
        off,on=results["steady"],results["wake"]
        assert off["anchor"]==on["anchor"]
        assert not errors and off["glError"]==on["glError"]==0,errors
        assert off["leaves"]["wakeEntries"]==0 and on["leaves"]["wakeEntries"]==1 and on["leaves"]["wakeReturns"]==1
        assert .055 < on["leaves"]["wakeDepth"] < .145
        assert max(abs(s["roll"]) for s in on["trace"])>.75
        a,b=on["leaves"]["recent"][:2]
        assert .075 < math.dist(a["position"],b["position"]) < .34 and .28 < b["time"]-a["time"] < .94
        assert on["waves"]["resurface"]>=1 and on["drain"]["detached"]==on["drain"]["returned"]==1,on["drain"]
        optic=on["optics"]
        assert optic["submerged"]==optic["totalVertices"] and optic["mask"]==1,optic
        assert optic["captureAge"]<.001 and optic["image"]["pixels"]>30 and optic["capture"]["pixels"]>10,optic
        assert optic["restored"]["pixels"]==optic["restoredImage"]["pixels"]==0,optic
        assert optic["transmission"]==[1920,1080] and optic["samples"]>=2,optic
        bead=on["carried"]
        assert bead and bead["offsetError"]<.0001 and bead["pixels"]["pixels"]>1,bead
        assert results["unassisted"]["leaves"]["wakeEntries"]>=2 and results["unassisted"]["drain"]["returned"]>=1
        print(json.dumps({k:on[k] for k in ("optics","carried","drain")},ensure_ascii=False),flush=True)
        subprocess.run(["ffmpeg","-loglevel","error","-y","-filter_complex_threads","1",
            "-framerate","22","-i",str(Path(folder)/"steady/%03d.jpg"),"-framerate","22","-i",
            str(Path(folder)/"wake/%03d.jpg"),"-filter_complex",
            "[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2",
            "-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-movflags","+faststart",
            str(args.out/"leaf-wake-replay.mp4")],check=True)


if __name__=="__main__":
    main()
