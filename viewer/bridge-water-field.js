import { MathUtils } from "three";
import { canalBankGLSL, canalShoreRadius, canalSpeed, waterHeight } from "./bridge-canal-bed.js";

// Wavelength, propagation and amplitude are shared by the mesh and physical samplers.
const waves = [
  [1.24,2.09,2.17,.022],
  [-2.25,2.61,3.12,.013],
  [.785,-1.38,1.27,.017],
];
const impactDrift = canalSpeed*.26;
const smooth = MathUtils.smoothstep;

export const surfaceGLSL = `
  ${canalBankGLSL}
  uniform float time;
  uniform vec2 origin;
  uniform vec4 contacts[CONTACT_COUNT];

  float surfaceOffset(vec2 world) {
    vec2 p=world-origin;
    float shore=canalBank(p)-abs(p.x);
    float mask=smoothstep(.0,.90,shore)*(1.-smoothstep(13.4,16.2,abs(p.y)));
    float h=0.;
    ${waves.map(([kx,kz,speed,amp]) =>
      `h+=${amp}*sin(dot(p,vec2(${kx},${kz}))-${speed}*time);`).join("\n    ")}
    for(int i=0;i<CONTACT_COUNT;i++) {
      vec4 impact=contacts[i];
      float age=time-impact.z;
      if(impact.w>.01 && age>=0. && age<2.4) {
        float d=distance(world,impact.xy+vec2(0.,age*${impactDrift}));
        float radius=.07+age*(.93+.35*impact.w);
        float delta=d-radius;
        if(abs(delta)<.46) {
          float band=delta/(.15+.09*age);
          h+=.028*impact.w*cos(delta*16.)*exp(-band*band-1.8*age);
        }
      }
    }
    return mask*h;
  }
`;

export function createWaterField(origin, contacts) {
  return {
    height(x,z,time) {
      const u=x-origin.x, v=z-origin.y;
      const shore=canalShoreRadius(v,Math.sign(u))-Math.abs(u);
      const mask=smooth(shore,0,.9)*(1-smooth(Math.abs(v),13.4,16.2));
      if (!mask) return waterHeight;
      let h=0;
      for(const [kx,kz,speed,amp] of waves) h+=amp*Math.sin(kx*u+kz*v-speed*time);
      for(const hit of contacts) {
        const age=time-hit.z;
        if (hit.w<=.01 || age<0 || age>=2.4) continue;
        const delta=Math.hypot(x-hit.x,z-hit.y-age*impactDrift)-(.07+age*(.93+.35*hit.w));
        if (Math.abs(delta)>=.46) continue;
        const band=delta/(.15+.09*age);
        h+=.028*hit.w*Math.cos(delta*16)*Math.exp(-band*band-1.8*age);
      }
      return waterHeight+h*mask;
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
      return out.set(across,along);
    },
  };
}
