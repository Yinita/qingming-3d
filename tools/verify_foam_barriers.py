"""Send a passive streak of foam toward real pier and hull footprints on the GPU."""

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


def expose_scene(route):
    response=route.fetch()
    body=response.text()
    marker="  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert body.count(marker)==1
    route.fulfill(response=response,body=body.replace(marker,
        "  window.foamScene={piers,hull,skiff};\n"+marker))


INSTALL = """()=>{
  const {renderer}=__scene;
  const render=renderer.render.bind(renderer);
  window.foamPass={render};
  renderer.render=(world,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Advected canal foam') Object.assign(foamPass,{world,camera,target});
    return render(world,camera);
  };
}"""

GPU = """async()=>{
  const THREE=await import('three');
  const {channelVelocityLimit}=await import('./bridge-channel-flow.js');
  const {renderer}=__scene;
  renderer.setAnimationLoop(null);
  const {world,camera,target,render}=foamPass;
  const {uniforms}=world.children[0].material;
  const {width,height}=target, bounds=uniforms.simulationBounds.value;
  const {piers,hull}=foamScene;
  const stack=piers.slice().sort((a,b)=>Math.hypot(a.x+63.56,a.y+42.33)-Math.hypot(b.x+63.56,b.y+42.33))[0];
  const flat=new THREE.DataTexture(new Uint8Array([128,0,0,0]),1,1,THREE.RGBAFormat);
  flat.needsUpdate=true;
  const buffers=[0,1].map(()=>new THREE.WebGLRenderTarget(width,height,{depthBuffer:false}));
  const saved=Object.fromEntries(['channelFlow','waterState','previousFoam','initialized','stepSeconds','time','windStrength']
    .map(key=>[key,uniforms[key].value]));
  const raster=new Uint8Array(width*height*4);
  const cellX=1/(width*bounds.z), cellZ=1/(height*bounds.w);
  function measure(data,center,axis,shape){
    let inside=0,outside=0,edge=0,peak=0,sum=0,far=0;
    const around=[0,0];
    for(let row=0;row<height;row++) for(let col=0;col<width;col++){
      const at=(row*width+col)*4;
      const x=bounds.x+(col+.5)*cellX-center[0], z=bounds.y+(row+.5)*cellZ-center[1];
      const beam=x*axis[0]+z*axis[1], along=x*axis[1]-z*axis[0];
      const core=shape==='pier' ? Math.abs(x)<.064 && Math.abs(z)<.064 : Math.abs(beam)<.16 && Math.abs(along)<.42;
      const value=(data[at]*256+data[at+1])/65535;
      if(core){inside+=value;peak=Math.max(peak,value);}
      else outside+=value;
      if(beam>.24) far+=value;
      const edgeWidth=shape==='pier' ? .135 : .51;
      if(Math.abs(along)>edgeWidth && beam>-.40) around[Number(along>0)]+=value;
      if(Math.hypot(x,z)<1) edge+=value;
      sum+=value;
    }
    return {inside,outside,sum,peak,edge,far,around};
  }
  function inject(shape,center,axis,start,steps,spread){
    const speed=.90, scale=127/channelVelocityLimit;
    const velocity=new THREE.DataTexture(new Uint8Array([Math.round(128+speed*axis[0]*scale),
      Math.round(128+speed*axis[1]*scale),0,255]),1,1,THREE.RGBAFormat);
    velocity.needsUpdate=true;
    const initial=new Uint8Array(raster.length);
    for(let row=0;row<height;row++) for(let col=0;col<width;col++){
      const x=bounds.x+(col+.5)*cellX-center[0], z=bounds.y+(row+.5)*cellZ-center[1];
      const toward=x*axis[0]+z*axis[1]+start, across=x*axis[1]-z*axis[0];
      const density=Math.round(58000*Math.exp(-((toward/.11)**2+(across/spread)**2)));
      const at=(row*width+col)*4;
      initial[at]=density>>>8;initial[at+1]=density&255;initial[at+3]=255;
    }
    const seed=new THREE.DataTexture(initial,width,height,THREE.RGBAFormat);
    seed.minFilter=seed.magFilter=THREE.LinearFilter;
    seed.needsUpdate=true;
    uniforms.channelFlow.value=velocity;
    try {
      for(let i=0;i<steps;i++){
        uniforms.previousFoam.value=i ? buffers[(i-1)%2].texture : seed;
        uniforms.time.value=saved.time+i*.042;
        renderer.setRenderTarget(buffers[i%2]);
        render(world,camera);
      }
      renderer.readRenderTargetPixels(buffers[(steps-1)%2],0,0,width,height,raster);
      return {initial:measure(initial,center,axis,shape),result:measure(raster,center,axis,shape),center,axis};
    } finally {velocity.dispose();seed.dispose();}
  }
  try {
    uniforms.initialized.value=1;
    uniforms.waterState.value=flat;
    uniforms.windStrength.value=0;
    uniforms.stepSeconds.value=.042;
    const pier=inject('pier',[stack.x,stack.y],[0,1],.60,16,.16);
    const skiff=inject('skiff',[hull.x,hull.y],[hull.w,-hull.z],.67,18,.37);
    return {pier,skiff,size:[width,height]};
  } finally {
    renderer.setRenderTarget(null);
    for(const [key,value] of Object.entries(saved)) uniforms[key].value=value;
    flat.dispose();for(const item of buffers) item.dispose();
  }
}"""

CAMERA = """()=>{
  const {persp}=__scene;
  const update=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    persp.position.set(-66.13,1.13,-51.20);
    persp.lookAt(-63.97,.01,-48.97);
    return update(force);
  };
  persp.fov=43;
  persp.updateProjectionMatrix();
  for(const id of ['missionHud','missionWaypoint','seal']){
    const label=document.getElementById(id);if(label) label.style.display='none';
  }
}"""

MOVING = """()=>{
  const {renderer,scene,persp}=__scene;
  const {skiff,hull}=foamScene;
  leafClock.getDelta=()=>1/60;
  let clock=performance.now();
  const initial=hull.clone();
  const trace=[];
  if(!skiff.tug(__scene.mission().water.time)) throw Error('Could not pull the actual mooring rope');
  function inside(points,x,z){
    let odd=false, clearance=1;
    for(let i=0, j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i], ex=b.x-a.x, ez=b.y-a.y;
      if((a.y>z)!==(b.y>z) && x<a.x+ex*(z-a.y)/ez) odd=!odd;
      const along=Math.min(1,Math.max(0,((x-a.x)*ex+(z-a.y)*ez)/Math.max(1e-8,ex*ex+ez*ez)));
      clearance=Math.min(clearance,Math.hypot(x-a.x-along*ex,z-a.y-along*ez));
    }
    return odd && clearance>.035;
  }
  let last, visiblePeak, on, off;
  for(let frame=0;frame<155;frame++){
    leafFrame(clock+=1000/60);
    const state=__scene.mission().water;
    if(last===state.foam.passes || frame%3!==0) continue;
    last=state.foam.passes;
    const {target,world}=foamPass;
    const uniforms=world.children[0].material.uniforms;
    const points=uniforms.foamHullPoints.value, extent=uniforms.foamHullBounds.value;
    const bounds=uniforms.simulationBounds.value;
    const dx=1/(bounds.z*target.width), dz=1/(bounds.w*target.height);
    const ix=Math.floor((extent.x-bounds.x)/dx), iz=Math.floor((extent.y-bounds.y)/dz);
    const w=Math.ceil((extent.z-bounds.x)/dx)-ix, h=Math.ceil((extent.w-bounds.y)/dz)-iz;
    const pixels=new Uint8Array(w*h*4);
    renderer.readRenderTargetPixels(target,ix,iz,w,h,pixels);
    let samples=0, leaks=0, rimSamples=0;
    for(let j=0;j<h;j++) for(let i=0;i<w;i++){
      const core=inside(points,bounds.x+(ix+i+.5)*dx,bounds.y+(iz+j+.5)*dz);
      const p=(j*w+i)*4, depth=(pixels[p]*256+pixels[p+1])/65535;
      samples+=Number(core);leaks+=Number(core && depth>0);
      rimSamples+=Number(!core && depth>.035);
    }
    const regionMove=Math.hypot(hull.x-initial.x,hull.y-initial.y);
    const yaw=Math.abs(Math.atan2(initial.z*hull.w-initial.w*hull.z,initial.z*hull.z+initial.w*hull.w));
    trace.push({time:state.time,samples,leaks,rimSamples,regionMove,yaw,outline:points.map(p=>p.toArray())});
    if(!visiblePeak || rimSamples>visiblePeak){
      visiblePeak=rimSamples;
      on=renderer.domElement.toDataURL('image/png').split(',')[1];
      const detail=scene.getObjectByName('Canal surface').material.uniforms.foamDetail;
      try {
        detail.value=0;
        renderer.render(scene,persp);
        off=renderer.domElement.toDataURL('image/png').split(',')[1];
      } finally {detail.value=1;}
    }
  }
  return {trace,on,off};
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
        page.route("**/bridge-water.js",expose_scene)
        page.route(args.url,expose_frame)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("window.__scene?.mission()?.water?.foam?.passes>2",timeout=25000)
        page.evaluate(INSTALL)
        page.wait_for_function("Boolean(window.foamPass?.target)",timeout=10000)
        report=page.evaluate(GPU)
        if not args.baseline:
            page.evaluate(CAMERA)
            moving=page.evaluate(MOVING)
            images=[Image.open(BytesIO(base64.b64decode(moving.pop(kind)))).convert("RGB") for kind in ("on","off")]
            images[0].save(args.out/"skiff-4k.jpg",quality=95)
            crop=(1260,910,3140,2100)
            on,off=[im.crop(crop) for im in images]
            delta=np.abs(np.asarray(on,dtype=np.int16)-np.asarray(off,dtype=np.int16)).max(axis=2)
            pair=Image.new("RGB",(2400,760))
            for i,image in enumerate((on,off)):
                pair.paste(image.resize((1200,760),Image.Resampling.LANCZOS),(i*1200,0))
            pair.save(args.out/"skiff-same-frame.jpg",quality=95)
            report["moving"]={**moving,"changed":int((delta>6).sum()),"peak":int(delta.max())}
            if args.record:
                page.close()
                page=browser.new_page(viewport={"width":1920,"height":1080})
                page.route("**/bridge-water.js",expose_scene)
                page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
                page.wait_for_function("window.__scene?.mission()?.water?.foam?.passes>3",timeout=25000)
                page.evaluate(CAMERA)
                page.evaluate("foamScene.skiff.tug(__scene.mission().water.time)")
                (args.out/"mooring.webm").write_bytes(base64.b64decode(page.evaluate(RECORD)))
        browser.close()
    (args.out/"foam-barriers.json").write_text(json.dumps({**report,"errors":errors},indent=2)+"\n")
    print(json.dumps({k:v for k,v in report.items() if k!="moving"}),flush=True)
    assert not errors,errors
    for shape in ('pier','skiff'):
        patch=report[shape]
        if args.baseline:
            assert patch['result']['peak']>.26,patch
        else:
            assert patch['result']['inside']==0,patch
            assert patch['result']['outside']>.48*patch['initial']['sum'],patch
            assert min(patch['result']['around'])>0.20,patch
    if not args.baseline:
        motion=report["moving"]
        trace=motion["trace"]
        coverage={"frames":len(trace),"move":max(row["regionMove"] for row in trace),
            "sampledFrames":sum(row["samples"]>100 for row in trace),"samples":sum(row["samples"] for row in trace),
            "leaks":sum(row["leaks"] for row in trace),"changed":motion["changed"],"peak":motion["peak"]}
        print(json.dumps(coverage),flush=True)
        assert coverage["frames"]>28 and coverage["move"]>.18,coverage
        assert coverage["sampledFrames"]>28 and coverage["samples"]>30000 and coverage["leaks"]==0,coverage
        assert coverage["changed"]>800 and coverage["peak"]>10,coverage


if __name__=="__main__":
    main()
