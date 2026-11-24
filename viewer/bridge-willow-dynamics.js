import * as THREE from "three";
import { canopyShift } from "./bridge-wind.js";
import { airFromMap, prevailingWind } from "./bridge-air.js";

const {clamp,lerp}=THREE.MathUtils;
const step=1/100;
const skinMargin=.0025;
const dragPoint=new THREE.Vector3(), draft=new THREE.Vector3();
const incident=new THREE.Vector2();
const restA=new THREE.Vector3(), nowA=new THREE.Vector3(), axisA=new THREE.Vector3(), axisB=new THREE.Vector3();
const restTangent=new THREE.Vector3(), poseTangent=new THREE.Vector3();
const deform=new THREE.Quaternion();

function closest(a,b,c,d,out) {
  const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z;
  const vx=d.x-c.x,vy=d.y-c.y,vz=d.z-c.z;
  const wx=a.x-c.x,wy=a.y-c.y,wz=a.z-c.z;
  const uu=ux*ux+uy*uy+uz*uz,vv=vx*vx+vy*vy+vz*vz,uv=ux*vx+uy*vy+uz*vz;
  const uw=ux*wx+uy*wy+uz*wz,vw=vx*wx+vy*wy+vz*wz;
  const div=uu*vv-uv*uv;
  let s=div>1e-10 ? clamp((uv*vw-uw*vv)/div,0,1) : 0;
  let t=(uv*s+vw)/Math.max(vv,1e-10);
  if(t<0 || t>1) {
    t=clamp(t,0,1);
    s=clamp((uv*t-uw)/Math.max(uu,1e-10),0,1);
  }
  out.s=s;
  out.t=t;
  out.x=wx+s*ux-t*vx;
  out.y=wy+s*uy-t*vy;
  out.z=wz+s*uz-t*vz;
  return out.x*out.x+out.y*out.y+out.z*out.z;
}

export function willowBranchRig(root,scale) {
  const nodes=[], limbs=[], links=[], constraints=[], capsules=[], pairs=[];
  const metrics={nodes:0,segments:0,pairs:0,restOverlaps:0,contacts:0,contactFrames:0,correctedFrames:0,maximumIncoming:0,
    maximumSolved:0,maximumStretch:0,tipTravel:0,tipVelocity:0,rootTravel:0};
  const opts={collisions:true};
  const seam={x:0,y:0,z:0,s:0,t:0};
  let data,texture,previousRender,drawPose,frameDuration=0,residue=0;
  let currentContacts=0,incoming=0,solved=0;
  const framePair={a:null,b:null,penetration:0};

  function branch(curve,base,tip,segments,joint=null,bearing=0) {
    const limb={curve,base,tip,joint,segments,offset:nodes.length,id:limbs.length};
    limbs.push(limb);
    for(let k=0;k<=segments;k++) {
      const u=k/segments, rest=curve.getPointAt(u);
      const taper=lerp(base,tip,u**.78);
      const weight=k===0 ? 0 : (base>.18 ? .14 : base>.055 ? .42 : .98)*(1+.4*u);
      const drive=(base>.18 ? .69 : base>.055 ? .92 : 1.36)*(.86+.27*Math.sin(bearing*1.83+u*.66));
      nodes.push({rest,p:rest.clone(),last:rest.clone(),speed:new THREE.Vector3(),weight,drive,
        spring:base>.18 ? 49 : base>.055 ? 39 : 31,damping:base>.18 ? 7.8 : 5.9});
      if(k>0) {
        const b=nodes.length-1,a=b-1;
        const edge={a,b,limb:limb.id,index:k-1,length:nodes[a].rest.distanceTo(rest),
          radius:(taper+lerp(base,tip,((k-1)/segments)**.78))*.48};
        links.push(edge);
        capsules.push(edge);
        if(k>1) constraints.push({a:b-2,b,length:nodes[b-2].rest.distanceTo(rest)});
      }
    }
    return limb;
  }

  function at(limb,u,out) {
    const t=clamp(u,0,1)*limb.segments;
    const i=Math.min(limb.segments-1,Math.floor(t));
    out[0]=limb.offset+i;
    out[1]=out[0]+1;
    out[2]=t-i;
    return out;
  }

  function atCurve(limb,t) {
    const lengths=limb.curve.getLengths(240);
    const f=clamp(t,0,1)*240,i=Math.min(239,Math.floor(f));
    return at(limb,lerp(lengths[i],lengths[i+1],f-i)/lengths[240],[]);
  }

  function point(rest,binding,out,turn=null,pose=null) {
    const [a,b,t]=binding;
    const node=nodes[a], other=nodes[b];
    const pa=pose ? axisA.fromArray(pose,a*3) : node.p;
    const pb=pose ? axisB.fromArray(pose,b*3) : other.p;
    restTangent.subVectors(other.rest,node.rest).normalize();
    poseTangent.subVectors(pb,pa).normalize();
    deform.setFromUnitVectors(restTangent,poseTangent);
    if(turn) turn.copy(deform);
    restA.copy(node.rest).lerp(other.rest,t);
    nowA.copy(pa).lerp(pb,t);
    return out.copy(rest).sub(restA).applyQuaternion(deform).add(nowA);
  }

  function attach() {
    for(const limb of limbs) {
      const base=nodes[limb.offset];
      if(limb.joint) point(base.rest,limb.joint,base.p);
      else base.p.copy(base.rest);
    }
  }

  function distance({a,b,length},factor) {
    const left=nodes[a],right=nodes[b];
    const dx=right.p.x-left.p.x,dy=right.p.y-left.p.y,dz=right.p.z-left.p.z;
    const span=Math.hypot(dx,dy,dz);
    const inv=left.weight+right.weight;
    if(span<1e-8 || inv===0) return;
    const scale=(span-length)*factor/(span*inv);
    const l=left.weight*scale,r=right.weight*scale;
    left.p.x+=dx*l;left.p.y+=dy*l;left.p.z+=dz*l;
    right.p.x-=dx*r;right.p.y-=dy*r;right.p.z-=dz*r;
  }

  function maybeNear(a,b,c,d,range) {
    return Math.min(a.x,b.x)-Math.max(c.x,d.x)<range && Math.min(c.x,d.x)-Math.max(a.x,b.x)<range &&
      Math.min(a.y,b.y)-Math.max(c.y,d.y)<range && Math.min(c.y,d.y)-Math.max(a.y,b.y)<range &&
      Math.min(a.z,b.z)-Math.max(c.z,d.z)<range && Math.min(c.z,d.z)-Math.max(a.z,b.z)<range;
  }

  function prepare() {
    for(let i=0;i<capsules.length;i++) {
      const a=capsules[i], ap=nodes[a.a].rest, aq=nodes[a.b].rest;
      for(let j=i+1;j<capsules.length;j++) {
        const b=capsules[j];
        if(a.limb===b.limb && Math.abs(a.index-b.index)<2) continue;
        const bp=nodes[b.a].rest,bq=nodes[b.b].rest;
        const radius=a.radius+b.radius+skinMargin;
        if(!maybeNear(ap,aq,bp,bq,radius+.49)) continue;
        const separation=Math.sqrt(closest(ap,aq,bp,bq,seam));
        // Geometry at authored sockets stays joined. Test free wood away from these sockets.
        const aSocket=limbs[a.limb].joint, bSocket=limbs[b.limb].joint;
        const jointA=aSocket && a.index<2 && b.a>=aSocket[0]-1 && b.b<=aSocket[1]+1;
        const jointB=bSocket && b.index<2 && a.a>=bSocket[0]-1 && a.b<=bSocket[1]+1;
        if(jointA || jointB || separation>radius+.49) continue;
        if(separation<=radius+.003) {
          metrics.restOverlaps+=Number(separation<radius);
          continue;
        }
        pairs.push({a,b,radius,restGap:separation-radius});
      }
    }
    metrics.nodes=nodes.length;
    metrics.segments=capsules.length;
    metrics.pairs=pairs.length;
    data=new Float32Array(nodes.length*8);
    texture=new THREE.DataTexture(data,nodes.length,2,THREE.RGBAFormat,THREE.FloatType);
    texture.name="Willow branch rest and solved poses";
    previousRender=new Float32Array(nodes.length*3);
    drawPose=new Float32Array(nodes.length*3);
    for(const [i,node] of nodes.entries()) {
      node.rest.toArray(data,(nodes.length+i)*4);
      node.rest.toArray(drawPose,i*3);
      node.rest.toArray(previousRender,i*3);
    }
    pack();
    return texture;
  }

  function resolve(pair,apply) {
    const {a,b,radius}=pair;
    const n0=nodes[a.a],n1=nodes[a.b],n2=nodes[b.a],n3=nodes[b.b];
    if(!maybeNear(n0.p,n1.p,n2.p,n3.p,radius)) return 0;
    const sq=closest(n0.p,n1.p,n2.p,n3.p,seam);
    if(sq>=radius*radius) return 0;
    const depth=radius-Math.sqrt(sq);
    if(!apply) return depth;
    let {s,t,x,y,z}=seam;
    if(sq<1e-12) {x=0;y=1;z=0;}
    const a0=1-s,a1=s,b0=1-t,b1=t;
    const w=n0.weight*a0*a0+n1.weight*a1*a1+n2.weight*b0*b0+n3.weight*b1*b1;
    if(w<1e-6) return depth;
    const move=depth/(w*(sq<1e-12 ? 1 : Math.sqrt(sq)));
    const m0=move*n0.weight*a0,m1=move*n1.weight*a1,m2=move*n2.weight*b0,m3=move*n3.weight*b1;
    n0.p.x+=x*m0;n0.p.y+=y*m0;n0.p.z+=z*m0;
    n1.p.x+=x*m1;n1.p.y+=y*m1;n1.p.z+=z*m1;
    n2.p.x-=x*m2;n2.p.y-=y*m2;n2.p.z-=z*m2;
    n3.p.x-=x*m3;n3.p.y-=y*m3;n3.p.z-=z*m3;
    return depth;
  }

  function advance() {
    const exposure=root.w*.52;
    airFromMap(root.x-exposure*prevailingWind.x,root.z-exposure*prevailingWind.y,incident,.14,root.w*.77);
    for(const node of nodes) {
      node.last.copy(node.p);
      if(!node.weight) continue;
      dragPoint.copy(node.rest).multiplyScalar(scale).add(root);
      canopyShift(dragPoint,root,node.drive,draft,0,incident);
      draft.multiplyScalar(1/scale).add(node.rest).sub(node.p);
      node.speed.addScaledVector(draft,node.spring*step).multiplyScalar(Math.exp(-node.damping*step));
      node.p.addScaledVector(node.speed,step);
    }
    for(let iteration=0;iteration<4;iteration++) {
      attach();
      for(const edge of links) distance(edge,.92);
      for(const bend of constraints) distance(bend,.22);
      for(const pair of pairs) {
        const depth=resolve(pair,opts.collisions);
        if(!depth || iteration!==0) continue;
        currentContacts++;
        if(depth>framePair.penetration) {
          framePair.a=pair.a;framePair.b=pair.b;framePair.penetration=depth;
        }
        incoming=Math.max(incoming,depth);
      }
    }
    attach();
    for(const pair of pairs) solved=Math.max(solved,resolve(pair,false));
    for(const node of nodes) node.speed.copy(node.p).sub(node.last).multiplyScalar(1/step);
  }

  function pack() {
    const blend=clamp(residue/step,0,1);
    for(const [i,node] of nodes.entries()) {
      const x=lerp(node.last.x,node.p.x,blend), y=lerp(node.last.y,node.p.y,blend),
        z=lerp(node.last.z,node.p.z,blend);
      data[i*4]=drawPose[i*3]=x;
      data[i*4+1]=drawPose[i*3+1]=y;
      data[i*4+2]=drawPose[i*3+2]=z;
    }
    texture.needsUpdate=true;
  }

  function frame(dt) {
    currentContacts=incoming=solved=0;
    framePair.a=framePair.b=null;
    framePair.penetration=0;
    if(dt<=0) return;
    previousRender.set(drawPose);
    frameDuration=dt;
    residue+=Math.min(dt,.065);
    while(residue>=step) {
      advance();
      residue-=step;
    }
    if(currentContacts) {
      metrics.contactFrames++;
      if(opts.collisions) metrics.correctedFrames++;
    }
    metrics.contacts+=currentContacts;
    metrics.maximumIncoming=Math.max(metrics.maximumIncoming,incoming*scale);
    metrics.maximumSolved=Math.max(metrics.maximumSolved,solved*scale);
    for(const edge of links) {
      metrics.maximumStretch=Math.max(metrics.maximumStretch,
        Math.abs(nodes[edge.a].p.distanceTo(nodes[edge.b].p)-edge.length)*scale);
    }
    pack();
    const tip=nodes[limbs[0].segments];
    metrics.tipTravel=Math.max(metrics.tipTravel,tip.p.distanceTo(tip.rest)*scale);
    metrics.tipVelocity=Math.max(metrics.tipVelocity,tip.speed.length()*scale);
    metrics.rootTravel=Math.max(metrics.rootTravel,nodes[0].p.distanceTo(nodes[0].rest)*scale);
  }

  function handoff(rest,binding,current,previous,rotation) {
    point(rest,binding,current,rotation,drawPose);
    point(rest,binding,previous,null,previousRender);
    return Math.max(.001,frameDuration);
  }

  function inspect() {
    let separation=null;
    if(framePair.a) {
      const {a,b,penetration}=framePair;
      const references=[a.a,a.b,b.a,b.b];
      separation={ids:references,penetration:penetration*scale};
    }
    return {...metrics,currentContacts,incoming:incoming*scale,solved:solved*scale,separation};
  }

  function windCenter(out) {
    let x=0,z=0,count=0;
    for(const limb of limbs) {
      if(limb.base<=.055 || limb.base>.18) continue;
      const index=limb.offset+Math.floor(limb.segments*.70);
      const rest=nodes[index].rest;
      x+=drawPose[index*3]-rest.x;
      z+=drawPose[index*3+2]-rest.z;
      count++;
    }
    return out.set(x*scale/Math.max(1,count),z*scale/Math.max(1,count));
  }

  function probePair(ids) {
    const pair=pairs.find(({a,b})=>ids[0]===a.a && ids[1]===a.b && ids[2]===b.a && ids[3]===b.b);
    if(!pair) return null;
    const [a,b,c,d]=ids.map(i=>new THREE.Vector3().fromArray(drawPose,i*3));
    const gap=Math.sqrt(closest(a,b,c,d,seam))-pair.radius;
    const local=a.clone().lerp(b,seam.s).lerp(c.clone().lerp(d,seam.t),.5);
    return {gap:gap*scale,restGap:pair.restGap*scale,local,ids};
  }

  return {branch,at,atCurve,prepare,frame,handoff,inspect,probePair,windCenter,opts,
    sample:(rest,binding,out)=>point(rest,binding,out,null,drawPose)};
}
