import { Box3, Ray, Vector3 } from "three";

export const workerRadius=.355;
export const workerHeight=1.76;

export function sweepHorizontal(position,dx,dz,allows) {
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.09));
  const sx=dx/steps, sz=dz/steps;
  for(let i=0;i<steps;i++) {
    if(sx && allows(position.x+sx,position.z)) position.x+=sx;
    if(sz && allows(position.x,position.z+sz)) position.z+=sz;
  }
}

export function circleTouchesBox(x,z,radius,boxX,boxZ,halfX,halfZ,yaw) {
  const dx=x-boxX, dz=z-boxZ, cos=Math.cos(yaw), sin=Math.sin(yaw);
  const side=Math.max(Math.abs(dx*cos-dz*sin)-halfX,0);
  const forward=Math.max(Math.abs(dx*sin+dz*cos)-halfZ,0);
  return side*side+forward*forward<radius*radius;
}

export function rectanglesOverlap(x,z,halfX,halfZ,yaw,otherX,otherZ,otherHalfX,otherHalfZ,otherYaw) {
  const dx=otherX-x,dz=otherZ-z;
  const cos=Math.cos(yaw),sin=Math.sin(yaw),c=Math.cos(otherYaw),s=Math.sin(otherYaw);
  const ac=Math.abs(Math.cos(yaw-otherYaw)),as=Math.abs(Math.sin(yaw-otherYaw));
  return Math.abs(dx*c-dz*s)<=otherHalfX+ac*halfX+as*halfZ &&
    Math.abs(dx*s+dz*c)<=otherHalfZ+as*halfX+ac*halfZ &&
    Math.abs(dx*cos-dz*sin)<=halfX+ac*otherHalfX+as*otherHalfZ &&
    Math.abs(dx*sin+dz*cos)<=halfZ+as*otherHalfX+ac*otherHalfZ;
}

export function createStreetCollision() {
  const solids=[];
  const ray=new Ray(), direction=new Vector3(), hit=new Vector3(), bounds=new Box3();

  function box(name,minX,maxX,minZ,maxZ,bottom,top) {
    const solid={name,minX,maxX,minZ,maxZ,bottom,top,enabled:true,radius:0};
    solids.push(solid);
    return solid;
  }

  function cylinder(name,x,z,bottom,top,radius) {
    const solid={ name,x,z,bottom,top,radius,enabled:true };
    solids.push(solid);
    return solid;
  }

  function orientedBox(name,halfX,halfZ,height) {
    const solid={name,x:0,z:0,bottom:0,top:height,halfX,halfZ,yaw:0,radius:0,enabled:true};
    solids.push(solid);
    return solid;
  }

  function meshBox(name,object) {
    object.updateWorldMatrix(true,true);
    const {min,max}=new Box3().setFromObject(object);
    return box(name,min.x,max.x,min.z,max.z,min.y,max.y);
  }

  function blocking(x,z,feet,radius,height,ignored=null,ignoredCargo=null) {
    for(const s of solids) {
      if(!s.enabled || s===ignored || s===ignoredCargo || feet+.045>=s.top || feet+height<=s.bottom) continue;
      if(s.radius) {
        if((s.x-x)**2+(s.z-z)**2<(radius+s.radius)**2) return s;
      } else if(s.halfX) {
        if(circleTouchesBox(x,z,radius,s.x,s.z,s.halfX,s.halfZ,s.yaw)) return s;
      } else {
        const dx=Math.max(s.minX-x,0,x-s.maxX), dz=Math.max(s.minZ-z,0,z-s.maxZ);
        if(dx*dx+dz*dz<radius*radius) return s;
      }
    }
    return null;
  }

  function boxBlocking(x,z,bottom,halfX,halfZ,height,yaw,ignored=null,ignoredCargo=null) {
    const cos=Math.cos(yaw), sin=Math.sin(yaw);
    for(const s of solids) {
      if(!s.enabled || s===ignored || s===ignoredCargo || bottom>=s.top || bottom+height<=s.bottom) continue;
      if(s.radius) {
        const side=Math.max(Math.abs((s.x-x)*cos-(s.z-z)*sin)-halfX,0);
        const forward=Math.max(Math.abs((s.x-x)*sin+(s.z-z)*cos)-halfZ,0);
        if(side*side+forward*forward<s.radius*s.radius) return s;
        continue;
      }
      const extentX=s.halfX ?? (s.maxX-s.minX)*.5, extentZ=s.halfZ ?? (s.maxZ-s.minZ)*.5;
      if(rectanglesOverlap(x,z,halfX,halfZ,yaw,s.x ?? (s.minX+s.maxX)*.5,
        s.z ?? (s.minZ+s.maxZ)*.5,extentX,extentZ,s.yaw||0)) return s;
    }
    return null;
  }

  function cameraDistance(anchor,destination,padding=.17) {
    direction.subVectors(destination,anchor);
    const length=direction.length();
    if(length<.001) return { distance:0, obstacle:null };
    ray.set(anchor,direction.multiplyScalar(1/length));
    let distance=length, obstacle=null;
    for(const s of solids) {
      if(!s.enabled || s.camera===false) continue;
      if(s.halfX) {
        const c=Math.abs(Math.cos(s.yaw)), t=Math.abs(Math.sin(s.yaw));
        const x=c*s.halfX+t*s.halfZ, z=t*s.halfX+c*s.halfZ;
        bounds.min.set(s.x-x,s.bottom,s.z-z);
        bounds.max.set(s.x+x,s.top,s.z+z);
      } else {
        bounds.min.set(s.radius ? s.x-s.radius : s.minX,s.bottom,s.radius ? s.z-s.radius : s.minZ);
        bounds.max.set(s.radius ? s.x+s.radius : s.maxX,s.top,s.radius ? s.z+s.radius : s.maxZ);
      }
      bounds.expandByScalar(padding);
      if(!ray.intersectBox(bounds,hit)) continue;
      const point=bounds.containsPoint(anchor) ? 0 : anchor.distanceTo(hit);
      if(point<distance) {
        distance=Math.max(0,point-.022);
        obstacle=s.name;
      }
    }
    return {distance,obstacle};
  }

  return {box,cylinder,orientedBox,meshBox,blocking,boxBlocking,cameraDistance,inspect:()=>solids.filter(s=>s.enabled).length};
}
