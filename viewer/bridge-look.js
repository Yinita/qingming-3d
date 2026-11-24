import * as THREE from "three";
import { mooredSkiff } from "./bridge-boat.js";
import { buildCanal } from "./bridge-water.js";
import { buildCanalBed, canalOrigin } from "./bridge-canal-bed.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const materialRoot = "../data/bridge-finish/";
const finishLoader=new THREE.TextureLoader();
let loadSurfaceTexture=url=>finishLoader.loadAsync(url);
export function setSurfaceTextureLoader(load) {
  loadSurfaceTexture=load;
}
const finishSets=new Map();
export const bridgeRailOffset=1.23;
export function bridgeDeckHeight(anchor,x) {
  const u=x-anchor.x;
  return Math.max(0,Math.min(2.593,.3247*(u+10.607),.3711*(10.606-u)));
}
const materialScale = {
  "tea-wood": 1.4, "rail-wood": 2.0, "stone-paving": 3.8,
  "gray-roof-tile": 2.4, "lime-plaster": 2.5, "indigo-linen": 1.0,
  "worn-stone": 1.25, "willow-bark": 1.7, "packed-earth": 2.4,
};

export function createSurfaceLibrary() {
  function load(id, file, srgb = false) {
    return loadSurfaceTexture(materialRoot + id + "/" + file).then(map => {
      if (srgb) map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 8;
      return map;
    });
  }

  function maps(id) {
    if (!finishSets.has(id)) {
      finishSets.set(id, Promise.all([load(id, "basecolor.webp", true), load(id, "normal.png"), load(id, "orm.png")]));
    }
    return finishSets.get(id);
  }

  function surface(id, color = 0xffffff, normalStrength = 1, roughnessFactor = 1) {
    const mat = id === "indigo-linen" ? new THREE.MeshPhysicalMaterial({
      color, roughness:.85, sheen:.27, sheenColor:0xcabc9e, sheenRoughness:.81,
    }) : new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: 0 });
    mat.userData.tileMetres = materialScale[id];
    mat.userData.grain = id.endsWith("wood");
    maps(id).then(([colorMap, normal, orm]) => {
      mat.map = colorMap;
      mat.normalMap = normal;
      mat.normalScale.setScalar(normalStrength);
      mat.roughnessMap = orm;
      mat.roughness = roughnessFactor;
      mat.aoMap = orm;
      mat.aoMapIntensity = .65;
      mat.needsUpdate = true;
      mat.userData.surfaceReady = true;
    }, err => console.warn("Bridge material could not be loaded", id, err.message));
    return mat;
  }

  surface.project = (id, options, floor=false) => {
    const street=floor==="street";
    const material = new THREE.MeshStandardMaterial(options);
    const detail={
      finishColor:{value:null}, finishNormal:{value:null}, finishOrm:{value:null},
      finishMetres:{value:materialScale[id]}, finishReady:{value:0},
    };
    if(street) {
      detail.shoulderColor={value:null};
      detail.shoulderNormal={value:null};
      detail.shoulderReady={value:0};
      maps("worn-stone").then(([color,normal])=>{
        detail.shoulderColor.value=color;
        detail.shoulderNormal.value=normal;
        detail.shoulderReady.value=1;
      },err=>console.warn("Street aggregate could not be loaded",err.message));
    }
    maps(id).then(([color,normal,orm])=>{
      detail.finishColor.value=color;
      detail.finishNormal.value=normal;
      detail.finishOrm.value=orm;
      detail.finishReady.value=1;
      material.userData.surfaceReady=true;
    },err=>console.warn("Projected material could not be loaded",id,err.message));
    material.customProgramCacheKey=()=>street ? "weathered-market-earth" :
      floor ? "projected-floor-finish" : "projected-building-finish";
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,detail);
      shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 finishPoint;")
        .replace("#include <begin_vertex>","#include <begin_vertex>\nfinishPoint=(modelMatrix*vec4(position,1.)).xyz;");
      shader.fragmentShader=shader.fragmentShader.replace("#include <common>",`#include <common>
        varying vec3 finishPoint;
        uniform sampler2D finishColor,finishNormal,finishOrm;
        uniform float finishMetres,finishReady;
        ${street ? `uniform sampler2D shoulderColor,shoulderNormal;
        uniform float shoulderReady;` : ""}
        ${floor ? `
        float soilHash(vec2 p) {
          vec3 q=fract(vec3(p.xyx)*.1031);
          q+=dot(q,q.yzx+33.33);
          return fract((q.x+q.y)*q.z);
        }
        float soilNoise(vec2 p) {
          vec2 i=floor(p), f=fract(p);
          f=f*f*(3.-2.*f);
          return mix(mix(soilHash(i),soilHash(i+vec2(1.,0.)),f.x),
            mix(soilHash(i+vec2(0.,1.)),soilHash(i+vec2(1.)),f.x),f.y);
        }
        ` : ""}
        vec3 finishWeights() {
          ${floor ? "return vec3(0.,1.,0.);" : `
          vec3 v=abs(normalize(cross(dFdx(finishPoint),dFdy(finishPoint))));
          v=pow(v,vec3(7.));
          return v/max(dot(v,vec3(1.)),.001);`}
        }
        vec3 finishSample(sampler2D source,vec3 p,vec3 w) {
          ${floor ? "return texture2D(source,p.xz).rgb;" : `
          return texture2D(source,p.zy).rgb*w.x + texture2D(source,p.xz).rgb*w.y
              + texture2D(source,p.xy).rgb*w.z;`}
        }
      `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec3 finishUV=finishPoint/finishMetres, finishWeight=finishWeights();
        vec3 pigment=finishSample(finishColor,finishUV,finishWeight);
        vec3 relief=finishSample(finishOrm,finishUV,finishWeight);
        vec3 litSurface=diffuseColor.rgb*(.70+.62*smoothstep(.035,.46,dot(pigment,vec3(.2126,.7152,.0722))));
        litSurface*=mix(.78,1.,relief.r);
        ${floor ? `
        vec2 soilPoint=finishPoint.xz;
        float districts=soilNoise(soilPoint*.37);
        float compaction=soilNoise(soilPoint*vec2(.84,1.42)+vec2(districts*1.8,-districts));
        float mottling=soilNoise(soilPoint*5.7+13.2);
        vec3 dust=mix(vec3(.74,.72,.65),vec3(1.12,1.04,.93),smoothstep(.22,.80,districts));
        vec3 grains=texture2D(finishColor,finishUV.zx*2.13+vec2(.21,.47)).rgb;
        float aggregate=grains.r;
        vec3 soil=litSurface*dust*(.77+.23*compaction+.12*mottling+.15*aggregate);
        ${street ? `
        float market=1.-smoothstep(8.,16.,length((soilPoint-vec2(25.06,-26.6))*vec2(1.,.56)));
        float west=1.-smoothstep(5.,11.,length(soilPoint-vec2(-71.,-41.42)));
        float east=1.-smoothstep(5.,11.,length(soilPoint-vec2(-43.,-41.42)));
        float approach=max(west,east);
        float wander=soilNoise(soilPoint*.38)+.24*sin(soilPoint.y*.37);
        float crossTrack=mix(soilPoint.x-25.06-(soilPoint.y+26.6)*.08,soilPoint.y+41.42,approach);
        float track=crossTrack-.25*wander;
        float rutDist=abs(track);
        float rutCentre=rutDist-(.83+.085*sin(mix(soilPoint.y+26.3,soilPoint.x+71.8,approach)*.56));
        float route=max(market,approach);
        float wornEdge=.094*(mottling-.5)+.052*(compaction-.5);
        float wheel=(1.-smoothstep(.044,.235,abs(rutCentre+wornEdge)))*route;
        float tread=(1.-smoothstep(.91,2.37,rutDist))*route;
        float compressed=(.24*tread+.76*wheel)*(.64+.36*compaction);
        vec2 swale=soilPoint+vec2(districts-.5,compaction-.5)*1.6;
        float looseDust=smoothstep(.31,.78,soilNoise(swale*.83+5.8))*(1.-.81*tread);
        float clay=smoothstep(.29,.73,soilNoise(swale*vec2(1.61,.91)+4.1));
        float gravelMix=smoothstep(.28,.74,soilNoise(swale*vec2(.53,.39)+23.8));
        mat2 soilTurn=mat2(.8,.6,-.6,.8);
        vec2 aggregateUV=soilTurn*finishUV.xz*1.73+vec2(.19,.53);
        vec3 aggregateColor=texture2D(finishColor,aggregateUV).rgb;
        vec3 tilePigment=mix(pigment,aggregateColor,gravelMix*.74);
        vec3 earth=mix(vec3(.39,.27,.16),tilePigment,.50)*vec3(1.52,1.72,1.93);
        // The chalkier sediment is strongest at irregular shoulders and in pavement joints.
        vec2 shoulderUV=soilTurn*soilPoint/.89+vec2(.18,.42);
        vec3 stoneTexel=texture2D(shoulderColor,shoulderUV).rgb;
        float stoneLuma=dot(stoneTexel,vec3(.2126,.7152,.0722));
        vec3 stoneDust=mix(grains*vec3(1.6,1.83,2.05),
          mix(vec3(.37,.36,.31),vec3(.77,.73,.61),smoothstep(.08,.59,stoneLuma)),shoulderReady);
        float shoulder=route*smoothstep(1.14,2.79,rutDist)*(1.-smoothstep(2.8,5.4,rutDist));
        float silt=clamp(.10+.40*looseDust+.33*shoulder+.16*gravelMix-.31*compressed,.05,.83);
        soil=diffuseColor.rgb*mix(earth,stoneDust,silt);
        soil*=mix(vec3(.92,.87,.82),vec3(1.10,1.10,1.05),districts);
        soil*=mix(vec3(.90,.95,.99),vec3(1.09,1.01,.88),clay);
        float wash=soilNoise(swale*vec2(2.62,1.71)+7.9);
        float dampClay=smoothstep(.38,.76,clay*.60+wash*.40)*(1.-.56*looseDust);
        soil*=mix(vec3(1.02,1.00,.95),vec3(.74,.78,.79),dampClay*.64);
        soil*=mix(.89,1.08,relief.r)*mix(1.,.68,compressed);
        float washSilt=soilNoise(swale*vec2(.68,1.09)+vec2(-5.,12.));
        float dustEdge=smoothstep(.38,.74,washSilt+.13*mottling)*looseDust;
        soil*=mix(vec3(.85,.77,.67),vec3(1.18,1.18,1.13),smoothstep(.23,.69,washSilt));
        soil*=1.+.18*dustEdge;
        vec2 prints=soilPoint+vec2(.12*soilNoise(soilPoint*1.7),0.);
        float alongTrack=mix(prints.y,-prints.x,approach);
        float hoof=(1.-smoothstep(.36,.95,length(vec2(
          (abs(track)-(.46+.09*sin(floor(alongTrack*2.27)*2.4)))/.069,
          (fract(alongTrack*2.27+.24*step(0.,track))-.5)*5.4))))*route;
        soil*=1.-.14*hoof*(.3+.7*compaction);
        float grainWidth=max(length(dFdx(swale)),length(dFdy(swale)));
        float gritMask=1.-smoothstep(.018,.077,grainWidth);
        float fineGrit=soilNoise(swale*22.7+17.)*soilNoise(swale*31.6);
        soil*=1.+(smoothstep(.23,.61,fineGrit)-.27)*(.26+.16*looseDust)*gritMask;
        // Long streaks follow traffic, with gaps where loose dirt settles back in.
        vec2 alongAcross=vec2(alongTrack,track);
        float abrasion=soilNoise(alongAcross*vec2(3.1,31.)+vec2(19.,4.));
        float wheelScrape=smoothstep(.42,.75,abrasion)*wheel*(.60+.40*washSilt)*gritMask;
        float shoulderChips=smoothstep(.37,.72,mottling+.24*aggregate)
          *smoothstep(.26,.68,gravelMix)*(1.-.71*tread);
        soil*=mix(vec3(1.),vec3(.79,.81,.80),wheelScrape*.53);
        soil=mix(soil,soil*vec3(.84,.89,.93)+stoneDust*.052,shoulderChips*.52);
        soil*=mix(vec3(1.),vec3(1.10,1.09,1.04),looseDust);
        ` : ""}
        diffuseColor.rgb=mix(diffuseColor.rgb*dust,soil,finishReady);
        ` : `diffuseColor.rgb=mix(diffuseColor.rgb,litSurface,finishReady*.81);`}
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,max(.48,relief.g),finishReady*.91);
        ${street ? "roughnessFactor=clamp(roughnessFactor+(.07+.12*looseDust-.24*compressed-.15*dampClay)*finishReady,.51,1.);" : ""}
      `)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        vec2 sy=texture2D(finishNormal,finishUV.xz).xy*2.-1.;
        vec3 reliefVector=vec3(sy.x,0.,sy.y)*(finishWeight.y*.64);
        ${floor ? `
        vec2 grit=texture2D(finishNormal,finishUV.zx*2.13+vec2(.21,.47)).yx*2.-1.;
        reliefVector=vec3(sy.x,0.,sy.y)*${street ? ".76" : ".44"}+vec3(grit.x,0.,grit.y)*${street ? ".18" : ".29"};
        ` : ""}
        ${street ? `
        float bank=exp(-31.*rutCentre*rutCentre)*rutCentre*sign(track)*route;
        vec2 crossSlope=mix(vec2(1.,-.08),vec2(0.,1.),approach);
        vec2 aggregateNormal=(texture2D(finishNormal,aggregateUV).xy*2.-1.)*soilTurn;
        reliefVector=mix(reliefVector,vec3(aggregateNormal.x,0.,aggregateNormal.y)*.68,gravelMix*.74);
        vec2 stoneNormal=(texture2D(shoulderNormal,shoulderUV).xy*2.-1.)*soilTurn;
        reliefVector=mix(reliefVector,vec3(stoneNormal.x,0.,stoneNormal.y)*.44,silt*shoulderReady);
        reliefVector=reliefVector*(1.-.53*compressed)-vec3(crossSlope.x,0.,crossSlope.y)*bank*.91;
        ` : ""}
        ${floor ? "" : `
        vec2 sx=texture2D(finishNormal,finishUV.zy).xy*2.-1.;
        vec2 sz=texture2D(finishNormal,finishUV.xy).xy*2.-1.;
        reliefVector+=vec3(0.,sx.y,sx.x)*(finishWeight.x*.73)
                     +vec3(sz.x,sz.y,0.)*(finishWeight.z*.73);`}
        normal=normalize(normal+mat3(viewMatrix)*reliefVector*finishReady);
      `);
    };
    return material;
  };
  return surface;
}

const faceAxes = [[2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1]];

export function detailedBox(w, h, d, material, radius = .013, phase = 0) {
  const size = [w, h, d];
  const bevel = Math.min(radius, Math.min(...size) * .26);
  const geometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const half = size.map(v => v / 2);
  const inner = half.map(v => v - bevel);
  const point = new THREE.Vector3();
  const core = new THREE.Vector3();
  const faceOffset = 25;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    for (let axis = 0; axis < 3; axis++) {
      const unit = point.getComponent(axis);
      const amplitude = Math.abs(unit) > .49 ? half[axis] : inner[axis] * 4 * Math.abs(unit);
      point.setComponent(axis, Math.sign(unit) * amplitude);
      core.setComponent(axis, THREE.MathUtils.clamp(point.getComponent(axis), -inner[axis], inner[axis]));
    }
    point.sub(core).normalize();
    normals.setXYZ(i, point.x, point.y, point.z);
    point.multiplyScalar(bevel).add(core);
    positions.setXYZ(i, point.x, point.y, point.z);

    const metres = material.userData.tileMetres;
    if (metres) {
      const face = Math.floor(i / faceOffset);
      const [a, b] = faceAxes[face];
      const baseU = half[a] + Math.sign(uv.getX(i) - .5) * Math.abs(point.getComponent(a));
      const baseV = half[b] + Math.sign(uv.getY(i) - .5) * Math.abs(point.getComponent(b));
      const turn = material.userData.grain && size[b] > size[a] * 1.18;
      // Rotations preserve the handedness of each face's UV axes.
      uv.setXY(i, (turn ? baseV : baseU) / metres + phase,
               (turn ? -baseU : baseV) / metres + phase * .37);
    }
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildWoodenBridge(group,center,surface) {
  const timber=surface("rail-wood",0xf7e7cf,.91);
  const fascia=surface("rail-wood",0xe4ceb1,.76);
  const boards = [], trim = [], piers = [];
  const q = local => bridgeDeckHeight(center,center.x+local);
  const add = (list, mat, widths, x, y, z, angle, shade) => {
    const part = detailedBox(...widths, mat, .014, Math.sin(x * 1.73 + z * .91) * 5);
    part.rotateZ(angle);
    part.translate(x + center.x, y, z + center.z);
    const color = new Float32Array(part.attributes.position.count * 3);
    color.fill(shade);
    part.setAttribute("color", new THREE.BufferAttribute(color, 3));
    list.push(part);
  };
  const sections = [-10.606, -2.62, 3.62, 10.606];
  const intervals = [29, 23, 26];
  for (let k = 0; k < intervals.length; k++) {
    const a = sections[k], b = sections[k + 1];
    const gap = (b - a) / intervals[k];
    const angle = Math.atan2(q(b) - q(a), b - a);
    for (let i = 0; i < intervals[k]; i++) {
      const x = a + (i + .5) * gap;
      add(boards, timber, [gap / Math.cos(angle) - .009, .123, bridgeRailOffset*2-.02], x, q(x) - .06, 0,
          angle, .70 + .25 * (.5 + .5 * Math.sin((i + k * 29) * 26.57)));
    }
    for (const side of [-1, 1]) {
      for (const [y, depth] of [[-.09, .19], [.49, .105], [1.0, .13]]) {
        add(trim, fascia, [Math.hypot(b - a, q(b) - q(a)), depth, .12],
            (a + b) / 2, (q(a) + q(b)) / 2 + y, side * bridgeRailOffset, angle, .86);
      }
    }
  }
  const postXs = [-10.52, -8.48, -6.51, -4.55, -2.62, -.58, 1.55, 3.62, 5.55, 7.42, 9.35, 10.52];
  for (const x of postXs) {
    const y = q(x);
    for (const z of [-bridgeRailOffset,bridgeRailOffset]) {
      add(trim, fascia, [.143, 1.15, .145], x, y + .51, z, 0, .86 + .09 * Math.sin(x * 4.6));
      add(trim, fascia, [.189, .09, .184], x, y + 1.08, z, 0, .95);
      if (y > .6 && Math.abs(x) > 3) {
        const footZ = z - Math.sign(z) * .17;
        add(trim, fascia, [.20, y, .215], x, y / 2 - .12, footZ, 0, .75);
        piers.push(new THREE.Vector2(center.x + x, center.z + footZ));
      }
    }
  }
  for (const [parts, material] of [[boards, timber], [trim, fascia]]) {
    material.vertexColors = true;
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    const model = new THREE.Mesh(geometry, material);
    model.castShadow = model.receiveShadow = true;
    model.layers.enable(1);
    group.add(model);
  }
  return piers;
}

export function walkPath(w, depth, mat) {
  const size = 128;
  const mask = document.createElement("canvas");
  mask.width = mask.height = size;
  const paint = mask.getContext("2d");
  const coverage = paint.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const e = Math.min(i, j, size - 1 - i, size - 1 - j);
      const b = 3 * Math.sin(i * .47 + j * .28) + 2 * Math.sin(i * .15 - j * .31);
      const a = THREE.MathUtils.smoothstep(e + b, 2, 13) * 255;
      const offset = (j * size + i) * 4;
      coverage.data.set([a, a, a, 255], offset);
    }
  }
  paint.putImageData(coverage, 0, 0);
  mat.alphaMap ||= new THREE.CanvasTexture(mask);
  mat.alphaMap.channel = 1;
  mat.transparent = true;
  mat.alphaTest = .07;
  const geometry = new THREE.PlaneGeometry(w, depth);
  const uv = geometry.attributes.uv;
  geometry.setAttribute("uv1", uv.clone());
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w / mat.userData.tileMetres, uv.getY(i) * depth / mat.userData.tileMetres);
  }
  const model = new THREE.Mesh(geometry, mat);
  model.rotation.x = -Math.PI / 2;
  model.receiveShadow = true;
  return model;
}

export function buildBridgeLook(parent, center, surface, ground, apron) {
  const model = new THREE.Group();
  model.name = "Close-range bridge and canal";
  parent.add(model);
  const piers = buildWoodenBridge(model,center,surface);
  const skiffBoards = surface("tea-wood",0xbfb29a,.87,.75);
  const skiffRail = surface("rail-wood",0xe6cfab,.70,.82);
  const skiff = mooredSkiff(model, center, skiffBoards, skiffRail, detailedBox);
  const origin = canalOrigin(center);
  const bed = buildCanalBed(model,origin,ground,apron);
  const canal = buildCanal(model,origin,piers,skiff.wake,skiff.motion);
  return {
    setVisible(visible) { model.visible = visible; bed.setVisible(visible); },
    frame(time,dt) { skiff.update(time,dt,canal.field); bed.frame(time); canal.frame(time,dt); },
    field:canal.field,
    probe:canal.probe,
    mooring:skiff.anchor,
    hull:skiff.wake,
    tug:skiff.tug,
    hit: canal.hit,
    leafSource:canal.leafSource,
    prepare: canal.prepare,
    inspect(time) { return { ...canal.inspect(), skiff:skiff.inspect(time) }; },
  };
}

export function createPlayLighting(scene, renderer, center, ambient, sun) {
  const sky = new THREE.HemisphereLight(0xf2f1d9, 0x838068, 1.15);
  const key = new THREE.DirectionalLight(0xffedd2, 2.15);
  scene.add(sky, key, key.target);
  sky.layers.enable(1);
  key.layers.enable(1);
  key.position.set(center.x - 9, 17, center.z - 7);
  key.target.position.set(center.x + .7, 0, center.z);
  key.castShadow = true;
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 13;
  key.shadow.camera.bottom = -13;
  key.shadow.camera.near = .5;
  key.shadow.camera.far = 52;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.normalBias = .047;
  key.shadow.bias = -.0003;
  key.shadow.radius = 2;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return function activate(active) {
    renderer.shadowMap.enabled = active;
    sky.visible = key.visible = active;
    ambient.visible = sun.visible = !active;
  };
}
