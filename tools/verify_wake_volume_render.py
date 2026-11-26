"""Compare depth-dependent wake transport against the same surface wake."""

import argparse
import base64
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_rain_capture_budget import INSTALL as CAPTURE
from verify_rain_wave_packets import expose_paused_frame

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission")
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


def expose_volume(route):
    response = route.fetch()
    text = response.text()
    anchor = "  return {\n    prepare,\n    caustics:caustics.uniforms,"
    assert text.count(anchor) == 1
    route.fulfill(response=response, body=text.replace(anchor, "  window.wakeLab={simulation,silt,field};\n"+anchor))


def toggle_roll(route):
    response = route.fetch()
    text = response.text()
    anchor = "    if(amp<.001) return;"
    assert text.count(anchor) == 1
    route.fulfill(response=response, body=text.replace(anchor, "    if(window.noDepthRoll || amp<.001) return;"))


SETUP = """() => {
  const {renderer,persp}=__scene;
  const render=renderer.render.bind(renderer);
  window.siltCapture={render};
  renderer.render=(scene,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Suspended canal sediment') Object.assign(siltCapture,{scene,camera,target});
    if(target?.texture.name==='Canal bubble color') siltCapture.bubbles=target;
    return render(scene,camera);
  };
  for(const id of ['missionRestart','questEntry','missionIntroShade']) {
    const element=document.getElementById(id);
    if(element) element.style.display='none';
  }
  window.tick=0;
  leafClock.getDelta=()=>1/60;
  persp.fov=39;
  persp.updateProjectionMatrix();
  capturePose([[-65.48,1.68,-46.45],[-63.78,-.11,-47.38]]);
  window.stepWake=()=>leafFrame(tick+=1000/60);
}"""

STEP = """(frames) => {
  const images=[];
  for(let i=0;i<frames;i++) {
    stepWake();
    if(i%4===3) images.push(__scene.renderer.domElement.toDataURL('image/jpeg',.93).split(',')[1]);
  }
  return images;
}"""

DEPOSIT = """() => {
  const {simulation,silt}=wakeLab;
  let source;
  simulation.visitWakes((p,radius)=>{
    if(p.source==='skiff') source={...p,radius};
  });
  if(!source) throw new Error('Missing the first skiff wake');
  const {x,z,alongX,alongZ,radius}=source;
  const edge=[x+alongZ*radius*1.05,z-alongX*radius*1.05];
  const time=__scene.mission().water.time;
  silt.disturb(...edge,time,'bed',1.45);
  return {source,edge,time};
}"""

MOMENTS = """() => {
  const {renderer}=__scene;
  const {target,bubbles}=siltCapture;
  const pixels=new Uint8Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
  let upper=0,lower=0,above=0;
  for(let i=0;i<pixels.length;i+=4) {
    const top=(pixels[i]*256+pixels[i+1])/65535, bot=(pixels[i+2]*256+pixels[i+3])/65535;
    upper+=top; lower+=bot;
    above+=Number(top>.010);
  }
  const raster=new Uint8Array(bubbles.width*bubbles.height*4);
  renderer.readRenderTargetPixels(bubbles,0,0,bubbles.width,bubbles.height,raster);
  let visibleBubbles=0;
  for(let i=3;i<raster.length;i+=4) visibleBubbles+=Number(raster[i]>23);
  return {upper,lower,above,visibleBubbles,...__scene.mission().water.submerged};
}"""

PASSIVE = """async() => {
  const THREE=await import('three');
  const {renderer}=__scene;
  const {scene,camera,target,render}=siltCapture;
  const {uniforms}=scene.children[0].material;
  const {width,height}=target, bounds=uniforms.simulationBounds.value;
  const map=uniforms.wakeVolume.value.image;
  let best=null;
  for(let row=0;row<map.height;row++) for(let col=0;col<map.width;col++) {
    const x=bounds.x+(col+.5)/(map.width*bounds.z);
    const z=bounds.y+(row+.5)/(map.height*bounds.w);
    if(x< -65.3 || x> -62.5 || z< -49.0 || z> -45.5) continue;
    const sample=map.data[(row*map.width+col)*4+2]-128;
    if(!best || sample>best.sample) best={x,z,sample};
  }
  if(!best || best.sample<12) throw new Error('No upwelling in the signed texture');
  function texture(data,w,h) {
    const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat);
    t.minFilter=t.magFilter=THREE.LinearFilter;
    t.needsUpdate=true;
    return t;
  }
  const cached=Object.fromEntries(['priorSediment','wakeVolume','channelFlow','elapsed','sourceCount','carry']
    .map(key=>[key,uniforms[key].value]));
  const buffers=[0,1].map(()=>new THREE.WebGLRenderTarget(width,height,{depthBuffer:false}));
  const seeded=new Uint8Array(width*height*4), output=new Uint8Array(seeded.length);
  for(let row=0;row<height;row++) for(let col=0;col<width;col++){
    const x=bounds.x+(col+.5)/(width*bounds.z)-best.x,z=bounds.y+(row+.5)/(height*bounds.w)-best.z;
    const value=Math.round(36000*Math.exp(-((x/.133)**2+(z/.194)**2)));
    const i=(row*width+col)*4;
    seeded[i+2]=value>>>8;seeded[i+3]=value&255;
  }
  const seed=texture(seeded,width,height);
  const still=texture(new Uint8Array([128,128,0,0]),1,1);
  const neutralData=map.data.slice();
  for(let i=0;i<neutralData.length;i+=4) neutralData[i]=neutralData[i+1]=neutralData[i+2]=128;
  const neutral=texture(neutralData,map.width,map.height);
  function mass(data) {
    let upper=0,lower=0;
    for(let i=0;i<data.length;i+=4) {
      upper+=(data[i]*256+data[i+1])/65535;
      lower+=(data[i+2]*256+data[i+3])/65535;
    }
    return {upper,lower,total:upper+lower};
  }
  let without,withRoll;
  const atlas={width:140,height:100,images:[]};
  function patch(data) {
    const col0=Math.round((best.x-bounds.x)*bounds.z*width-atlas.width*.5);
    const row0=Math.round((best.z-bounds.y)*bounds.w*height-atlas.height*.5);
    let encoded='';
    for(let layer=0;layer<2;layer++)
      for(let j=atlas.height-1;j>=0;j--) for(let i=0;i<atlas.width;i++) {
        const idx=((row0+j)*width+col0+i)*4+layer*2;
        const value=(data[idx]*256+data[idx+1])/65535;
        encoded+=String.fromCharCode(Math.min(255,Math.round(Math.sqrt(value)*310)));
      }
    atlas.images.push(btoa(encoded));
  }
  patch(seeded);
  try {
    uniforms.channelFlow.value=still;
    uniforms.sourceCount.value=0;
    uniforms.carry.value=1;
    uniforms.elapsed.value=.046;
    [without,withRoll]=[neutral,cached.wakeVolume].map(velocity=>{
      uniforms.wakeVolume.value=velocity;
      for(let frame=0;frame<17;frame++) {
        uniforms.priorSediment.value=frame ? buffers[(frame-1)%2].texture : seed;
        renderer.setRenderTarget(buffers[frame%2]);
        render(scene,camera);
      }
      renderer.readRenderTargetPixels(buffers[0],0,0,width,height,output);
      patch(output);
      return mass(output);
    });
  } finally {
    renderer.setRenderTarget(null);
    for(const [key,value] of Object.entries(cached)) uniforms[key].value=value;
    for(const item of [seed,still,neutral,...buffers]) item.dispose();
  }
  return {best,start:mass(seeded),without,withRoll,seconds:.046*17,atlas,gl:renderer.getContext().getError()};
}"""

with TemporaryDirectory(prefix="submerged-wake-frames-") as frames, sync_playwright() as api:
    browser=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
        args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
    errors=[]
    results={}
    for name in ("flat","volume"):
        page=browser.new_page(viewport={"width":1280,"height":720},device_scale_factor=1)
        page.on("pageerror", lambda error:errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type=="error" else None)
        page.add_init_script(f"window.noDepthRoll={str(name=='flat').lower()};")
        page.route(args.url,expose_paused_frame)
        page.route("**/bridge-water.js",expose_volume)
        page.route("**/bridge-wake-volume.js",toggle_roll)
        page.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        page.wait_for_function("""window.__scene && window.wakeLab &&
            __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
        page.evaluate(CAPTURE)
        page.evaluate(SETUP)
        page.evaluate("()=>{for(let i=0;i<77;i++) stepWake();}")
        injection=page.evaluate(DEPOSIT)
        series=[]
        target=Path(frames)/name
        target.mkdir()
        index=0
        for i in range(6):
            for photo in page.evaluate(STEP,24):
                (target/f"{index:03d}.jpg").write_bytes(base64.b64decode(photo))
                index+=1
            series.append(page.evaluate(MOMENTS))
            if i==1:
                page.evaluate("""()=>{
                  const {renderer}=__scene;
                  renderer.setPixelRatio(3);
                  renderer.setSize(1280,720);
                  stepWake();
                }""")
                file=args.out/f"{name}-4k.jpg"
                data64=page.evaluate("() => __scene.renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1]")
                file.write_bytes(base64.b64decode(data64))
                assert Image.open(file).size==(3840,2160)
                if name=="volume":
                    disabled=page.evaluate("""()=>{
                      const {renderer,scene,persp}=__scene;
                      const murk=scene.getObjectByName('Canal surface').material.uniforms.murkStrength;
                      const before=murk.value;
                      try{
                        murk.value=0;
                        captureDraw(scene,persp);
                        return renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
                      } finally {murk.value=before;}
                    }""")
                    (args.out/"volume-clear-4k.jpg").write_bytes(base64.b64decode(disabled))
                page.evaluate("()=>{__scene.renderer.setPixelRatio(1);__scene.renderer.setSize(1280,720);}")
        results[name]={"injection":injection,"series":series}
        if name=="volume":
            results["passive"]=page.evaluate(PASSIVE)
        print(name,[(round(s["upper"],2),round(s["lower"],2),s["visibleBubbles"]) for s in series],flush=True)
        page.close()

    assert not errors,errors
    assert results["volume"]["injection"]==results["flat"]["injection"]
    passive=results["passive"]
    atlas=passive.pop("atlas")
    for index, data in enumerate(atlas["images"]):
        w,h=atlas["width"],atlas["height"]
        Image.frombytes("L",(w,h*2),base64.b64decode(data)).save(args.out/f"probe-{index}.png")
    print(passive,flush=True)
    assert passive["gl"]==0 and passive["without"]["upper"]<.005,passive
    assert passive["withRoll"]["upper"]>passive["start"]["lower"]*.11,passive
    assert abs(passive["without"]["total"]-passive["withRoll"]["total"]) < passive["start"]["lower"]*.05,passive
    bubbles=results["volume"]["series"][-1]["bubbles"]
    assert bubbles["emitters"]["wake"]>12 and bubbles["maximumDownwash"]>.08,bubbles
    assert results["flat"]["series"][-1]["bubbles"]["maximumDownwash"]==0
    # The wake is to the right and below the skiff in this fixed composition.
    crop=(2050,700,3400,1780)
    a,b,c=[np.asarray(Image.open(args.out/f"{tag}-4k.jpg").crop(crop),dtype=np.int16)
           for tag in ("flat","volume","volume-clear")]
    def pixel_change(reference):
        delta=np.abs(b-reference).mean(axis=2)
        return {"crop":crop,"pixelsAboveFour":int((delta>4).sum()),
                "fractionAboveFour":float((delta>4).mean()),"peak":float(delta.max())}
    results["difference"]=pixel_change(a)
    results["sedimentOptics"]=pixel_change(c)
    assert results["difference"]["pixelsAboveFour"]>1000 and results["difference"]["peak"]>15,results["difference"]
    assert results["sedimentOptics"]["pixelsAboveFour"]>10000,results["sedimentOptics"]
    (args.out/"render.json").write_text(json.dumps(results,ensure_ascii=False,indent=2)+"\n")
    subprocess.run(["ffmpeg","-loglevel","error","-y","-filter_complex_threads","1",
        "-framerate","15","-i",str(Path(frames)/"flat/%03d.jpg"),"-framerate","15","-i",
        str(Path(frames)/"volume/%03d.jpg"),"-filter_complex",
        "[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2",
        "-c:v","libx264","-pix_fmt","yuv420p","-crf","18","-movflags","+faststart",
        str(args.out/"submerged-wake-comparison.mp4")],check=True)
    browser.close()
