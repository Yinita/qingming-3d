"""Read back a leaf-wave draw in known flow, then compare live canal optics."""

import argparse
import base64
import json
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import CAMERA, INSTALL_AUDIT, NEXT_PACKET, expose_frame, expose_packets


CONTROL = """async()=>{
  const {createLeafWater}=await import('./bridge-leaf-water.js');
  const {Vector3,PerspectiveCamera}=await import('three');
  const {renderer}=__scene;
  const view=new PerspectiveCamera(48,1.7,.03,100);
  view.position.set(0,.91,.20);
  view.lookAt(new Vector3(.04,0,.09));
  view.updateMatrixWorld();
  const n=128;
  const on=(shear,depth,barrier=false)=>{
    const waves=createLeafWater(0,(x,z,time,out)=>{
      out.depth=barrier && x>=0 ? 0 : depth;
      out.u=barrier ? .65 : .24;
      out.v=.4+shear*x;
    });
    const origin=barrier ? -.063 : 0;
    waves.begin(0);
    waves.emit('impact',4,origin,0,0,.24,.40,0,1,.135);
    waves.begin(.4);
    waves.prepare(renderer,view,.4);
    const {target,footprint,waveBasis,life,count}=leafSlopes;
    const x=footprint.getX(0),z=footprint.getY(0);
    const bounds=waves.uniforms.leafSlopeBounds.value;
    const raw=new Uint8Array(n*n*4);
    renderer.readRenderTargetPixels(target,
      Math.round((.072-bounds.x)*bounds.z*target.width)-n/2,
      Math.round((.16-bounds.y)*bounds.w*target.height)-n/2,n,n,raw);
    let s='',covered=0;
    for(let i=0;i<raw.length;i+=4) {
      const energy=Math.hypot(raw[i]-raw[i+1],raw[i+2]-raw[i+3]);
      covered+=Number(energy>4);
      s+=String.fromCharCode(Math.round(Math.min(255,energy*2.45)));
    }
    target.dispose();
    return {center:[x,z],basis:Array.from(waveBasis.array.slice(0,4)),distance:life.getZ(0),
      strength:life.getW(0),covered,count,blocked:window.leafInstances[0].blocked,raster:btoa(s)};
  };
  return {straight:on(0,.48),shear:on(.90,.48),film:on(.90,.002),wall:on(0,.043,true)};
}"""


NATIVE = """event=>{
  const {renderer,scene,persp}=__scene;
  const {target,footprint,heading,life,waveBasis,count,scene:mapScene,camera:mapCamera}=leafSlopes;
  const row=window.leafInstances.slice(0,count).findIndex(p=>p.index===event.index&&p.time===event.time&&p.type===1);
  if(row<0) throw Error('The chosen leaf wave is not in the draw');
  const data=window.leafInstances[row];
  const live=[footprint.getX(row),footprint.getY(row)];
  const age=life.getX(row);
  const linear=[event.x+age*event.u,event.z+age*event.v];
  const basis=Array.from(waveBasis.array.slice(row*4,row*4+4));
  const original=Array.from(life.array.slice(row*4,row*4+4));
  const baseline=[event.dz,-event.dx,event.dx,event.dz];
  function draw() {
    const prior=renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(mapScene,mapCamera);
    renderer.setRenderTarget(prior);
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  const priorColor=renderer.getClearColor(new (scene.background.constructor)());
  const priorAlpha=renderer.getClearAlpha();
  const oldAutoClear=renderer.autoClear;
  try {
    renderer.autoClear=true;
    renderer.setClearColor(0x000000,0);
    const current=draw();
    footprint.setXYZW(row,...linear,footprint.getZ(row),footprint.getW(row));
    waveBasis.setXYZW(row,...baseline);
    footprint.needsUpdate=waveBasis.needsUpdate=true;
    const linearImage=draw();
    return {current,linearImage,live,linear,age,basis,baseline,travel:original[2],
      hitBarrier:data.blocked,delta:Math.hypot(live[0]-linear[0],live[1]-linear[1]),
      dimensions:[renderer.domElement.width,renderer.domElement.height]};
  } finally {
    footprint.setXYZW(row,...live,footprint.getZ(row),footprint.getW(row));
    waveBasis.setXYZW(row,...basis);
    footprint.needsUpdate=waveBasis.needsUpdate=true;
    renderer.autoClear=oldAutoClear;
    renderer.setClearColor(priorColor,priorAlpha);
  }
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8133/viewer/?mission&gust&swell')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
        errors=[]
        page.on('pageerror', lambda e:errors.append(str(e)))
        page.on('console', lambda e:errors.append(e.text) if e.type=='error' else None)
        page.route(args.url,expose_frame)
        page.route('**/bridge-leaf-water.js',expose_packets)
        page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
        page.wait_for_function('window.__scene?.mission()?.water?.caustics?.passes>3',timeout=65000)
        page.evaluate(INSTALL_AUDIT)
        control=page.evaluate(CONTROL)
        panel=Image.new('L',(4*256,256))
        for i,case in enumerate(control.values()):
            frame=Image.frombytes('L',(128,128),base64.b64decode(case.pop('raster')))
            panel.paste(frame.resize((256,256)),(256*i,0))
        panel.save(args.out/'controlled-slopes.png')
        assert np.allclose(control['straight']['center'],[.096,.16],atol=.00002),control
        # z' = .4 + .9x, x' = .24. The gradient's integrated shear is .9t.
        assert np.allclose(control['shear']['center'],[.096,.17728],atol=.00002),control
        assert np.allclose(control['shear']['basis'],[1,.36,0,1],atol=.00002),control
        assert control['shear']['covered']>500 and control['film']['covered']>240,control
        assert .46<control['film']['distance']/control['shear']['distance']<.60,control
        assert -.007<control['wall']['center'][0]<0 and control['wall']['blocked']>2,control
        best=0
        for attempt in range(9):
            packet=page.evaluate(NEXT_PACKET, 'drift')
            page.evaluate(CAMERA,{'index':packet['index'],'wake':True})
            page.evaluate('()=>{for(let i=0;i<19;i++)leafStep()}')
            pair=page.evaluate(NATIVE,packet)
            images=[Image.open(BytesIO(base64.b64decode(pair.pop(key)))).convert('RGB')
                for key in ('linearImage','current')]
            box=(1410,655,2300,1535)
            crops=[image.crop(box) for image in images]
            changed=int((np.abs(np.asarray(crops[0],dtype=np.int16)-
                np.asarray(crops[1],dtype=np.int16)).max(axis=2)>6).sum())
            if changed>best:
                best=changed
                composite=Image.new('RGB',(1334,660))
                for i,crop in enumerate(crops):
                    composite.paste(crop.resize((667,660),Image.Resampling.LANCZOS),(667*i,0))
                composite.save(args.out/'canal-wave-same-frame.jpg',quality=95)
                images[1].save(args.out/'canal-wave-4k.jpg',quality=95)
                native={**pair,'source':packet,'changedPixels':changed}
            if changed>2200 and pair['delta']>.014:
                break
        assert best>700 and native['dimensions']==[3840,2160] and not errors,(best,native,errors)
        report={'control':control,'native':native,'errors':errors}
        (args.out/'leaf-flow-verification.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report),flush=True)


if __name__=='__main__':
    main()
