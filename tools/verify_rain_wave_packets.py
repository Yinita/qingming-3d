"""Check rain wave transport, frame cadence and signed water highlights."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_rain_capture_budget import INSTALL, RIVER, TIMING, URL


SHALLOWS = [[-65.77,.70,-47.83],[-67.64,.048,-48.91]]


def expose_paused_frame(route):
    response = route.fetch()
    source = response.text()
    start = 'renderer.setAnimationLoop(now => {'
    end = '  renderer.render(scene, cam);\n});'
    assert source.count(start) == source.count(end) == 1
    source = source.replace(start, 'window.leafFrame = now => {')
    source = source.replace(end, '  renderer.render(scene, cam);\n};')
    source = source.replace('const clock = new THREE.Clock();',
        'const clock = new THREE.Clock(); window.leafClock=clock;')
    route.fulfill(response=response,body=source)


ATLAS = """async ()=>{
  const {makeRainRipples}=await import('./bridge-rain-ripples.js');
  const {Vector4}=await import('three');
  const {renderer}=__scene;
  const ripples=makeRainRipples(new Vector4(-.60,-.60,1/1.2,1/1.2));
  const {width,height}=ripples.target;
  const pixels=new Uint8Array(width*height*4);
  function measure(t,x=0,z=0) {
    ripples.update(renderer,t);
    renderer.readRenderTargetPixels(ripples.target,0,0,width,height,pixels);
    let energy=0, mx=0,mz=0,wide=0,core=0,count=0,largest=0;
    for(let j=0;j<height;j++) for(let i=0;i<width;i++) {
      const k=(j*width+i)*4;
      const dx=pixels[k]-pixels[k+1], dz=pixels[k+2]-pixels[k+3];
      const weight=dx*dx+dz*dz;
      if(!weight)continue;
      const px=1.2*(i+.5)/width-.6,pz=1.2*(j+.5)/height-.6;
      const r=Math.hypot(px-x,pz-z);
      energy+=weight;
      mx+=weight*px;mz+=weight*pz;
      if(r>.315 && r<.45)wide+=weight;
      if(r>.12 && r<.297)core+=weight;
      count++;
      largest=Math.max(largest,r);
    }
    return {t,energy,wide,core,center:energy?[mx/energy,mz/energy]:null,count,largest,
      ...ripples.inspect()};
  }
  const velocity=[.37,-.23];
  ripples.enter(0,0,0,.77,1,.88,...velocity);
  const first=measure(.35,...velocity.map(v=>v*.35));
  const next=measure(.35+1/60,...velocity.map(v=>v*(.35+1/60)));
  const repeat=measure(.35+1/60,...velocity.map(v=>v*(.35+1/60)));
  const separating=measure(.60,...velocity.map(v=>v*.60));
  const fading=measure(.81,...velocity.map(v=>v*.81));
  const ended=measure(.92);
  return {first,next,repeat,separating,fading,ended,velocity};
}"""


REPLAY = """poses=>{
  const {renderer,scene,persp}=__scene, gl=renderer.getContext();
  const water=scene.getObjectByName('Canal surface');
  const slope=water.material.uniforms.rainRippleReady;
  const rain=scene.getObjectByName('Rain over the bridge district');
  leafClock.getDelta=()=>1/60;
  let tick=0;
  const step=()=>leafFrame(tick+=1000/60);
  const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
  const wet=new Uint8Array(width*height*4), flat=new Uint8Array(wet.length);
  const read=dest=>gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,dest);
  const frames=[];
  capturePose(poses.river);
  for(let i=0;i<330;i++)step();
  for(const [label,pose] of Object.entries(poses)){
    capturePose(pose);
    for(let i=0;i<12;i++)step();
    rain.visible=false;
    captureDraw(scene,persp);
    read(wet);
    const image=renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    const ready=slope.value;
    slope.value=0;
    captureDraw(scene,persp);
    read(flat);
    rain.visible=true;
    slope.value=ready;
    let lighter=0,darker=0,change=0;
    for(let i=0;i<wet.length;i+=4){
      const d=.2126*(wet[i]-flat[i])+.7152*(wet[i+1]-flat[i+1])+.0722*(wet[i+2]-flat[i+2]);
      lighter+=Number(d>4);
      darker+=Number(d<-4);
      change+=Math.abs(d);
    }
    const {time,ripples,counts}=__scene.mission().rain;
    frames.push({label,image,lighter,darker,meanChange:change/(width*height),time,ripples,
      fineImpacts:counts.fineImpacts,glError:gl.getError(),raster:[width,height]});
  }
  return frames;
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default=URL)
    parser.add_argument('--reference',required=True,help='Viewer URL for the prior render pipeline')
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--seconds',type=float,default=5)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])

        def open_page(url,paused=False):
            page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda row:errors.append(row.text)
                if row.type=='error' or 'GL_INVALID' in row.text else None)
            if paused:
                page.route(url,expose_paused_frame)
            page.goto(url,wait_until='domcontentloaded',timeout=65000)
            page.wait_for_function("""window.__scene &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            page.evaluate(INSTALL)
            return page

        frames={}
        atlas=None
        for label,url in [('before',args.reference),('after',args.url)]:
            page=open_page(url,paused=True)
            if label=='after':
                atlas=page.evaluate(ATLAS)
            frames[label]=page.evaluate(REPLAY,{'river':RIVER,'shore':SHALLOWS})
            for frame in frames[label]:
                (args.out/(label+'-'+frame['label']+'-4k.jpg')).write_bytes(
                    base64.b64decode(frame.pop('image')))
            print(label,frames[label],flush=True)
            page.close()

        timing={}
        for label,url in [('before',args.reference),('after',args.url)]:
            page=open_page(url)
            page.wait_for_function('__scene.mission().rain.time>5',timeout=65000)
            timing[label]=page.evaluate(TIMING,{'legacy':False,'seconds':args.seconds})
            print(label,timing[label],flush=True)
            page.close()
        browser.close()
    report={'atlas':atlas,'frames':frames,'timing':timing,'errors':errors}
    (args.out/'rain-wave-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(atlas),flush=True)
    assert not errors,errors
    assert atlas['separating']['wide']>0 and atlas['separating']['core']>0,atlas
    assert atlas['next']['passes']==atlas['first']['passes']+1,atlas
    assert atlas['next']['passes']==atlas['repeat']['passes'],atlas
    for sample in (atlas['first'],atlas['next'],atlas['separating']):
        assert all(abs(atlas['velocity'][i]*sample['t']-sample['center'][i])<.001 for i in range(2)),sample
    assert 0<atlas['fading']['energy']<atlas['separating']['energy'] and atlas['ended']['energy']==0,atlas
    for previous,updated in zip(frames['before'],frames['after']):
        assert previous['fineImpacts']==updated['fineImpacts'] and previous['time']==updated['time'],frames
        assert updated['raster']==[3840,2160] and updated['glError']==0,updated
        assert updated['lighter']>500 and updated['darker']>500,updated


if __name__=='__main__':
    main()
