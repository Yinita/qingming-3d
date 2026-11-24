import { MathUtils } from "three";

export const legRig={separation:.109, hip:.717, upper:.351, lower:.326, ankle:.067};
const {separation,hip,upper,lower,ankle:ankleHeight}=legRig;
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

export function createGroundedGait(floor,stepAllowed,touchdown) {
  const feet=[-1,1].map(side=>({
    side,x:0,y:0,z:0,yaw:0,pitch:0,plantAge:0,
  }));
  let ready=false, swing=null, next=0, landings=0, wetLandings=0;
  let cadence=0, bob=0, pause=0;
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
        foot.pitch=0;
        foot.plantAge=1;
      }
    }
    pause=Math.max(0,pause-dt);
    for(const [i,foot] of feet.entries()) {
      if(swing?.index===i) continue;
      foot.plantAge+=dt;
      foot.pitch=MathUtils.damp(foot.pitch,0,36,dt);
    }
    if (swing) {
      const foot=feet[swing.index];
      swing.age+=dt;
      const t=Math.min(1,swing.age/swing.duration);
      if (t<.73) {
        const anticipation=swing.duration*(1.36-t);
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
      // Toe-off is brisk and the heel settles more slowly before the next support.
      const lift=Math.sin(Math.PI*t)**1.32*(1.24-.46*t);
      foot.y=Math.max(ground,base)+lift*swing.clearance;
      foot.yaw=swing.yaw+angleDelta(swing.yaw,swing.targetYaw)*step;
      foot.pitch=t<.42 ? MathUtils.lerp(swing.pitch,.12,MathUtils.smoothstep(t,0,.42)) :
        MathUtils.lerp(.12,swing.heel,MathUtils.smoothstep(t,.62,1));
      if (t>=1) {
        foot.y=swing.toY;
        foot.plantAge=0;
        cadence+=Math.PI;
        landings++;
        const wet=touchdown(foot.x,foot.y,foot.z,time,swing.velocityX,swing.velocityZ);
        if(wet) wetLandings++;
        last={ foot:swing.index,x:foot.x,y:foot.y,z:foot.z,time,wet };
        next=1-swing.index;
        pause=swing.exchange;
        swing=null;
      }
    }
    if (!swing && pause<=0) {
      const feetOffset=feet.map(foot=>{
        const [fx,fz]=nominal(foot,x,z,yaw);
        return Math.hypot(fx-foot.x,fz-foot.z)+.12*Math.abs(angleDelta(foot.yaw,yaw));
      });
      const moving=speed>.14;
      const lag=MathUtils.lerp(.14,.084,MathUtils.smoothstep(depth,.03,.48));
      const shouldMove=moving ? Math.max(...feetOffset)>lag : Math.max(...feetOffset)>.125;
      if (shouldMove) {
        const index=feetOffset[next]>.069 ? next : 1-next;
        const foot=feet[index];
        const inWater=MathUtils.smoothstep(depth,.015,.48);
        const run=MathUtils.smoothstep(speed,1.72,3.42);
        const grade=moving ? Math.abs(floor(x+.42*vx/speed,z+.42*vz/speed)-floor(x,z))/.42 : 0;
        const incline=MathUtils.smoothstep(grade,.065,.32);
        const duration=moving ? MathUtils.lerp(.348,.174,run)*(1-.24*incline)+.040*inWater : .24;
        const [toX,toZ]=destination(foot,x,z,yaw,vx,vz,duration*1.36);
        const stride=Math.hypot(toX-foot.x,toZ-foot.z);
        swing={ index,age:0,fromX:foot.x,fromY:foot.y,fromZ:foot.z,
          toX,toY:floor(toX,toZ),toZ,yaw:foot.yaw,targetYaw:yaw,duration,
          clearance:.030+.071*Math.min(stride,.67)+.053*inWater,
          pitch:moving ? -.23-.18*run : 0,heel:moving ? (.21-.085*run)*(1-.61*inWater) : 0,
          exchange:moving ? .046*(1-run)*(1-.52*incline) : .029,
          velocityX:vx,velocityZ:vz };
      }
    }
    const motion=MathUtils.smoothstep(speed,.10,.92);
    const amount=swing ? Math.sin(Math.PI*Math.min(1,swing.age/swing.duration)) : 0;
    bob=MathUtils.damp(bob,(-.025+.027*amount)*motion,13,dt);
  }

  function rootHeight(x,z) {
    const ground=floor(x,z);
    if (!ready) return ground;
    let h=ground+bob;
    for (const [i,foot] of feet.entries()) {
      if (swing?.index===i) continue;
      const reach=Math.hypot(foot.x-x,foot.z-z)+.076*Math.abs(foot.pitch);
      const upperBound=foot.y+ankleHeight+Math.sqrt(Math.max(.06,(upper+lower-.026)**2-reach*reach))-hip;
      h=Math.min(h,upperBound);
    }
    return Math.max(ground-.244,h);
  }

  return {
    update,rootHeight,feet,
    reset() { ready=false; swing=null; next=0; cadence=0; bob=0; pause=0; },
    phase:()=>cadence+(swing ? Math.PI*Math.min(1,swing.age/swing.duration) : 0),
    inspect:()=>({ feet:feet.map((foot,i)=>({...foot,planted:swing?.index!==i})),landings,wetLandings,last }),
  };
}
