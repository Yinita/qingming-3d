import * as THREE from "three";
import { canalBankGLSL } from "./bridge-canal-bed.js";

const textureRoot="../data/bridge-finish/earth/";
const layers=[
  ["path","packedSoil"],
  ["verge","stonySoil"],
];

export function createEarthMaterial(origin,load) {
  const material=new THREE.MeshStandardMaterial({color:0xb39d78,roughness:.94});
  const uniforms={
    earthCanalOrigin:{value:origin}, earthReady:{value:0},
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
        vec2 track=abs(pEarth.x-25.8)<7.5 ? market : pEarth.x<-58. ? west : east;
        float wheelLine=abs(abs(track.y+fray*.27)-(.83+.085*sin(track.x*.56)));
        float wheel=(1.-smoothstep(.047,.23,wheelLine))*wear;
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
        vec3 earthColor=mix(pathPigment,vergePigment,edge);
        earthColor*=mix(.88,1.16,areaVariation);
        earthColor*=1.-.24*wheel*(.80+.20*grain);
        earthColor*=mix(vec3(1.),vec3(.66,.71,.75),earthMoisture);
        diffuseColor.rgb=mix(diffuseColor.rgb,earthColor,earthReady);
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        float dryRough=mix(mix(compactSurface.b,alternateSurface.b,packedWeight),vergeSurface.b,edge);
        roughnessFactor=mix(roughnessFactor,clamp(dryRough-.19*wheel-.17*earthMoisture,.54,1.),earthReady);
      `)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        vec2 compactRelief=mix(compactSurface.rg*2.-1.,(alternateSurface.rg*2.-1.)*turn,packedWeight);
        vec2 vergeRelief=(vergeSurface.rg*2.-1.)*turn;
        vec2 earthRelief=mix(compactRelief*.73,vergeRelief*.91,edge)*(1.-.48*wheel);
        normal=normalize(normal+mat3(viewMatrix)*vec3(earthRelief.x,0.,earthRelief.y)*earthReady);
      `);
  };
  return material;
}
