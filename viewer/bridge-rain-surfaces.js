import * as THREE from "three";
import { rainRippleGLSL } from "./bridge-rain-ripples.js";
import { depthUnit } from "./bridge-street-runoff.js";
import { createStreetRainField } from "./bridge-street-rain-field.js";
import { puddleFieldGLSL, puddleLayerGLSL, puddleReflectionGLSL } from "./bridge-street-water-shading.js";
import { reflectionFootprintGLSL } from "./bridge-reflection.js";

export function collectRainSurfaces(...groups) {
  const roofs=[],canopies=[];
  const world=new THREE.Vector3();
  for(const group of groups) group.traverse(object=>{
    if(object.userData.roofProfile) {
      const {width,run,eave,centreZ,slope}=object.userData.roofProfile;
      object.getWorldPosition(world);
      const {x,y,z}=world;
      const at=z+centreZ, half=width*.5;
      const footing=object.parent.userData.rainFoundation;
      roofs.push({x,z:at,y,eave,run,slope,half,kind:"tile",enabled:()=>true,
        bounds:{minX:x-half,maxX:x+half,minZ:at-run-.02,maxZ:at+run+.02},
        foundation:(x,z)=>!!footing && Math.abs(x-footing.x)<footing.halfX && Math.abs(z-footing.z)<footing.halfZ,
        name:object.parent.name,object,wet:{value:0},caught:0,runoff:0,stored:Array.from({length:18},()=>({mass:0,due:0}))});
    }
    if(object.userData.branchMotion) {
      object.getWorldPosition(world);
      const scale=object.scale.x;
      canopies.push({ tree:object,x:world.x-.30*scale,z:world.z,scale,
        leaves:object.getObjectByName("Willow canopy leaf instances"),
        wet:{value:0},caught:0,runoff:0,pending:[],pose:object.userData.branchMotion });
    }
  });
  return {roofs,canopies};
}

export function roofLevel(roof,x,z) {
  if(roof.kind==="mesh") return roof.level(x,z);
  const front=Math.abs(z-roof.z);
  if(front>roof.run+.015 || Math.abs(x-roof.x)>roof.half) return -Infinity;
  return roof.y+roof.eave+(roof.run-front)*roof.slope+.129*(front/roof.run)**4+.037;
}

export function rainWetSurface(bounds,{roofCover,foundation,onDeck,groundAt,depthAt}) {
  const width=Math.ceil(1/(bounds.z*.245)),height=Math.ceil(1/(bounds.w*.273)),count=width*height;
  const pixels=new Uint8Array(count*4);
  const motionPixels=new Uint8Array(count*4);
  const open=new Uint8Array(count), deck=new Uint8Array(count), basin=new Float32Array(count);
  const whichRiver=new Uint8Array(count), blocked=new Uint8Array(count), bed=new Float32Array(count);
  const dx=1/(bounds.z*width),dz=1/(bounds.w*height);
  const texture=new THREE.DataTexture(pixels,width,height);
  const motionTexture=new THREE.DataTexture(motionPixels,width,height);
  texture.name="Rain exposure, ground wetness and puddles";
  motionTexture.name="Street runoff velocity and flux";
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  motionTexture.minFilter=motionTexture.magFilter=THREE.LinearFilter;
  const uniforms={rainWetMap:{value:texture},rainWetBounds:{value:bounds},rainWetMix:{value:1},
    rainFlow:{value:motionTexture},rainGroundGrid:{value:new THREE.Vector2(width,height)},
    rainGroundClock:{value:0},rainPuddleOptics:{value:1},rainPuddleView:{value:1}};
  let elapsed=0,rainSum=0,covered=0,coverChanged=false;
  for(let j=0;j<height;j++) for(let i=0;i<width;i++) {
    const cell=j*width+i,x=bounds.x+(i+.5)*dx,z=bounds.y+(j+.5)*dz;
    deck[cell]=Number(onDeck(x,z));
    basin[cell]=Math.max(0,.60*Math.sin(x*1.97-z*1.24)*Math.sin(z*3.2+x*.41)
      +.31*Math.cos(x*3.97+z*.33)-.16);
    const support=groundAt(x,z);
    whichRiver[cell]=Number(depthAt(x,z)>.026 && support<.031);
    const grade=.010*Math.sin(x*.65+z*.26)+.006*Math.sin(z*1.06-x*.29);
    // Centimetre-scale road grade and local depressions over the existing support mesh.
    bed[cell]=(support+grade-.019*basin[cell])/depthUnit;
    motionPixels[cell*4]=motionPixels[cell*4+1]=128;
  }
  motionTexture.needsUpdate=true;

  function refresh(area=null) {
    const x0=area ? Math.max(0,Math.floor((area.minX-bounds.x)/dx)) : 0;
    const x1=area ? Math.min(width-1,Math.floor((area.maxX-bounds.x)/dx)) : width-1;
    const z0=area ? Math.max(0,Math.floor((area.minZ-bounds.y)/dz)) : 0;
    const z1=area ? Math.min(height-1,Math.floor((area.maxZ-bounds.y)/dz)) : height-1;
    for(let j=z0;j<=z1;j++) for(let i=x0;i<=x1;i++) {
      const cell=j*width+i,x=bounds.x+(i+.5)*dx,z=bounds.y+(j+.5)*dz;
      const exposed=Number(!roofCover(x,z));
      covered+=open[cell]-exposed;
      const solid=Number(foundation(x,z));
      if(blocked[cell]!==solid || open[cell]!==exposed) coverChanged=true;
      blocked[cell]=solid;
      open[cell]=exposed;
    }
  }
  open.fill(1);
  refresh();
  texture.needsUpdate=true;

  const layout={width,height,bed,blocked,whichRiver,basin,deck,open,area:dx*dz};
  let committedCover={open:open.slice(),blocked:blocked.slice()};
  let worker=null, fallback=null;
  let waiting=null,arrived=null,snapshot=null,reusable=null,grid=null;
  let input=[];
  coverChanged=false;

  function commit(data) {
    if(waiting?.cover) committedCover=waiting.cover;
    waiting=null;
    reusable=snapshot ? {pixels:snapshot.pixels,grid:snapshot.grid} : null;
    snapshot=data;
    grid=new Float32Array(data.grid);
    texture.image.data=new Uint8Array(data.pixels,0,count*4);
    motionTexture.image.data=new Uint8Array(data.pixels,count*4,count*4);
    texture.needsUpdate=true;
    motionTexture.needsUpdate=true;
  }

  function continueLocally() {
    worker?.terminate();
    worker=null;
    const cover=(arrived && waiting?.cover) || committedCover;
    fallback=createStreetRainField({...layout,...cover});
    if(arrived || snapshot) fallback.resume(arrived ?? snapshot);
    if(!arrived && waiting) arrived=fallback.advance(waiting);
  }

  try {
    worker=new Worker(new URL("./bridge-street-runoff-worker.js",import.meta.url),{type:"module"});
    const background=worker;
    worker.onmessage=event=>{
      if(worker===background) arrived=event.data;
    };
    worker.onerror=event=>{
      event.preventDefault();
      if(worker===background) continueLocally();
    };
    worker.postMessage({type:"initialize",layout});
  } catch {
    continueLocally();
  }

  function send() {
    const cover=coverChanged ? {open:open.slice(),blocked:blocked.slice()} : null;
    waiting={dt:elapsed,intensity:rainSum/elapsed,input,cover};
    input=[];
    elapsed=0;
    rainSum=0;
    coverChanged=false;
    const buffers=reusable;
    reusable=null;
    if(!worker) {
      arrived=fallback.advance(waiting,buffers);
      return;
    }
    try {
      worker.postMessage({type:"advance",request:waiting,buffers},buffers ? [buffers.pixels,buffers.grid] : []);
    } catch {
      continueLocally();
    }
  }

  function index(x,z) {
    const i=Math.floor((x-bounds.x)*bounds.z*width), j=Math.floor((z-bounds.y)*bounds.w*height);
    return i<0||i>=width||j<0||j>=height ? -1 : j*width+i;
  }
  function deposit(x,z,amount,elevated=false,runoff=false) {
    const at=index(x,z);
    if(at>=0) input.push(at,amount,elevated,runoff);
  }

  function update(dt,intensity,time) {
    uniforms.rainGroundClock.value=time;
    elapsed+=dt;
    rainSum+=intensity*dt;
    if(!waiting && elapsed>=.082) send();
    if(!arrived) return false;
    commit(arrived);
    arrived=null;
    return true;
  }
  function sample(x,z) {
    const i=index(x,z);
    if(i<0) return null;
    const at=i*6, h=blocked[i] ? 0 : grid?.[at] ?? 0;
    return {wet:Math.max(grid?.[at+4] ?? 0,Math.min(1,h*1.27)),puddle:Math.min(1,h),
      depthMm:h*depthUnit*1000,runoffMm:blocked[i] ? 0 : (grid?.[at+1] ?? 0)*depthUnit*1000,
      high:grid?.[at+5] ?? 0,flux:[grid?.[at+2] ?? 0,grid?.[at+3] ?? 0],exposed:!!open[i],foundation:!!blocked[i]};
  }
  return {
    uniforms,deposit,update,sample,refresh,
    shoreline(feed) {
      const sites=snapshot?.shoreline ?? [];
      const volumeUnit=depthUnit*dx*dz;
      for(let n=0;n<sites.length;n+=5) {
        const i=sites[n], amount=sites[n+1];
        feed(bounds.x+(i%width+.5)*dx,bounds.y+(Math.floor(i/width)+.5)*dz,
          amount,amount*volumeUnit,sites[n+2],sites[n+3],sites[n+4]*volumeUnit,snapshot.dt);
      }
    },
    inspect:()=>({width,height,covered,thread:worker ? "worker" : "main",...snapshot?.stats}),
  };
}

export function wetMaterial(material,moisture,film=null) {
  const compile=material.onBeforeCompile;
  const key=material.customProgramCacheKey();
  if(film) material.userData.roofRainFlow=film;
  material.onBeforeCompile=shader=>{
    compile.call(material,shader);
    shader.uniforms.dampMaterial=moisture;
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nuniform float dampMaterial;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        diffuseColor.rgb*=mix(vec3(1.),vec3(.63,.72,.71),dampMaterial*.69);`)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,max(.22,roughnessFactor*.40),dampMaterial*.83);`);
    if(!film) return;
    Object.assign(shader.uniforms,film);
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 rainRoofPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nrainRoofPoint=(modelMatrix*vec4(transformed,1.)).xyz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        varying vec3 rainRoofPoint;
        uniform sampler2D roofFlowMap;
        uniform vec4 roofFlowBounds;
        uniform vec2 roofElevation;
        uniform float roofRain,roofClock;`)
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec2 flowUV=(rainRoofPoint.xz-roofFlowBounds.xy)*roofFlowBounds.zw;
        vec4 sheet=texture2D(roofFlowMap,clamp(flowUV,0.,1.));
        vec2 route=normalize(sheet.gb*255.-128.+vec2(.001,.002));
        vec3 crestNormal=normalize(cross(dFdx(rainRoofPoint),dFdy(rainRoofPoint)));
        float sameLevel=1.-smoothstep(.08,.30,abs(rainRoofPoint.y-(roofElevation.x+sheet.a*roofElevation.y)));
        float surfaceFilm=smoothstep(.20,.75,abs(crestNormal.y))*sameLevel*roofRain*step(.009,sheet.r);
        vec2 grainUV=vec2(dot(rainRoofPoint.xz,route),dot(rainRoofPoint.xz,vec2(-route.y,route.x)));
        float rainStreak=pow(max(0.,sin(grainUV.y*48.+.8*sin(grainUV.x*9.))),3.);
        float movingWave=.49+.51*sin(grainUV.x*23.-roofClock*12.+sin(grainUV.y*16.));
        float sheetDensity=surfaceFilm*smoothstep(.13,.87,sheet.r);
        float filmRun=sheetDensity*(.33+.49*rainStreak+.18*movingWave);
        diffuseColor.rgb*=1.-.14*filmRun;`)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.18,filmRun*.78);`)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        normal=normalize(normal+mat3(viewMatrix)*vec3(route.x,0.,route.y)*filmRun*(movingWave-.49)*.12);`)
      .replace("#include <opaque_fragment>",`
        float skim=pow(1.-abs(dot(normal,normalize(vViewPosition))),3.);
        outgoingLight+=vec3(.12,.16,.15)*skim*filmRun*(.43+.57*movingWave);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>key+(film ? "-rain-roof-film" : "-rain-sheen");
}

export function wetGroundMaterial(material,uniforms,reflection,deck=false) {
  if(!material?.isMeshStandardMaterial) return;
  const compile=material.onBeforeCompile;
  const key=material.customProgramCacheKey();
  if(!deck) material.userData.puddleOptics=uniforms.rainPuddleOptics;
  material.onBeforeCompile=shader=>{
    compile.call(material,shader);
    Object.assign(shader.uniforms,uniforms,reflection);
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 rainGroundPoint;")
      .replace("#include <begin_vertex>",`#include <begin_vertex>
        rainGroundPoint=(modelMatrix*vec4(transformed,1.)).xyz;`);
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        varying vec3 rainGroundPoint;
        uniform sampler2D rainWetMap;
        uniform vec4 rainWetBounds;
        uniform float rainWetMix;
        uniform sampler2D rainMirror;
        uniform mat4 rainMirrorUV;
        uniform float rainMirrorReady;
        ${deck ? "" : rainRippleGLSL+puddleFieldGLSL+reflectionFootprintGLSL}
      `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec2 dampUV=(rainGroundPoint.xz-rainWetBounds.xy)*rainWetBounds.zw;
        float valid=step(0.,min(min(dampUV.x,dampUV.y),min(1.-dampUV.x,1.-dampUV.y)));
        vec3 rainGround=texture2D(rainWetMap,dampUV).rgb*valid*rainWetMix;
        float rainDark=${deck ? "rainGround.b" : "rainGround.r"};
        float grain=.49+.51*sin(rainGroundPoint.x*21.+sin(rainGroundPoint.z*16.))*
          cos(rainGroundPoint.z*23.-rainGroundPoint.x*12.);
        ${deck ? "float rainPool=0.;" : puddleLayerGLSL}
        diffuseColor.rgb*=mix(vec3(1.),vec3(.57,.65,.68),rainDark*.72+rainPool*.21);`)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,max(.25,roughnessFactor*.62),rainDark);
        roughnessFactor=mix(roughnessFactor,.17,rainPool*.82);`)
      .replace("#include <opaque_fragment>",`
        ${deck ? "" : puddleReflectionGLSL}
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>key+`-rain-ground-${deck}`;
}
