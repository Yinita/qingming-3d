"""Read back the meniscus under the same willow blade with three different poses."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_leaf_water import CAMERA, INSTALL_AUDIT, expose_frame


def expose_fixture(route):
    response = route.fetch()
    body = response.text()
    marker = "  return { mesh:leaves, frame,"
    assert body.count(marker) == 1
    body = body.replace(marker, "  window.meniscusFixture={leaf:data.at(-1),surface,settle,waterContact,frame};\n" + marker)
    route.fulfill(response=response, body=body)


MEASURE = """async ({roll,bend,lift,name,generation})=>{
  const THREE=await import('three');
  const {scene,renderer,persp}=__scene;
  const {leaf,surface,settle,waterContact,frame}=meniscusFixture;
  const now=__scene.mission().water.time;
  const time=now+1+generation*.002;
  const sheet={}, x=-61.58, z=-47.44;
  surface(x,z,time,sheet);
  if(sheet.depth<.045) throw Error('Controlled leaf must be in open water');
  leaf.mode='water';
  leaf.position.set(x,sheet.height+.008+lift,z);
  leaf.scale.set(.175,.270,.210);
  leaf.orientation.setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),roll));
  leaf.flex.set(bend,.06,0.04);
  leaf.velocity.set(0,0,0);
  leaf.wet=.94;
  leaf.onDeck=leaf.stoneRest=false;
  leaf.wakeAt=leaf.pulseAt=time+2;
  waterContact.begin(time);
  settle(leaf,time,0);
  frame(time,0);
  persp.updateMatrixWorld(true);
  waterContact.prepare(renderer,persp,time);
  const {target,footprint,heading,count,scene:stamps}=leafSlopes;
  if(count!==1 || heading.getW(0)!==0) throw Error('Expected one attached meniscus in the isolated draw');
  const matrix=new THREE.Matrix4();
  const mesh=scene.getObjectByName('Floating and falling willow leaves');
  mesh.getMatrixAt(leaf.index,matrix);
  const attributes=stamps.children[0].geometry.attributes;
  const stored=Array.from({length:8},(_,i)=>{
    const point=attributes[`rim${i}`];
    return point ? [point.getX(0),point.getY(0),point.getZ(0)] : null;
  });
  const indices=[0,20,40,65,69,44,24,4];
  const points=indices.map(index=>{
    const vertex=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,index);
    const y=vertex.y+.47;
    const u=vertex.x;
    vertex.x+=y*y*leaf.flex.z;
    vertex.z+=y*(y*leaf.flex.x+u*leaf.flex.y);
    return vertex.applyMatrix4(matrix).toArray();
  });
  const dx=heading.getX(0), dz=heading.getY(0), cx=footprint.getX(0), cz=footprint.getY(0);
  const projectionError=stored[0] ? Math.max(...stored.map(([u,v],i)=>Math.hypot(
    cx+dz*u+dx*v-points[i][0],cz-dx*u+dz*v-points[i][2]))) : null;
  const {leafSlopeBounds}=waterContact.uniforms, bounds=leafSlopeBounds.value;
  const size=72, cell=1/(bounds.z*target.width);
  const ix=Math.round((x-bounds.x)/cell)-size/2, iz=Math.round((z-bounds.y)/cell)-size/2;
  const pixels=new Uint8Array(size*size*4);
  renderer.readRenderTargetPixels(target,ix,iz,size,size,pixels);
  let energy=0,xMoment=0,zMoment=0,dxPlus=0,dxMinus=0;
  for(let row=0;row<size;row++) for(let col=0;col<size;col++) {
    const at=(row*size+col)*4;
    const strength=Math.hypot(pixels[at]-pixels[at+1],pixels[at+2]-pixels[at+3]);
    const u=bounds.x+(ix+col+.5)*cell-x, v=bounds.y+(iz+row+.5)*cell-z;
    energy+=strength;
    xMoment+=strength*u;
    zMoment+=strength*v;
    if(u>0) dxPlus+=strength;
    else dxMinus+=strength;
  }
  renderer.render(scene,persp);
  const image=renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
  return {name,energy,centroid:energy>0 ? [xMoment/energy,zMoment/energy] : null,sideEnergy:[dxMinus,dxPlus],projectionError,
    clearance:stored[0] ? stored.map(rim=>rim[2]) : null,points,cell,image};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--baseline", action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.route(args.url, expose_frame)
        page.route("**/bridge-canal-leaves.js", expose_fixture)
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.caustics?.passes>3", timeout=65000)
        page.evaluate(INSTALL_AUDIT)
        index=page.evaluate("meniscusFixture.leaf.index")
        page.evaluate(CAMERA,index)
        report={}
        poses=[("flat",0,.02,0),("roll-left",-.80,.08,0),("roll-right",.80,.08,0),("raised",0,.02,.095)]
        for generation,(name,roll,bend,lift) in enumerate(poses):
            case=page.evaluate(MEASURE,{"roll":roll,"bend":bend,"lift":lift,"name":name,"generation":generation})
            (args.out / f"{name}.jpg").write_bytes(base64.b64decode(case.pop("image")))
            report[name]=case
        browser.close()
    (args.out / "meniscus.json").write_text(json.dumps({"cases":report,"errors":errors}, indent=2)+"\n")
    assert not errors,errors
    flat,left,right=[report[name] for name in ("flat","roll-left","roll-right")]
    assert min(flat["energy"],left["energy"],right["energy"]) > 650,report
    print(json.dumps({name:[row["energy"],row["centroid"],row["projectionError"]] for name,row in report.items()}))
    if args.baseline:
        assert abs(left["centroid"][0]-right["centroid"][0]) < .003,report
    else:
        assert all(row["projectionError"]<.00002 for row in report.values()),report
        assert abs(left["centroid"][0]-right["centroid"][0]) > .012,report
        assert left["sideEnergy"][0]/left["energy"] > .55 and right["sideEnergy"][1]/right["energy"] > .58,report
        assert report["raised"]["energy"] < .05*flat["energy"],report


if __name__=="__main__":
    main()
