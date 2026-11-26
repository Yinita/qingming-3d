"""Check a held reflection for moving and departing leaves against a fresh render."""

import argparse
import base64
from pathlib import Path
import json

from PIL import Image
from io import BytesIO
from playwright.sync_api import sync_playwright

from verify_rain_capture_budget import INSTALL, expose_frame, expose_weather
from verify_reflected_leaves import expose

URL = 'http://127.0.0.1:8133/viewer/?mission&rain&gust'

TIMING = """seconds=>new Promise(resolve=>{
  const {renderer}=__scene;
  const gl=renderer.getContext();
  const gpuInfo=gl.getExtension('WEBGL_debug_renderer_info');
  const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const render=renderer.render.bind(renderer);
  const frames=[],queries=[],duration={full:[],tile:[]};
  const counts={full:0,tile:0};
  let period=0,previous=0,started,measuring=false;
  renderer.render=(scene,camera)=>{
    const name=renderer.getRenderTarget()?.texture.name;
    const kind=name==='Canal reflection' ? 'full' : name==='Moving foliage reflection tile' ? 'tile' : null;
    if(!kind || !measuring) return render(scene,camera);
    counts[kind]++;
    if(!timer || queries.length>=20) return render(scene,camera);
    const query=gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
    try {return render(scene,camera);}
    finally {gl.endQuery(timer.TIME_ELAPSED_EXT);queries.push({query,kind});}
  };
  capturePose([[-59.04,2.15,-49.23],[-67.10,-1.45,-46.83]]);
  __scene.persp.fov=55;
  __scene.persp.updateProjectionMatrix();
  function sample(t) {
    started??=t;
    period=t-started;
    if(measuring) frames.push(t-previous);
    if(period>800) measuring=true;
    previous=t;
    while(queries.length && gl.getQueryParameter(queries[0].query,gl.QUERY_RESULT_AVAILABLE)) {
      const {query,kind}=queries.shift();
      if(!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        duration[kind].push(gl.getQueryParameter(query,gl.QUERY_RESULT)*1e-6);
      }
      gl.deleteQuery(query);
    }
    if(period<(seconds*1000+800)) return requestAnimationFrame(sample);
    renderer.render=render;
    for(const {query} of queries) gl.deleteQuery(query);
    const pct=(values,p)=>values.length ? values.toSorted((a,b)=>a-b)[Math.ceil(p*values.length)-1] : null;
    resolve({frames:frames.length,p50:pct(frames,.5),p95:pct(frames,.95),
      over24:frames.filter(dt=>dt>24).length,counts,
      gpuPassMs:Object.fromEntries(Object.entries(duration).map(([kind,times])=>[kind,{
        count:times.length,p50:pct(times,.5),p95:pct(times,.95),
      }])),
      gpu:gpuInfo&&gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL),
      raster:[gl.drawingBufferWidth,gl.drawingBufferHeight]});
  }
  requestAnimationFrame(sample);
})"""

AUDIT = """async()=>{
  const THREE=await import('three');
  const {renderer,scene,persp}=__scene;
  const {target,uniforms,visitMirrorMovement,mirror}=mirrorFixture;
  const {leaf,frame}=bladeFixture;
  const water=()=>__scene.mission().water;
  const gl=renderer.getContext();
  const half=42, size=2*half;
  const raw=new Uint8Array(size*size*4);
  const receiverSize=256;
  const receiverRaw=new Uint8Array(receiverSize*receiverSize*4);
  const preview=document.createElement('canvas');
  preview.width=1280;
  preview.height=720;
  const pen=preview.getContext('2d',{alpha:false});
  function view(native=false) {
    if(native) return renderer.domElement.toDataURL('image/jpeg',.95).split(',')[1];
    pen.drawImage(renderer.domElement,0,0,1280,720);
    return preview.toDataURL('image/jpeg',.95).split(',')[1];
  }
  const phases=[];
  let capturedTile=null;
  const render=renderer.render.bind(renderer);
  renderer.render=(world,camera)=>{
    const target=renderer.getRenderTarget();
    if(target?.texture.name==='Moving foliage reflection tile') capturedTile=target;
    return render(world,camera);
  };
  renderer.setAnimationLoop(null);
  let tick=performance.now();
  leafClock.getDelta=()=>1/60;
  function fresh(mirrorOnly=false) {
    window.rainFresh=mirrorOnly ? 'mirror' : true;
    try {captureRainReference();} finally {window.rainFresh=false;}
  }
  const xy=uniforms.reflectionUV.value;
  const projected=new THREE.Vector3();
  function sampleCoordinates(point){
    projected.copy(point).applyMatrix4(xy);
    return [Math.round(projected.x*target.width)-half,Math.round(projected.y*target.height)-half];
  }
  function read(source,x,y) {
    renderer.readRenderTargetPixels(source,x,y,size,size,raw);
    renderer.setRenderTarget(null);
    return raw.slice();
  }
  function delta(a,b){
    let sum=0,pixels=0,above1=0;
    for(let i=0;i<a.length;i+=4){
      const r=Math.abs(a[i]-b[i]),g=Math.abs(a[i+1]-b[i+1]),b0=Math.abs(a[i+2]-b[i+2]);
      sum+=r+g+b0;
      const peak=Math.max(r,g,b0);
      pixels+=Number(peak>5);
      above1+=Number(peak>1);
    }
    return {pixels,above1,mae:sum/(3*a.length/4)};
  }
  function photo(buffer,width=size){
    const image=document.createElement('canvas');
    image.width=image.height=width;
    const context=image.getContext('2d'),data=context.createImageData(width,width);
    for(let i=0;i<width;i++){
      const from=(width-1-i)*width*4;
      data.data.set(buffer.subarray(from,from+width*4),i*width*4);
    }
    context.putImageData(data,0,0);
    return image.toDataURL('image/png').split(',')[1];
  }
  const hit=new THREE.Vector3();
  function pixelOfReflection(point) {
    const surfaceY=scene.getObjectByName('Canal surface').position.y;
    const t=(surfaceY-mirror.position.y)/(point.y-mirror.position.y);
    hit.copy(mirror.position).lerp(point,t).project(persp);
    const x=Math.round((hit.x*.5+.5)*gl.drawingBufferWidth-receiverSize*.5);
    const y=Math.round((hit.y*.5+.5)*gl.drawingBufferHeight-receiverSize*.5);
    if(x<0||y<0||x+receiverSize>gl.drawingBufferWidth||y+receiverSize>gl.drawingBufferHeight) return null;
    return [x,y];
  }
  function receiverAt([x,y],withPatch=true) {
    const uniform=uniforms.mirrorPatchReady;
    const current=uniform.value;
    if(!withPatch) uniform.value=0;
    try {
      captureDraw(scene,persp);
      gl.readPixels(x,y,receiverSize,receiverSize,gl.RGBA,gl.UNSIGNED_BYTE,receiverRaw);
      return receiverRaw.slice();
    } finally {uniform.value=current;}
  }
  function compareReceiver(stale,patched,expected){
    const changed=delta(stale,patched);
    return {before:delta(stale,expected),after:delta(patched,expected),
      changed:changed.pixels,changedAbove1:changed.above1,
      images:[stale,patched,expected].map(buffer=>photo(buffer,receiverSize))};
  }
  function poseLeaf(x,y,mode='air'){
    Object.assign(leaf,{mode,wet:.25,began:uniforms.time.value,onDeck:false,stoneRest:false,onFilm:false});
    leaf.position.set(x,y,-46.42);
    leaf.scale.set(.172,.245,.196);
    leaf.orientation.setFromEuler(new THREE.Euler(.34,.29,-.44));
    leaf.flex.set(.062,-.12,.021);
    frame(uniforms.time.value,0);
  }
  capturePose([[-66.69,.83,-49.56],[-64.16,.27,-46.53]]);
  persp.fov=48;
  persp.updateProjectionMatrix();
  for(const state of ['moving','gone']){
    poseLeaf(-63.96,.64);
    fresh();
    const before=water();
    const center=leaf.position.clone();
    const [x,y]=sampleCoordinates(center);
    const oldPixels=read(target,x,y);

    uniforms.time.value+=1/60;
    if(state==='moving') poseLeaf(-63.89,.64);
    else poseLeaf(-63.95,.018,'water');
    captureRainReference();

    const held=water(), current=held.foliageMirror;
    if(!current.active) throw Error('Missing held foliage tile for '+state+' '+JSON.stringify(current));
    const [left,down,w,h]=current.bounds;
    if(x<left||y<down||x+size>left+w||y+size>down+h)
      throw Error('The chosen crop crosses the tile edge '+JSON.stringify({x,y,size,bounds:current.bounds}));
    const livePixels=read(capturedTile,x-left,y-down);
    const at=pixelOfReflection(center);
    if(!at) throw Error('The sampled leaf must project to an on-screen water point');
    const staleReceiver=receiverAt(at,false), liveReceiver=receiverAt(at);
    const exact=view();
    fresh(true);
    const expected=read(target,x,y);
    phases.push({state,before:delta(oldPixels,expected),after:delta(livePixels,expected),held:{
      mirrorDelta:held.reflectionPasses-before.reflectionPasses, ...current},
      receiver:compareReceiver(staleReceiver,liveReceiver,receiverAt(at)),
      images:[photo(oldPixels),photo(livePixels),photo(expected)],view:exact,
      raster:[gl.drawingBufferWidth,gl.drawingBufferHeight]});
  }
  leaf.mode='dormant';
  frame(uniforms.time.value,0);

  // A real, moving canopy must also reach the tile through its posed branch tips.
  const views=[
    [[-59.04,2.15,-49.23],[-67.10,-1.45,-46.83]],
    [[-61.10,1.64,-50.04],[-67.42,-1.95,-46.25]],
    [[-59.35,2.42,-44.90],[-67.20,-1.28,-46.64]],
    [[-62.57,1.34,-48.80],[-67.43,-1.56,-46.04]],
    [[-60.31,1.69,-48.06],[-67.04,-1.76,-46.50]],
  ];
  let natural=null;
  const attempts=[];
  for(const pose of views) {
    capturePose(pose);
    persp.fov=55;
    persp.updateProjectionMatrix();
    const attempt={pose,tiles:0,canopyTiles:0,changedTexels:0,receiverChanged:0};
    attempts.push(attempt);
    const positions=new Map(), probes=new THREE.Vector3();
    attempt.maxMotion=0;
    attempt.maxVisibleMotion=0;
    for(let i=0;i<72;i++){
      leafFrame(tick+=1000/60);
      const current=water(), state=current.foliageMirror;
      if(!i || i===71) {
        (attempt.frames ??= []).push({i,close:current.closeReflection,
          age:current.time-current.lastReflectionTime, rain:__scene.mission().rain.intensity,
          size:current.reflectionSize,winds:__scene.mission().wind.branchMotion.map(({tipVelocity})=>tipVelocity)});
      }
      visitMirrorMovement((key,x,y,z)=>{
        if(key>=8192) return;
        probes.set(x,y,z).applyMatrix4(xy);
        const dx=probes.x*target.width,dy=probes.y*target.height;
        if(positions.has(key)){
          const [a,b]=positions.get(key);
          const move=Math.hypot(dx-a,dy-b);
          attempt.maxMotion=Math.max(attempt.maxMotion,move);
          if(dx>0 && dy>0 && dx<target.width && dy<target.height)
            attempt.maxVisibleMotion=Math.max(attempt.maxVisibleMotion,move);
        }
        positions.set(key,[dx,dy]);
      });
      if(!state.active) continue;
      attempt.tiles++;
      if(state.selected>=8192) continue;
      attempt.canopyTiles++;
      const [left,down,w,h]=state.bounds;
      const point=new THREE.Vector3();
      visitMirrorMovement((key,x,y,z)=>{if(key===state.selected) point.set(x,y,z);});
      const [x,y]=sampleCoordinates(point);
      if(x<left+8 || y<down+8 || x+size>left+w-8 || y+size>down+h-8) continue;
      const old=read(target,x,y), live=read(capturedTile,x-left,y-down);
      const changed=delta(old,live).pixels;
      attempt.changedTexels=Math.max(attempt.changedTexels,changed);
      if(changed<18) continue;
      const at=pixelOfReflection(point);
      if(!at) continue;
      const staleReceiver=receiverAt(at,false), liveReceiver=receiverAt(at);
      attempt.receiverChanged=Math.max(attempt.receiverChanged,delta(staleReceiver,liveReceiver).pixels);
      const image=view(true);
      fresh(true);
      const reference=read(target,x,y);
      const before=delta(old,reference),after=delta(live,reference);
      const receiver=compareReceiver(staleReceiver,liveReceiver,receiverAt(at));
      if(before.pixels>=18 && after.mae<before.mae*.72 && receiver.changed>=16 &&
        receiver.after.mae<receiver.before.mae*.85) {
        natural={pose,point:point.toArray(),before,after,receiver,tile:state,
          images:[photo(old),photo(live),photo(reference)],view:image};
        break;
      }
    }
    if(natural) break;
  }
  return {phases,natural,attempts};
}"""


def decode(encoded):
    return Image.open(BytesIO(base64.b64decode(encoded))).convert('RGB')


def save(sample,name,folder):
    canvas=Image.new('RGB',(720,240))
    for i,encoded in enumerate(sample.pop('images')):
        canvas.paste(decode(encoded).resize((240,240),Image.Resampling.LANCZOS),(240*i,0))
    canvas.save(folder/(name+'-tile.jpg'),quality=96)
    decode(sample.pop('view')).save(folder/(name+'-view.jpg'),quality=96)
    if 'receiver' in sample:
        for i,encoded in enumerate(sample['receiver'].pop('images')):
            canvas.paste(decode(encoded).resize((240,240),Image.Resampling.LANCZOS),(240*i,0))
        canvas.save(folder/(name+'-water.jpg'),quality=96)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default=URL)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--timing',type=float,default=0,metavar='SECONDS',
        help='Also measure the fixed willow shot with the tile disabled and enabled.')
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as api:
        browser=api.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
            args=['--enable-gpu','--use-angle=gl','--ozone-platform=x11'])
        errors=[]
        def water_route(route):
            response=route.fetch()
            source=response.text()
            marker='  return {\n    prepare,\n    caustics:caustics.uniforms,'
            old_target='    const oldTarget=renderer.getRenderTarget();'
            assert source.count(marker)==source.count(old_target)==1
            source=source.replace(marker,'  window.mirrorFixture={target,uniforms,visitMirrorMovement,mirror};\n'+marker)
            source=source.replace('const foliageReuse=depthReuse &&',
                'const foliageReuse=!window.skipFoliageRefresh && depthReuse &&')
            route.fulfill(response=response,body=source.replace(old_target,
                '    if(window.rainFresh) {reflect=true;refract=window.rainFresh!=="mirror" && seesCanal;}\n'+old_target))

        def open_page(skip=False):
            page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=2)
            if skip:
                page.add_init_script('window.skipFoliageRefresh=true;')
            page.on('pageerror',lambda exc:errors.append(str(exc)))
            page.on('console',lambda log:errors.append(log.text) if log.type=='error' else None)
            page.route(args.url,expose_frame)
            page.route('**/bridge-canal-leaves.js',lambda route:expose(route,
                '  return { mesh:leaves, frame,','  window.bladeFixture={leaf:data.at(-1),frame};\n'))
            page.route('**/bridge-water.js',water_route)
            page.route('**/bridge-mission.js*',expose_weather)
            page.goto(args.url,wait_until='domcontentloaded',timeout=65000)
            page.wait_for_function("""__scene?.mission()?.rain?.time>6.3 &&
                __scene.models.length===__scene.L.objects.filter(o=>o.mesh).length""",timeout=65000)
            page.evaluate(INSTALL)
            return page

        page=open_page()
        report=page.evaluate(AUDIT)
        page.close()
        if args.timing:
            report['timing']={}
            for name,skip in [('held',True),('patched',False)]:
                page=open_page(skip)
                report['timing'][name]=page.evaluate(TIMING,args.timing)
                page.close()
            assert report['timing']['held']['counts']['tile']==0,report['timing']
            assert report['timing']['patched']['counts']['tile']>0,report['timing']
    for entry in report['phases']:
        save(entry,entry['state'],args.out)
    if report['natural']:
        save(report['natural'],'willow',args.out)
    report['errors']=errors
    (args.out/'foliage-reflection-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)
    assert not errors,errors
    assert report['natural'] is not None,report
    for entry in report['phases']:
        assert entry['raster']==[3840,2160] and entry['held']['mirrorDelta']==0,entry
        assert entry['before']['pixels']>40 and entry['after']['mae']<entry['before']['mae']*.42,entry
        assert entry['receiver']['changedAbove1']>12 and entry['receiver']['after']['mae']<entry['receiver']['before']['mae']*.85,entry
    assert report['phases'][1]['held']['departed']>=1,report


if __name__=='__main__':
    main()
