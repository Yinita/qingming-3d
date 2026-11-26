"""Replay the wet ground sampler feedback on exactly the same rain frame."""
import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame
from verify_rain_capture_budget import URL, INSTALL, RIVER, expose_capture, expose_weather

def expose_rain(route):
    response=route.fetch()
    source=response.text()
    line='for(const {binding} of captureSamplers) binding.value=null;'
    assert source.count(line)==1
    route.fulfill(response=response,body=source.replace(
        line,'if(!window.auditBoundSamplers) '+line))

COMPARE="""poses=>{
  const {renderer,scene,persp}=__scene, gl=renderer.getContext();
  const boundRender=renderer.render;
  let mirror;
  renderer.render=(...args)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Canal reflection') mirror=target;
    return boundRender(...args);
  };
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let tick=performance.now();
  const step=()=>leafFrame(tick+=1000/60);
  const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  const preview=document.createElement('canvas');
  preview.width=1600;preview.height=900;
  const pen=preview.getContext('2d',{alpha:false});
  const main=new Uint8Array(w*h*4), compared=new Uint8Array(main.length);
  const photo=()=>{
    pen.drawImage(renderer.domElement,0,0,preview.width,preview.height);
    return preview.toDataURL('image/jpeg',.95).split(',')[1];
  };
  const stats=(a,b)=>{
    let changed=0,above8=0,mean=0;
    for(let i=0;i<a.length;i+=4){
      const r=Math.abs(a[i]-b[i]),g=Math.abs(a[i+1]-b[i+1]),c=Math.abs(a[i+2]-b[i+2]);
      changed+=Number(r+g+c>0);
      above8+=Number(Math.max(r,g,c)>8);
      mean+=r+g+c;
    }
    return {pixels:a.length/4,changed,above8,mean:mean/(a.length*.75)};
  };
  function snap(bad,buffer) {
    window.auditBoundSamplers=bad;
    window.rainFresh=true;
    captureRainReference();
    captureDraw(scene,persp);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
    const image=photo();
    const reflect=new Uint8Array(mirror.width*mirror.height*4);
    renderer.readRenderTargetPixels(mirror,0,0,mirror.width,mirror.height,reflect);
    const capture=document.createElement('canvas');
    capture.width=mirror.width;capture.height=mirror.height;
    const pixels=new Uint8ClampedArray(reflect.buffer);
    const ctx=capture.getContext('2d');
    ctx.putImageData(new ImageData(pixels,mirror.width,mirror.height),0,0);
    const flipped=document.createElement('canvas');
    flipped.width=mirror.width;flipped.height=mirror.height;
    const screen=flipped.getContext('2d');
    screen.setTransform(1,0,0,-1,0,mirror.height);
    screen.drawImage(capture,0,0);
    return {image,reflect,reflection:flipped.toDataURL('image/png').split(',')[1],error:gl.getError()};
  }
  const result=[];
  for(const [name,pose] of Object.entries(poses)) {
    capturePose(pose);window.auditBoundSamplers=false;
    for(let i=0;i<20;i++)step();
    const before=snap(true,main), after=snap(false,compared);
    result.push({name,before:before.image,after:after.image,beforeMirror:before.reflection,
      afterMirror:after.reflection,screen:stats(main,compared),
      mirror:stats(before.reflect,after.reflect),beforeError:before.error,afterError:after.error});
  }
  return result;
}"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default=URL)
    parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)

    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',args=[
            '--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
        page.route(args.url,expose_frame)
        page.route('**/bridge-water.js',expose_capture)
        page.route('**/bridge-mission.js*',expose_weather)
        page.route('**/bridge-rain.js',expose_rain)
        page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
        page.wait_for_function("""window.__scene?.mission()?.rain?.time>6 &&
            __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
        page.evaluate(INSTALL)
        result=page.evaluate(COMPARE,{'wide-canal':[[-68.41,4.6,-51.77],[-59.19,.06,-43.87]],
                'wide-bank':[[-45.08,4.12,-39.70],[-51.66,.19,-41.93]], 'near-canal':RIVER})
        browser.close()
    for sample in result:
        for key,ext in [('before','jpg'),('after','jpg'),('beforeMirror','png'),('afterMirror','png')]:
            (args.out/(sample['name']+'-'+key+'.'+ext)).write_bytes(base64.b64decode(sample.pop(key)))
        assert sample['afterError']==0, sample
        if sample['name'].startswith('wide'):
            assert sample['beforeError']==1282, sample
    assert max(row['mirror']['above8'] for row in result)>100, result
    (args.out/'wet-feedback-verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':
    main()
