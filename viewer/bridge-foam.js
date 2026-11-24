import * as THREE from "three";
import { channelVelocityLimit } from "./bridge-channel-flow.js";
import { waterStateGLSL } from "./bridge-water-field.js";
import { airGLSL, airUniforms, waterWindDelay, waterWindDrift } from "./bridge-air.js";

export const foamDensityGLSL = `
  float foamDensity(vec2 encodedRG) {
    return dot(encodedRG,vec2(65280.,255.))/65535.;
  }
`;

const vertexShader = `
  varying vec2 fieldUV;
  void main() {
    fieldUV=uv;
    gl_Position=vec4(position.xy,0.,1.);
  }
`;

const fragmentShader = `
  ${airGLSL}
  ${waterStateGLSL}
  ${foamDensityGLSL}
  uniform sampler2D channelFlow;
  uniform sampler2D previousFoam;
  uniform float time;
  uniform float stepSeconds;
  uniform float initialized;
  varying vec2 fieldUV;

  float hash(vec2 p) {
    vec3 q=fract(vec3(p.xyx)*.1031);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }

  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p);
    f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
      mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);
  }

  vec2 velocity(vec2 encodedRG) {
    return (encodedRG*255.-128.)*(${channelVelocityLimit}/127.);
  }

  void main() {
    vec2 world=simulationBounds.xy+fieldUV/simulationBounds.zw;
    vec3 flow=texture2D(channelFlow,fieldUV).rgb;
    vec4 state=sampleWaterState(world);
    vec2 windDrift=canalAir(world,windTime-${waterWindDelay})*${waterWindDrift};
    vec2 centerVelocity=velocity(flow.rg)+windDrift;
    vec2 halfTrace=fieldUV-.5*stepSeconds*centerVelocity*simulationBounds.zw;
    vec2 transport=velocity(texture2D(channelFlow,halfTrace).rg)+windDrift;

    // Small curls distort the foam between adjacent solver samples.
    vec2 p=fieldUV/simulationBounds.zw;
    float s=sin(dot(p,vec2(7.4,4.6))-time*2.15);
    float c=cos(dot(p,vec2(4.2,-8.7))+time*1.86);
    transport+=vec2(.071*s-.051*c,-.114*s-.025*c)*smoothstep(.053,.31,state.b+.20*flow.b);
    vec2 sourceUV=fieldUV-transport*stepSeconds*simulationBounds.zw;
    float edge=min(min(sourceUV.x,sourceUV.y),min(1.-sourceUV.x,1.-sourceUV.y));
    float carried=foamDensity(texture2D(previousFoam,sourceUV).rg)*initialized*step(-.0004,edge);

    vec2 cells=p-transport*.22;
    float coarse=noise(cells*vec2(10.3,13.2)+vec2(.47*time,-.33*time));
    float fine=noise(cells*vec2(28.1,25.3)-vec2(time*.72,time*.81));
    float cluster=smoothstep(.54,.85,.72*coarse+.28*fine);
    float air=smoothstep(.045,.72,flow.b);
    float broken=smoothstep(.23,.89,state.b)*(1.-.62*air);
    float birth=cluster*(air*2.4+broken*.97);
    float decay=.69+.50*(1.-fine);
    float density=carried*exp(-stepSeconds*decay)+stepSeconds*birth;
    float encoded=floor(clamp(density,0.,1.)*65535.+.5);
    gl_FragColor=vec4(floor(encoded/256.)/255.,mod(encoded,256.)/255.,0.,1.);
  }
`;

export function createFoamTransport(surface) {
  const width = 512, height = 856;
  const makeTarget = () => new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false, stencilBuffer: false,
  });
  let read = makeTarget(), write = makeTarget();
  read.texture.name = write.texture.name = "Advected canal foam";
  const visibleFoam = { value: read.texture };
  const uniforms = {
    ...airUniforms,
    time: surface.time, channelFlow: surface.channelFlow, waterState: surface.waterState,
    simulationBounds: surface.simulationBounds, previousFoam: { value: read.texture },
    stepSeconds: { value: 0 }, initialized: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader,
    depthTest: false, depthWrite: false });
  const pass = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  pass.add(quad);
  const camera = new THREE.Camera();
  let last = -1, passes = 0;
  return {
    visibleFoam,
    update(renderer) {
      const time = surface.time.value;
      if (last >= 0 && time - last < .030) return;
      uniforms.previousFoam.value = read.texture;
      uniforms.stepSeconds.value = last < 0 ? .033 : Math.min(.075, time - last);
      uniforms.initialized.value = last >= 0 && time - last < .65 ? 1 : 0;
      renderer.setRenderTarget(write);
      renderer.render(pass,camera);
      [read,write] = [write,read];
      visibleFoam.value = read.texture;
      last = time;
      passes++;
    },
    inspect: () => ({ passes, width, height, last }),
  };
}
