import { MathUtils } from "three";
import { canalBankGLSL, canalShoreRadius, waterHeight } from "./bridge-canal-bed.js";
import { airGLSL } from "./bridge-air.js";

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

// Three smaller ripples contribute both to the surface normal and light bending.
export const capillaryGLSL=`
  ${airGLSL}
  vec3 capillaryFromAir(vec2 world,vec3 airflow) {
    vec2 p=world-origin;
    vec2 k1=vec2(9.7,12.9), k2=vec2(-14.2,9.4), k3=vec2(12.5,-16.8);
    float a=dot(k1,p)-time*5.7+.68*sin(p.x*1.9+p.y*1.4-time*.71);
    float b=dot(k2,p)-time*6.3+.63*sin(p.y*2.7-p.x*.88+time*.58);
    float c=dot(k3,p)-time*7.2+.44*cos(p.x*1.8-p.y*2.3);
    float envelope=.60+.40*smoothstep(-.85,.83,sin(p.y*2.7+p.x*.82-time*.77));
    float speed=length(airflow.xy);
    vec2 heading=airflow.xy/max(.1,speed);
    float gust=smoothstep(.36,5.12,speed);
    float edgeEddy=min(.46,airflow.z*.54);
    float first=.014*(.51+.74*gust)*(.86+.25*abs(dot(normalize(k1),heading)));
    float second=.0097*(.61+.49*gust)*(.84+.41*abs(dot(normalize(k2),heading)));
    float shortWave=.0046*(.58+.48*gust+edgeEddy);
    float h=first*sin(a)+second*sin(b)+shortWave*sin(c);
    vec2 slope=first*k1*cos(a)+second*k2*cos(b)+shortWave*k3*cos(c);
    return envelope*vec3(h,slope);
  }
  vec3 capillaryWaves(vec2 world) {
    return capillaryFromAir(world,canalAirFlow(world,windTime-.20,.10));
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
      return waterHeight+h*mask+simulation.heightAt(x,z);
    },
    velocity(x,z,time,out) {
      const u=x-origin.x,v=z-origin.y;
      const shore=canalShoreRadius(v,Math.sign(u))-Math.abs(u);
      const clear=smooth(shore,.08,.90);
      let across=.035*Math.sin(.68*v-.89*time+.37*u)*clear;
      let along=0;
      for(const [kx,kz,speed,amp] of waves) {
        const orbit=.54*amp*speed*Math.cos(kx*u+kz*v-speed*time)*clear;
        const magnitude=Math.hypot(kx,kz);
        across+=orbit*kx/magnitude;
        along+=orbit*kz/magnitude;
      }
      simulation.sample(x,z,scratch);
      return out.set(across+scratch.meanU+scratch.u,along+scratch.meanV+scratch.v);
    },
    disturbance(x,z,out) { return simulation.sample(x,z,out); },
  };
}
