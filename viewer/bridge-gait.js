import { MathUtils } from "three";

export const legRig={separation:.109, hip:.717, upper:.351, lower:.326, ankle:.067};
const {separation,hip,upper,lower,ankle:ankleHeight}=legRig;
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

export function createGroundedGait(floor,stepAllowed,touchdown) {
  const feet=[-1,1].map(side=>({
    side,x:0,y:0,z:0,yaw:0,pitch:0,plantAge:0,
  }));
  let ready=false, swing=null, next=0, landings=0, wetLandings=0;
  let cadence=0, pause=0, rise=0, height=0;
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
    const moving=speed>.14;
    if (!ready) {
      ready=true;
      height=floor(x,z);
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
      if (t<.17) foot.pitch=MathUtils.lerp(swing.pitch,swing.release,MathUtils.smoothstep(t,0,.17));
      else if (t<.54) foot.pitch=MathUtils.lerp(swing.release,swing.clearPitch,MathUtils.smoothstep(t,.17,.54));
      else foot.pitch=MathUtils.lerp(swing.clearPitch,swing.contact,MathUtils.smoothstep(t,.62,1));
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
      const shouldMove=Math.max(...feetOffset)>(moving ? .037 : .125);
      if (shouldMove) {
        const index=feetOffset[next]>(moving ? .029 : .069) ? next : 1-next;
        const foot=feet[index], support=feet[1-index];
        const inWater=MathUtils.smoothstep(depth,.015,.48);
        const run=MathUtils.smoothstep(speed,1.72,3.42);
        const grade=moving ? Math.abs(floor(x+.42*vx/speed,z+.42*vz/speed)-floor(x,z))/.42 : 0;
        const incline=MathUtils.smoothstep(grade,.065,.32);
        let duration=.24, exchange=.029;
        const direction=vx*Math.sin(yaw)+vz*Math.cos(yaw)>0 ? -1 : 1;
        if (moving) {
          exchange=.037*(1-run)*(1-.52*incline);
          const natural=MathUtils.lerp(.348,.174,run)*(1-.24*incline)+.040*inWater;
          const lead=((support.x-x)*vx+(support.z-z)*vz)/speed;
          const reach=.39+.11*run-.055*incline;
          duration=MathUtils.clamp((lead+reach)/speed-exchange,.115,natural);
        }
        const [toX,toZ]=destination(foot,x,z,yaw,vx,vz,duration*1.36);
        const stride=Math.hypot(toX-foot.x,toZ-foot.z);
        swing={ index,age:0,fromX:foot.x,fromY:foot.y,fromZ:foot.z,
          toX,toY:floor(toX,toZ),toZ,yaw:foot.yaw,targetYaw:yaw,duration,
          clearance:.030+.071*Math.min(stride,.67)+.053*inWater,
          pitch:foot.pitch,release:moving ? -direction*(.23+.18*run) : 0,
          clearPitch:moving ? .12*direction : 0,
          contact:moving ? direction*(.21-.085*run)*(1-.61*inWater) : 0,exchange,
          velocityX:vx,velocityZ:vz };
      }
    }
    const motion=MathUtils.smoothstep(speed,.10,.92);
    const amount=swing ? Math.sin(Math.PI*Math.min(1,swing.age/swing.duration)) : 0;
    rise=MathUtils.damp(rise,(-.025+.027*amount)*motion,13,dt);
    const ground=floor(x,z);
    let bound=Infinity;
    for (const [i,foot] of feet.entries()) {
      if (swing?.index===i) continue;
      const [hipX,hipZ]=nominal(foot,x,z,yaw);
      const reach=Math.hypot(foot.x-hipX,foot.z-hipZ)+.076*Math.abs(foot.pitch);
      const upperBound=foot.y+ankleHeight+Math.sqrt(Math.max(.06,(upper+lower-.026)**2-reach*reach))-hip;
      bound=Math.min(bound,upperBound);
    }
    // The pelvis leaves a low support gradually after the other boot takes the load.
    const target=Math.min(ground+rise,bound);
    height=Math.max(ground-.244,Math.min(bound,MathUtils.damp(height,target,11,dt)));
  }

  return {
    update,rootHeight:(x,z)=>ready ? height : floor(x,z),feet,
    reset() { ready=false; swing=null; next=0; cadence=0; rise=0; pause=0; landings=wetLandings=0; last=null; },
    phase:()=>cadence+(swing ? Math.PI*Math.min(1,swing.age/swing.duration) : 0),
    inspect:()=>({ feet:feet.map((foot,i)=>({...foot,planted:swing?.index!==i})),landings,wetLandings,last }),
  };
}
