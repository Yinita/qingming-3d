import { MathUtils, Vector2 } from "three";
import { airFromMap, airGLSL, airUniforms } from "./bridge-air.js";

const air=new Vector2();

export function canopyShift(point,root,flexibility,out,delay=0,incident=null) {
  const level=MathUtils.clamp((point.y-root.y)/root.w,0,1.15);
  const span=Math.hypot(point.x-root.x,point.z-root.z);
  const lever=level*level*(.67+.33*MathUtils.smoothstep(span,.12,root.w*.48));
  airFromMap(point.x,point.z,air,.12+.36*(1-level)+delay,point.y);
  if(incident) air.lerp(incident,.49*airUniforms.windWakeMix.value);
  const pressure=root.w*.017*flexibility*lever*(.69+.19*air.length());
  const x=air.x*pressure, z=air.y*pressure;
  return out.set(x,-.47*(x*x+z*z)/Math.max(.35,root.w*level),z);
}

export function leafFlutter(anchor,time,origin,out) {
  const phase=(anchor.x-origin.x)*6.31+anchor.y*7.13+(anchor.z-origin.y)*2.27;
  const drag=Math.min(1.12,airFromMap(anchor.x,anchor.z,air,.058,anchor.y).length()*.43);
  const flip=Math.sin(time*6.1+phase)+.32*Math.sin(time*10.2-phase*.71);
  return out.set(.21*flip,.41*Math.sin(time*4.1+phase*1.7),.11*Math.sin(time*4.7+phase)).multiplyScalar(drag);
}

const canopyGLSL=`
  vec3 canopyDisplacement(vec3 p,vec4 root,float flex) {
    float level=clamp((p.y-root.y)/root.w,0.,1.15);
    float span=length(p.xz-root.xz);
    float lever=level*level*(.67+.33*smoothstep(.12,root.w*.48,span));
    vec2 wind=canalAirAt(p.xz,windTime-.12-.36*(1.-level),p.y);
    float pressure=root.w*.017*flex*lever*(.69+.19*length(wind));
    vec2 bend=wind*pressure;
    return vec3(bend.x,-.47*dot(bend,bend)/max(.35,root.w*level),bend.y);
  }
  vec3 leafResponse(vec3 anchor) {
    float phase=dot(anchor-vec3(windOrigin.x,0.,windOrigin.y),vec3(6.31,7.13,2.27));
    float drag=min(1.12,length(canalAirAt(anchor.xz,windTime-.058,anchor.y))*.43);
    float flip=sin(windTime*6.1+phase)+.32*sin(windTime*10.2-phase*.71);
    float roll=sin(windTime*4.1+phase*1.7);
    return drag*vec3(flip*.21,roll*.41,sin(windTime*4.7+phase)*.11);
  }
`;

// Main and shadow shaders evaluate identical motion. Leaf stems remain on the
// branch because blade flex starts at zero at the instance anchor.
export function bindCanopyWind(material,{root=null,scale=1,flexibility=1,instanced=false,blade=false}={}) {
  const group=root!==null;
  const indexPoint=instanced ? "(instanceMatrix*vec4(position,1.)).xyz" : "position";
  const anchor=blade ? "instanceMatrix[3].xyz" : indexPoint;
  const world=group ? `canopyTree.xyz+${anchor}*canopyScale` : anchor;
  const roots=group ? "canopyTree" : "windRoot";
  const shadeBlade=blade && !material.isMeshDepthMaterial;
  const base=material.onBeforeCompile;
  const previousKey=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    base.call(material,shader);
    Object.assign(shader.uniforms,airUniforms);
    shader.uniforms.canopyFlex={value:flexibility};
    shader.uniforms.canopyScale={value:scale};
    if(group) shader.uniforms.canopyTree={value:root};
    shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>
      ${airGLSL}
      ${canopyGLSL}
      uniform float canopyScale;
      uniform float canopyFlex;
      ${group ? "uniform vec4 canopyTree;" : "attribute vec4 windRoot;"}`)
      .replace("#include <begin_vertex>",`#include <begin_vertex>
        vec3 pointWorld=${world};
        vec3 bend=canopyDisplacement(pointWorld,${roots},canopyFlex)/canopyScale;
        ${instanced ? `
          mat3 axes=mat3(instanceMatrix);
          vec3 square=vec3(dot(axes[0],axes[0]),dot(axes[1],axes[1]),dot(axes[2],axes[2]));
          transformed+=vec3(dot(axes[0],bend),dot(axes[1],bend),dot(axes[2],bend))/square;`
          : "transformed+=bend;"}
        ${blade ? `
          ${shadeBlade ? "" : "vec3 bladeSway=leafResponse(pointWorld);"}
          transformed.z+=position.y*(position.y*bladeSway.x+position.x*bladeSway.y);
          transformed.x+=position.y*position.y*bladeSway.z;` : ""}`);
    if(shadeBlade) {
      shader.vertexShader=shader.vertexShader.replace("#include <beginnormal_vertex>",`#include <beginnormal_vertex>
        vec3 bladeSway=leafResponse(${world});
        objectNormal.x-=objectNormal.z*position.y*bladeSway.y;
        objectNormal.y-=objectNormal.z*(2.*position.y*bladeSway.x+position.x*bladeSway.y)
                       +objectNormal.x*2.*position.y*bladeSway.z;`);
    }
  };
  material.customProgramCacheKey=()=>previousKey+`-canal-wind-${group}-${instanced}-${blade}`;
}

const branchPoseGLSL=`
  attribute vec3 branchLink;
  uniform sampler2D branchPose;
  uniform float branchNodes;
  uniform float branchPoseAmount;

  vec3 branchNode(float index,float row) {
    return texture2D(branchPose,vec2((index+.5)/branchNodes,row)).xyz;
  }
  void woodFrame(out vec3 authored,out vec3 moved,out vec3 axis,out float turn) {
    if(branchLink.x<0.) {
      authored=moved=axis=vec3(0.);
      turn=.5;
      return;
    }
    vec3 start=branchNode(branchLink.x,.75), end=branchNode(branchLink.y,.75);
    vec3 a=mix(start,branchNode(branchLink.x,.25),branchPoseAmount);
    vec3 b=mix(end,branchNode(branchLink.y,.25),branchPoseAmount);
    authored=mix(start,end,branchLink.z);
    moved=mix(a,b,branchLink.z);
    vec3 oldDirection=normalize(end-start), newDirection=normalize(b-a);
    axis=cross(oldDirection,newDirection);
    turn=1./max(.0001,1.+dot(oldDirection,newDirection));
  }
  vec3 woodRotate(vec3 v,vec3 axis,float turn) {
    vec3 tangent=cross(axis,v);
    return v+tangent+cross(axis,tangent)*turn;
  }
`;

export function bindWillowPose(material,pose,{root,scale,blade=false}) {
  const earlier=material.onBeforeCompile;
  const cache=material.customProgramCacheKey();
  const shades=blade && !material.isMeshDepthMaterial;
  const frame=`vec3 oldCenter,newCenter,woodAxis;
    float woodTurn;
    woodFrame(oldCenter,newCenter,woodAxis,woodTurn);`;
  const leafSetup=`
    mat3 bladeAxes=mat3(instanceMatrix);
    vec3 axeLength=vec3(dot(bladeAxes[0],bladeAxes[0]),dot(bladeAxes[1],bladeAxes[1]),dot(bladeAxes[2],bladeAxes[2]));
    vec3 originBlade=instanceMatrix[3].xyz;
    vec3 posedStem=newCenter+woodRotate(originBlade-oldCenter,woodAxis,woodTurn);
    vec3 bladeSway=leafResponse(willowBase+posedStem*willowWorldScale);`;
  material.onBeforeCompile=shader=>{
    earlier.call(material,shader);
    shader.uniforms.branchPose=pose.texture;
    shader.uniforms.branchNodes=pose.nodes;
    shader.uniforms.branchPoseAmount=pose.amount;
    shader.uniforms.willowBase={value:root};
    shader.uniforms.willowWorldScale={value:scale};
    if(blade) Object.assign(shader.uniforms,airUniforms);
    shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>
      ${branchPoseGLSL}
      ${blade ? airGLSL+canopyGLSL : ""}
      uniform vec3 willowBase;
      uniform float willowWorldScale;`);
    if(!material.isMeshDepthMaterial) {
      shader.vertexShader=shader.vertexShader.replace("#include <beginnormal_vertex>",`#include <beginnormal_vertex>
        ${frame}
        ${blade ? `${leafSetup}
          objectNormal.x-=objectNormal.z*position.y*bladeSway.y;
          objectNormal.y-=objectNormal.z*(2.*position.y*bladeSway.x+position.x*bladeSway.y)
                         +objectNormal.x*2.*position.y*bladeSway.z;
          vec3 n=woodRotate(bladeAxes*(objectNormal/axeLength),woodAxis,woodTurn);
          objectNormal=vec3(dot(bladeAxes[0],n),dot(bladeAxes[1],n),dot(bladeAxes[2],n));`
          : "objectNormal=woodRotate(objectNormal,woodAxis,woodTurn);"}`);
    }
    shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>",`#include <begin_vertex>
      ${material.isMeshDepthMaterial ? frame : ""}
      ${blade ? `${shades ? "" : leafSetup}
        transformed.z+=position.y*(position.y*bladeSway.x+position.x*bladeSway.y);
        transformed.x+=position.y*position.y*bladeSway.z;
        vec3 newPoint=posedStem+woodRotate(bladeAxes*transformed,woodAxis,woodTurn);
        vec3 relative=newPoint-originBlade;
        transformed=vec3(dot(bladeAxes[0],relative),dot(bladeAxes[1],relative),dot(bladeAxes[2],relative))/axeLength;`
        : "transformed=newCenter+woodRotate(position-oldCenter,woodAxis,woodTurn);"}`);
  };
  material.customProgramCacheKey=()=>cache+`-willow-elastic-pose-${blade}`;
}
