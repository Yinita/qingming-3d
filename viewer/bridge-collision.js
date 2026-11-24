import { Box3, Ray, Vector3 } from "three";

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

  function meshBox(name,object) {
    object.updateWorldMatrix(true,true);
    const {min,max}=new Box3().setFromObject(object);
    return box(name,min.x,max.x,min.z,max.z,min.y,max.y);
  }

  function blocking(x,z,feet,radius,height,ignored=null) {
    for(const s of solids) {
      if(!s.enabled || s===ignored || feet+.045>=s.top || feet+height<=s.bottom) continue;
      if(s.radius) {
        if((s.x-x)**2+(s.z-z)**2<(radius+s.radius)**2) return s;
      } else {
        const dx=Math.max(s.minX-x,0,x-s.maxX), dz=Math.max(s.minZ-z,0,z-s.maxZ);
        if(dx*dx+dz*dz<radius*radius) return s;
      }
    }
    return null;
  }

  function boxBlocking(x,z,bottom,halfX,halfZ,height,yaw) {
    const cos=Math.cos(yaw), sin=Math.sin(yaw);
    const ac=Math.abs(cos), as=Math.abs(sin);
    for(const s of solids) {
      if(!s.enabled || bottom>=s.top || bottom+height<=s.bottom) continue;
      if(s.radius) {
        const dx=s.x-x, dz=s.z-z;
        const side=Math.max(Math.abs(dx*cos-dz*sin)-halfX,0);
        const forward=Math.max(Math.abs(dx*sin+dz*cos)-halfZ,0);
        if(side*side+forward*forward<s.radius*s.radius) return s;
        continue;
      }
      const extentX=(s.maxX-s.minX)*.5, extentZ=(s.maxZ-s.minZ)*.5;
      const dx=(s.minX+s.maxX)*.5-x, dz=(s.minZ+s.maxZ)*.5-z;
      if(Math.abs(dx)>extentX+ac*halfX+as*halfZ || Math.abs(dz)>extentZ+as*halfX+ac*halfZ) continue;
      if(Math.abs(dx*cos-dz*sin)>halfX+ac*extentX+as*extentZ) continue;
      if(Math.abs(dx*sin+dz*cos)>halfZ+as*extentX+ac*extentZ) continue;
      return s;
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
      bounds.min.set(s.radius ? s.x-s.radius : s.minX,s.bottom,s.radius ? s.z-s.radius : s.minZ);
      bounds.max.set(s.radius ? s.x+s.radius : s.maxX,s.top,s.radius ? s.z+s.radius : s.maxZ);
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

  return {box,cylinder,meshBox,blocking,boxBlocking,cameraDistance,inspect:()=>solids.filter(s=>s.enabled).length};
}
