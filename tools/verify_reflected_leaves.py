"""Compare the production canal mirror with and without a falling blade on the same frame."""

import argparse
import base64
import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


def expose(route, marker, hook):
    response = route.fetch()
    source = response.text()
    assert source.count(marker) == 1, marker
    route.fulfill(response=response, body=source.replace(marker, hook + marker))


AUDIT = """async()=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  renderer.setAnimationLoop(null);
  const {prepare,target,uniforms,leaves}=mirrorFixture;
  const {leaf,frame}=bladeFixture;
  const matrix=uniforms.reflectionUV.value;
  const canal=scene.getObjectByName('Canal surface');
  const bladeMesh=leaves.mesh;
  const oldRender=renderer.render.bind(renderer);
  const raster=renderer.getDrawingBufferSize(new THREE.Vector2());
  const posed=new THREE.Vector3();
  const crop=82;
  const right=new Uint8Array(crop*crop*4), left=new Uint8Array(right.length);
  const images={};
  for(const id of ['missionHud','seal','missionIntro','missionWaypoint'])
    document.getElementById(id).style.display='none';
  const read=(buffer,x,y)=>renderer.readRenderTargetPixels(target,x,y,crop,crop,buffer);
  function cropImage(buffer) {
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=crop;
    const ctx=canvas.getContext('2d'), image=ctx.createImageData(crop,crop);
    for(let y=0;y<crop;y++) {
      const start=(crop-1-y)*crop*4;
      image.data.set(buffer.subarray(start,start+crop*4),y*crop*4);
    }
    ctx.putImageData(image,0,0);
    return canvas.toDataURL('image/png').split(',')[1];
  }
  function diff(a,b) {
    let pixels=0,peak=0,xSum=0,ySum=0;
    for(let i=0;i<a.length;i+=4){
      const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
      peak=Math.max(peak,d);
      if(d<=3) continue;
      const p=i/4;
      pixels++;
      xSum+=p%crop;
      ySum+=Math.floor(p/crop);
    }
    return {pixels,peak,centroid:pixels ? [xSum/pixels,ySum/pixels] : null};
  }
  function snapshot(fixture,record) {
    Object.assign(leaf,{mode:fixture.mode,wet:fixture.mode==='water' ? 1 : 0,began:uniforms.time.value,
      onDeck:false,stoneRest:false,onFilm:false});
    leaf.position.set(fixture.x,fixture.y,-46.42);
    leaf.scale.set(.172,.245,.196);
    leaf.flex.set(.062,-.12,.021);
    leaf.orientation.setFromEuler(new THREE.Euler(.34,.29,-.44));
    frame(uniforms.time.value,0);
    persp.position.set(-66.69,.83,-49.56);
    persp.lookAt(-64.16,.27,-46.53);
    persp.fov=48+fixture.offset;
    persp.updateProjectionMatrix();
    const capture={};
    renderer.render=(root,camera)=>{
      if(renderer.getRenderTarget()!==target) return oldRender(root,camera);
      const projected=posed.copy(leaf.position).applyMatrix4(matrix);
      const ix=Math.max(0,Math.min(target.width-crop,Math.round(projected.x*target.width)-crop/2));
      const iy=Math.max(0,Math.min(target.height-crop,Math.round(projected.y*target.height)-crop/2));
      oldRender(root,camera);
      read(right,ix,iy);
      bladeMesh.visible=false;
      // Readback binds the resolve buffer, so rebind the multisampled target.
      renderer.setRenderTarget(target);
      oldRender(root,camera);
      read(left,ix,iy);
      function mainImage() {
        renderer.setRenderTarget(null);
        canal.visible=true;
        bladeMesh.visible=true;
        leaves.mirror(false);
        oldRender(root,persp);
        const image=renderer.domElement.toDataURL('image/jpeg',.94).split(',')[1];
        renderer.setRenderTarget(target);
        canal.visible=false;
        leaves.mirror(true);
        return image;
      }
      if(record) {
        images.before=mainImage();
        images.mirrorBefore=cropImage(left);
        images.mirrorAfter=cropImage(right);
      }
      bladeMesh.visible=true;
      renderer.setRenderTarget(target);
      oldRender(root,camera);
      if(record) images.after=mainImage();
      Object.assign(capture,diff(left,right),{x:ix,y:iy,
        projected:[projected.x*target.width,projected.y*target.height],
        mask:bladeMesh.geometry.getAttribute('bladeMirror').getX(leaf.index)});
    };
    try {
      prepare(renderer,scene,persp);
    } finally { renderer.render=oldRender; }
    return capture;
  }
  const first=snapshot({mode:'air',x:-63.96,y:.64,offset:0},true);
  const moved=snapshot({mode:'air',x:-63.43,y:.64,offset:.002},false);
  const afloat=snapshot({mode:'water',x:-63.96,y:.18,offset:.004},false);
  const raised=snapshot({mode:'land',x:-63.96,y:.64,offset:.006},false);

  const crowns=[];
  scene.traverse(node=>{if(node.name==='Willow blade detail') crowns.push(node);});
  const collect=()=>crowns.map(lod=>({triangles:lod.children[0].geometry.index.count/3,
    instances:lod.children[0].count, sameBinding:lod.children[0].geometry.getAttribute('branchLink')===lod.userData.fineBlade.getAttribute('branchLink')}));
  const lodResult={};
  for(const detail of [false,true]){
    for(const crown of crowns) {
      crown.autoUpdate=detail;
      if(!detail) crown.children[0].geometry=crown.userData.fineBlade;
    }
    const shots={};
    renderer.render=(root,camera)=>{
      if(renderer.getRenderTarget()!==target) return oldRender(root,camera);
      oldRender(root,camera);
      shots.reflection={triangles:renderer.info.render.triangles,crowns:collect()};
    };
    persp.position.set(-68.05,2.45,-48.90);
    persp.lookAt(-62.40,1.06,-45.30);
    persp.fov=54+Number(detail)*.001;
    persp.updateProjectionMatrix();
    try { prepare(renderer,scene,persp); }
    finally { renderer.render=oldRender; }
    oldRender(scene,persp);
    shots.main={triangles:renderer.info.render.triangles,crowns:collect()};
    lodResult[detail ? 'adaptive' : 'fine']=shots;
  }
  return {images,results:{first,moved,afloat,raised,lod:lodResult,raster:raster.toArray(),
    mirror:[target.width,target.height]}};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome",
            args=["--enable-gpu", "--use-angle=gl", "--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda e: errors.append(e.text) if e.type == "error" else None)
        page.route("**/bridge-canal-leaves.js", lambda route: expose(route,
            "  return { mesh:leaves, frame,", "  window.bladeFixture={leaf:data.at(-1),frame};\n"))
        page.route("**/bridge-water.js", lambda route: expose(route,
            "  return {\n    prepare,\n    caustics:caustics.uniforms,",
            "  window.mirrorFixture={prepare,target,uniforms,leaves};\n"))
        page.route("**/bridge-foreground.js*", lambda route: expose(route,
            "  detail.add(leaves);", "  detail.userData.fineBlade=original;\n"))
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("__scene?.mission()?.water?.reflectionPasses>8", timeout=45000)
        report = page.evaluate(AUDIT)
        result = report["results"]
        assert not errors, errors
        for k, data in report["images"].items():
            name = f"{k}.png" if k.startswith("mirror") else f"{k}-4k.jpg"
            (args.out/name).write_bytes(base64.b64decode(data))
        before, after = (Image.open(args.out/f"{name}-4k.jpg") for name in ("before", "after"))
        panel = Image.new("RGB", (1920, 540))
        for i, shot in enumerate((before,after)):
            panel.paste(shot.resize((960, 540), Image.Resampling.LANCZOS), (i*960,0))
        panel.save(args.out/"same-frame.jpg",quality=94)
        detail = Image.new("RGB", (656, 328))
        for i, name in enumerate(("mirrorBefore", "mirrorAfter")):
            with Image.open(args.out/f"{name}.png") as shot:
                detail.paste(shot.resize((328,328),Image.Resampling.NEAREST),(i*328,0))
        detail.save(args.out/"reflection-crop.png")
        (args.out/"reflection-and-lod.json").write_text(json.dumps(result,indent=2)+"\n")
        print(json.dumps(result,indent=2))
        assert result["raster"] == [3840,2160]
        for capture in ("first","moved","raised"):
            assert result[capture]["pixels"] > 12 and result[capture]["mask"] == 1, result[capture]
        assert result["afloat"]["pixels"] == 0 and result["afloat"]["mask"] == 0, result["afloat"]
        first, moved = (result[k] for k in ("first", "moved"))
        predicted = moved["projected"][0]-first["projected"][0]
        measured = moved["x"]+moved["centroid"][0]-first["x"]-first["centroid"][0]
        assert abs(measured) > 12 and abs(predicted-measured) < 4, (predicted,measured)
        for lane in ("reflection","main"):
            fine, adaptive = (result["lod"][mode][lane] for mode in ("fine","adaptive"))
            assert all(c["sameBinding"] for c in adaptive["crowns"])
            assert [c["instances"] for c in fine["crowns"]] == [c["instances"] for c in adaptive["crowns"]]
        assert result["lod"]["adaptive"]["reflection"]["triangles"] < result["lod"]["fine"]["reflection"]["triangles"]


if __name__ == "__main__":
    main()
