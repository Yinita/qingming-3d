"""Check reflection depth validity across controlled rain, dry and rain transitions."""

import argparse
import json
from pathlib import Path

from verify_rain_capture_budget import URL, RIVER, INSTALL, expose_frame
from playwright.sync_api import sync_playwright

def expose_phase(route):
    response=route.fetch()
    source=response.text()
    marker='  function update(elapsed,dt,camera,moving) {'
    assert source.count(marker)==1
    hook='  window.probeRainPhase=phase=>{time=phase;deadline=phase-1;};\n'
    route.fulfill(response=response,body=source.replace(marker,hook+marker))

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',default=URL)
parser.add_argument('--out',required=True,type=Path)
args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=True)

with sync_playwright() as api:
    browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
        args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
    page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda row:errors.append(row.text) if row.type=='error' else None)
    page.route(args.url,expose_frame)
    page.route('**/bridge-rain.js',expose_phase)
    page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
    page.wait_for_function('window.__scene?.mission()?.rain?.time>5',timeout=65000)
    page.evaluate(INSTALL)
    report=page.evaluate("""pose=>{
      const {renderer,scene}=__scene;
      const uniforms=scene.getObjectByName('Canal surface').material.uniforms;
      renderer.setAnimationLoop(null);
      leafClock.getDelta=()=>1/60;
      let stamp=performance.now(),shift=0;
      const draw=renderer.render.bind(renderer);
      let depthError=0,recorded=0;
      renderer.render=(world,camera)=>{
        if(renderer.getRenderTarget()?.texture?.name==='Canal reflection' && uniforms.mirrorSceneDepth.value) {
          const inv=camera.projectionMatrixInverse.elements;
          const expected=[2*inv[3],2*inv[7],2*inv[11], inv[15]-inv[3]-inv[7]-inv[11]];
          const actual=uniforms.mirrorDepthUnpack.value.toArray();
          depthError=Math.max(depthError,...expected.map((entry,i)=>Math.abs(entry-actual[i])));
          recorded++;
        }
        draw(world,camera);
      };
      function advance() {
        shift+=.017;
        capturePose([[pose[0][0]+shift,pose[0][1],pose[0][2]],pose[1]]);
        leafFrame(stamp+=1000/60);
        const {rain,water}=__scene.mission();
        return {reuse:uniforms.mirrorParallaxReady.value,mirror:water.reflectionPasses,rain:rain.intensity,
          foliagePatch:water.foliageMirror.active};
      }
      const wet=Array.from({length:5},advance);
      probeRainPhase(20);
      const dry=Array.from({length:4},advance);
      probeRainPhase(5);
      const rewet=Array.from({length:6},advance);
      return {wet,dry,rewet,depthError,recorded,size:[uniforms.mirrorSceneDepth.value.image.width,
        uniforms.mirrorSceneDepth.value.image.height]};
    }""",RIVER)
    report['errors']=errors
    (args.out/'wet-transition.json').write_text(json.dumps(report,indent=2)+'\n')
    print(report,flush=True)
    assert any(x['reuse'] for x in report['wet']) and all(x['reuse']==0 and x['rain']==0 for x in report['dry']),report
    assert report['rewet'][0]['rain']==1 and any(x['reuse'] for x in report['rewet']),report
    assert not any(x['foliagePatch'] for x in report['dry']) and not report['rewet'][0]['foliagePatch'],report
    assert report['depthError']<1e-7 and report['size']==[1920,1080] and not errors,report
