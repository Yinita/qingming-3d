import { MathUtils } from "three";

const {lerp,smoothstep}=MathUtils;
const facing=Math.PI;
const facingError=yaw=>Math.abs(Math.atan2(Math.sin(yaw-facing),Math.cos(yaw-facing)));

// Back the pack up to the runners, then pass its weight to the counter and the receiver.
export function createCounterDelivery(target,back) {
  const station={x:target.x,z:target.z+1.22};
  const unloadZ=target.z+.785;
  const motion={x:0,z:0,yaw:facing};
  const pose={x:0,y:0,z:0,yaw:0,carrierGrip:0,merchantGrip:0,resting:false};
  let action=null;

  function start(method,carried) {
    action={method,stage:"approach",age:0,turn:carried.yaw};
    Object.assign(pose,carried,{carrierGrip:0,merchantGrip:0,resting:false});
  }

  function enter(stage) {
    action.stage=stage;
    action.age=0;
  }

  function drive(actor,x,z,dt,max,away=false) {
    const dx=x-actor.x,dz=z-actor.z,dist=Math.hypot(dx,dz);
    if(dist<=.010) return true;
    const speed=Math.min(max,dist/dt);
    motion.x=dx/dist*speed;
    motion.z=dz/dist*speed;
    if(!away && dist>.055) motion.yaw=Math.atan2(-dx,-dz);
    return false;
  }

  function update(dt,actor,yaw,carried,ready,merchantReady) {
    action.age+=dt;
    motion.x=motion.z=0;
    motion.yaw=facing;
    const {stage,age}=action;
    if(stage==="approach") {
      if(drive(actor,station.x,station.z,dt,1.18)) enter("settle");
      else if(age>5) return "blocked";
    } else if(stage==="settle") {
      if(ready && merchantReady && facingError(yaw)<.035) {
        action.turn=carried.yaw;
        enter("raise");
      } else if(age>5.2) return "blocked";
    } else if(stage==="raise" && age>=.43) {
      enter("back");
    } else if(stage==="back") {
      if(drive(actor,station.x,unloadZ,dt,.65,true)) {
        action.float={x:actor.x,z:actor.z-back};
        enter("pass");
      }
      else if(age>2.3) return "blocked";
    } else if(stage==="pass" && age>=1.19) return "done";
    return null;
  }

  function position(carried) {
    const {stage,age}=action;
    if(stage==="approach" || stage==="settle") {
      Object.assign(pose,carried);
      return;
    }
    pose.yaw=action.turn;
    pose.carrierGrip=stage==="raise" ? smoothstep(age,.02,.31) : 1;
    pose.merchantGrip=0;
    pose.resting=false;
    pose.x=carried.x;
    pose.z=carried.z;
    const clearance=target.y+.034;
    pose.y=stage==="raise" ? lerp(carried.y,clearance,smoothstep(age,.11,.43)) : clearance;
    if(stage==="pass") {
      const slide=smoothstep(age,.34,1.03);
      pose.x=lerp(action.float.x,target.x,slide);
      pose.z=lerp(action.float.z,target.z,slide);
      pose.y=lerp(clearance,target.y,smoothstep(age,.025,.26));
      pose.yaw=lerp(action.turn,Math.round(action.turn/Math.PI)*Math.PI,slide);
      pose.resting=age>=.26;
      pose.carrierGrip=1-smoothstep(age,.36,.61);
      pose.merchantGrip=smoothstep(age,.025,.32)*(1-smoothstep(age,1.03,1.19));
    }
  }

  return {station,unloadZ,motion,pose,start,update,position,
    get action(){return action;},reset(){action=null;}};
}
