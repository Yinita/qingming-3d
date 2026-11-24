import { MathUtils } from "three";
import { canalBankGLSL, canalShoreRadius, canalSpeed, waterHeight } from "./bridge-canal-bed.js";

// Wave numbers, propagation and amplitude are shared by the mesh and physical samplers.
const waves = [
  [1.24,2.09,2.17,.022],
  [-2.25,2.61,3.12,.013],
  [.785,-1.38,1.27,.017],
];
const smooth = MathUtils.smoothstep;

export const waterStateGLSL = `
  uniform sampler2D waterState;
  uniform vec4 simulationBounds;
  uniform float simulationHeight;

  vec4 sampleWaterState(vec2 world) {
    vec2 uv=(world-simulationBounds.xy)*simulationBounds.zw;
    return texture2D(waterState,clamp(uv,0.,1.));
  }

  float decodeWave(vec4 state) {
    return (state.r*65280.+state.g*255.-32768.)*(simulationHeight/32767.);
  }
`;

export const surfaceGLSL = `
  ${canalBankGLSL}
  uniform float time;
  uniform vec2 origin;
  ${waterStateGLSL}

  float surfaceOffset(vec2 world) {
    vec2 p=world-origin;
    float shore=canalBank(p)-abs(p.x);
    float mask=smoothstep(.0,.90,shore)*(1.-smoothstep(13.4,16.2,abs(p.y)));
    float h=0.;
    ${waves.map(([kx,kz,speed,amp]) =>
      `h+=${amp}*sin(dot(p,vec2(${kx},${kz}))-${speed}*time);`).join("\n    ")}
    return mask*h+decodeWave(sampleWaterState(world));
  }
`;

export function createWaterField(origin, simulation) {
  const scratch={};
  return {
    height(x,z,time) {
      const u=x-origin.x, v=z-origin.y;
      const shore=canalShoreRadius(v,Math.sign(u))-Math.abs(u);
      const mask=smooth(shore,0,.9)*(1-smooth(Math.abs(v),13.4,16.2));
      let h=0;
      if(mask) for(const [kx,kz,speed,amp] of waves) h+=amp*Math.sin(kx*u+kz*v-speed*time);
      return waterHeight+h*mask+simulation.sample(x,z,scratch).height;
    },
    velocity(x,z,time,out) {
      const u=x-origin.x,v=z-origin.y;
      const shore=canalShoreRadius(v,Math.sign(u))-Math.abs(u);
      let across=.075*Math.sin(.68*v-.89*time+.37*u);
      let along=canalSpeed*(.41+.59*smooth(shore,.08,2.5));
      for(const [kx,kz,speed,amp] of waves) {
        const orbit=.54*amp*speed*Math.cos(kx*u+kz*v-speed*time);
        const magnitude=Math.hypot(kx,kz);
        across+=orbit*kx/magnitude;
        along+=orbit*kz/magnitude;
      }
      simulation.sample(x,z,scratch);
      return out.set(across+scratch.u,along+scratch.v);
    },
    disturbance(x,z,out) { return simulation.sample(x,z,out); },
  };
}
