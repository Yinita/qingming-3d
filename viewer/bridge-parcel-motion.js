import * as THREE from "three";

const {smoothstep,lerp}=THREE.MathUtils;
export const parcelReach={pick:.86,load:.79,unload:.79,handIn:.85};
export const parcelCarryDistance=.448;
export const parcelCarryHeight=.842;

export function parcelCarryPose(x,z,ground,yaw) {
  return {x:x-Math.sin(yaw)*parcelCarryDistance,y:ground+parcelCarryHeight,
    z:z-Math.cos(yaw)*parcelCarryDistance,yaw};
}

export function createParcelMotion() {
  const lifted=new THREE.Vector3();
  const position=new THREE.Vector3(), rotation=new THREE.Quaternion();
  const upright=new THREE.Quaternion(), up=new THREE.Vector3(0,1,0);
  const pose={position,rotation,grip:0,haul:0,lean:0,crouch:0,gate:0,contact:false,slide:false,done:false};

  // Feet settle before this timeline starts. The horizontal move starts after clearing the support.
  function sample(kind,t,station,tail,bed,carry,yaw,attitude) {
    const cart=kind==="load" || kind==="unload";
    upright.setFromAxisAngle(up,yaw);
    pose.lean=pose.crouch=pose.grip=pose.haul=pose.gate=0;
    pose.contact=pose.slide=pose.done=false;
    if(kind==="pick") {
      const clear=smoothstep(t,.37,.65), gather=smoothstep(t,.54,1.17);
      lifted.copy(station);lifted.y+=.183*clear;
      position.copy(lifted).lerp(carry,gather);
      rotation.copy(attitude).slerp(upright,gather);
      pose.grip=smoothstep(t,.12,.36);
      pose.lean=lerp(1.12,.27,gather)*smoothstep(t,0,.35);
      pose.crouch=.350*smoothstep(t,0,.32)*(1-gather);
      pose.done=t>=1.19;
    } else if(kind==="handIn") {
      const extend=smoothstep(t,.06,.58), lower=smoothstep(t,.50,.91);
      lifted.copy(station);lifted.y+=.176*(1-lower);
      position.copy(carry).lerp(lifted,extend);
      rotation.copy(upright);
      pose.grip=1-smoothstep(t,.91,1.15);
      pose.lean=lerp(.27,1,smoothstep(t,0,.59))*(1-smoothstep(t,.95,1.29));
      pose.crouch=.313*smoothstep(t,.07,.63)*(1-smoothstep(t,.96,1.28));
      pose.contact=t>=.91;
      pose.done=t>=1.30;
    } else if(kind==="load") {
      const lower=smoothstep(t,.10,.59), slide=smoothstep(t,.66,1.10);
      position.copy(carry).lerp(tail,lower).lerp(bed,slide);
      rotation.copy(upright).slerp(attitude,lower);
      pose.grip=1-smoothstep(t,.65,.82);
      pose.lean=lerp(.27,.85,smoothstep(t,.07,.51))*(1-smoothstep(t,.73,1.25));
      pose.crouch=.13*smoothstep(t,.12,.50)*(1-smoothstep(t,.72,1.23));
      pose.contact=t>=.59;
      pose.slide=t>=.68;
      pose.done=t>=1.34;
    } else {
      const slide=smoothstep(t,.31,.88), take=smoothstep(t,1.06,1.49);
      position.copy(bed).lerp(tail,slide).lerp(carry,take);
      rotation.copy(attitude).slerp(upright,take);
      pose.haul=smoothstep(t,.10,.30)*(1-smoothstep(t,.83,.98));
      pose.grip=smoothstep(t,.86,1.05);
      pose.lean=lerp(.83,.27,take)*smoothstep(t,.02,.30);
      pose.crouch=.126*smoothstep(t,.04,.43)*(1-take);
      pose.slide=t>=.32;
      pose.done=t>=1.50;
    }
    if(cart) pose.gate=smoothstep(t,0,.24)*(1-smoothstep(t,kind==="load" ? 1.11 : 1.36,kind==="load" ? 1.33 : 1.51));
    return pose;
  }

  return {sample};
}
