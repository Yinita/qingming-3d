import * as THREE from "three";
import { canalDepth } from "./bridge-canal-bed.js";
import { createLivestockRig,livestockKinds } from "./bridge-livestock-model.js";

const {damp,clamp,smoothstep}=THREE.MathUtils;
const xHalf=.35,zHalf=.995,zBias=-.128;
const sizes={horse:1.83,donkey:1.67,ox:1.61};
const names={horse:"马",donkey:"驴",ox:"耕牛"};
const greetingDuration=2.8;
const point=new THREE.Vector3();
const earTarget=new THREE.Vector3();

function terrainShade(parent,sites,floor) {
  const texture=document.createElement("canvas");
  texture.width=texture.height=32;
  const ctx=texture.getContext("2d");
  const brush=ctx.createRadialGradient(16,16,1,16,16,16);
  brush.addColorStop(0,"rgba(255,255,255,.88)");
  brush.addColorStop(.42,"rgba(255,255,255,.58)");
  brush.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=brush;
  ctx.fillRect(0,0,32,32);
  const p=[],uv=[],color=[],indices=[];
  const corners=[[-1,-1],[1,-1],[-1,1],[1,1]];
  for(const {x,z,yaw,width,length,alpha} of sites) {
    const c=Math.cos(yaw),s=Math.sin(yaw),j=p.length/3;
    for(const [u,v] of corners) {
      const px=x+u*width*c+v*length*s,pz=z-u*width*s+v*length*c;
      p.push(px,floor(px,pz)+.011,pz);
      uv.push((u+1)*.5,(v+1)*.5);
      color.push(1,1,1,alpha);
    }
    indices.push(j,j+2,j+1,j+1,j+2,j+3);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(color,4));
  const material=new THREE.MeshBasicMaterial({color:0x32271e,map:new THREE.CanvasTexture(texture),
    vertexColors:true,depthWrite:false,transparent:true,polygonOffset:true,polygonOffsetFactor:-1});
  const shade=new THREE.Mesh(geometry,material);
  shade.name="Livestock hoof contact shadows";
  parent.add(shade);
}

function placement(o,city,anchor,origin,floor,scale,yaw) {
  const biasX=Math.sin(yaw)*zBias*scale,biasZ=Math.cos(yaw)*zBias*scale;
  const xs=xHalf*scale,zs=zHalf*scale;
  const across=Math.abs(Math.sin(yaw))*xs+Math.abs(Math.cos(yaw))*zs;
  const inLane=(x,z)=>x>-77 && x<-39 && Math.abs(z+biasZ-anchor.z)<1.26+across;
  const wantZ=inLane(o.x,o.z) ? anchor.z+Math.sign(o.z-anchor.z||1)*(1.26+across)-biasZ : o.z;
  const wet=(x,z)=>Math.abs(z-origin.y)<15 && canalDepth(origin,x,z)>.082;
  if(wet(o.x,wantZ)) return null;
  // Only shift an authored placement when the footprint interpenetrates
  // another street solid. Prefer the closest dry point on the original bank.
  for(let attempt=0;attempt<65;attempt++) {
    const step=.26*Math.ceil(attempt/8),direction=yaw+(attempt%8)*Math.PI*.25;
    const x=o.x+step*Math.cos(direction),z=wantZ+step*Math.sin(direction);
    if(inLane(x,z) || wet(x,z)) continue;
    const y=Math.max(o.y||0,floor(x,z));
    const centreX=x+biasX,centreZ=z+biasZ,height=scale*sizes[o.label];
    if(city.boxBlocking(centreX,centreZ,y,xs,zs,height,yaw)) continue;
    return {x,y,z,centreX,centreZ,yaw,xs,zs,height,offset:Math.hypot(x-o.x,z-o.z)};
  }
  return null;
}

export function buildLivestock(root,city,objects,anchor,origin,floor) {
  const group=new THREE.Group();
  group.name="Street horses, donkeys and ox";
  root.add(group);
  const actors=[],shadows=[];
  const hidden=[];
  let greeting=null;
  const face=new THREE.Vector3(), palm=new THREE.Vector3();
  for(const o of objects) {
    if(!livestockKinds.has(o.label)) continue;
    const id=Number(o.id.slice(1))||0;
    const scale=clamp(o.h/1.57,.65,1.31),yaw=id*1.38;
    const p=placement(o,city,anchor,origin,floor,scale,yaw);
    if(!p) {
      hidden.push(o.id);
      continue;
    }
    const model=createLivestockRig(o.label,Math.imul(id,0x41c64e6d)>>>12);
    const mesh=model.mesh;
    mesh.name="Livestock "+o.id+" "+o.label;
    mesh.position.set(p.x,p.y,p.z);
    mesh.rotation.y=yaw;
    mesh.scale.setScalar(scale);
    group.add(mesh);
    mesh.updateMatrixWorld(true);
    const contacts=model.contacts.map((v,i)=>{
      const vWorld=mesh.localToWorld(point.copy(v));
      const height=floor(vWorld.x,vWorld.z);
      model.hoofBones[i].position.y=(height-p.y)/scale;
      shadows.push({x:vWorld.x,z:vWorld.z,yaw,width:.087*scale,length:.103*scale,alpha:.68});
      return {x:vWorld.x,y:height,z:vWorld.z};
    });
    shadows.push({x:p.x,z:p.z,yaw,width:.54*scale,length:.88*scale,alpha:.32});
    const collider=city.orientedBox(o.label,p.xs,p.zs,p.height+.015*scale);
    Object.assign(collider,{x:p.centreX,z:p.centreZ,yaw,bottom:Math.min(p.y,...contacts.map(f=>f.y))-.009,
      top:p.y+p.height+.015*scale});
    actors.push({model,mesh,collider,kind:o.label,id:o.id,seed:id*.672,
      x:p.x,y:p.y,z:p.z,yaw,scale,offset:p.offset,contacts,turn:0,pitch:0,near:false,far:false});
  }
  if(shadows.length) terrainShade(group,shadows,floor);

  function muzzle(actor,target) {
    return actor.model.bones[1].localToWorld(target.copy(actor.model.sniff));
  }

  function nearby(visitor) {
    if(!visitor) return null;
    let best=null,reach=.63;
    for(const actor of actors) {
      if(Math.hypot(actor.x-visitor.x,actor.z-visitor.z)>2.25) continue;
      const target=muzzle(actor,face);
      const length=Math.hypot(target.x-visitor.x,target.z-visitor.z);
      if(length>=reach || target.y-visitor.y<.72 || target.y-visitor.y>1.49) continue;
      const x=(target.x+visitor.x)*.5,z=(target.z+visitor.z)*.5;
      if(city.blocking(x,z,target.y-.05,.088,.16,actor.collider)) continue;
      best=actor;
      reach=length;
    }
    return best;
  }

  function greet(visitor) {
    if(greeting) return null;
    const actor=nearby(visitor);
    if(!actor) return null;
    greeting={actor,age:0};
    return names[actor.kind];
  }

  function gesture(visitor) {
    if(!greeting || !visitor) return null;
    const {actor,age}=greeting;
    muzzle(actor,face);
    const dx=visitor.x-face.x,dz=visitor.z-face.z;
    const length=Math.max(.001,Math.hypot(dx,dz));
    const strength=smoothstep(age,0,.62)*(1-smoothstep(age,2.12,greetingDuration));
    palm.set(face.x+dx/length*.16,face.y-.025,face.z+dz/length*.16);
    return {target:palm,yaw:Math.atan2(dx,dz),strength,name:names[actor.kind]};
  }

  function update(dt,time,eye,visitor) {
    if(greeting) {
      greeting.age+=dt;
      if(!visitor || greeting.age>=greetingDuration) greeting=null;
    }
    for(const actor of actors) {
      const {model,mesh,x,y,z,yaw,scale,seed,kind}=actor;
      const distance=(eye.x-x)**2+(eye.y-y)**2+(eye.z-z)**2;
      const far=distance>(actor.far ? 25 : 29)**2;
      if(far!==actor.far) {
        actor.far=far;
        model.setFar(far);
      }
      if(far && !actor.near) continue;
      const dx=(visitor?.x??Infinity)-x,dz=(visitor?.z??Infinity)-z;
      const vicinity=Math.hypot(dx,dz);
      const near=vicinity<2.8*scale && Math.abs((visitor?.y??Infinity)-y)<1.3;
      actor.near=near;
      const c=Math.cos(yaw),s=Math.sin(yaw);
      // Look toward a visitor who approaches the shoulder or muzzle. A rear
      // approach flicks the ears without twisting the neck backwards.
      const lateral=near ? (dx*c-dz*s)/scale : 0;
      const forward=near ? -(dx*s+dz*c)/scale : 0;
      const alert=near ? 1-smoothstep(vicinity,.76*scale,2.8*scale) : 0;
      const face=near && forward>-.43 ? clamp(-Math.atan2(lateral,Math.max(.87,forward)), -.27,.27)*alert : 0;
      actor.turn=damp(actor.turn,face,near ? 4.3 : 1.8,dt);
      const scent=greeting?.actor===actor ? smoothstep(greeting.age,.22,.96)*
        (1-smoothstep(greeting.age,1.78,2.65)) : 0;
      actor.pitch=damp(actor.pitch,.018*Math.sin(time*.72+seed)-.11*alert-.14*scent,3.7,dt);
      const [chest,head,tail,earL,earR]=model.bones;
      const breathing=Math.sin(time*1.33+seed);
      chest.scale.set(1+.018*breathing,1+.007*breathing,1+.007*breathing);
      head.rotation.set(actor.pitch,actor.turn+.018*Math.sin(time*.49+seed),.016*Math.sin(time*.66+seed),"YXZ");
      const swish=Math.max(0,Math.sin(time*1.22+seed))**7;
      tail.rotation.set(.035*Math.sin(time*.79+seed),.15*swish*Math.cos(time*4.2+seed),
        .22*swish*Math.sin(time*5.0+seed));
      const earFlick=Math.sin(time*(kind==="donkey" ? 2.81 : 2.43)+seed);
      earL.rotation.set(.12*earFlick**9-.11*alert,-.18*alert,.075*Math.sin(time*1.59+seed));
      earR.rotation.set(.13*Math.sin(time*2.54+seed+1.72)**9-.08*alert-.12*scent,
        .21*alert,-.055*Math.sin(time*1.57));
      mesh.updateMatrixWorld(true);
    }
  }

  function inspect() {
    return {hidden:[...hidden],greeting:greeting ? {id:greeting.actor.id,age:greeting.age} : null,
      animals:actors.map(({id,kind,model,mesh,x,y,z,offset,contacts,turn,pitch,near,far,collider})=>{
      const nose=model.bones[1].localToWorld(earTarget.copy(model.sniff));
      return {id,kind,x,y,z,offset,turn,pitch,near,far,footings:contacts.map(({x,y,z})=>[x,y,z]),
        muzzle:nose.toArray(),bounds:{x:collider.x,z:collider.z,yaw:collider.yaw,halfX:collider.halfX,halfZ:collider.halfZ},
        triangles:mesh.geometry.index.count/3};
    })};
  }

  return {count:actors.length,update,inspect,greet,gesture,
    invitation:visitor=>greeting ? null : names[nearby(visitor)?.kind]??null,
    cancel(){greeting=null;},
  };
}
