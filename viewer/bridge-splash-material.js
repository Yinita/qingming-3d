import * as THREE from "three";
import { waterHeight } from "./bridge-canal-bed.js";
import { surfaceGLSL } from "./bridge-water-field.js";

const vertexShader = `
  attribute float filmGauge;
  uniform mat4 reflectionUV;
  varying vec3 pointWorld;
  varying vec3 waterNormal;
  varying vec4 mirrorPoint;
  varying float gauge;
  void main() {
    vec4 p=vec4(position,1.);
    vec3 n=normal;
    #ifdef USE_INSTANCING
      mat3 basis=mat3(instanceMatrix);
      vec3 squaredAxis=vec3(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]));
      n=basis*(n/squaredAxis);
      p=instanceMatrix*p;
      gauge=sqrt(squaredAxis.x)*1.72;
    #else
      gauge=filmGauge;
    #endif
    pointWorld=(modelMatrix*p).xyz;
    waterNormal=normalize(mat3(modelMatrix)*n);
    mirrorPoint=reflectionUV*vec4(pointWorld,1.);
    gl_Position=projectionMatrix*viewMatrix*vec4(pointWorld,1.);
  }
`;

const fragmentShader = `
  uniform sampler2D reflection;
  uniform sampler2D refractionColor;
  uniform sampler2D refractionDepth;
  uniform float reflectionReady;
  uniform float refractionReady;
  uniform vec2 drawingSize;
  uniform float particle;
  ${surfaceGLSL}
  varying vec3 pointWorld;
  varying vec3 waterNormal;
  varying vec4 mirrorPoint;
  varying float gauge;

  void main() {
    float waterY=${waterHeight}+surfaceOffset(pointWorld.xz);
    float emerged=smoothstep(-.014,.014,pointWorld.y-waterY);
    if (emerged<.025) discard;
    vec3 n=normalize(waterNormal);
    vec3 eye=normalize(cameraPosition-pointWorld);
    n=faceforward(n,-eye,n);
    float incidence=clamp(dot(n,eye),0.,1.);
    float fresnel=.0204+.9796*pow(1.-incidence,5.);
    vec3 ray=refract(-eye,n,1./1.333);
    vec2 bend=(mat3(viewMatrix)*(ray+eye)).xy;
    vec2 screen=gl_FragCoord.xy/max(drawingSize,vec2(1.));
    vec2 transmittedUV=clamp(screen+bend*(.008+.31*gauge),.002,.998);
    float bedDepth=texture2D(refractionDepth,transmittedUV).r;
    vec3 substrate=texture2D(refractionColor,transmittedUV).rgb;
    vec3 transmission=mix(vec3(.36,.42,.30),substrate,
      refractionReady*(1.-smoothstep(.988,1.,bedDepth))*.68);
    transmission*=exp(-vec3(3.6,2.2,4.8)*gauge/max(.25,incidence));

    vec2 r=mirrorPoint.xy/max(.001,mirrorPoint.w);
    r+=(mat3(viewMatrix)*n).xy*.073;
    float border=smoothstep(.006,.10,min(min(r.x,r.y),min(1.-r.x,1.-r.y)));
    vec3 mirror=texture2D(reflection,clamp(r,.002,.998)).rgb;
    vec3 sky=mix(vec3(.46,.48,.38),mirror,reflectionReady*border*.78);
    vec3 sun=normalize(vec3(-.42,.82,-.33));
    float glint=pow(max(0.,dot(n,normalize(sun+eye))),mix(67.,42.,particle));
    float rim=smoothstep(.002,.013,gauge);
    vec3 color=mix(transmission,sky,fresnel)+vec3(.96,.90,.72)*(.33*rim*fresnel+1.12*glint);
    float alpha=emerged*clamp(mix(.24,.36,particle)+.40*fresnel+.23*rim+.48*glint,0.,.96);
    gl_FragColor=vec4(color,alpha);
    #include <colorspace_fragment>
  }
`;

export function splashMaterial(water,particle=false) {
  const optics = Object.fromEntries([
    "time", "origin", "waterState", "simulationBounds", "simulationHeight", "drawingSize",
    "refractionColor", "refractionDepth", "refractionReady", "reflection", "reflectionReady", "reflectionUV",
  ].map(name => [name,water[name]]));
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms: {...optics,particle:{value:Number(particle)}},
    transparent:true, depthWrite:false, side:particle ? THREE.FrontSide : THREE.DoubleSide,
    forceSinglePass:true,
  });
}
