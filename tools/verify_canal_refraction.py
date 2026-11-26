"""Inspect actual transmission color for objects above and below moving water."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import TimeoutError as BrowserTimeout, sync_playwright

from verify_canal_inflow import RECORD
from verify_leaf_water import expose_frame


def expose_capture(route):
    response=route.fetch()
    body=response.text()
    marker="  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert body.count(marker)==1
    hook="""  window.refractionAudit={refractedCamera,refraction,leafField,origin,uniforms,
    clip:typeof captureClip==='undefined' ? null : captureClip};\n"""
    route.fulfill(response=response,body=body.replace(marker,hook+marker))


REPLAY = """async()=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  const {refraction,refractedCamera,leafField,origin,uniforms,clip}=refractionAudit;
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let clock=performance.now();
  function step(){leafFrame(clock+=1000/60);return __scene.mission().water;}
  const {canalDepth}=await import('./bridge-canal-bed.js');
  const geometry=new THREE.SphereGeometry(.018,12,8);
  const marker=color=>{
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.25}));
    mesh.layers.enable(1);
    scene.add(mesh);
    clip?.include(mesh);
    return mesh;
  };
  const wet=marker(0xff0000),dry=marker(0x0000ff);
  wet.visible=dry.visible=false;
  const eye=new THREE.Vector3(),look=new THREE.Vector3(),test=new THREE.Vector3();
  let cameraActive=false;
  const update=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    if(cameraActive) {persp.position.copy(eye);persp.lookAt(look);}
    return update(force);
  };
  for(const id of ['missionHud','missionWaypoint','seal']) {
    const item=document.getElementById(id);if(item) item.style.display='none';
  }
  function count(point,color){
    const uv=test.copy(point).project(refractedCamera);
    const x=Math.round((uv.x*.5+.5)*refraction.width), y=Math.round((uv.y*.5+.5)*refraction.height);
    const size=52;
    if(x-size/2<0 || y-size/2<0 || x+size/2>refraction.width || y+size/2>refraction.height)
      throw Error('Optical marker is outside the transmission target');
    const pixels=new Uint8Array(size*size*4);
    renderer.readRenderTargetPixels(refraction,x-size/2,y-size/2,size,size,pixels);
    let matches=0;
    for(let i=0;i<pixels.length;i+=4){
      if(pixels[i+color]>105 && pixels[i+color]>2.8*pixels[i+(2-color)] && pixels[i+color]>2.8*pixels[i+1]) matches++;
    }
    return matches;
  }
  function shot(){return renderer.domElement.toDataURL('image/png').split(',')[1];}
  async function reprojection(){
    eye.set(-66.71,2.42,-48.85);
    look.set(-63.98,.02,-45.83);
    const before=__scene.mission().water.refractionPasses;
    let captured;
    for(let i=0;i<9;i++) {
      captured=step();
      if(captured.refractionPasses>before) break;
    }
    if(captured.refractionPasses===before) throw Error('The transmission camera did not capture the new view');
    const point=new THREE.Vector3(-64.55,.02,-46.15);
    const source=point.clone().project(refractedCamera).multiplyScalar(.5).addScalar(.5);
    const move=new THREE.Vector3(.060,0,.017);
    eye.add(move);look.add(move);
    const advanced=step();
    const current=point.clone().project(persp).multiplyScalar(.5).addScalar(.5);
    const {width,height}=renderer.domElement;
    const pixelDistance=(u,v)=>Math.hypot((u-source.x)*width,(v-source.y)*height);
    const screenShift=pixelDistance(current.x,current.y);
    if(advanced.refractionPasses!==captured.refractionPasses) throw Error('Expected a stale transmission frame during the small camera move');
    const result={age:advanced.time-captured.time,screenShift,shaderError:screenShift,foregroundRejected:null,backgroundAccepted:null};
    if(!uniforms.refractionUV) return result;
    const {refractionProjectionGLSL}=await import('./bridge-refraction.js');
    const material=scene.getObjectByName('Canal surface').material;
    const code=material.fragmentShader;
    const start=code.indexOf('vec4 captured=transmissionPoint'), end=code.indexOf('float throughWeight=');
    const project=material.vertexShader.match(/transmissionPoint=refractionUV[^;]+;/)?.[0];
    if(!project || start<0 || end<start) throw Error('Projection code missing from the real surface');
    const distance=new THREE.Vector4(...point.toArray(),1).applyMatrix4(uniforms.refractionUV.value).w;
    function clipDepth(d){
      const p=new THREE.Vector4(0,0,-d,1).applyMatrix4(refractedCamera.projectionMatrix);
      return .5+.5*p.z/p.w;
    }
    const probe=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
    const shape=new THREE.PlaneGeometry(2,2);
    const shade=new THREE.ShaderMaterial({uniforms:{refractionUV:uniforms.refractionUV,
      refractionProjectionInverse:uniforms.refractionProjectionInverse,
      worldPoint:{value:point},depths:{value:new THREE.Vector2(clipDepth(distance-.13),clipDepth(distance+.13))}},
      vertexShader:'void main(){gl_Position=vec4(position,1.);}',
      fragmentShader:`${refractionProjectionGLSL}
        uniform vec3 worldPoint;
        uniform vec2 depths;
        void main(){
          vec4 world=vec4(worldPoint,1.);
          vec4 ${project}
          ${code.slice(start,end)}
          gl_FragColor=vec4(screen,float(behindWater(depths.x,captured.w)),float(behindWater(depths.y,captured.w)));
        }`});
    const fixture=new THREE.Scene(), camera=new THREE.Camera();
    const plane=new THREE.Mesh(shape,shade);
    plane.frustumCulled=false;
    fixture.add(plane);
    const old=renderer.getRenderTarget(), sample=new Float32Array(4);
    try {
      renderer.setRenderTarget(probe);
      renderer.render(fixture,camera);
      renderer.readRenderTargetPixels(probe,0,0,1,1,sample);
    } finally {renderer.setRenderTarget(old);probe.dispose();shape.dispose();shade.dispose();}
    result.shaderError=pixelDistance(sample[0],sample[1]);
    result.foregroundRejected=sample[2]===0;
    result.backgroundAccepted=sample[3]===1;
    return result;
  }
  function search(kind){
    let hit=null;
    for(let i=0;i<465;i++){
      const state=step();
      if(i%2!==0) continue;
      const trough=kind==='trough';
      for(let iz=0;iz<13;iz++) for(let ix=0;ix<24;ix++){
        const x=-66.15+ix*.151,z=-49.55+iz*.245, y=leafField.height(x,z,state.time);
        if(canalDepth(origin,x,z)<.38 || (trough ? y>-.063 : y<.109)) continue;
        if(!hit || (trough ? y<hit.y : y>hit.y)) hit={x,y,z};
      }
      if(hit) break;
    }
    if(!hit) throw Error('No '+kind+' at a testable river location');
    const {x,z}=hit;
    eye.set(x+1.19,.77,z+.45);
    look.set(x,hit.y,z);
    cameraActive=true;
    persp.fov=43;
    persp.updateProjectionMatrix();
    // Resolve the current surface again before positioning the two markers.
    for(let i=0;i<2;i++) step();
    wet.visible=dry.visible=true;
    const before=__scene.mission().water.refractionPasses;
    let now,height;
    for(let i=0;i<3;i++){
      height=leafField.height(x,z,__scene.mission().water.time+1/60);
      wet.position.set(x+.036,height-.031,z-.033);
      dry.position.set(x-.037,height+.031,z+.041);
      now=step();
      if(now.refractionPasses>before) break;
    }
    if(now.refractionPasses<=before) throw Error('Visible transmission markers did not receive a capture');
    const wetGap=leafField.height(wet.position.x,wet.position.z,now.time)-wet.position.y;
    const dryGap=dry.position.y-leafField.height(dry.position.x,dry.position.z,now.time);
    const result={height,time:now.time,wetGap,dryGap,wetY:wet.position.y,dryY:dry.position.y,
      wetPixels:count(wet.position,0),dryPixels:count(dry.position,2)};
    wet.visible=dry.visible=false;
    return result;
  }
  try {
    const crest=search('crest'),trough=search('trough');
    const motion=await reprojection();
    eye.set(-65.90,.71,-47.96);
    look.set(-67.0,.04,-46.97);
    for(let i=0;i<7;i++) step();
    const actual=shot();
    let without;
    try {
      uniforms.refractionReady.value=0;
      renderer.render(scene,persp);
      without=shot();
    } finally {uniforms.refractionReady.value=1;}
    return {crest,trough,motion,actual,without,device:[renderer.domElement.width,renderer.domElement.height]};
  } finally {
    scene.remove(wet,dry);
    geometry.dispose();wet.material.dispose();dry.material.dispose();
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
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.on("console",lambda message:errors.append(message.text) if message.type=="error" else None)
        page.route(args.url,expose_frame)
        page.route("**/bridge-water.js",expose_capture)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        try:
            page.wait_for_function("window.__scene?.mission()?.water?.refractionPasses>4",timeout=25000)
        except BrowserTimeout as error:
            raise AssertionError(errors or "The transmission pass did not start") from error
        report=page.evaluate(REPLAY)
        if args.record:
            page.close()
            page=browser.new_page(viewport={"width":1920,"height":1080})
            page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
            page.wait_for_function("window.__scene?.mission()?.water?.refractionPasses>4",timeout=25000)
            page.evaluate("""()=>{
              const {persp}=__scene;
              const update=persp.updateMatrixWorld.bind(persp), start=performance.now();
              persp.updateMatrixWorld=force=>{
                const t=Math.sin((performance.now()-start)*.00061);
                persp.position.set(-64.97-.86*t,.70+.22*t,-49.37+.81*t);
                persp.lookAt(-66.49,.025,-46.83);
                return update(force);
              };
              persp.fov=49;
              persp.updateProjectionMatrix();
              for(const id of ['missionHud','missionWaypoint','seal']) {
                const label=document.getElementById(id);if(label) label.style.display='none';
              }
            }""")
            (args.out/"refraction.webm").write_bytes(base64.b64decode(page.evaluate(RECORD)))
        browser.close()
    images=[Image.open(BytesIO(base64.b64decode(report.pop(name)))).convert("RGB") for name in ("actual","without")]
    images[0].save(args.out/"canal-4k.jpg",quality=95)
    crop=(630,850,2970,2110)
    on,off=[image.crop(crop) for image in images]
    delta=np.abs(np.asarray(on,dtype=np.int16)-np.asarray(off,dtype=np.int16)).max(axis=2)
    report["pixels"]={"changed":int((delta>6).sum()),"peak":int(delta.max()),"crop":crop}
    pair=Image.new("RGB",(2400,646))
    for i,image in enumerate((on,off)):
        pair.paste(image.resize((1200,646),Image.Resampling.LANCZOS),(i*1200,0))
    pair.save(args.out/"refraction-same-frame.jpg",quality=95)
    (args.out/"refraction.json").write_text(json.dumps({**report,"errors":errors},indent=2)+"\n")
    print(json.dumps(report),flush=True)
    assert not errors and report["device"]==[3840,2160],errors
    crest,trough=report["crest"],report["trough"]
    assert crest["wetY"]>.045 and trough["dryY"]<-.012,report
    assert min(case[key] for case in (crest,trough) for key in ("wetGap","dryGap"))>.017,report
    if args.baseline:
        assert crest["wetPixels"]==0 and trough["dryPixels"]>12,report
    else:
        assert crest["wetPixels"]>12 and trough["dryPixels"]==0,report
        assert crest["dryPixels"]==0 and trough["wetPixels"]>12,report
        motion=report["motion"]
        assert motion["screenShift"]>10 and motion["shaderError"]<.04,motion
        assert motion["foregroundRejected"] and motion["backgroundAccepted"],motion
        assert report["pixels"]["changed"]>10000,report["pixels"]


if __name__=="__main__":
    main()
