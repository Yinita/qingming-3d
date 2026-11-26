import * as THREE from "three";
import { canalBankGLSL } from "./bridge-canal-bed.js";
import { cropBeds, westBankEarthGLSL } from "./bridge-west-bank.js";
import { fieldsGLSL } from "./bridge-field-layout.js";

const textureRoot="../data/bridge-finish/earth/";
const layers=[
  ["path","packedSoil"],
  ["verge","stonySoil"],
];

export function createEarthMaterial(origin,load) {
  const material=new THREE.MeshStandardMaterial({color:0xb39d78,roughness:.94});
  const gardenWater=cropBeds.map(()=>new THREE.Vector3());
  material.userData.gardenWater=gardenWater;
  const uniforms={
    earthCanalOrigin:{value:origin}, earthReady:{value:0}, gardenWater:{value:gardenWater},
  };
  const loading=layers.flatMap(([directory,key])=>[
    ["color.webp",key+"Color",THREE.SRGBColorSpace],
    ["surface.webp",key+"Surface",THREE.NoColorSpace],
  ].map(async ([file,name,colorSpace])=>{
    uniforms[name]={value:null};
    const texture=await load(textureRoot+directory+"/"+file);
    texture.colorSpace=colorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.anisotropy=8;
    uniforms[name].value=texture;
  }));
  Promise.all(loading).then(()=>{
    uniforms.earthReady.value=1;
    material.userData.surfaceReady=true;
  },error=>console.warn("Scanned earth could not be loaded",error.message));

  material.customProgramCacheKey=()=>"scanned-bridge-earth";
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec2 earthPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nearthPoint=(modelMatrix*vec4(position,1.)).xz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        varying vec2 earthPoint;
        uniform vec2 earthCanalOrigin;
        uniform float earthReady;
        uniform sampler2D packedSoilColor,packedSoilSurface,stonySoilColor,stonySoilSurface;
        ${canalBankGLSL.replace("canalBank","earthBank")}
        float earthHash(vec2 p) {
          vec3 v=fract(p.xyx*.1031);
          v+=dot(v,v.yzx+33.33);
          return fract((v.x+v.y)*v.z);
        }
        float earthNoise(vec2 p) {
          vec2 i=floor(p), f=fract(p);
          f=f*f*(3.-2.*f);
          return mix(mix(earthHash(i),earthHash(i+vec2(1.,0.)),f.x),
            mix(earthHash(i+vec2(0.,1.)),earthHash(i+vec2(1.)),f.x),f.y);
        }
        float earthLane(vec2 alongCross,float halfLength,float halfWidth) {
          return (1.-smoothstep(halfLength*.65,halfLength,abs(alongCross.x)))*
            (1.-smoothstep(halfWidth*.55,halfWidth,abs(alongCross.y)));
        }
        vec2 earthTrack(vec2 p,vec2 center,float skew) {
          vec2 q=p-center;
          return vec2(q.x,q.y-skew*q.x-.16*sin(q.x*.61));
        }
        ${westBankEarthGLSL}
        ${fieldsGLSL}
      `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec2 pEarth=earthPoint;
        float areaVariation=earthNoise(pEarth*.32);
        float patchVariation=earthNoise(pEarth*.91+vec2(15.6,3.7));
        float grain=earthNoise(pEarth*5.2);
        float fray=(patchVariation-.5)*.45+(grain-.5)*.16;
        vec2 market=earthTrack(pEarth.yx,vec2(-26.3,25.8),.079);
        vec2 west=earthTrack(pEarth,vec2(-71.8,-41.42),.035);
        vec2 east=earthTrack(pEarth,vec2(-43.1,-41.42),-.09);
        vec2 landing=earthTrack(pEarth,vec2(-44.6,-50.6),.015);
        float wear=max(max(earthLane(market,14.8,2.29),earthLane(west,7.3,2.15)),
                       max(earthLane(east,7.1,2.12),.66*earthLane(landing,5.1,1.34)));
        float westWalk=westLane(pEarth);
        wear=max(wear,westWalk*.93);
        vec2 track=abs(pEarth.x-25.8)<7.5 ? market : pEarth.x<-58. ? west : east;
        float wheelLine=abs(abs(track.y+fray*.27)-(.83+.085*sin(track.x*.56)));
        float wheel=(1.-smoothstep(.047,.23,wheelLine))*wear*(1.-westWalk);
        vec2 river=pEarth-earthCanalOrigin;
        float earthMoisture=smoothstep(-1.08,.03,earthBank(river)-abs(river.x))*
          (1.-smoothstep(13.2,16.2,abs(river.y)));

        // The two scans keep their respective physical scales. Warping the UVs
        // softly breaks tile boundaries without rotating the relief independently.
        vec2 warp=.22*vec2(earthNoise(pEarth*.48)-.5,earthNoise(pEarth*.52+31.)-.5);
        mat2 turn=mat2(.80,.60,-.60,.80);
        vec2 compactUV=(pEarth+warp)/3.;
        vec2 vergeUV=turn*(pEarth-warp)/2.17+vec2(.38,.17);
        vec2 alternateUV=turn*(pEarth+warp)/2.71+vec2(.53,.67);
        float tileBlend=smoothstep(.18,.79,areaVariation);
        float edge=smoothstep(.19,.87,.55*areaVariation+.61*patchVariation+fray-.52*wear+.24*earthMoisture);
        vec3 compact=mix(texture2D(packedSoilColor,compactUV).rgb,
                         texture2D(packedSoilColor,alternateUV).rgb,tileBlend*.79);
        vec3 verge=texture2D(stonySoilColor,vergeUV).rgb;
        vec3 compactSurface=texture2D(packedSoilSurface,compactUV).rgb;
        vec3 alternateSurface=texture2D(packedSoilSurface,alternateUV).rgb;
        vec3 vergeSurface=texture2D(stonySoilSurface,vergeUV).rgb;
        float packedWeight=tileBlend*.79;

        // Keep the photographs' local contrast within the warm, muted ink palette.
        vec3 pathTint=vec3(.386,.297,.188);
        vec3 vergeTint=vec3(.295,.248,.175);
        vec3 pathPigment=pathTint*pow(clamp(compact/vec3(.191,.130,.047),.18,2.3),vec3(.66));
        vec3 vergePigment=vergeTint*pow(clamp(verge/vec3(.058,.032,.015),.18,2.3),vec3(.62));
        float westField=(1.-smoothstep(-70.5,-65.8,pEarth.x))*smoothstep(-40.6,-38.2,pEarth.y);
        float weeds=westField*(1.-westWalk*.87)*smoothstep(.27,.64,patchVariation*.62+areaVariation*.38);
        pathPigment=mix(pathPigment,pathTint*(.86+.26*areaVariation),westField*.32);
        vergePigment=mix(vergePigment,vergeTint*(.82+.29*patchVariation),westField*.41);
        vec3 earthColor=mix(pathPigment,vergePigment,edge);
        earthColor=mix(earthColor,earthColor*vec3(.71,.86,.63),weeds*.61);
        earthColor*=mix(.88,1.16,areaVariation);
        vec3 fieldTint=fieldPigments(pEarth,patchVariation);
        float farmWalk=fieldCartway(pEarth);
        earthColor=mix(earthColor,earthColor*vec3(.73,.91,.62),fieldTint.x);
        earthColor=mix(earthColor,earthColor*vec3(.64,.58,.47),fieldTint.y*.71);
        earthColor=mix(earthColor,pathPigment*vec3(.93,.87,.79),farmWalk*.67);
        earthColor=mix(earthColor,earthColor*vec3(.56,.62,.61),fieldTint.z*.74);
        float irrigationWet;
        float loam=gardenLoam(pEarth,earthNoise(pEarth*16.)-.47,irrigationWet);
        vec3 loamPigment=vec3(.142,.092,.054)*
          pow(clamp(compact/vec3(.191,.130,.047),.26,2.09),vec3(.52));
        float cultivation=.94+.08*sin(pEarth.x*42.+3.5*grain)+.15*(patchVariation-.5);
        earthColor=mix(earthColor,loamPigment*cultivation,loam);
        earthColor*=mix(vec3(1.),vec3(.53,.59,.63),irrigationWet);
        earthColor*=1.-.24*wheel*(.80+.20*grain);
        earthColor*=mix(vec3(1.),vec3(.66,.71,.75),earthMoisture);
        earthColor=mix(earthColor,vec3(.721,.681,.504),smoothstep(114.,160.,-pEarth.x)*.78);
        vec3 baseEarth=mix(diffuseColor.rgb,vec3(.32,.26,.164),westField*.52);
        baseEarth=mix(baseEarth,vec3(.142,.092,.054),loam)*mix(1.,.58,irrigationWet);
        diffuseColor.rgb=mix(baseEarth,earthColor,earthReady);
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        float dryRough=mix(mix(compactSurface.b,alternateSurface.b,packedWeight),vergeSurface.b,edge);
        float earthRough=mix(dryRough-.19*wheel-.17*earthMoisture-.19*fieldTint.z,.92-.33*irrigationWet,loam);
        roughnessFactor=mix(roughnessFactor,clamp(earthRough,.54,1.),earthReady);
      `)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        vec2 compactRelief=mix(compactSurface.rg*2.-1.,(alternateSurface.rg*2.-1.)*turn,packedWeight);
        vec2 vergeRelief=(vergeSurface.rg*2.-1.)*turn;
        vec2 earthRelief=mix(mix(compactRelief*.73,vergeRelief*.91,edge),compactRelief*.92,loam)*(1.-.48*wheel);
        normal=normalize(normal+mat3(viewMatrix)*vec3(earthRelief.x,0.,earthRelief.y)*earthReady);
      `);
  };
  return material;
}
