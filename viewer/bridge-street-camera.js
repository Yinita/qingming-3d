import { MathUtils, Vector3 } from "three";

const {clamp,damp}=MathUtils;
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

export function createStreetCamera(trace) {
  const right=new Vector3(),left=new Vector3(),goal=new Vector3();
  const nearA=new Vector3(),nearB=new Vector3(),aheadPivot=new Vector3(),aheadGoal=new Vector3();
  const previous=new Vector3(),previousPivot=new Vector3(),follow=new Vector3(),candidate=new Vector3();
  let tracking=false;
  let yaw=null,height=null,boom=3.2,shoulder=1,blend=1,compact=0,compactSide=1,freeTime=0,switchTime=0;
  const state={distance:3.2,clearance:3.2,obstacle:null,shoulder:1,compact:0,anticipated:false};

  function followYaw(target,dt,immediate) {
    yaw=yaw===null || immediate ? target : yaw+angleDelta(yaw,target)*(1-Math.exp(-22*dt));
    return yaw;
  }

  function followHeight(target,dt,immediate) {
    height=height===null || immediate ? target : clamp(damp(height,target,17,dt),target-.067,target+.067);
    return height;
  }

  function clear(pivot,point) {
    return trace(pivot,point).distance>=pivot.distanceTo(point)-.0001;
  }

  function glide(position,dt,pivot) {
    if(tracking) {
      follow.copy(previous).add(pivot).sub(previousPivot);
      const length=follow.distanceTo(position);
      const step=dt*(3.5+1.05*Math.min(3.2,boom));
      candidate.lerpVectors(follow,position,Math.min(1,step/Math.max(.0001,length)));
      if(clear(pivot,candidate)) position.copy(candidate);
      else {
        const carriedFits=clear(pivot,follow);
        if(!carriedFits) follow.copy(previous);
        if(carriedFits || clear(pivot,follow)) {
          // Retreat on the last clear sightline until it is possible to round the corner.
          const gap=pivot.distanceTo(follow);
          position.copy(follow).lerp(pivot,Math.min(1,step/Math.max(.0001,gap)));
        } else {
          const hit=trace(pivot,candidate);
          const gap=pivot.distanceTo(candidate);
          position.copy(pivot).lerp(candidate,hit.distance/Math.max(.0001,gap));
        }
      }
    }
    tracking=true;
    previous.copy(position);
    previousPivot.copy(pivot);
  }

  function place(position,dt,pivot,centre,across,width,vx,vz,allowShoulder) {
    right.copy(centre).addScaledVector(across,width);
    const preferred=trace(pivot,right);
    const reach=pivot.distanceTo(right);
    const switchAt=Math.min(1.72,reach*.79);
    let hit=preferred;
    if(allowShoulder && (shoulder<0 || blend<.94 || compact>.02 || preferred.distance<switchAt)) {
      left.copy(centre).addScaledVector(across,-width);
      const alternative=trace(pivot,left);
      const wantsLeft=preferred.distance<switchAt && alternative.distance>preferred.distance+.36;
      const rightClear=preferred.distance>Math.min(1.81,reach*.92) || alternative.distance<preferred.distance-.34;
      freeTime=rightClear ? freeTime+dt : 0;
      switchTime=wantsLeft ? switchTime+dt : 0;
      if(shoulder>0 && switchTime>.083) shoulder=-1;
      if(shoulder<0 && freeTime>.23) shoulder=1;
      blend=damp(blend,shoulder,10,dt);
      goal.lerpVectors(left,right,(blend+1)*.5);
      const tight=Math.max(preferred.distance,alternative.distance)<Math.min(1.08,.75*reach);
      if(tight || compact>.015) {
        // In a corner, orbit beside the shoulder instead of pushing straight into the head.
        nearA.lerpVectors(pivot,centre,.095).addScaledVector(across,.97);
        nearB.lerpVectors(pivot,centre,.095).addScaledVector(across,-.97);
        nearA.y+=.18;nearB.y+=.18;
        const nearRight=trace(pivot,nearA),nearLeft=trace(pivot,nearB);
        const currentNear=compactSide>0 ? nearRight.distance : nearLeft.distance;
        if(compact<.13 || currentNear<.37) {
          if(nearRight.distance>nearLeft.distance+.19) compactSide=1;
          if(nearLeft.distance>nearRight.distance+.19) compactSide=-1;
        }
        const usable=Math.max(nearRight.distance,nearLeft.distance)>.70 && tight;
        compact=damp(compact,Number(usable),13,dt);
        goal.lerp(compactSide>0 ? nearA : nearB,compact);
      }
      hit=trace(pivot,goal);
    } else {
      shoulder=blend=1;
      compact=switchTime=freeTime=0;
      goal.copy(right);
    }

    let target=hit.distance;
    let anticipated=false;
    if(Math.hypot(vx,vz)>.26 && target>.60) {
      aheadPivot.set(pivot.x+.19*vx,pivot.y,pivot.z+.19*vz);
      aheadGoal.copy(goal).add(aheadPivot).sub(pivot);
      const upcoming=trace(aheadPivot,aheadGoal);
      const buffered=upcoming.distance+.20;
      if(buffered<target) {
        anticipated=true;
        target=buffered;
      }
    }
    boom=Math.min(hit.distance,damp(boom,target,target<boom ? 17 : 10,dt));
    const length=pivot.distanceTo(goal);
    position.copy(pivot).lerp(goal,length>1e-5 ? boom/length : 0);
    glide(position,dt,pivot);
    Object.assign(state,{distance:pivot.distanceTo(position),clearance:hit.distance,obstacle:hit.obstacle,
      shoulder:blend,compact,anticipated});
    return state;
  }

  function reset() {
    yaw=height=null;
    tracking=false;
    boom=3.2;shoulder=blend=compactSide=1;compact=switchTime=freeTime=0;
  }

  return {followYaw,followHeight,place,reset,inspect:()=>({...state})};
}
