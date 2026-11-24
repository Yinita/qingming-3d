import * as THREE from "three";
import { canalBathymetryGLSL, waterHeight } from "./bridge-canal-bed.js";
import { capillaryGLSL, surfaceGLSL } from "./bridge-water-field.js";

// Project each patch of the simulated water surface onto the bed. Differentials
// in the light-space raster estimate the irradiance gained by compression.
const vertexShader=`
  ${surfaceGLSL}
  ${canalBathymetryGLSL}
  ${capillaryGLSL}
  varying vec2 surfaceUV;
  varying float transmission;
  varying float focusFactor;
  uniform vec2 causticSize;
  void main() {
    vec2 world=simulationBounds.xy+uv/simulationBounds.zw;
    const float d=.128;
    vec3 ripple=capillaryWaves(world);
    float h=${waterHeight}+surfaceOffset(world)+ripple.x;
    vec2 gradient=vec2(surfaceOffset(world+vec2(d,0.))-surfaceOffset(world-vec2(d,0.)),
                       surfaceOffset(world+vec2(0.,d))-surfaceOffset(world-vec2(0.,d)))/(2.*d);
    gradient+=ripple.yz*.96;
    vec3 normal=normalize(vec3(-gradient.x,1.,-gradient.y));
    vec3 sun=normalize(vec3(.43,-.82,.34));
    vec3 refracted=refract(sun,normal,1./1.333);
    float column=h-canalBedElevation(world-origin);
    float lengthToBed=max(0.,column)/max(.64,-refracted.y);
    vec2 bottom=world+refracted.xz*lengthToBed;
    lengthToBed=max(0.,h-canalBedElevation(bottom-origin))/max(.64,-refracted.y);
    bottom=world+refracted.xz*lengthToBed;
    vec2 destinationUV=(bottom-simulationBounds.xy)*simulationBounds.zw;
    surfaceUV=uv*causticSize;
    transmission=smoothstep(.034,.15,column)*exp(-lengthToBed*.85);
    focusFactor=smoothstep(.08,.50,column);
    gl_Position=vec4(destinationUV*2.-1.,0.,1.);
  }
`;

const fragmentShader=`
  varying vec2 surfaceUV;
  varying float transmission;
  varying float focusFactor;
  void main() {
    vec2 tangent=dFdx(surfaceUV), bitangent=dFdy(surfaceUV);
    float compression=abs(tangent.x*bitangent.y-tangent.y*bitangent.x);
    float focus=clamp((compression-1.0)*.46,0.,3.4);
    // Store scene-linear irradiance in one channel. Focus near grazing light
    // paths is averaged by the filter on the bed instead of hard-clipped.
    float value=2.7*transmission*focus*mix(.26,.42,focusFactor);
    gl_FragColor=vec4(value,0.,0.,1.);
  }
`;

export function createCanalCaustics(surface) {
  const width=384,height=640;
  const target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:false,stencilBuffer:false});
  target.texture.name="Refracted sunlight on canal bed";
  const material=new THREE.ShaderMaterial({
    uniforms:{
      windTime:surface.windTime,windStrength:surface.windStrength,windOrigin:surface.windOrigin,
      windMap:surface.windMap,windBounds:surface.windBounds,
      time:surface.time,origin:surface.origin,waterState:surface.waterState,
      simulationBounds:surface.simulationBounds,simulationHeight:surface.simulationHeight,
      causticSize:{value:new THREE.Vector2(width,height)},
    },
    vertexShader,fragmentShader,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,
    blending:THREE.AdditiveBlending,
  });
  const pass=new THREE.Scene();
  pass.background=new THREE.Color(0);
  const geometry=new THREE.PlaneGeometry(2,2,212,352);
  const projection=new THREE.Mesh(geometry,material);
  projection.frustumCulled=false;
  pass.add(projection);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,2);
  camera.position.z=1;
  let last=-1, passes=0;
  return {
    uniforms:{
      causticMap:{value:target.texture},
      causticBounds:surface.simulationBounds,
      causticStrength:{value:1},
    },
    update(renderer) {
      if(last>=0 && surface.time.value-last<.031) return;
      renderer.setRenderTarget(target);
      renderer.render(pass,camera);
      passes++;
      last=surface.time.value;
    },
    inspect:()=>({passes,width,height,last}),
  };
}
