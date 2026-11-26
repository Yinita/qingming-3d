"""Track wetness at fixed shore positions through two crests in the running game."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_canal_inflow import RECORD
from verify_leaf_water import expose_frame


CAMERA = """()=>{
  const {persp}=__scene;
  const update=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    persp.position.set(-65.97,.70,-47.12);
    persp.lookAt(-67.10,.058,-47.71);
    return update(force);
  };
  persp.fov=49;
  persp.updateProjectionMatrix();
  for(const id of ['missionHud','missionWaypoint','seal']) {
    const element=document.getElementById(id);
    if(element) element.style.display='none';
  }
}"""


def expose_height(route):
    response=route.fetch()
    body=response.text()
    marker="  const leafField=breakers ? {...field,height:breakers.renderHeight} : field;"
    assert body.count(marker)==1
    route.fulfill(response=response,body=body.replace(marker,marker+" window.bankWaterHeight=leafField.height;"))


REPLAY = """async ()=>{
  const THREE=await import('three');
  const {bankWettingGLSL}=await import('./bridge-bank-wetting.js');
  const {canalShoreRadius,canalTerrainHeight}=await import('./bridge-canal-bed.js');
  const {scene,renderer,persp}=__scene;
  const bed=scene.getObjectByName('Recessed canal bed');
  const rocks=scene.getObjectByName('Damp shoreline stones');
  const uniforms=scene.getObjectByName('Canal surface').material.uniforms;
  const {bankWetAtlas,bankWetBounds,bankWetOptics,bankWash,bankWashBounds,origin}=uniforms;
  if(bed.material.userData.shoreWetting.bankWetAtlas!==bankWetAtlas ||
    rocks.material.userData.shoreWetting.bankWetAtlas!==bankWetAtlas) throw Error('The shore materials must share exposure data');
  const z=-47.48215625, across=-.2923529412, edgeAcross=-.3323529412, dryAcross=-.49;
  const edge=origin.value.x-canalShoreRadius(z-origin.value.y,-1);
  const x=edge+across;
  const ray=new THREE.Raycaster(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0));
  const terrain=ray.intersectObject(bed,false)[0].point.y;
  ray.ray.origin.x=edge+dryAcross;
  const dryTerrain=ray.intersectObject(bed,false)[0].point.y;
  ray.ray.origin.x=edge+edgeAcross;
  const edgeTerrain=ray.intersectObject(bed,false)[0].point.y;
  const points=[new THREE.Vector3(x,terrain,z),new THREE.Vector3(x,terrain+.10,z),
    new THREE.Vector3(edge+dryAcross,dryTerrain,z),new THREE.Vector3(),new THREE.Vector3(),
    new THREE.Vector3(edge+edgeAcross,edgeTerrain,z)];
  const heads=[across,across,dryAcross,0,0,edgeAcross];
  const shoreAt=p=>p.x-origin.value.x+canalShoreRadius(p.z-origin.value.y,-1);
  const probe=new THREE.WebGLRenderTarget(points.length,1,{depthBuffer:false});
  const panel=new THREE.PlaneGeometry(2,2);
  const shader=new THREE.ShaderMaterial({uniforms:{bankWetAtlas,bankWetBounds,bankWetOptics,
    probes:{value:points},heads:{value:heads}},
    vertexShader:'void main(){gl_Position=vec4(position,1.);}',
    fragmentShader:`${bankWettingGLSL}
      uniform vec3 probes[6];
      uniform float heads[6];
      void main(){int i=int(gl_FragCoord.x);gl_FragColor=vec4(bankWetness(heads[i],probes[i]),0.,0.,1.);}`});
  const sceneProbe=new THREE.Scene(), cameraProbe=new THREE.Camera();
  const surfaceProbe=new THREE.Mesh(panel,shader);
  surfaceProbe.frustumCulled=false;
  sceneProbe.add(surfaceProbe);
  const rgba=new Uint8Array(points.length*4), trace=[];
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let now=performance.now();
  function sample(){
    const previous=renderer.getRenderTarget();
    renderer.setRenderTarget(probe);
    renderer.render(sceneProbe,cameraProbe);
    renderer.readRenderTargetPixels(probe,0,0,points.length,1,rgba);
    renderer.setRenderTarget(previous);
    const time=__scene.mission().water.time;
    const row=Math.round((z-bankWashBounds.value.x)*bankWashBounds.value.y*bankWash.value.image.width-.5);
    const reach=bankWash.value.image.data[row*4+1]*.54/255;
    return {time,reach,water:bankWaterHeight(x,z,time),stain:rgba[0]/255,highFace:rgba[4]/255,
      dryNeighbor:rgba[8]/255,rockLow:rgba[12]/255,rockHigh:rgba[16]/255,thinEdge:rgba[20]/255};
  }
  function rockFaces(time){
    const {position,color}=rocks.geometry.attributes;
    const p=new THREE.Vector3();
    const candidates=[];
    let start=0;
    // The merged mesh retains the uniform tint used on each separate stone.
    while(start<position.count) {
      let end=start+1;
      while(end<position.count && color.getX(end)===color.getX(start)) end++;
      p.fromBufferAttribute(position,start).applyMatrix4(rocks.matrixWorld);
      if(Math.abs(p.x-x)<1.20 && Math.abs(p.z-z)<1.25){
        let top=null,low=null,immersed=0;
        for(let i=start;i<end;i+=3){
          p.fromBufferAttribute(position,i).applyMatrix4(rocks.matrixWorld);
          if(!top || top.y<p.y) top=p.clone();
          const s=shoreAt(p), height=bankWaterHeight(p.x,p.z,time);
          const floor=canalTerrainHeight(origin.value,p.x,p.z);
          if(s<-.31 || s>.25 || p.y-floor<.002 || height-p.y<=immersed) continue;
          low=p.clone();
          immersed=height-p.y;
        }
        if(low && top.y-low.y>.050 && top.y-bankWaterHeight(top.x,top.z,time)>.041)
          candidates.push({low,top,immersed,score:Math.hypot(low.x-x,low.z-z)-immersed*4});
      }
      start=end;
    }
    candidates.sort((a,b)=>a.score-b.score);
    const best=candidates[0];
    if(!best) throw Error('No stone with both an immersed base and a dry top');
    points[3].copy(best.low);
    points[4].copy(best.top);
    heads[3]=shoreAt(best.low);heads[4]=shoreAt(best.top);
    return {immersed:best.immersed,topClearance:best.top.y-bankWaterHeight(best.top.x,best.top.z,time)};
  }
  function snapshot(){
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  let peak,retreat,rewet,rewetStart,on,off,rock;
  try {
    trace.push(sample());
    for(let i=0;i<500;i++) {
      leafFrame(now+=1000/60);
      if(i%3!==0) continue;
      const row=sample();
      trace.push(row);
      const covered=row.water>terrain+.002;
      if(!peak && row.time>3.65 && row.reach>.346 && covered && row.stain>.75){
        rock=rockFaces(row.time);
        peak=sample();
      }
      if(peak && !retreat && row.time-peak.time>.86 && row.reach<.10){
        retreat=row;
        on=snapshot();
        try {bankWetOptics.value=0;off=snapshot();}
        finally {bankWetOptics.value=1;}
      }
      if(retreat && row.reach>.338 && covered && row.stain>.75) {
        rewetStart??=row.time;
        if(!rewet || row.stain>rewet.stain) rewet=row;
      }
      if(rewet && row.time-rewetStart>.24) break;
    }
    return {points:points.map(p=>p.toArray()),trace,peak,retreat,rewet,rock,on,off,
      atlas:[bankWetAtlas.value.image.width,bankWetAtlas.value.image.height]};
  } finally {probe.dispose();panel.dispose();shader.dispose();}
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--record",action="store_true")
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page=browser.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda message:errors.append(message.text) if message.type=="error" else None)
        page.route(args.url,expose_frame)
        page.route("**/bridge-water.js",expose_height)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.swash?.foam?.passes>3",timeout=65000)
        page.evaluate(CAMERA)
        report=page.evaluate(REPLAY)
        frames=[report.pop(key,None) for key in ("on","off")]
        if all(frames):
            images=[Image.open(BytesIO(base64.b64decode(encoded))).convert("RGB") for encoded in frames]
            images[0].save(args.out/"retreat-4k.jpg",quality=95)
            crop=(760,720,3090,2120)
            panels=[image.crop(crop) for image in images]
            delta=np.abs(np.asarray(panels[0],dtype=np.int16)-np.asarray(panels[1],dtype=np.int16)).max(axis=2)
            pair=Image.new("RGB",(2400,722))
            for i,image in enumerate(panels):
                pair.paste(image.resize((1200,722),Image.Resampling.LANCZOS),(i*1200,0))
            pair.save(args.out/"retreat-same-frame.jpg",quality=95)
            report["pixels"]={"changed":int((delta>6).sum()),"peak":int(delta.max()),"crop":crop}
        (args.out/"bank-wetting.json").write_text(json.dumps({**report,"errors":errors},indent=2)+"\n")
        print(json.dumps({key:report.get(key) for key in ("peak","retreat","rewet","pixels")}),flush=True)
        assert not errors,errors
        assert all(report.get(key) for key in ("peak","retreat","rewet")),report
        peak,retreat,rewet=(report[key] for key in ("peak","retreat","rewet"))
        assert peak["water"]>report["points"][0][1]+.002 and retreat["water"]<report["points"][0][1],report
        assert retreat["stain"]>.49 and rewet["stain"]>retreat["stain"]+.15,report
        assert max(row["highFace"] for row in report["trace"])<.018,report
        assert max(row["dryNeighbor"] for row in report["trace"])<.022,report
        assert .28 < max(row["thinEdge"] for row in report["trace"]) < .75,report
        assert peak["rockLow"]>.42 and retreat["rockLow"]>.25,report
        assert max(row["rockHigh"] for row in report["trace"] if row["time"]>=peak["time"])<.025,report
        assert report["pixels"]["changed"]>10000 and report["pixels"]["peak"]>11,report["pixels"]
        if args.record:
            page.close()
            page=browser.new_page(viewport={"width":1920,"height":1080})
            page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
            page.wait_for_function("window.__scene?.mission()?.water?.swash?.foam?.passes>3",timeout=65000)
            page.evaluate(CAMERA)
            video=page.evaluate(RECORD)
            (args.out/"bank-wetting.webm").write_bytes(base64.b64decode(video))
        browser.close()


if __name__=="__main__":
    main()
