import { MathUtils } from "three";

const separation=.119;
const ankleHeight=.067;
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

export function createGroundedGait(floor,stepAllowed,touchdown) {
  const feet=[-1,1].map(side=>({
    side,x:0,y:0,z:0,yaw:0,
  }));
  let ready=false, swing=null, next=0, landings=0, wetLandings=0;
  let cadence=0, bob=0;
  let last=null;

  function nominal(foot,x,z,yaw) {
    const c=Math.cos(yaw), s=Math.sin(yaw);
    return [x+foot.side*separation*c,z-foot.side*separation*s];
  }

  function destination(foot,x,z,yaw,vx,vz,lookAhead) {
    const [nearX,nearZ]=nominal(foot,x,z,yaw);
    const aheadX=nearX+vx*lookAhead, aheadZ=nearZ+vz*lookAhead;
    // Approach the rail or depth limit with a shorter step.
    for (const scale of [1,.68,.33,0]) {
      const px=MathUtils.lerp(nearX,aheadX,scale), pz=MathUtils.lerp(nearZ,aheadZ,scale);
      if (stepAllowed(px,pz)) return [px,pz];
    }
    return [x,z];
  }

  function update(dt,time,x,z,yaw,vx,vz,depth) {
    const speed=Math.hypot(vx,vz);
    if (!ready) {
      ready=true;
      for (const foot of feet) {
        [foot.x,foot.z]=nominal(foot,x,z,yaw);
        foot.y=floor(foot.x,foot.z);
        foot.yaw=yaw;
      }
    }
    if (swing) {
      const foot=feet[swing.index];
      swing.age+=dt;
      const t=Math.min(1,swing.age/swing.duration);
      if (t<.69) {
        const anticipation=swing.duration*(1.29-t);
        const [px,pz]=destination(foot,x,z,yaw,vx,vz,anticipation);
        swing.toX=MathUtils.damp(swing.toX,px,17,dt);
        swing.toZ=MathUtils.damp(swing.toZ,pz,17,dt);
        swing.toY=floor(swing.toX,swing.toZ);
        swing.targetYaw=yaw;
      }
      const step=MathUtils.smoothstep(t,0,1);
      foot.x=MathUtils.lerp(swing.fromX,swing.toX,step);
      foot.z=MathUtils.lerp(swing.fromZ,swing.toZ,step);
      const ground=floor(foot.x,foot.z);
      const base=MathUtils.lerp(swing.fromY,swing.toY,step);
      foot.y=Math.max(ground,base)+Math.sin(Math.PI*t)**1.38*swing.clearance;
      foot.yaw=swing.yaw+angleDelta(swing.yaw,swing.targetYaw)*step;
      if (t>=1) {
        foot.y=swing.toY;
        cadence+=Math.PI;
        landings++;
        const wet=touchdown(foot.x,foot.y,foot.z,time,swing.velocityX,swing.velocityZ);
        if(wet) wetLandings++;
        last={ foot:swing.index,x:foot.x,y:foot.y,z:foot.z,time,wet };
        next=1-swing.index;
        swing=null;
      }
    }
    if (!swing) {
      const feetOffset=feet.map(foot=>{
        const [fx,fz]=nominal(foot,x,z,yaw);
        return Math.hypot(fx-foot.x,fz-foot.z)+.12*Math.abs(angleDelta(foot.yaw,yaw));
      });
      const moving=speed>.14;
      const lag=MathUtils.lerp(.16,.106,MathUtils.smoothstep(depth,.03,.48));
      const shouldMove=moving ? Math.max(...feetOffset)>lag : Math.max(...feetOffset)>.125;
      if (shouldMove) {
        const index=feetOffset[next]>.069 ? next : 1-next;
        const foot=feet[index];
        const inWater=MathUtils.smoothstep(depth,.015,.48);
        const run=MathUtils.smoothstep(speed,2.7,6.2);
        const duration=moving ? MathUtils.lerp(.255,.121,run)+.036*inWater : .22;
        const [toX,toZ]=destination(foot,x,z,yaw,vx,vz,duration*1.29);
        const stride=Math.hypot(toX-foot.x,toZ-foot.z);
        swing={ index,age:0,fromX:foot.x,fromY:foot.y,fromZ:foot.z,
          toX,toY:floor(toX,toZ),toZ,yaw:foot.yaw,targetYaw:yaw,duration,
          clearance:.061+.102*Math.min(stride,.64)+.067*inWater,
          velocityX:vx,velocityZ:vz };
      }
    }
    const motion=speed>.13 ? 1 : 0;
    const amount=swing ? Math.sin(Math.PI*Math.min(1,swing.age/swing.duration)) : 0;
    bob=MathUtils.damp(bob,(-.023+.030*amount)*motion,14,dt);
  }

  function rootHeight(x,z) {
    const ground=floor(x,z);
    if (!ready) return ground;
    let h=ground+bob;
    for (const [i,foot] of feet.entries()) {
      if (swing?.index===i) continue;
      const reach=Math.hypot(foot.x-x,foot.z-z);
      const upperBound=foot.y+ankleHeight+Math.sqrt(Math.max(.10,.666**2-reach*reach))-.68;
      h=Math.min(h,upperBound);
    }
    return Math.max(ground-.135,h);
  }

  return {
    update,rootHeight,feet,
    reset() { ready=false; swing=null; next=0; cadence=0; bob=0; },
    phase:()=>cadence+(swing ? Math.PI*Math.min(1,swing.age/swing.duration) : 0),
    inspect:()=>({ feet:feet.map((foot,i)=>({...foot,planted:swing?.index!==i})),landings,wetLandings,last }),
  };
}
