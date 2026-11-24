import * as THREE from "three";

export function bladeGeometry(width=.15, divisions=7, crossSegments=2) {
  const position=[],uv=[],index=[];
  const stride=crossSegments+1;
  for(let row=0;row<=divisions;row++) {
    const t=row/divisions;
    const edge=Math.max(.019,Math.pow(Math.sin(Math.PI*t),.82))*(1.16-.37*t);
    const scallop=1-.062*Math.pow(Math.sin(t*13.*Math.PI),2);
    const radius=width*edge*scallop;
    const bend=.066*Math.sin(t*2.7)-.19*t*t*t;
    for(let col=0;col<=crossSegments;col++) {
      const across=2*col/crossSegments-1;
      const cup=-across*across*(.019+.022*Math.sin(t*3.8));
      const midrib=.014*Math.exp(-across*across*17.);
      const roll=across*.069*Math.sin(t*3.8)+(.021+cup+midrib)*edge;
      position.push(across*radius+(t*t*.054),.10+.90*t,bend+roll);
      uv.push((across+1)*.5,t);
      const i=row*stride+col;
      if(row<divisions && col<crossSegments) index.push(i,i+1,i+stride,i+1,i+stride+1,i+stride);
    }
  }
  const stalk=position.length/3;
  position.push(-.007,0,0,.007,0,0,-.004,.104,.006,.004,.104,.006,
    0,0,-.007,0,0,.007,0,.104,.001,0,.104,.011);
  uv.push(.5,0,.5,0,.5,.05,.5,.05,.5,0,.5,0,.5,.05,.5,.05);
  index.push(stalk,stalk+1,stalk+2,stalk+1,stalk+3,stalk+2,
    stalk+4,stalk+5,stalk+6,stalk+5,stalk+7,stalk+6);
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// One thin-sheet lobe for backlit blades, evaluated against the actual key light
// and the foliage shadow map. The front side still uses Three's PBR response.
export function lightLeaf(material, power=.54, closeDetail=false) {
  const earlier=material.onBeforeCompile;
  const previousKey=material.customProgramCacheKey();
  const transmission={value:power};
  material.userData.leafTransmission=transmission;
  material.onBeforeCompile=shader=>{
    earlier.call(material,shader);
    shader.uniforms.leafTransmission=transmission;
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec2 bladeUV;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nbladeUV=uv;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nvarying vec2 bladeUV; uniform float leafTransmission;")
      .replace("#include <shadowmap_pars_fragment>",
        "#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float ageCenter=1.-smoothstep(.045,.14,abs(bladeUV.x-.5));
        float midrib=1.-smoothstep(.012,.035,abs(bladeUV.x-.5));
        float fine=1.-smoothstep(.045,.28,length(fwidth(bladeUV)));
        float ribs=1.-smoothstep(.017,.082,abs(sin((bladeUV.y+abs(bladeUV.x-.5)*.28)*54.)));
        float veins=clamp((midrib*.64+ribs*(1.-ageCenter)*.30)*fine,0.,1.);
        float dryEdge=smoothstep(.27,.49,abs(bladeUV.x-.5))*
          (1.-smoothstep(.19,.80,bladeUV.y));
        diffuseColor.rgb*=vec3(1.+veins*.17,1.+veins*.18,1.-veins*.12);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.87,.82,.64),dryEdge*.19);`)
      .replace("#include <opaque_fragment>",`
        #if NUM_DIR_LIGHTS > 0
          vec3 leafKey=directionalLights[0].direction;
          float behind=pow(max(0.,-dot(normal,leafKey)),.87);
          float transmitted=behind*(.38+.62*max(0.,dot(leafKey,-normalize(vViewPosition))));
          vec3 transmittedPigment=diffuseColor.rgb*vec3(.94,1.19,.51);
          outgoingLight+=transmittedPigment*transmitted*leafTransmission*
            max(.23,getShadowMask())*(1.-veins*.38)*directionalLights[0].color;
        #endif
        #include <opaque_fragment>`);
    if(closeDetail) {
      shader.fragmentShader=shader.fragmentShader
        .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
          float pigment=.5+.5*sin(bladeUV.y*19.+sin(bladeUV.x*17.))*sin(bladeUV.x*24.-bladeUV.y*18.);
          float fromStem=smoothstep(.06,.86,bladeUV.y);
          float skinFleck=mix(.5,pigment,fine);
          diffuseColor.rgb*=mix(vec3(.79,.88,.79),vec3(1.12,1.06,.83),fromStem)*(.91+skinFleck*.18);
          roughnessFactor=clamp(roughnessFactor-.15*veins-.11*skinFleck,.41,.94);`)
        .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
          float relief=fine*(veins*.00023+.000045*skinFleck);
          vec3 acrossPixel=-dFdx(vViewPosition), alongPixel=-dFdy(vViewPosition);
          vec3 veinTangent=cross(alongPixel,normal), veinBitangent=cross(normal,acrossPixel);
          float area=dot(acrossPixel,veinTangent);
          vec3 gradient=dFdx(relief)*veinTangent+dFdy(relief)*veinBitangent;
          normal=normalize(max(.00000001,abs(area))*normal-sign(area)*gradient);`);
    }
  };
  material.customProgramCacheKey=()=>previousKey+`-leaf-transmission-${closeDetail}`;
}
