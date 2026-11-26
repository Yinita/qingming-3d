"""Check the bank's tapered film on the GPU, and compare frozen advancing and retreating frames."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame


AUDIT = """async ({withReference,dryReference})=>{
  const THREE=await import('three');
  const {canalShoreRadius,canalTerrainHeight}=await import('./bridge-canal-bed.js');
  const {swashHeight,swashHeightGLSL}=await import('./bridge-swash-film.js');
  const prior=withReference ? await import('./bridge-water-prior.js') : null;
  const {scene,renderer,persp}=__scene;
  const {swash,field,shore:shoreGeometry,hullShader}=filmFixture;
  const canal=scene.getObjectByName('Canal surface'), material=canal.material;
  const bed=scene.getObjectByName('Recessed canal bed').material;
  const uniforms=material.uniforms;
  const origin=uniforms.origin.value, wash=uniforms.bankWash.value.image;
  const bounds=uniforms.bankWashBounds.value;
  const initialMatrix=persp.updateMatrixWorld.bind(persp);
  const eye=new THREE.Vector3(-65.77,.70,-47.83), aim=new THREE.Vector3(-67.64,.048,-48.91);
  persp.fov=46;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    persp.position.copy(eye);
    persp.lookAt(aim);
    return initialMatrix(force);
  };
  for(const id of ['missionHud','seal','missionIntro','missionWaypoint'])
    document.getElementById(id).style.display='none';

  renderer.setAnimationLoop(null);
  leafClock.getDelta=()=>1/60;
  let tick=performance.now();
  const row=Math.floor((-48.9-bounds.x)*bounds.y*wash.width);
  const z=bounds.x+(row+.5)/wash.width/bounds.y;
  const center=origin.x-canalShoreRadius(z-origin.y,-1);
  const read=()=>wash.data[4*row+1]*.54/255;
  const depth=(s,r,bed,baseline)=>swashHeight(s,r,bed,baseline)-bed;
  function oldHeight(s,r,bed,baseline) {
    if(r<=.022 || s< -r || s>=.155) return baseline;
    const skin=bed+.006+.008*Math.sqrt(r);
    return THREE.MathUtils.lerp(skin,Math.max(skin,baseline),THREE.MathUtils.smoothstep(s,-r,.155));
  }

  const sourceSamples=[];
  const shots={};
  function picture(shader) {
    if(shader) {
      material.vertexShader=shader.vertexShader;
      material.fragmentShader=shader.fragmentShader;
      material.needsUpdate=true;
    }
    renderer.render(scene,persp);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  function seek(name) {
    let previous=read();
    for(let i=0;i<320;i++) {
      leafFrame(tick+=1000/60);
      const reach=read(), change=reach-previous;
      previous=reach;
      if(name==='advance' ? reach<.18 || change<.002 : reach>.123 || reach<.072 || change>-.002) continue;
      const time=uniforms.time.value, samples=[];
      let maxJoinStep=0,maxLegacyStep=0,maxCpuError=0,maxSupportError=0,thin=0;
      for(let j=-30;j<=88;j++) {
        const shore=-reach+j*.004, x=center+shore;
        const bed=canalTerrainHeight(origin,x,z), baseline=field.height(x,z,time);
        const expected=swashHeight(shore,reach,bed,baseline);
        const live=swash.height(x,z,baseline);
        const rock=shoreGeometry.rockTop(x,z);
        const ground=Math.max(rock,bed);
        const leaf={ground,height:ground,depth:0,u:0,v:0};
        const carries=swash.support(x,z,leaf);
        const old=oldHeight(shore,reach,bed,baseline);
        maxCpuError=Math.max(maxCpuError,Math.abs(live-expected));
        if(carries) maxSupportError=Math.max(maxSupportError,Math.abs(leaf.depth-Math.max(0,live-ground)));
        const earlier=samples.at(-1);
        if(earlier && Math.abs(j)<10) {
          maxJoinStep=Math.max(maxJoinStep,Math.abs(live-earlier.live));
          maxLegacyStep=Math.max(maxLegacyStep,Math.abs(old-earlier.old));
        }
        thin+=Number(carries && leaf.depth<.012);
        samples.push({shore,bed,live,old,depth:depth(shore,reach,bed,baseline),carries});
        sourceSamples.push([shore,reach,bed,baseline,expected]);
      }
      const after=picture(null);
      let before=null;
      if(prior) {
        const finalShader={vertexShader:material.vertexShader,fragmentShader:material.fragmentShader};
        const shadows=renderer.shadowMap.autoUpdate;
        const compile=bed.onBeforeCompile, cache=bed.customProgramCacheKey;
        if(dryReference) {
          bed.onBeforeCompile=(shader,renderer)=>{
            compile.call(bed,shader,renderer);
            const marker='vec2 foamPoint=vec2(shore,finishPoint.z);';
            const start=shader.fragmentShader.indexOf(marker);
            const end=shader.fragmentShader.indexOf('#include <roughnessmap_fragment>',start);
            if(start<0 || end<0) throw Error('Dry residue block is missing');
            shader.fragmentShader=shader.fragmentShader.slice(0,start)+dryReference+'\\n'+shader.fragmentShader.slice(end);
          };
          bed.customProgramCacheKey=()=>cache.call(bed)+'-reference-foam';
          bed.needsUpdate=true;
        }
        renderer.shadowMap.autoUpdate=false;
        try {
          before=picture({vertexShader:prior.vertexShader,fragmentShader:typeof prior.fragmentShader==='function'
            ? prior.fragmentShader(hullShader) : prior.fragmentShader});
        }
        finally {
          if(dryReference) {
            bed.onBeforeCompile=compile;
            bed.customProgramCacheKey=cache;
            bed.needsUpdate=true;
          }
          picture(finalShader);
          renderer.shadowMap.autoUpdate=shadows;
        }
      }
      return {name, time,reach,change,maxJoinStep,maxLegacyStep,maxCpuError,maxSupportError,thin,samples,before,after};
    }
    throw Error('West bank wash never reached the '+name+' camera');
  }
  shots.advance=seek('advance');
  shots.retreat=seek('retreat');

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const count=sourceSamples.length, bytes=new Float32Array(count*4);
  sourceSamples.forEach((v,i)=>bytes.set(v.slice(0,4),4*i));
  const input=new THREE.DataTexture(bytes,count,1,THREE.RGBAFormat,THREE.FloatType);
  input.needsUpdate=true;
  const target=new THREE.WebGLRenderTarget(count,1,{type:THREE.FloatType,depthBuffer:false});
  const probe=new THREE.ShaderMaterial({
    uniforms:{samples:{value:input}},
    vertexShader:'void main(){gl_Position=vec4(position,1.);}',
    fragmentShader:`uniform sampler2D samples;
      ${swashHeightGLSL}
      void main(){
        vec4 p=texture2D(samples,vec2(gl_FragCoord.x/${count}.,.5));
        gl_FragColor=vec4(washHeight(p.w,p.x,p.y,p.z),0.,0.,1.);
      }`,
  });
  const tests=new THREE.Scene(), surface=new THREE.Mesh(geometry,probe);
  surface.frustumCulled=false;
  tests.add(surface);
  renderer.setRenderTarget(target);
  renderer.render(tests,new THREE.Camera());
  renderer.readRenderTargetPixels(target,0,0,count,1,bytes);
  renderer.setRenderTarget(null);
  let gpuError=0;
  for(let i=0;i<count;i++) gpuError=Math.max(gpuError,Math.abs(bytes[4*i]-sourceSamples[i][4]));
  target.dispose();
  probe.dispose();
  geometry.dispose();
  input.dispose();
  return {shots,gpuError,count,raster:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()};
}"""


def save_images(report, output):
    for name, state in report["shots"].items():
        frames = []
        for key in ("before", "after"):
            data = state.pop(key)
            if not data:
                continue
            image = Image.open(BytesIO(base64.b64decode(data))).convert("RGB")
            frames.append(image)
            if key == "after":
                image.save(output/f"{name}-4k.jpg", quality=95)
        if len(frames) != 2:
            continue
        before, after = (np.asarray(im, dtype=np.int16) for im in frames)
        change = np.abs(before-after).max(2)
        state["visiblePixelsChanged"] = int((change>8).sum())
        pair = Image.new("RGB", (2200, 618))
        for i, frame in enumerate(frames):
            pair.paste(frame.resize((1100,618),Image.Resampling.LANCZOS),(i*1100,0))
        pair.save(output/f"{name}-same-frame.jpg",quality=94)
        width,height=960,530
        integral=np.pad((change>8).astype(np.int32),((1,0),(1,0))).cumsum(0).cumsum(1)
        cropped=(integral[height:,width:]-integral[height:,:-width]
                 -integral[:-height,width:]+integral[:-height,:-width])
        y,x=np.unravel_index(cropped[::16,::16].argmax(),cropped[::16,::16].shape)
        bounds=(x*16,y*16,x*16+width,y*16+height)
        detail=Image.new("RGB",(width*2,height))
        for i,frame in enumerate(frames):
            detail.paste(frame.crop(bounds),(i*width,0))
        detail.save(output/f"{name}-detail.jpg",quality=95)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as api:
        browser = api.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        page = browser.new_page(viewport={"width":1920,"height":1080}, device_scale_factor=2)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda row: errors.append(row.text) if row.type=="error" else None)
        page.route(args.url, expose_frame)

        def probe(route):
            response=route.fetch()
            body=response.text()
            marker="  return {\n    prepare,\n    caustics:caustics.uniforms,"
            assert body.count(marker)==1
            hook="  window.filmFixture={swash,field,shore,hullShader:surfaceFoam.obstacles.hullGLSL};\n"
            route.fulfill(response=response,body=body.replace(marker,hook+marker))

        page.route("**/bridge-water.js", probe)
        dry_reference=None
        if args.reference:
            shader=(args.reference/"bridge-water.js").read_text().replace(
                "./bridge-breaker-surface.js","./bridge-breaker-surface-prior.js").replace(
                "swashFoamAt(shore,worldPoint.z).r",
                "swashFoamState(swashFoamUV(vec2(shore,worldPoint.z))).r")
            relief=(args.reference/"bridge-breaker-surface.js").read_text()
            page.route("**/bridge-water-prior.js", lambda route: route.fulfill(body=
                shader+"\nexport {vertexShader,fragmentShader};\n",content_type="text/javascript"))
            page.route("**/bridge-breaker-surface-prior.js", lambda route: route.fulfill(body=relief,
                content_type="text/javascript"))
            old_bed=args.reference/"bridge-canal-bed.js"
            if old_bed.exists():
                source=old_bed.read_text()
                start=source.index("if(q.x<0. && shore<.25)")
                end=source.index("}` : \"\"}",start)+1
                dry_reference=source[start:end].replace("swashFoamAt(shore,finishPoint.z).g",
                    "swashFoamState(swashFoamUV(vec2(shore,finishPoint.z))).g")
        page.goto(args.url, wait_until="domcontentloaded", timeout=65000)
        page.wait_for_function("__scene?.mission()?.water?.swash?.foam?.passes>5", timeout=55000)
        report=page.evaluate(AUDIT,{"withReference":bool(args.reference),"dryReference":dry_reference})
        report["errors"]=errors
        save_images(report,args.out)
        (args.out/"film-verification.json").write_text(json.dumps(report,indent=2)+"\n")

    assert report["raster"]==[3840,2160] and not errors, report["errors"]
    assert report["count"]==238 and report["gpuError"]<.00001, report["gpuError"]
    for result in report["shots"].values():
        sample={k:v for k,v in result.items() if k!="samples"}
        print(json.dumps(sample),flush=True)
        assert result["maxCpuError"]<.00001 and result["maxSupportError"]<.00001, sample
        assert result["maxJoinStep"]<.007 and result["maxLegacyStep"]>.019, sample
        assert result["thin"]>4, sample
        if args.reference:
            assert result["visiblePixelsChanged"]>700, sample


if __name__=="__main__":
    main()
