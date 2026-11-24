import * as THREE from "three";
import { canalShoreRadius } from "./bridge-canal-bed.js";

export const breakerRows=58, breakerSpan=9.4;
const leftExtent=.71, length=1.39;
export const breakerDomain=Object.freeze({leftExtent,length});
const knots=[
  [0,0,1,0],
  [.43,.15,.02,1.19],
  [.27,.91,.71,1.38],
  [.66,.62,1.30,-2.82],
  [1,0,1,0],
];

function hermite(t,a,b,da,db) {
  return a+t*(da+t*(3*(b-a)-2*da-db+t*(2*(a-b)+da+db)));
}

export function rolledSection(u,out) {
  const i=Math.min(3,Math.floor(u*4));
  const a=knots[i], b=knots[i+1], t=u*4-i;
  out.x=hermite(t,a[0],b[0],a[2]*.25,b[2]*.25);
  out.y=hermite(t,a[1],b[1],a[3]*.25,b[3]*.25);
  return out;
}

function sectionLift(u,profile,roll) {
  return THREE.MathUtils.lerp(Math.sin(Math.PI*u)**2*.62,profile.y,roll);
}

const horizontal=knots.slice(0,-1).map((a,i)=>{
  const b=knots[i+1], p=a[2]*.25, q=b[2]*.25;
  return [a[0],p,3*(b[0]-a[0])-2*p-q,2*(a[0]-b[0])+p+q];
});
const curve={};
export function crestRiseAt(worldX,center,roll,lift) {
  const wanted=(worldX-center+leftExtent)/length;
  if(wanted<=0 || wanted>=1 || lift<=0) return 0;
  if(roll<.001) return lift*Math.sin(Math.PI*wanted)**2*.62;
  const mix=THREE.MathUtils.lerp;
  let result=0;
  for(const [i,[a,p,q,r]] of horizontal.entries()) {
    const A=mix(i*.25,a,roll), B=mix(.25,p,roll), C=q*roll, D=r*roll;
    const x=t=>A+t*(B+t*(C+t*D));
    const discriminant=C*C-3*D*B;
    const cuts=[0,1];
    if(Math.abs(D)<1e-7) {
      const turning=-B/(2*C);
      if(turning>0 && turning<1) cuts.push(turning);
    } else if(discriminant>0) {
      const root=Math.sqrt(discriminant);
      for(const t of [(-C-root)/(3*D),(-C+root)/(3*D)]) {
        if(t>0 && t<1) cuts.push(t);
      }
    }
    cuts.sort((a,b)=>a-b);
    for(let k=1;k<cuts.length;k++) {
      let start=cuts[k-1],end=cuts[k];
      const first=x(start), last=x(end);
      if(wanted<Math.min(first,last)-.00004 || wanted>Math.max(first,last)+.00004) continue;
      const ascending=last>first;
      for(let step=0;step<11;step++) {
        const root=(start+end)*.5;
        const at=x(root);
        if((at<wanted)===ascending) start=root;
        else end=root;
      }
      const u=(i+(start+end)*.5)*.25;
      result=Math.max(result,sectionLift(u,rolledSection(u,curve),roll)*lift);
    }
  }
  return result;
}

export function breakingPosition(node,z,u,field,swash,time,out) {
  const profile=rolledSection(u,{});
  const x=node.x-leftExtent+length*THREE.MathUtils.lerp(u,profile.x,node.roll);
  const lift=node.lift*sectionLift(u,profile,node.roll);
  const height=field.height(x,z,time);
  return out.set(x,swash ? swash.height(x,z,height)+lift : height+lift,z);
}

export function refinedCanalGeometry(halfLength) {
  const left=12, shallow=106, deep=104;
  const columns=left+shallow+deep;
  const geometry=new THREE.PlaneGeometry(19.4,halfLength*2,columns,236);
  geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++) {
    const column=i%(columns+1);
    const z=positions.getZ(i);
    const shore=-canalShoreRadius(z,-1);
    const a=shore-.61, b=shore+3.47;
    const x=column<=left ? THREE.MathUtils.lerp(-9.7,a,column/left) :
      column<=left+shallow ? THREE.MathUtils.lerp(a,b,(column-left)/shallow) :
      THREE.MathUtils.lerp(b,9.7,(column-left-shallow)/deep);
    positions.setX(i,x);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const glsl=v=>v.toFixed(5);
const vec=(p,i)=>`vec2(${glsl(p[i])},${glsl(p[i+1])})`;
const pieces=knots.slice(0,-1).map((a,i)=>{
  const b=knots[i+1];
  const t=i===0 ? "u*4." : `u*4.-${glsl(i)}`;
  return `${i===3 ? "" : `if(u<${glsl((i+1)/4)}) `}return rollHermite(${t},
    ${vec(a,0)},${vec(b,0)},${vec(a,2)}*.25,${vec(b,2)}*.25);`;
}).join("\n");

export const bankReachGLSL=`
  uniform sampler2D bankWash;
  uniform vec2 bankWashBounds;
  float bankReach(vec2 p,float shore) {
    float u=(p.y-bankWashBounds.x)*bankWashBounds.y;
    if(p.x>origin.x || shore>.27 || u<=0. || u>=1.) return 0.;
    return texture2D(bankWash,vec2(u,.5)).g*.54;
  }

`;

export const breakerSurfaceGLSL=`
  uniform sampler2D breakingRows;
  uniform vec2 breakingBounds;
  uniform float breakingBlend;
  ${bankReachGLSL}

  vec4 breakerRow(float z,float row) {
    float at=clamp((z-breakingBounds.x)*breakingBounds.y,0.,1.)*${breakerRows-1}.;
    float a=floor(at);
    const float stepU=1./${breakerRows}.;
    vec4 left=texture2D(breakingRows,vec2((a+.5)*stepU,row));
    vec4 right=texture2D(breakingRows,vec2(min(${breakerRows-.5},a+1.5)*stepU,row));
    vec4 state=mix(left,right,fract(at));
    if(row<.5) {
      if(left.w<.02) state.x=right.x;
      if(right.w<.02) state.x=left.x;
      state.yzw*=breakingBlend;
    }
    return state;
  }

  float washHeight(float baseline,float shore,float reach,float bed) {
    if(reach<=.022 || shore>=.155 || shore < -reach) return baseline;
    float thin=bed+.006+.008*sqrt(reach);
    float body=smoothstep(-reach,.155,shore);
    return mix(thin,max(thin,baseline),body);
  }

  vec2 rollHermite(float t,vec2 a,vec2 b,vec2 da,vec2 db) {
    return a+t*(da+t*(3.*(b-a)-2.*da-db+t*(2.*(a-b)+da+db)));
  }

  vec2 rollProfile(float u) {
    ${pieces}
  }

  vec3 coherentWaterPoint(vec2 base,float y0,out vec3 optics) {
    float x=base.x;
    vec4 row=breakerRow(base.y,.25);
    float u=(x-row.x+${glsl(leftExtent)})/${glsl(length)};
    float lift=0.;
    optics=vec3(0.);
    if(u>0. && u<1. && row.w>.001) {
      vec2 profile=rollProfile(u);
      float crest=smoothstep(.08,.39,u)*(1.-smoothstep(.62,.91,u));
      x+=${glsl(length)}*(profile.x-u)*row.y;
      float bump=sin(3.14159265*u);
      lift=row.z*mix(.62*bump*bump,profile.y,row.y);
      vec4 details=breakerRow(base.y,.75);
      optics.x=crest*row.w*details.x;
      optics.y=crest*row.y;
    }
    vec2 world=vec2(x,base.y);
    float baseline=y0+surfaceOffset(world);
    float shore=canalBank(world-origin)-abs(x-origin.x);
    float reach=bankReach(world,shore);
    if(reach>.022 && shore>=-reach && shore<.155) {
      baseline=washHeight(baseline,shore,reach,canalBedElevation(world-origin));
      optics.z=(1.-smoothstep(.01,.155,shore))*smoothstep(.022,.09,reach);
    }
    return vec3(x,baseline+lift,base.y);
  }
`;
