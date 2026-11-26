"""Read back shallow-water optics and test the transmission of a captured bed signal."""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame

AUDIT = r"""async ({prior})=>{
  const THREE=await import('three');
  const {swashOpticsGLSL}=await import('./bridge-swash-film.js');
  const {renderer,scene,persp}=__scene;
  const river=scene.getObjectByName('Canal surface');
  const mat=river.material;
  const optical=mat.fragmentShader;
  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let tick=performance.now();
  const eye=new THREE.Vector3(-65.85,1.64,-47.87), aim=new THREE.Vector3(-67.39,.035,-48.88);
  const update=persp.updateMatrixWorld.bind(persp);
  persp.updateMatrixWorld=force=>{
    persp.position.copy(eye);
    persp.lookAt(aim);
    return update(force);
  };
  persp.fov=48;
  persp.updateProjectionMatrix();
  for(const id of ['missionHud','missionIntro','missionWaypoint','seal'])
    document.getElementById(id).style.display='none';

  const gl=renderer.getContext();
  const w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
  const rect=[Math.round(w*.12),Math.round(h*.14),Math.round(w*.74),Math.round(h*.67)];
  const read=(shader)=>{
    mat.fragmentShader=shader;
    mat.needsUpdate=true;
    renderer.render(scene,persp);
    const image=new Uint8Array(rect[2]*rect[3]*4);
    gl.readPixels(...rect,gl.RGBA,gl.UNSIGNED_BYTE,image);
    return image;
  };
  const maskShader=optical.replace('    gl_FragColor = vec4(mix(color',`
    #ifdef COHERENT_BREAKERS
    if(shoreLens>.8 && shoreConfidence>.72 && facing>.39 && foam<.22 && column<.19) {
      gl_FragColor=vec4(0.,1.,1.,1.);
      return;
    }
    #endif
    gl_FragColor = vec4(mix(color`);
  if(maskShader===optical) throw Error('No shoreline sample marker');
  function mapSelection(image) {
    const selected=[];
    for(let at=0;at<image.length;at+=4)
      if(image[at]===0 && image[at+1]===255 && image[at+2]===255) selected.push(at);
    return selected;
  }
  function withBedSignal(shader) {
    const edit=shader.replace(/texture2D\(refractionColor,\s*(uv|sampleUV)\)\.rgb/g,
      '($&+vec3(0.,.10,0.))');
    if(edit===shader) throw Error('No deployed transmission sample');
    return edit;
  }

  let selected=[],sample,images;
  const shadows=renderer.shadowMap.autoUpdate;
  try {
    for(let i=0;i<440;i++) {
      leafFrame(tick+=1000/60);
      const {swash,time}=__scene.mission().water;
      if(i%6!==0 || swash.liveReach<.125) continue;
      renderer.shadowMap.autoUpdate=false;
      selected=mapSelection(read(maskShader));
      if(selected.length>10000) {
        sample={time,reach:swash.liveReach,pixels:selected.length};
        break;
      }
      mat.fragmentShader=optical;
      mat.needsUpdate=true;
      renderer.shadowMap.autoUpdate=shadows;
    }
    if(!sample) throw Error('No confirmed shallow bed transmission in camera footprint');
    function sensitivity(base,signal) {
      let sum=0, above8=0;
      for(const at of selected) {
        const delta=signal[at+1]-base[at+1];
        sum+=delta;
        above8+=Number(delta>8);
      }
      return {mean:sum/selected.length,above8};
    }
    const old=prior.replace('__SHORE_HULL_SOURCE__',()=>shoreAuditHull);
    const photo=()=>renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    const restored=read(optical);
    const after=photo();
    const signalAfter=read(withBedSignal(optical));
    const older=read(old);
    const before=photo();
    const signalBefore=read(withBedSignal(old));
    images={before,after};
    sample.before=sensitivity(older,signalBefore);
    sample.after=sensitivity(restored,signalAfter);
  } finally {
    mat.fragmentShader=optical;
    mat.needsUpdate=true;
    renderer.shadowMap.autoUpdate=shadows;
  }

  // Run the exact production GLSL at known angles and optical path lengths.
  const cases=[
    [1,0,0],[.5,0,0],[.08,0,0],[0,0,0],
    [1,.006,0],[1,.06,0],[1,.22,0],[1,.22,1],
    [.59,.086,.42],[.25,.165,.93],
  ];
  const values=new Float32Array(cases.length*4);
  cases.forEach((args,i)=>values.set(args,i*4));
  const inputs=new THREE.DataTexture(values,cases.length,1,THREE.RGBAFormat,THREE.FloatType);
  inputs.needsUpdate=true;
  const probe=new THREE.ShaderMaterial({
    uniforms:{fields:{value:inputs}},
    vertexShader:'void main(){gl_Position=vec4(position,1.);}',
    fragmentShader:`uniform sampler2D fields;
      ${swashOpticsGLSL}
      void main(){
        vec3 args=texture2D(fields,vec2(gl_FragCoord.x/${cases.length}.,.5)).rgb;
        gl_FragColor=shadeWaterFilm(vec3(.16,.22,.28),vec3(.81,.67,.60),vec3(.40,.30,.10),
         vec3(1.19,.80,1.57),args.y,args.x,args.z);
      }`,
  });
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const quad=new THREE.Mesh(geo,probe);
  quad.frustumCulled=false;
  const stage=new THREE.Scene();
  stage.add(quad);
  const target=new THREE.WebGLRenderTarget(cases.length,1,{type:THREE.FloatType,depthBuffer:false});
  renderer.setRenderTarget(target);
  renderer.render(stage,new THREE.Camera());
  renderer.readRenderTargetPixels(target,0,0,cases.length,1,values);
  renderer.setRenderTarget(null);
  target.dispose();inputs.dispose();probe.dispose();geo.dispose();
  return {sample,cases:cases.map((args,i)=>[...args,Array.from(values.slice(i*4,i*4+4))]),raster:[w,h],images};
}"""


def expected(facing, path, captured):
    from math import exp, sqrt
    index=1.333
    cos_t=sqrt(1-(1-facing*facing)/(index*index))
    rs=(facing-index*cos_t)/(facing+index*cos_t)
    rp=(index*facing-cos_t)/(index*facing+cos_t)
    reflection=.5*(rs*rs+rp*rp)
    trans=[(1-reflection)*exp(-ext*path) for ext in (1.19,.80,1.57)]
    alpha=1-(1-captured)*sum(w*t for w,t in zip((.2126,.7152,.0722),trans))
    color=[(reflection*r+(1-reflection-t)*s+captured*t*b)/alpha
           for r,t,s,b in zip((.81,.67,.60),trans,(.16,.22,.28),(.40,.30,.10))]
    return color+[alpha]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8133/viewer/?mission&gust&swell')
    parser.add_argument('--reference',type=Path,required=True,
                        help='Directory containing the before-change bridge-water.js.')
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    prior=args.reference/'bridge-water.js'
    errors=[]
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('console',lambda log:errors.append(log.text) if log.type=='error' else None)
        page.route(args.url,expose_frame)
        def expose(route):
            response=route.fetch()
            code=response.text()
            marker='  const surfaceFoam=createFoamTransport(uniforms,piers,skiff,leafField);'
            assert code.count(marker)==1
            route.fulfill(response=response,body=code.replace(marker,marker+
                '\n  window.shoreAuditHull=surfaceFoam.obstacles.hullGLSL;'))
        page.route('**/bridge-water.js',expose)
        page.route('**/bridge-water-before-shore.js',lambda route:route.fulfill(
            body=prior.read_text()+'\nexport {fragmentShader};',content_type='text/javascript'))
        page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
        page.wait_for_function('window.__scene?.mission()?.water?.swash?.foam?.passes>5',timeout=65000)
        shader=page.evaluate("""async()=> (await import('./bridge-water-before-shore.js'))
          .fragmentShader('__SHORE_HULL_SOURCE__')""")
        report=page.evaluate(AUDIT,{'prior':shader})
        browser.close()
    report['errors']=errors
    report['maxGpuError']=max(abs(a-b) for facing,path,valid,observed in report['cases']
        for a,b in zip(observed,expected(facing,path,valid)))
    for name,encoded in report.pop('images').items():
        (args.out/f'bed-{name}-4k.jpg').write_bytes(base64.b64decode(encoded))
    (args.out/'shore-transmission.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)
    assert not errors,errors
    assert report['raster']==[3840,2160] and report['maxGpuError']<.00003,report
    sample=report['sample']
    assert sample['after']['mean']>sample['before']['mean']*1.15 and sample['after']['above8']>5000,sample


if __name__=='__main__':
    main()
