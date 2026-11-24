import { MathUtils } from "three";

export function willowPosition(anchor,time,phase,target) {
  const height=MathUtils.clamp(anchor.y/4.8,0,1.2);
  const softness=height*height*(.44+.56*MathUtils.smoothstep(Math.hypot(anchor.x,anchor.z),.13,2.5));
  const front=time*1.03+phase-anchor.x*.36-anchor.z*.24;
  const breath=.62+.38*Math.sin(time*.38+phase*.53);
  const shear=breath*(.13*Math.sin(front)+.039*Math.sin(front*2.41+anchor.y*.35));
  return target.set(anchor.x+softness*shear,
    anchor.y-.22*softness*Math.abs(shear),
    anchor.z+softness*(shear*.46+.046*Math.sin(front*1.31)));
}

// Bend branches and their leaf instances in the same tree-local wind field.
const wind = `
  uniform float windTime;
  uniform float windPhase;
  vec3 branchSway(vec3 p) {
    float height = clamp(p.y/4.8,0.0,1.2);
    float softness = height*height*(.44+.56*smoothstep(.13,2.5,length(p.xz)));
    float front = windTime*1.03 + windPhase - dot(p.xz,vec2(.36,.24));
    float breath = .62 + .38*sin(windTime*.38 + windPhase*.53);
    float shear = breath*(.13*sin(front) + .039*sin(front*2.41 + p.y*.35));
    return softness*vec3(shear,-.22*abs(shear),shear*.46 + .046*sin(front*1.31));
  }
`;

const flutter = `
  vec3 anchor = instanceMatrix[3].xyz;
  vec3 shift = branchSway(anchor);
  mat3 axes = mat3(instanceMatrix);
  transformed += vec3(dot(shift,axes[0])/dot(axes[0],axes[0]),
                      dot(shift,axes[1])/dot(axes[1],axes[1]),
                      dot(shift,axes[2])/dot(axes[2],axes[2]));
  float lag = dot(anchor,vec3(6.31,7.13,2.27));
  float flip = sin(windTime*5.6+lag) + .38*sin(windTime*9.4-lag*.72);
  transformed.z += position.y*position.y*.13*flip;
  transformed.x += position.y*.052*sin(windTime*3.80+lag);
`;

export function willowWind(material, clock, phase, leaves = false) {
  material.onBeforeCompile = shader => {
    shader.uniforms.windTime = clock;
    shader.uniforms.windPhase = { value: phase };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\n" + wind)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" +
        (leaves ? flutter : "transformed += branchSway(position);"));
  };
  material.customProgramCacheKey = () => leaves ? "willow-canopy-v1" : "willow-limbs-v1";
}
