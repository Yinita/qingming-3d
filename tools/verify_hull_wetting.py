"""Observe local skiff moisture through a physical rope pull and compare a frozen 4K frame."""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from verify_leaf_water import expose_frame


AUDIT = r"""async()=>{
  const THREE=await import('three');
  const {createHullWetting}=await import('./bridge-hull-wetting.js');
  const {renderer,scene,persp}=__scene;
  const {skiff,field,legacy,prepare}=wetHullFixture;
  renderer.setAnimationLoop(null);
  const boat=scene.getObjectByName('Moored timber skiff');
  const shell=boat.children.find(mesh=>mesh.material?.userData.hullWetting);
  const material=shell.material;
  const optics=scene.getObjectByName('Canal surface').material.uniforms;
  const atlas=material.userData.hullWetting.hullWetMap.value.image;
  const bounds=material.userData.hullWetting.hullWetBounds.value;
  const camera=persp.updateMatrixWorld.bind(persp);
  let detailPose=null;
  persp.fov=48;
  persp.updateProjectionMatrix();
  persp.updateMatrixWorld=force=>{
    if(detailPose) {
      persp.position.copy(detailPose.eye);
      persp.lookAt(detailPose.target);
      return camera(force);
    }
    const anchor=boat.position;
    persp.position.set(anchor.x-2.13, .44, anchor.z-1.32);
    persp.lookAt(anchor.x-.24,anchor.y+.05,anchor.z+.21);
    return camera(force);
  };
  for(const id of ['missionHud','missionWaypoint','missionIntro','seal']) {
    document.getElementById(id).style.display='none';
  }
  leafClock.getDelta=()=>1/60;
  let clock=performance.now();
  const trace=[],ray=new THREE.Raycaster();
  const point=new THREE.Vector3(),vector=new THREE.Vector3();
  function legacyWood(shader) {
    shader.uniforms.boatWetLine=legacy;
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 oldHullPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\noldHullPoint=(modelMatrix*vec4(position,1.)).xyz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nvarying vec3 oldHullPoint; uniform float boatWetLine;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float timberGrain=.013*sin(oldHullPoint.x*38.+oldHullPoint.z*27.)+.006*sin(oldHullPoint.z*91.);
        float saturation=1.-smoothstep(boatWetLine-.032,boatWetLine+.045,oldHullPoint.y+timberGrain);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.63,.66,.61),saturation);`)
      .replace("#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.39,saturation*.65);");
  }
  function capture(mode) {
    const gl=renderer.getContext(), side=280;
    const optical=mode==='meniscus' || mode==='transmission';
    const crop=optical ? new Uint8Array(side*side*4) : null;
    let initial=null, strong=0, visible=0;
    function shot() {
      renderer.render(scene,persp);
      if(crop) {
        gl.readPixels((gl.drawingBufferWidth-side)/2,(gl.drawingBufferHeight-side)/2,
          side,side,gl.RGBA,gl.UNSIGNED_BYTE,crop);
        if(!initial) initial=crop.slice();
        else for(let i=0;i<crop.length;i+=4) {
          const delta=Math.max(Math.abs(crop[i]-initial[i]),Math.abs(crop[i+1]-initial[i+1]),
            Math.abs(crop[i+2]-initial[i+2]));
          visible+=Number(delta>2);
          strong+=Number(delta>8);
        }
      }
      return renderer.domElement.toDataURL('image/png').split(',')[1];
    }
    const shadow=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    const after=shot();
    let before;
    let comparison=null;
    const exchanged=[];
    const wetUniform=material.userData.hullWetting.hullWetMap;
    let originalBytes=null;
    try {
      if(mode==='meniscus') {
        optics.hullSurfaceFilm.value=0;
      } else if(mode==='transmission') {
        optics.hullTransmissionAA.value=0;
      } else if(mode==='displacement') {
        optics.hullDisplacement.value=0;
      } else if(mode==='live') {
        const bytes=atlas.data;
        originalBytes=bytes.slice();
        for(let i=0;i<bytes.length;i+=4) bytes[i]=bytes[i+1]=bytes[i+2];
        wetUniform.value.needsUpdate=true;
      } else {
        // Switching the original material's hook leaves the renderer's
        // cached uniform table attached to the last compiled variant.
        comparison=material.clone();
        comparison.onBeforeCompile=legacyWood;
        comparison.customProgramCacheKey=()=>'constant-world-height-skiff-wetting';
        scene.traverse(mesh=>{
          if(mesh.material!==material) return;
          exchanged.push(mesh);
          mesh.material=comparison;
        });
      }
      before=shot();
    } finally {
      for(const mesh of exchanged) mesh.material=material;
      comparison?.dispose();
      optics.hullSurfaceFilm.value=optics.hullTransmissionAA.value=1;
      optics.hullDisplacement.value=1;
      if(originalBytes) {
        atlas.data.set(originalBytes);
        wetUniform.value.needsUpdate=true;
      }
      renderer.shadowMap.autoUpdate=shadow;
    }
    return {before,after,...(optical ? {strong,visible} : {})};
  }

  const at=()=>__scene.mission().water;
  const before=at(), start=before.skiff.position;
  if(!skiff.tug(before.time)) throw Error('skiff could not be hauled');
  let shot=null, emerged=null, meniscus=null, transmission=null, displacement=null;
  let maxGap=0, maxSkinGap=0, hits=0, hitsOnMesh=0, distance=0, yaw=0, maxRange=0;
  let outsideHits=0,lastImpact=before.contacts.totals.boat, crossings=0, submergedSections=0, worst;
  let bracketedLips=0, unresolved=0;
  let residualSamples=0;
  function exposedPose(time) {
    const {width,height,data}=atlas, bands=height/2;
    const direction=new THREE.Vector3(), anchor=new THREE.Vector3(), line=new THREE.Vector3();
    const exposure=shell.geometry.attributes.skiffExposure;
    let best=null;
    for(const side of [-1,1]) for(let row=1;row<bands;row+=2) {
      const y=bounds.z+(row+.5)/(bands*bounds.w);
      direction.set(-side,0,0).transformDirection(boat.matrixWorld);
      for(let col=3;col<width-3;col+=3) {
        const i=4*((row+(side>0 ? bands : 0))*width+col);
        const stain=data[i]-data[i+2];
        if(stain<118 || best && stain<=best.score) continue;
        const z=bounds.x+(col+.5)/(width*bounds.y);
        anchor.set(side*.91,y,z).applyMatrix4(boat.matrixWorld);
        ray.set(anchor,direction);
        const hit=ray.intersectObject(shell,false)[0];
        if(!hit || hit.point.y-field.height(hit.point.x,hit.point.z,time)<.022 ||
           [hit.face.a,hit.face.b,hit.face.c].some(v=>exposure.getX(v)<.95)) continue;
        const target=hit.point.clone();
        const eye=target.clone().addScaledVector(direction,-.85);
        eye.y=Math.max(.58,target.y+.42);
        ray.set(eye,line.copy(target).sub(eye).normalize());
        const visible=ray.intersectObject(shell,false)[0];
        if(!visible || visible.point.distanceToSquared(target)>.0001) continue;
        let clearance=Infinity;
        for(let step=1;step<12;step++) {
          line.copy(target).lerp(eye,step/12);
          clearance=Math.min(clearance,line.y-field.height(line.x,line.z,time));
        }
        if(clearance<.012) continue;
        best={target,eye,score:stain,clearance};
      }
    }
    return best;
  }
  function contactPose(station) {
    const {contact,normal}=skiff.waterline[station];
    if(!contact.atSurface) return null;
    const target=contact.point.clone().addScaledVector(normal,.038);
    const eye=target.clone().addScaledVector(normal,.94);
    eye.y=Math.max(.56,target.y+.57);
    return {target,eye};
  }
  for(let i=0;i<214;i++) {
    leafFrame(clock+=1000/60);
    const state=at(), current=state.skiff;
    distance=Math.max(distance,Math.hypot(current.position[0]-start[0],current.position[2]-start[2]));
    yaw=Math.max(yaw,Math.abs(current.rotation[1]-before.skiff.rotation[1]));
    maxRange=Math.max(maxRange,current.wetting.range);
    for(const {contact,side,section,normal} of skiff.waterline) {
      if(!contact.hit) continue;
      const p=contact.point;
      if(contact.atSurface) {
        const error=Math.abs(field.height(p.x,p.z,state.time)-p.y);
        if(error>.001) {
          // A rolling lip can cross the side of the hull, with distinct upper
          // heights on either side. Verify the wet and dry points on the mesh.
          const sideGap=dy=>{
            point.set(side*.85,contact.height+dy,section.z).applyMatrix4(boat.matrixWorld);
            vector.set(-side,0,0).transformDirection(boat.matrixWorld);
            ray.set(point,vector);
            const hit=ray.intersectObject(shell,false)[0]?.point;
            return hit ? field.height(hit.x,hit.z,state.time)-hit.y : NaN;
          };
          if(sideGap(-.0015)>=0 && sideGap(.0015)<=0) bracketedLips++;
          else unresolved++;
        }
        if(error>maxGap) {
          maxGap=error;
          worst={time:state.time,side,z:section.z,localY:contact.height,point:p.toArray()};
        }
        crossings++;
      } else submergedSections++;
      hits++;
      point.set(side*.85,contact.height,section.z).applyMatrix4(boat.matrixWorld);
      vector.set(-side,0,0).transformDirection(boat.matrixWorld);
      ray.set(point,vector);
      const skin=ray.intersectObject(shell,false)[0];
      if(skin) {
        maxSkinGap=Math.max(maxSkinGap,skin.point.distanceTo(p));
        hitsOnMesh++;
      }
    }
    if(state.contacts.totals.boat!==lastImpact) {
      lastImpact=state.contacts.totals.boat;
      const entry=state.contacts.lastByKind.boat;
      const impact=wetHullFixture.impact;
      const match=impact && Math.hypot(entry.x-impact.x,entry.z-impact.z)<.0002;
      outsideHits+=Number(match);
    }
    if(i%4===0) trace.push({time:state.time,position:current.position,rotation:current.rotation,...current.wetting});
    if(shot===null && current.wetting.retained>68 && current.wetting.range>.044 && distance>.21 &&
       current.wetting.splashes>before.skiff.wetting.splashes) {
      const data=atlas.data;
      for(let j=0;j<data.length;j+=4) if(data[j]>48 && data[j+2]===0) residualSamples++;
      shot={time:state.time,wetting:current.wetting,legacy:legacy.value,...capture()};
    }
    if(i>163 && shot && emerged===null && current.wetting.retained>1400 &&
       current.wetting.live<current.wetting.retained*.65) {
      const pose=exposedPose(state.time);
      if(pose) {
        detailPose=pose;
        prepare(renderer,scene,persp);
        emerged={time:state.time,wetting:current.wetting,score:pose.score,clearance:pose.clearance,...capture('live')};
        detailPose=null;
      }
    }
    if(i>=152 && i%8===0 && (!meniscus || !transmission)) {
      const station=(i/8)%skiff.waterline.length;
      const pose=contactPose(station);
      if(!pose) continue;
      detailPose=pose;
      prepare(renderer,scene,persp);
      if(!meniscus) {
        const comparison=capture('meniscus');
        if(comparison.strong>85) meniscus={time:state.time,station,...comparison};
      }
      if(!transmission) {
        const comparison=capture('transmission');
        if(comparison.visible>110) transmission={time:state.time,station,...comparison};
      }
      detailPose=null;
    }
    if(i===92) {
      const target=new THREE.Vector3(0,.035,0).applyMatrix4(boat.matrixWorld);
      const eye=new THREE.Vector3(-1.6,1.54,-.67).applyMatrix4(boat.matrixWorld);
      detailPose={target,eye};
      prepare(renderer,scene,persp);
      displacement={time:state.time,...capture('displacement')};
      detailPose=null;
    }
  }

  // Lower a known surface far below a turned hull. Material-space stain
  // should remain on the same board and lose polish faster than pigment.
  const shape=[[-1.6,.10,.31],[-.3,.62,.25],[.6,.55,.28],[1.5,.10,.39]];
  const assembly=createHullWetting(shape,[[.48,-.091],[.79,.005],[.944,.117]]);
  const test=assembly.uniforms.hullWetMap.value.image;
  const model=new THREE.Matrix4();
  assembly.frame(model,{height:(x,z)=>.042+.050*z+.047*x},.12,.035);
  const wet0=test.data.slice();
  model.makeRotationY(.37).setPosition(1.6,.23,-.8);
  assembly.frame(model,{height:()=>-.51},.52,.40);
  let wetInterior=0, held=0, gloss=0, submerged=0;
  for(let i=0;i<wet0.length;i+=4) {
    submerged+=Number(test.data[i+2]>0);
    if(wet0[i+2]!==255) continue;
    wetInterior++;
    held+=test.data[i];
    gloss+=test.data[i+1];
  }
  const memory={wetInterior,held:held/(wetInterior*255),gloss:gloss/(wetInterior*255),submerged};
  return {distance,yaw,maxRange,hits,hitsOnMesh,maxGap,maxSkinGap,crossings,submergedSections,worst,bracketedLips,unresolved,
    outsideHits,residualSamples,memory,shot,emerged,meniscus,transmission,displacement,trace,
    dimensions:[atlas.width,atlas.height],raster:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default="http://127.0.0.1:8133/viewer/?mission&gust&swell")
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as api:
        b=api.chromium.launch(executable_path="/usr/bin/google-chrome",headless=True,
            args=["--enable-gpu","--use-angle=gl","--ozone-platform=x11"])
        p=b.new_page(viewport={"width":1920,"height":1080},device_scale_factor=2)
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.on("console",lambda e:errors.append(e.text) if e.type=="error" else None)
        p.route(args.url,expose_frame)

        def expose(route):
            response=route.fetch()
            body=response.text()
            marker="  return {\n    prepare,\n    caustics:caustics.uniforms,"
            hook="  const legacy={value:.068}; window.wetHullFixture={skiff,field:leafField,legacy,prepare};\n"
            assert body.count(marker)==1
            body=body.replace(marker,hook+marker).replace("      skiff.wetHull(leafField,time,dt);",
                "      legacy.value=Math.max(skiff.inspect(time).heaveTarget+.017,legacy.value-dt*.009);\n"
                "      skiff.wetHull(leafField,time,dt);").replace(
                "      skiff.wetSplash(side,section.z,contact.height,strength);",
                "      window.wetHullFixture.impact={x:contact.point.x+normal.x*.15,z:contact.point.z+normal.z*.15};\n"
                "      skiff.wetSplash(side,section.z,contact.height,strength);")
            route.fulfill(response=response,body=body)

        p.route("**/bridge-water.js",expose)
        p.goto(args.url,wait_until="domcontentloaded",timeout=65000)
        p.wait_for_function("__scene?.mission()?.water?.skiff?.wetting?.updates>9",timeout=45000)
        result=p.evaluate(AUDIT)
    result["errors"]=errors
    cases=(("shot","waterline"),("emerged","exposed-planks"),("meniscus","hull-meniscus"),
           ("transmission","hull-transmission"),("displacement","dry-bilge"))
    for phase,name in cases:
        shot=result[phase]
        if not shot:
            continue
        images=[Image.open(BytesIO(base64.b64decode(shot.pop(k)))).convert("RGB") for k in ("before","after")]
        images[1].save(args.out/f"{name}-4k.jpg",quality=95)
        data=[np.asarray(i,dtype=np.int16) for i in images]
        delta=np.abs(data[0]-data[1]).max(2)
        width,height=1080,550
        integral=np.pad((delta>2).astype(np.int32),((1,0),(1,0))).cumsum(0).cumsum(1)
        coverage=(integral[height:,width:]-integral[height:,:-width]
                -integral[:-height,width:]+integral[:-height,:-width])
        y,x=np.unravel_index(coverage[::16,::16].argmax(),coverage[::16,::16].shape)
        box=(x*16,y*16,x*16+width,y*16+height)
        pair=Image.new("RGB",(width*2,height))
        for i,im in enumerate(images):pair.paste(im.crop(box),(i*width,0))
        pair.save(args.out/f"{name}-same-frame.jpg",quality=95)
        shot["changedPixels"]=int((delta>8).sum())
        shot["visiblePixels"]=int((delta>2).sum())
        shot["maximumColorDelta"]=int(delta.max())
        if phase=="transmission":
            # Restrict the edge count to pixels influenced by the local resolve.
            mask=delta[1:-1,1:-1]>2
            neighbor=mask | (delta[:-2,1:-1]>2) | (delta[2:,1:-1]>2)
            for i,label in enumerate(("point","resolved")):
                green=data[i][:,:,1]
                edge=np.maximum(np.abs(green[1:-1,1:-1]-green[:-2,1:-1]),
                                np.abs(green[1:-1,1:-1]-green[1:-1,:-2]))
                shot[label+"HardEdges"]=int(((edge>7)&neighbor).sum())
    (args.out/"hull-wetting.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({k:v for k,v in result.items() if k!="trace"}),flush=True)
    assert not errors and result["raster"]==[3840,2160],errors
    assert result["distance"]>.18 and result["yaw"]>.035 and result["maxRange"]>.044,result
    assert result["hits"]>600 and result["hitsOnMesh"]>500 and result["crossings"]>500,result
    assert result["unresolved"]==0 and result["maxSkinGap"]<.004,result
    assert result["outsideHits"]>0,result
    assert result["shot"] and result["shot"]["changedPixels"]>1000 and result["residualSamples"]>50,result
    assert result["emerged"] and result["emerged"]["changedPixels"]>1000,result
    assert result["meniscus"] and 500<result["meniscus"]["changedPixels"]<160000,result
    transmission=result["transmission"]
    assert transmission and transmission["visiblePixels"]>800,result
    assert transmission["resolvedHardEdges"]<transmission["pointHardEdges"]*.85,transmission
    assert result["displacement"]["changedPixels"]>15000,result["displacement"]
    memory=result["memory"]
    assert memory["wetInterior"]>300 and .83<memory["held"]<.92 and .50<memory["gloss"]<.62 and memory["submerged"]==0,memory


if __name__=="__main__":
    main()
