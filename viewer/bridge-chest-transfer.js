import { MathUtils } from "three";

const {lerp,smoothstep}=MathUtils;
const workingRadius=.179;
const clearDistance=.241;
const squatDepth=.532;
const liftTime=1.28;

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const turn=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
function chestSpace(crate,x,z) {
  const c=Math.cos(crate.yaw),s=Math.sin(crate.yaw);
  return {x:crate.x+c*x+s*z,z:crate.z-s*x+c*z};
}

export function createChestTransfer(back,floor,clear,canLift,canLower) {
  let action=null;
  const motion={x:0,z:0,yaw:0};
  const pose={crouch:0,grip:0,height:0,x:0,y:0,z:0,yaw:0};

  function pathOpen(from,to,aroundCargo) {
    const count=Math.max(1,Math.ceil(distance(from,to)/.055));
    for(let i=1;i<=count;i++) {
      const x=lerp(from.x,to.x,i/count),z=lerp(from.z,to.z,i/count);
      if(!clear(x,z,aroundCargo,workingRadius)) return false;
    }
    return true;
  }

  function pickUp(player,crate) {
    let best=null;
    for(const side of [-1,1]) {
      const yaw=crate.yaw+(side>0 ? Math.PI : 0);
      const station=chestSpace(crate,0,side*back);
      const approach=chestSpace(crate,0,side*(back+clearDistance));
      const stationY=floor(station.x,station.z);
      if(!pathOpen(approach,station,true) || Math.abs(stationY-crate.y)>.115 || !canLift(crate,stationY)) continue;
      const routes=[[approach,station]];
      for(const direction of [-1,1]) routes.push([chestSpace(crate,direction*.69,side*(back+clearDistance)),approach,station]);
      for(const path of routes) {
        let length=0,point=player,reachable=true;
        for(let i=0;i<path.length;i++) {
          const next=path[i];
          if(!pathOpen(point,next,i===path.length-1)) {reachable=false;break;}
          length+=distance(point,next);
          point=next;
        }
        if(reachable && (!best || length<best.length)) best={path,length,yaw,offset:side>0 ? -Math.PI : 0};
      }
    }
    if(!best) return false;
    action={kind:"pick",stage:"approach",age:0,index:0,crate,...best};
    Object.assign(pose,crate,{crouch:0,grip:0,height:0});
    return true;
  }

  function setDown(player,crate,yaw,offset,ground) {
    const departure=chestSpace({...player,yaw},0,-clearDistance);
    if(!canLower(crate,ground) || !pathOpen(player,departure,true)) return false;
    action={kind:"drop",stage:"settle",age:0,index:0,crate:{...crate,y:ground},yaw,offset,departure};
    Object.assign(pose,crate,{crouch:0,grip:0,height:1});
    return true;
  }

  function update(dt,player,yaw,carried,planted) {
    if(!action) return null;
    const a=action;
    motion.x=motion.z=0;
    motion.yaw=a.yaw;
    a.age+=dt;
    if(a.stage==="approach" || a.stage==="clear") {
      const approach=a.stage==="approach";
      if(a.age>4.6) return approach ? "blocked" : "drop";
      const to=approach ? a.path[a.index] : a.departure;
      const remaining=distance(player,to);
      if(remaining>.009) {
        const close=approach && a.index===a.path.length-1;
        if(!clear(to.x,to.z,close || !approach,workingRadius)) return approach ? "blocked" : "drop";
        const speed=Math.min((close ? .81 : approach ? 1.36 : .91),remaining/dt);
        motion.x=(to.x-player.x)*speed/remaining;
        motion.z=(to.z-player.z)*speed/remaining;
      } else if(approach && a.index<a.path.length-1) {
        a.index++;
      } else if(approach) {
        a.stage="settle"; a.age=0;
      } else return "drop";
    } else if(a.stage==="settle") {
      if(a.age>.22 && planted && Math.abs(turn(yaw,a.yaw))<.037) {a.stage="lifting"; a.age=0;}
      else if(a.age>1.6) return a.kind==="pick" ? "blocked" : "aborted";
    } else if(a.stage==="lifting" && a.age>=liftTime) {
      if(a.kind==="pick") return "pick";
      a.stage="clear"; a.age=0;
    }
    let t=a.kind==="pick" ? 0 : 1;
    if(a.stage==="lifting") t=a.kind==="pick" ? a.age/liftTime : 1-a.age/liftTime;
    else if(a.stage==="clear") t=0;
    const lift=smoothstep(t,.28,.92);
    pose.crouch=squatDepth*smoothstep(t,.015,.29)*(1-smoothstep(t,.31,.91));
    pose.grip=smoothstep(t,.17,.28)*(1-smoothstep(t,.84,.98));
    pose.height=lift;
    pose.x=lerp(a.crate.x,carried.x,lift);
    pose.y=lerp(a.crate.y,carried.y,lift);
    pose.z=lerp(a.crate.z,carried.z,lift);
    pose.yaw=a.crate.yaw+turn(a.crate.yaw,a.yaw+a.offset)*lift;
    return null;
  }

  return {pickUp,setDown,update,motion,pose,get action(){return action;},reset(){action=null;}};
}
