import * as THREE from "three";

export const waterHeight = .016;
export const canalHalfLength = 16.2;
export const canalSpeed = .39;

export function canalOrigin(center) {
  return new THREE.Vector2(center.x + .25, center.z - 1.75);
}

export function canalShoreRadius(z, side) {
  return 8.59 + .43*Math.sin(.55*z) + .21*Math.cos(.91*z) - side*.14*Math.cos(.33*z);
}

export function canalBedHeight(shore, along) {
  const { smoothstep } = THREE.MathUtils;
  const depth = .38*smoothstep(shore,0,1.42) + 1.34*smoothstep(shore,.81,4.26);
  return -depth*(1-smoothstep(Math.abs(along),13.55,canalHalfLength));
}

export function canalDepth(origin, x, z) {
  const across = x-origin.x, along = z-origin.y;
  return Math.max(0,waterHeight - canalBedHeight(canalShoreRadius(along,Math.sign(across))-Math.abs(across),along));
}

export const canalBankGLSL = `
  float canalBank(vec2 p) {
    return 8.59 + .43*sin(.55*p.y) + .21*cos(.91*p.y) - sign(p.x)*.14*cos(.33*p.y);
  }
`;

function cutGround(groundMaterial,origin,cut) {
  groundMaterial.onBeforeCompile = shader => {
    shader.uniforms.cutCanal = cut;
    shader.uniforms.canalOrigin = { value: origin };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 paintedXZ;")
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\npaintedXZ=(modelMatrix*vec4(position,1.)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float cutCanal;
        uniform vec2 canalOrigin;
        varying vec2 paintedXZ;
        ${canalBankGLSL}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        vec2 p=paintedXZ-canalOrigin;
        if(cutCanal>.5 && abs(p.y)<16.19 && abs(p.x)<canalBank(p)) discard;`)
      .replace("#include <map_fragment>",`#include <map_fragment>
        float shore=canalBank(p)-abs(p.x);
        float damp=smoothstep(-.58,.01,shore)*(1.-smoothstep(13.5,16.2,abs(p.y)));
        diffuseColor.rgb*=mix(vec3(1.),vec3(.78,.80,.72),damp*cutCanal);`);
  };
  groundMaterial.customProgramCacheKey = () => "canal-cut-paint";
  groundMaterial.needsUpdate=true;
}

// The source view still uses its planar painting. Mission mode replaces both flat
// layers in the same footprint so the recessed bed is visible at the shoreline.
export function buildCanalBed(parent,origin,paintedGround,apron) {
  const cut={ value:0 };
  cutGround(paintedGround.material,origin,cut);
  cutGround(apron.material,origin,cut);

  const acrossSamples = 80, alongSamples = 128;
  const geometry = new THREE.PlaneGeometry(2,2,acrossSamples,alongSamples);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const { width, height } = paintedGround.geometry.parameters;
  for (let row=0; row<=alongSamples; row++) {
    const along = canalHalfLength*(1-2*row/alongSamples);
    for (let col=0; col<=acrossSamples; col++) {
      const fraction = 2*col/acrossSamples-1;
      const radius = canalShoreRadius(along,Math.sign(fraction));
      const x = origin.x + fraction*(radius+.075);
      const z = origin.y + along;
      const y = canalBedHeight(radius-Math.abs(x-origin.x),along) - .004;
      const i = row*(acrossSamples+1)+col;
      positions.setXYZ(i,x,y,z);
      uv.setXY(i,x/width+.5,-z/height);
    }
  }
  // PlaneGeometry is wound for +Z. In this grid rows move toward -Z.
  const indices = geometry.index.array;
  for (let i=0; i<indices.length; i+=3) {
    const temp=indices[i+1];
    indices[i+1]=indices[i+2];
    indices[i+2]=temp;
  }
  geometry.computeVertexNormals();

  const clock = { value: 0 };
  const bedMaterial = new THREE.ShaderMaterial({
    uniforms: { time: clock, painting: { value: paintedGround.material.map }, origin: { value: origin } },
    vertexShader: `
      varying vec2 paintingUV;
      varying vec3 p;
      void main() {
        paintingUV=uv; p=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }
    `,
    fragmentShader: `
      uniform sampler2D painting;
      uniform float time;
      uniform vec2 origin;
      varying vec2 paintingUV;
      varying vec3 p;
      ${canalBankGLSL}
      float chalk(vec2 q) {
        vec2 g=vec2(sin(dot(q,vec2(1.9,1.1))),sin(dot(q,vec2(-1.5,2.2))));
        vec2 w=sin(q+g*.92);
        return pow(1.-min(1.,abs(w.x+w.y*.82)),9.);
      }
      void main() {
        vec3 color=texture2D(painting,paintingUV).rgb;
        vec2 q=p.xz-origin;
        float grain=.5+.5*sin(q.x*7.5+sin(q.y*9.4))*cos(q.y*7.2+sin(q.x*8.9));
        vec3 silt=mix(vec3(.215,.159,.087),vec3(.38,.291,.174),grain);
        float depth=max(0.,-p.y);
        float shore=canalBank(q)-abs(q.x);
        float damp=smoothstep(-.58,.01,shore)*(1.-smoothstep(13.5,16.2,abs(q.y)));
        color*=mix(vec3(1.),vec3(.78,.80,.72),damp);
        float bedMix=smoothstep(.011,.23,depth);
        float footprint=length(fwidth(q));
        float luminous=chalk(q*8.5+vec2(time*.3,-time*.65))*.72
          +chalk(q*10.2+vec2(-time*.42,time*.29))*.28;
        float caustic=luminous*smoothstep(.11,.27,depth)*(1.-smoothstep(.46,1.39,depth))
          *(1.-smoothstep(.06,.23,footprint));
        gl_FragColor=vec4(mix(color,silt,bedMix*.69)+caustic*vec3(.12,.10,.055),1.);
        #include <colorspace_fragment>
      }
    `,
  });
  const bed = new THREE.Mesh(geometry,bedMaterial);
  bed.name = "Recessed canal bed";
  bed.layers.enable(1);
  parent.add(bed);
  return {
    setVisible(active) { cut.value = active ? 1 : 0; },
    frame(time) { clock.value = time; },
  };
}
