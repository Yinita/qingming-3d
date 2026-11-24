import * as THREE from "three";

export const waterHeight = .016;
export const canalHalfLength = 16.2;
export const canalSpeed = .39;
const bankOverlap = .91;
const smooth = THREE.MathUtils.smoothstep;

export function canalOrigin(center) {
  return new THREE.Vector2(center.x + .25, center.z - 1.75);
}

export function canalShoreRadius(z, side) {
  return 8.59 + .43*Math.sin(.55*z) + .21*Math.cos(.91*z) - side*.14*Math.cos(.33*z);
}

export function canalBedHeight(shore, along) {
  return -(.38*smooth(shore,0,1.42)+1.34*smooth(shore,.81,4.26))*
    (1-smooth(Math.abs(along),13.55,canalHalfLength));
}

export function canalShelfRelief(shore,along,side) {
  const envelope=smooth(shore,-.87,-.51)*(1-smooth(shore,.29,.79));
  if(envelope===0) return 0;
  const phase=12.1*along+side*1.7+3.2*shore+.62*Math.sin(3.59*along+side);
  const groove=(.5+.5*Math.cos(phase))**8;
  const lip=.063*(1-smooth(shore,-.24,.32));
  const chips=.008*Math.sin(along*28.2+shore*19.3)*Math.sin(shore*31.7-along*8.1);
  return envelope*(lip-.010-.030*groove+chips)*(1-smooth(Math.abs(along),13.55,canalHalfLength));
}

export function canalTerrainHeight(origin,x,z) {
  const across=x-origin.x, along=z-origin.y, side=Math.sign(across);
  const shore=canalShoreRadius(along,side)-Math.abs(across);
  return canalBedHeight(shore,along)+canalShelfRelief(shore,along,side);
}

export function canalDepth(origin, x, z) {
  return Math.max(0,waterHeight-canalTerrainHeight(origin,x,z));
}

export const canalBankGLSL = `
  float canalBank(vec2 p) {
    return 8.59 + .43*sin(.55*p.y) + .21*cos(.91*p.y) - sign(p.x)*.14*cos(.33*p.y);
  }
`;

export const canalBathymetryGLSL = `
  float shelfGroove(float shore,float along,float side) {
    float phase=12.1*along+side*1.7+3.2*shore+.62*sin(3.59*along+side);
    float ridge=.5+.5*cos(phase);
    float fourth=ridge*ridge*ridge*ridge;
    return fourth*fourth;
  }

  float canalBedElevation(vec2 p) {
    float shore=canalBank(p)-abs(p.x);
    float deep=.38*smoothstep(0.,1.42,shore)+1.34*smoothstep(.81,4.26,shore);
    float envelope=smoothstep(-.87,-.51,shore)*(1.-smoothstep(.29,.79,shore));
    float relief=0.;
    if(envelope>0.) {
      float lip=.063*(1.-smoothstep(-.24,.32,shore));
      float chips=.008*sin(p.y*28.2+shore*19.3)*sin(shore*31.7-p.y*8.1);
      relief=envelope*(lip-.010-.030*shelfGroove(shore,p.y,sign(p.x))+chips);
    }
    return (relief-deep)*(1.-smoothstep(13.55,16.2,abs(p.y)));
  }
`;

function cutGround(groundMaterial,origin,cut,wetting) {
  const previous=groundMaterial.onBeforeCompile;
  const previousKey=groundMaterial.customProgramCacheKey();
  if(wetting) groundMaterial.userData.shoreWetting=wetting;
  groundMaterial.onBeforeCompile = shader => {
    previous.call(groundMaterial,shader);
    shader.uniforms.cutCanal = cut;
    shader.uniforms.canalOrigin = { value: origin };
    if(wetting) Object.assign(shader.uniforms,wetting);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 paintedXZ;")
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\npaintedXZ=(modelMatrix*vec4(position,1.)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float cutCanal;
        uniform vec2 canalOrigin;
        varying vec2 paintedXZ;
        ${wetting ? "uniform sampler2D bankWash; uniform vec2 bankWashBounds; uniform float bankWashRange;" : ""}
        ${canalBankGLSL}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        vec2 p=paintedXZ-canalOrigin;
        if(cutCanal>.5 && abs(p.y)<16.19 && abs(p.x)<canalBank(p)+${bankOverlap.toFixed(2)}) discard;`)
      .replace("#include <map_fragment>",`#include <map_fragment>
        float shore=canalBank(p)-abs(p.x);
        float damp=smoothstep(-.58,.01,shore)*(1.-smoothstep(13.5,16.2,abs(p.y)));
        diffuseColor.rgb*=mix(vec3(1.),vec3(.78,.80,.72),damp*cutCanal);
        ${wetting ? `
          float bankU=(paintedXZ.y-bankWashBounds.x)*bankWashBounds.y;
          if(cutCanal>.5 && p.x<0. && shore<.035 && bankU>0. && bankU<1.) {
            float wet=texture2D(bankWash,vec2(bankU,.5)).r*bankWashRange;
            float mark=smoothstep(.014,.17,wet)*(1.-smoothstep(max(0.,wet-.073),wet+.028,max(0.,-shore)));
            diffuseColor.rgb*=mix(vec3(1.),vec3(.62,.66,.59),mark*.71);
          }` : ""}`);
  };
  groundMaterial.customProgramCacheKey = () => previousKey+"-canal-cut"+(wetting ? "-wash" : "");
  groundMaterial.needsUpdate=true;
}

// The source view still uses its planar painting. Mission mode replaces both flat
// layers in the same footprint so the recessed bed is visible at the shoreline.
export function buildCanalBed(parent,origin,paintedGround,apron,caustics,wetting,surface) {
  const cut={ value:0 };
  const archive=paintedGround.userData.archiveMaterial;
  cutGround(archive,origin,cut,wetting);
  cutGround(paintedGround.userData.perspectiveMaterial,origin,cut,wetting);
  cutGround(apron.material,origin,cut,wetting);

  const bankSamples=49, innerSamples=72, acrossSamples=bankSamples*2+innerSamples, alongSamples=540;
  const geometry = new THREE.PlaneGeometry(2,2,acrossSamples,alongSamples);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const { width, height } = paintedGround.geometry.parameters;
  for (let row=0; row<=alongSamples; row++) {
    const along = canalHalfLength*(1-2*row/alongSamples);
    for (let col=0; col<=acrossSamples; col++) {
      const west=canalShoreRadius(along,-1), east=canalShoreRadius(along,1);
      const left=-west+.94,right=east-.94;
      const offset=col<=bankSamples ? THREE.MathUtils.lerp(-west-1.01,left,col/bankSamples) :
        col>=bankSamples+innerSamples ? THREE.MathUtils.lerp(right,east+1.01,(col-bankSamples-innerSamples)/bankSamples) :
        THREE.MathUtils.lerp(left,right,(col-bankSamples)/innerSamples);
      const x=origin.x+offset;
      const z = origin.y + along;
      const shore=(offset<0 ? west : east)-Math.abs(offset);
      const margin=Math.max(1-smooth(shore,-.90,-.77),smooth(Math.abs(along),16.08,16.19));
      const y=canalTerrainHeight(origin,x,z)-.004*margin;
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
  const bedMaterial=surface.project("worn-stone",{map:archive.map,roughness:.94},true);
  bedMaterial.userData.bankFinish={value:1};
  const compile=bedMaterial.onBeforeCompile, key=bedMaterial.customProgramCacheKey();
  bedMaterial.onBeforeCompile=shader=>{
    compile.call(bedMaterial,shader);
    Object.assign(shader.uniforms,caustics,{bankClock:clock,bankOrigin:{value:origin},
      bankFinish:bedMaterial.userData.bankFinish},wetting);
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
      uniform float bankClock, bankFinish;
      uniform vec2 bankOrigin;
      uniform sampler2D causticMap;
      uniform vec4 causticBounds;
      uniform float causticStrength;
      ${wetting ? "uniform sampler2D bankWash; uniform vec2 bankWashBounds; uniform float bankWashRange;" : ""}
      ${canalBankGLSL}
      ${canalBathymetryGLSL}
      float chalk(vec2 q) {
        vec2 g=vec2(sin(dot(q,vec2(1.9,1.1))),sin(dot(q,vec2(-1.5,2.2))));
        vec2 w=sin(q+g*.92);
        return pow(1.-min(1.,abs(w.x+w.y*.82)),9.);
      }
      `)
      .replace("#include <alphamap_fragment>",`#include <alphamap_fragment>
        vec2 q=finishPoint.xz-bankOrigin;
        float depth=max(0.,-finishPoint.y);
        float shore=canalBank(q)-abs(q.x);
        float bankGroove=shore<.71 ? shelfGroove(shore,q.y,sign(q.x))*(1.-smoothstep(.20,.71,shore)) : 0.;
        float damp=smoothstep(-.78,.10,shore)*(1.-smoothstep(13.5,16.2,abs(q.y)));
        float bankWet=bankFinish*damp*(.28+.38*bankGroove+.31*smoothstep(.005,.09,depth));
        ${wetting ? `
        float washU=(finishPoint.z-bankWashBounds.x)*bankWashBounds.y;
        if(q.x<0. && washU>0. && washU<1. && shore<.17) {
          float wet=texture2D(bankWash,vec2(washU,.5)).r*bankWashRange;
          float stain=smoothstep(.014,.17,wet)*(1.-smoothstep(max(0.,wet-.073),wet+.028,max(0.,-shore)));
          bankWet=max(bankWet,stain*.86*bankFinish);
        }` : ""}
        vec3 sediment=mix(vec3(.25,.205,.141),vec3(.33,.272,.181),pigment.g);
        float clay=smoothstep(.023,.34,depth)*(.41+.25*relief.r);
        diffuseColor.rgb=mix(diffuseColor.rgb,sediment,clay);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.62,.64,.61),bankWet);
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.29,bankWet*.83);
      `)
      .replace("#include <opaque_fragment>",`
        float footprint=length(fwidth(q));
        float luminous=chalk(q*8.5+vec2(bankClock*.3,-bankClock*.65))*.72
          +chalk(q*10.2+vec2(-bankClock*.42,bankClock*.29))*.28;
        float micro=luminous*smoothstep(.07,.19,depth)*(1.-smoothstep(.46,1.39,depth))
          *(1.-smoothstep(.06,.23,footprint));
        vec2 lightUV=(finishPoint.xz-causticBounds.xy)*causticBounds.zw;
        float light=texture2D(causticMap,lightUV).r;
        float softFocus=(smoothstep(.025,.55,light)+.12*light)*
          (1.-smoothstep(.77,1.62,depth));
        vec3 sunColor=vec3(.68,.57,.322)*(softFocus+.071*micro);
        outgoingLight+=sunColor*causticStrength*smoothstep(.012,.072,depth);
        #include <opaque_fragment>
      `);
  };
  bedMaterial.customProgramCacheKey=()=>key+"-canal-bed";
  const bed = new THREE.Mesh(geometry,bedMaterial);
  bed.name = "Recessed canal bed";
  bed.receiveShadow=true;
  bed.layers.enable(1);
  parent.add(bed);
  return {
    setVisible(active) { cut.value = active ? 1 : 0; },
    frame(time) { clock.value = time; },
  };
}
