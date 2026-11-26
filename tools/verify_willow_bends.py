"""Compare branch joints in the two renderers while holding the solved pose fixed."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from verify_rain_capture_budget import INSTALL
from verify_rain_wave_packets import expose_paused_frame


AUDIT = """async()=>{
  const THREE=await import('three');
  const {renderer,persp,scene}=__scene;
  const trees=scene.getObjectsByProperty('name','Volumetric riverside willow');
  if(trees.length!==2 || willowTopology.length!==2) throw Error('Missing willow topology');
  const views=[{eye:[-64.86,2.84,-43.73],look:[-66.89,4.14,-46.89],fov:43},
    {eye:[-64.10,5.10,-52.15],look:[-67.13,3.72,-46.32],fov:47}];
  const given=new THREE.Vector3(), left=new THREE.Vector3(), right=new THREE.Vector3();
  const oldCenter=new THREE.Vector3(), newCenter=new THREE.Vector3();
  const start=new THREE.Vector3(), end=new THREE.Vector3(), slope=new THREE.Vector3(), other=new THREE.Vector3();
  const axis=new THREE.Vector3(), fixed=new THREE.Vector3(0,0,1), turn=new THREE.Quaternion();
  function read(tree,node,row,out) {
    const {data,width}=tree.userData.branchMotion.pose.texture.value.image;
    return out.fromArray(data,(node+row*width)*4);
  }
  function linear(tree,a,b,t,rest,out) {
    read(tree,a,1,start);read(tree,b,1,end);
    oldCenter.copy(start).lerp(end,t);
    slope.subVectors(end,start).normalize();
    read(tree,a,0,start);read(tree,b,0,end);
    newCenter.copy(start).lerp(end,t);
    other.subVectors(end,start).normalize();
    turn.setFromUnitVectors(slope,other);
    return out.copy(rest).sub(oldCenter).applyQuaternion(turn).add(newCenter);
  }
  const report={samples:0,sockets:0,linearPeak:0,splinePeak:0,socketPeak:0};
  let strongest=null, tick=0;
  const photos={};
  leafClock.getDelta=()=>1/60;
  function pose(view) {
    capturePose([view.eye,view.look]);persp.fov=view.fov;persp.updateProjectionMatrix();
  }
  function capture(name,view) {
    pose(view);
    const shot=value=>{
      willowLinearPose.value=value;
      captureDraw(scene,persp);
      return renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    };
    try {
      photos[name]={before:shot(1),after:shot(0)};
    } finally {willowLinearPose.value=0;}
  }
  pose(views[0]);
  for(let frame=1;frame<=360;frame++) {
    leafFrame(++tick*1000/60);
    if(frame<70 || frame%3) continue;
    let frameWorst=null;
    trees.forEach((tree,which)=>{
      const {point}=tree.userData.branchMotion;
      for(const {offset,segments,joint,base} of willowTopology[which]) {
        if(joint) {
          read(tree,offset,1,given);
          point(given,joint,left);
          const gap=left.distanceTo(read(tree,offset,0,right))*tree.scale.x;
          report.socketPeak=Math.max(report.socketPeak,gap);
          report.sockets++;
        }
        for(let k=1;k<segments;k++) {
          const node=offset+k, span=base>.07 ? .09 : .03;
          read(tree,node,2,axis);
          axis.cross(fixed).normalize();
          read(tree,node,1,given).addScaledVector(axis,span);
          const inboard=[node-1,node,1], outboard=[node,node+1,0];
          linear(tree,node-1,node,1,given,left);
          linear(tree,node,node+1,0,given,right);
          const before=left.distanceTo(right)*tree.scale.x;
          point(given,inboard,left);point(given,outboard,right);
          const after=left.distanceTo(right)*tree.scale.x;
          if(which===0 && (!frameWorst || before>frameWorst.before)) {
            const world=tree.localToWorld(read(tree,node,0,start)).toArray();
            frameWorst={before,after,node,world,frame};
          }
          report.samples++;
          report.linearPeak=Math.max(report.linearPeak,before);
          report.splinePeak=Math.max(report.splinePeak,after);
        }
      }
    });
    if(frameWorst && (!strongest || frameWorst.before>strongest.before)) strongest=frameWorst;
    if(frame===141) {
      capture('canopy',views[0]);
      const [x,y,z]=frameWorst.world;
      capture('joint',{eye:[x+.83,y-.42,z-1.13],look:[x,y,z],fov:32});
      report.detail=frameWorst;
      pose(views[0]);
    }
    if(frame===255) {
      pose(views[1]);
    }
    if(frame===360) capture('river-canopy',views[1]);
  }
  report.strongest=strongest;
  report.raster=[renderer.domElement.width,renderer.domElement.height];
  return {report,photos};
}"""


def expose_topology(route):
    response = route.fetch()
    source = response.text()
    marker = "  return {branch,at,atCurve,prepare,frame,handoff,inspect,"
    assert source.count(marker) == 1
    injection = "  window.willowTopology.push(limbs);\n"
    route.fulfill(response=response, body=source.replace(marker, injection+marker))


def linear_fixture(route, prior):
    response = route.fetch()
    source = response.text()
    old_frame = prior.split("  void woodFrame(", 1)[1].split("  vec3 woodRotate(", 1)[0]
    old_frame = "  void linearWoodFrame(" + old_frame.replace(",.25)", ",.125)").replace(",.75)", ",.375)")
    marker = "  vec3 woodRotate(vec3 v,vec3 axis,float turn)"
    assert source.count(marker) == 1
    source = source.replace(marker,"  uniform float willowLinearPose;\n"+old_frame+marker)
    call = "    woodFrame(oldCenter,newCenter,woodAxis,woodTurn);"
    assert source.count(call) == 1
    source = source.replace(call,
        "    if(willowLinearPose>.5) linearWoodFrame(oldCenter,newCenter,woodAxis,woodTurn);\n"
        "    else woodFrame(oldCenter,newCenter,woodAxis,woodTurn);")
    marker = "    shader.uniforms.branchPose=pose.texture;"
    source = source.replace(marker,marker+"\n    shader.uniforms.willowLinearPose=window.willowLinearPose;")
    route.fulfill(response=response,body=source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--reference", type=Path, required=True,
                        help="The viewer directory containing the earlier bridge-wind.js.")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    prior = (args.reference/"bridge-wind.js").read_text()
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page = browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda msg:errors.append(msg.text) if msg.type=="error" else None)
        page.add_init_script("window.willowTopology=[];window.willowLinearPose={value:0};")
        page.route(args.url,expose_paused_frame)
        page.route("**/bridge-willow-dynamics.js",expose_topology)
        page.route("**/bridge-wind.js",lambda route:linear_fixture(route,prior))
        page.goto(args.url,wait_until="networkidle",timeout=65000)
        page.wait_for_function("""window.__scene?.scene.getObjectByName('Willow trunk and branches')
            ?.material.userData.surfaceReady &&
            __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
        page.evaluate(INSTALL)
        result = page.evaluate(AUDIT)
        browser.close()
    for name,pair in result["photos"].items():
        images = [Image.open(BytesIO(base64.b64decode(pair[key]))).convert("RGB")
                  for key in ("before","after")]
        comparison = Image.new("RGB",(1920,540))
        for i,image in enumerate(images):
            assert image.size==(3840,2160),image.size
            comparison.paste(image.resize((960,540),Image.Resampling.LANCZOS),(960*i,0))
        comparison.save(args.out/f"{name}-comparison.jpg",quality=94)
        images[1].save(args.out/f"{name}-4k.jpg",quality=94)
    report = {**result["report"],"errors":errors}
    (args.out/"willow-bends.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors and report["raster"]==[3840,2160],report
    assert report["samples"]>8000 and report["linearPeak"]>.002,report
    assert report["splinePeak"]<.000003 and report["socketPeak"]<.000003,report
    assert report["sockets"]>100,report


if __name__ == "__main__":
    main()
