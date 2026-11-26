"""Compare weather capture timing and the same rendered state against a fresh reference."""

import argparse
import base64
import json
from io import BytesIO
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame

URL = 'http://127.0.0.1:8133/viewer/?mission&rain&gust&swell'
RIVER = [[-63.76,.88,-47.6],[-59.19,.04,-43.87]]
BANK = [[-44.47,.64,-39.41],[-51.66,.19,-41.93]]
CUT = [[-64.94,1.37,-48.34],[-60.10,.16,-41.46]]


def expose_capture(route):
    response=route.fetch()
    source=response.text()
    switch='const wetCaptureBudget=wetSurfaces && closeReflection && seesCanal;'
    target='    const oldTarget=renderer.getRenderTarget();'
    depth='const depthReuse=wetCaptureBudget && (material.defines.MIRROR_DEPTH_REUSE || availableWaterTextures(renderer)>=1);'
    assert source.count(switch)==1 and source.count(target)==1 and source.count(depth)==1
    source=source.replace(depth,depth.replace('=wetCaptureBudget','=!window.noMirrorParallax && wetCaptureBudget'))
    source=source.replace(switch,switch.replace('=wetSurfaces','=!window.rainLegacy && wetSurfaces'))
    source=source.replace(target,'    if(window.rainFresh) {reflect=true;refract=seesCanal;}\n'+target)
    route.fulfill(response=response,body=source)


def expose_weather(route):
    response=route.fetch()
    source=response.text()
    marker='  return {\n    anchor: center,'
    hook='''  window.captureRainReference=()=>weather.prepare(renderer,scene,camera,
    wet=>bridgeLook.prepare(renderer,scene,camera,wet));
'''
    assert source.count(marker)==1
    route.fulfill(response=response,body=source.replace(marker,hook+marker))


def expose_puddle_light(route):
    response=route.fetch()
    source=response.text()
    marker='  const wet=rainWetSurface(worldBounds,{'
    assert source.count(marker)==1
    route.fulfill(response=response,body=source.replace(marker,'  window.puddleMirror=mirror.rainMirrorReady;\n'+marker))


INSTALL = """()=>{
  const {renderer,persp}=__scene;
  const update=persp.updateMatrixWorld.bind(persp);
  const draw=renderer.render.bind(renderer);
  window.captureDraw=draw;
  window.capturePasses={mirror:0,transmission:0};
  renderer.render=(scene,camera)=>{
    const name=renderer.getRenderTarget()?.texture.name;
    if(name==='Canal reflection') capturePasses.mirror++;
    if(name==='Canal refraction color') capturePasses.transmission++;
    return draw(scene,camera);
  };
  let projectionTick=-1, tickEye, tickTarget;
  const setPose=pose=>{
    tickEye=pose[0];tickTarget=pose[1];
    projectionTick=-1;
  };
  window.capturePose=setPose;
  setPose([[-63.76,.88,-47.6],[-59.19,.04,-43.87]]);
  persp.fov=51;persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    if(window.capturePath && projectionTick!==capturePath.clock()) {
      const time=capturePath.clock();
      [tickEye,tickTarget]=capturePath.pose(time);
      projectionTick=time;
    }
    persp.position.set(...tickEye);persp.lookAt(...tickTarget);
    return update(force);
  };
  for(const id of ['hud','seal','missionHud','missionIntro','missionWaypoint'])
    document.getElementById(id).style.display='none';
}"""


TIMING = """({legacy,seconds})=>new Promise(resolve=>{
  const {renderer,scene}=__scene;
  const gl=renderer.getContext();
  const info=gl.getExtension('WEBGL_debug_renderer_info');
  const clock=()=>scene.getObjectByName('Canal surface').material.uniforms.time.value;
  const origin=clock();
  window.rainLegacy=legacy;
  window.capturePath={clock,pose:time=>{
    const u=Math.max(0,Math.min(1,(time-origin)/seconds));
    const v=(1-Math.cos(Math.PI*u))*.5;
    return [[-68.41+4.65*v,2.27-1.39*v,-51.77+4.17*v],[-59.19,.82-.78*v,-43.87]];
  }};
  const frames=[];
  let previous,start,totalMirror=0,totalTransmission=0,both=0;
  let passes={...capturePasses};
  function frame(now){
    start??=now;
    if(previous!==undefined && now-start>750) {
      const mirror=capturePasses.mirror>passes.mirror, transmission=capturePasses.transmission>passes.transmission;
      frames.push(now-previous);
      totalMirror+=Number(mirror);totalTransmission+=Number(transmission);both+=Number(mirror&&transmission);
    }
    previous=now;
    passes={...capturePasses};
    if(now-start<(seconds+.75)*1000){requestAnimationFrame(frame);return;}
    const order=frames.toSorted((a,b)=>a-b);
    const pct=p=>order[Math.ceil(p*order.length)-1];
    resolve({count:frames.length,p50:pct(.5),p95:pct(.95),over24:frames.filter(dt=>dt>24).length,
      totalMirror,totalTransmission,both,gpu:info&&gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
      raster:[gl.drawingBufferWidth,gl.drawingBufferHeight]});
  }
  requestAnimationFrame(frame);
})"""


REPLAY = """({scenes,cut})=>{
  const {renderer,scene,persp}=__scene;
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let tick=performance.now();
  const step=()=>leafFrame(tick+=1000/60);
  const canvasClock=()=>scene.getObjectByName('Canal surface').material.uniforms.time.value;
  const clock=()=>__scene.mission().water;
  const gl=renderer.getContext();
  const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
  const staged=new Uint8Array(width*height*4), reference=new Uint8Array(staged.length);
  const untranslated=new Uint8Array(staged.length);
  const parallax=scene.getObjectByName('Canal surface').material.uniforms.mirrorParallaxReady;
  const preview=document.createElement('canvas');
  preview.width=1600;
  preview.height=900;
  const context=preview.getContext('2d',{alpha:false});
  const read=buffer=>gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
  const photo=()=>{
    context.drawImage(renderer.domElement,0,0,preview.width,preview.height);
    return preview.toDataURL('image/jpeg',.96).split(',')[1];
  };
  function difference(first,second) {
    let absolute=0,above12=0,above24=0,above8=0;
    for(let i=0;i<first.length;i+=4){
      const r=Math.abs(first[i]-second[i]),g=Math.abs(first[i+1]-second[i+1]),b=Math.abs(first[i+2]-second[i+2]);
      absolute+=r+g+b;
      const peak=Math.max(r,g,b);
      above8+=Number(peak>8);above12+=Number(peak>12);above24+=Number(peak>24);
    }
    const count=width*height;
    return {mae:absolute/(3*count),fractionOver12:above12/count,fractionOver24:above24/count,above8};
  }
  const state=()=>{
    const {time,lastReflectionTime,lastRefractionTime,reflectionSize,reflectionSamples,refractionSize,
      reflectionViewport,reflectionPasses,refractionPasses}=clock();
    return {now:time,reflectionAge:time-lastReflectionTime,transmissionAge:time-lastRefractionTime,
      reflectionSize,reflectionSamples,refractionSize,reflectionViewport,reflectionPasses,refractionPasses};
  };
  window.rainLegacy=false;
  let before=state();
  capturePose(cut);
  step();
  let after=state();
  const jump={reflected:after.reflectionPasses-before.reflectionPasses,
    transmitted:after.refractionPasses-before.refractionPasses,reflectionAge:after.reflectionAge,
    transmissionAge:after.transmissionAge};
  const samples=[];
  for(const [name,pose] of Object.entries(scenes)){
    capturePose(pose);
    window.capturePath=null;
    if(name.startsWith('moving')) {
      const start=canvasClock();
      window.capturePath={clock:canvasClock,pose:t=>{
        const shift=(t-start)*1.02;
        return [[pose[0][0]+shift,pose[0][1],pose[0][2]-.45*shift],pose[1]];
      }};
    }
    for(let i=0;i<24;i++)step();
    for(const capture of ['reflection-stale','transmission-stale']){
      for(let i=0;i<8;i++){
        const v=state();
        if((capture==='reflection-stale'?v.reflectionAge:v.transmissionAge)>.010)break;
        step();
      }
      const timed=state(), scheduled=photo();
      read(staged);
      const reuse=parallax.value;
      let withoutShift=null;
      if(reuse>.5) {
        parallax.value=0;
        try {
          captureDraw(scene,persp);
          read(untranslated);
          withoutShift=photo();
        } finally {parallax.value=reuse;}
      }
      window.rainFresh=true;
      try {captureRainReference();} finally {window.rainFresh=false;}
      captureDraw(scene,persp);
      read(reference);
      const sample={name,capture,timed,fresh:state(),scheduled,reference:photo(),
        ...difference(staged,reference)};
      if(withoutShift) {
        sample.withoutShift=withoutShift;
        sample.untranslated=difference(untranslated,reference);
      }
      if(name==='bank' && capture==='reflection-stale') {
        const wasReady=puddleMirror.value;
        puddleMirror.value=0;
        try {
          captureDraw(scene,persp);
          read(staged);
          sample.puddleReflectionPixels=difference(staged,reference).above8;
        } finally {puddleMirror.value=wasReady;}
      }
      samples.push(sample);
      for(let i=0;i<10;i++)step();
    }
  }
  return {samples,jump};
}"""


def capture_image(payload):
    return Image.open(BytesIO(base64.b64decode(payload))).convert('RGB')


def compare_images(sample, out):
    scheduled,reference=(capture_image(sample.pop(key)) for key in ('scheduled','reference'))
    name=sample.pop('name')+'-'+sample['capture']
    scheduled.resize((1600,900),Image.Resampling.LANCZOS).save(out/(name+'-view.jpg'),quality=95)
    pair=Image.new('RGB',(1600,450))
    for i,image in enumerate((reference,scheduled)):
        pair.paste(image.resize((800,450),Image.Resampling.LANCZOS),(i*800,0))
    pair.save(out/(name+'-same-frame.jpg'),quality=95)
    shift=sample.pop('withoutShift',None)
    if shift is not None:
        triple=Image.new('RGB',(1920,360))
        for i,image in enumerate((capture_image(shift),scheduled,reference)):
            triple.paste(image.resize((640,360),Image.Resampling.LANCZOS),(i*640,0))
        triple.save(out/(name+'-depth-reuse.jpg'),quality=95)
    return {'name':name, **sample}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default=URL)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--seconds',type=float,default=6)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        def open_page(initialization=""):
            page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('console',lambda row:errors.append(row.text) if row.type=='error' else None)
            if initialization:
                page.add_init_script(initialization)
            page.route(args.url,expose_frame)
            page.route('**/bridge-water.js',expose_capture)
            page.route('**/bridge-mission.js*',expose_weather)
            page.route('**/bridge-rain.js',expose_puddle_light)
            page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
            page.wait_for_function("""window.__scene?.mission()?.rain?.time>5 && __scene.mission().water.time>5 &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            page.evaluate(INSTALL)
            return page
        timing={}
        for label,legacy in [('before',True),('scheduled',False),('after',False)]:
            page=open_page('window.noMirrorParallax=true;' if label!='after' else '')
            timing[label]=page.evaluate(TIMING,{'legacy':legacy,'seconds':args.seconds})
            print(label,timing[label],flush=True)
            page.close()
        page=open_page()
        page.wait_for_function('__scene.mission().rain.time>8.5',timeout=45000)
        print('Preparing same-frame optical comparisons',flush=True)
        replay=page.evaluate(REPLAY,{'scenes':{'river':RIVER,'moving':RIVER,'bank':BANK,'moving-bank':BANK},'cut':CUT})
        browser.close()
    samples=[compare_images(sample,args.out) for sample in replay['samples']]
    report={'timing':timing,'jump':replay['jump'],'visuals':samples,'errors':errors}
    (args.out/'rain-capture-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print({k:v for k,v in report.items() if k!='visuals'},flush=True)
    print([(s['name'],s['mae'],s['fractionOver12']) for s in samples],flush=True)
    assert not errors,errors
    before,after=timing['before'],timing['after']
    assert before['raster']==after['raster']==[3840,2160] and after['count']>args.seconds*48, timing
    assert before['both']>before['count']*.65 and after['both']<after['count']*.05,timing
    assert after['p95']<=before['p95']+.25,timing
    corrected={s['name']:s for s in samples if 'untranslated' in s}
    for label in ('moving-reflection-stale','moving-bank-reflection-stale'):
        sample=corrected[label]
        assert sample['mae']<.74*sample['untranslated']['mae'],sample
    assert replay['jump']=={'reflected':1,'transmitted':1,'reflectionAge':0,'transmissionAge':0},replay['jump']
    assert any(s.get('puddleReflectionPixels',0)>1500 for s in samples),samples
    for sample in samples:
        timed=sample['timed']
        assert timed['reflectionSize']==[1920,1080] and timed['reflectionSamples']==4, timed
        assert timed['reflectionViewport']==[0,0,1920,1080] and timed['refractionSize']==[1152,648],timed
        assert max(timed['reflectionAge'],timed['transmissionAge'])<.055,timed
        assert sample['mae']<.85 and sample['fractionOver24']<.012,sample


if __name__=='__main__':
    main()
