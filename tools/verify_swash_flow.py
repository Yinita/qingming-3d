"""Verify that a blocked shore cell drives foam and bubble motion in the same wet gaps."""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_swash_foam import CAMERA

LIVE = """async()=>{
  const THREE=await import('three');
  const {canalShoreRadius}=await import('./bridge-canal-bed.js');
  const origin=__scene.scene.getObjectByName('Canal surface').material.uniforms.origin.value;
  const expected=new THREE.Vector2();
  const tracked=new Set();
  let samples=0,thin=0,maxDifference=0,maxAlong=0,bankward=0,riverward=0,depth=0;
  window.checkShoreFlow=(leaf,time,film,u,v,field)=>{
    const {x,z}=leaf.position;
    field.velocity(x,z,time,expected);
    maxDifference=Math.max(maxDifference,Math.hypot(expected.x-u,expected.y-v));
    maxAlong=Math.max(maxAlong,Math.abs(v));
    depth=Math.max(depth,film.depth);
    samples++;
    thin+=Number(film.depth<.02);
    const along=z-origin.y;
    const shoreBend=(canalShoreRadius(along-.04,-1)-canalShoreRadius(along+.04,-1))/.08;
    const cross=u-shoreBend*v;
    bankward+=Number(cross<-.03);
    riverward+=Number(cross>.03);
    if(leaf.id!==null) tracked.add(leaf.id);
  };
  return await new Promise(resolve=>{
    function tick(){
      const {time}=__scene.mission().water;
      if(time<10.8) return requestAnimationFrame(tick);
      delete window.checkShoreFlow;
      resolve({samples,thin,tracked:tracked.size,maxDifference,maxAlong,bankward,riverward,depth});
    }
    requestAnimationFrame(tick);
  });
}"""

AUDIT = """async()=>{
  const THREE=await import('three');
  const {createSwashFoam}=await import('./bridge-swash-foam.js');
  const {canalShoreRadius,canalTerrainHeight}=await import('./bridge-canal-bed.js');
  const {renderer}=__scene;
  renderer.setAnimationLoop(null);

  const origin=new THREE.Vector2(-58.764,-43.172);
  const start=-49.2, rows=21, span=2.1, dz=span/rows;
  const left=-.57, width=1.84, columns=48, dx=width/columns;
  const row=10, col=17, s=left+(col+.5)*dx, t=1/30;
  const bank=Array.from({length:rows},(_,i)=>{
    const z=start+(i+.5)*dz;
    const x=origin.x-canalShoreRadius(z-origin.y,-1);
    return {x,z,reach:.33,filmReach:.33,velocity:.78,surface:.114};
  });
  const {x,z}=bank[row];
  function caseFor(obstacle, reverseGap=false) {
    const shallow=row+(reverseGap ? 1 : -1), deep=row+(reverseGap ? -1 : 1);
    function stoneHeight(px,pz) {
      const r=Math.round((pz-start)/dz-.5);
      const c=Math.round((px-bank[r].x-left)/dx-.5);
      if(!obstacle) return -Infinity;
      if(c===col-1 && r===row) return .20;
      if(c===col && r===shallow) return .100;
      if(c===col && r===deep) return canalTerrainHeight(origin,px,pz);
      return -Infinity;
    }
    const field={
      height:()=>.114,
      velocity:(_x,_z,_t,out)=>out.set(0,0),
      disturbance:(_x,_z,out)=>{out.foam=0;return out;},
    };
    const foam=createSwashFoam(origin,start,span,bank,field,{height:stoneHeight},()=>{});
    foam.frame(.23,t);
    const velocity={};
    const blend=foam.sampleVelocity(s,z,velocity);
    foam.deposit(x+s,z,.95);
    foam.frame(.23+t,t);

    const i=row*columns+col;
    const state=foam.uniforms.bankBubblePaths.value.image.data;
    const diffuse=foam.uniforms.bankFoamMap.value.image.data;
    const shift=Array.from(state.subarray(i*4,i*4+2),THREE.DataUtils.fromHalfFloat);
    const rock=Array.from(diffuse.subarray((i-1)*4,(i-1)*4+3));
    const bend=(bank[row+1].x-bank[row-1].x)/(2*dz);
    const across=velocity.u-bend*velocity.v;
    const stats=foam.inspect();
    for(const uniform of ['bankFoamMap','bankBubblePaths']) foam.uniforms[uniform].value.dispose();
    return {velocity,across,blend,shift,rock,deflection:stats.stoneDeflection,balance:stats.massError};
  }
  const open=caseFor(false), wall=caseFor(true), reversedGap=caseFor(true,true);
  for(const r of bank) r.velocity=-.78;
  const retreat=caseFor(true);
  return {open,wall,reversedGap,retreat,dt:t};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8133/viewer/?mission&gust&swell')
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        page=browser.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('console',lambda item:errors.append(item.text) if item.type=='error' else None)
        def expose_flow(route):
            response=route.fetch()
            marker='      waterZ=flow.y;'
            source=response.text()
            assert source.count(marker)==1
            hook='\n      if(film.film) window.checkShoreFlow?.(leaf,time,film,waterX,waterZ,field);'
            route.fulfill(response=response,body=source.replace(marker,marker+hook))
        page.route('**/bridge-canal-leaves.js',expose_flow)
        page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
        page.wait_for_function('__scene?.mission()?.water?.swash?.foam.passes>3',timeout=65000)
        page.evaluate(CAMERA)
        live=page.evaluate(LIVE)
        report=page.evaluate(AUDIT)
        browser.close()
    report['live']=live
    report['errors']=errors
    (args.out/'shared-flow.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)
    assert not errors,errors
    assert report['open']['across']<-.25 and report['retreat']['across']>.25,report
    for label,sign in [('wall',1),('reversedGap',-1)]:
        wall=report[label]
        assert abs(wall['across'])<1e-6 and wall['velocity']['v']*sign>.045,wall
        assert abs(wall['shift'][0])<1e-6 and abs(wall['shift'][1]+wall['velocity']['v']*report['dt'])<.00009,wall
        assert wall['rock']==[0,0,0] and wall['deflection']>0,wall
    assert all(abs(report[k]['balance'])<.000003 for k in ['open','wall','reversedGap','retreat']),report
    assert live['samples']>250 and live['thin']>80 and live['tracked']>=3 and live['maxDifference']<1e-6,live
    assert live['bankward']>0 and live['riverward']>0 and live['maxAlong']>.08,live


if __name__=='__main__':
    main()
