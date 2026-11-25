import { MathUtils } from "three";

export const legRig={separation:.109, hip:.717, upper:.351, lower:.326, ankle:.067, heel:.070, toe:-.149};
const {separation,hip,upper,lower,ankle:ankleHeight,heel,toe}=legRig;
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const {clamp,damp,smoothstep}=MathUtils;

// Advance ground velocity in metres per second. The collision sweep reports
// actual movement back to the caller, so braking never stores force at a wall.
export function advanceStreetVelocity(velocity,targetX,targetZ,dt,laden) {
  const targetSpeed=Math.hypot(targetX,targetZ);
  const speed=velocity.length();
  if(targetSpeed && speed) {
    const along=(velocity.x*targetX+velocity.y*targetZ)/targetSpeed;
    // On a sharp input change, plant before pushing in the new direction.
    // Sideways momentum would otherwise drift into adjacent doors and rails.
    if(along<speed*.60) {
      const remaining=Math.max(0,along)/targetSpeed;
      velocity.set(targetX*remaining,targetZ*remaining);
    }
  }
  const dx=targetX-velocity.x, dz=targetZ-velocity.y;
  const delta=Math.hypot(dx,dz);
  const accelerating=targetSpeed>velocity.length();
  const rate=accelerating ? (laden ? 7.1 : 9.4) : (laden ? 28 : 33);
  if(delta<=rate*dt) velocity.set(targetX,targetZ);
  else {
    const step=rate*dt/delta;
    velocity.x+=dx*step;
    velocity.y+=dz*step;
  }
}

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

  function steer(dt,yaw,target,speed,laden) {
    const delta=angleDelta(yaw,target), sign=Math.sign(delta);
    if(!ready || !sign) return yaw;
    const stride=smoothstep(speed,.12,1.3);
    const maxTurn=MathUtils.lerp(laden ? 3.6 : 4.65,9.2,stride)*dt;
    const limit=MathUtils.lerp(swing ? .58 : .32,.79,stride);
    let advance=Math.min(Math.abs(delta)*(1-Math.exp(-16*dt)),maxTurn);
    for(const [i,foot] of feet.entries()) {
      if(swing?.index===i) continue;
      advance=Math.min(advance,Math.max(0,limit-sign*angleDelta(foot.yaw,yaw)));
    }
    return yaw+sign*advance;
  }

  function update(dt,time,x,z,yaw,vx,vz,depth,targetYaw=yaw) {
    const speed=Math.hypot(vx,vz);
    const moving=speed>.14;
    const turning=angleDelta(yaw,targetYaw);
    // Start the next foothold toward the intended facing while the planted
    // leg limits how far the pelvis may turn in this frame.
    const footYaw=yaw+clamp(turning,-.73,.73);
    const locomotion=smoothstep(speed,.1,2.75);
    const ground=floor(x,z);
    const grade=moving ? Math.abs(floor(x+.42*vx/speed,z+.42*vz/speed)-ground)/.42 : 0;
    const incline=smoothstep(grade,.065,.32);
    const strideReach=.424+.021*locomotion-.047*incline;
    if (!ready) {
      ready=true;
      height=ground;
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
      const sin=Math.sin(foot.yaw),cos=Math.cos(foot.yaw);
      const ahead=-(x-foot.x)*sin-(z-foot.z)*cos;
      const along=-(vx*sin+vz*cos);
      const direction=Math.sign(along);
      const pushOff=moving && swing && !swing.pivot ? direction*smoothstep(Math.abs(along),.26,.9)*
        smoothstep(ahead*direction,.072,.32)*smoothstep(foot.plantAge,.065,.195)*(.30+.075*incline) : 0;
      foot.pitch=damp(foot.pitch,-pushOff,pushOff ? 18 : 36,dt);
    }
    if (swing) {
      const foot=feet[swing.index];
      const support=feet[1-swing.index];
      const launchSpeed=Math.hypot(swing.velocityX,swing.velocityZ);
      const redirect=speed>.19 && vx*swing.velocityX+vz*swing.velocityZ<.46*speed*launchSpeed;
      const stopping=speed<.16 && launchSpeed>.55;
      let rate=1;
      if(moving) {
        const dx=x-support.x, dz=z-support.z;
        const along=(dx*vx+dz*vz)/speed;
        const side2=Math.max(0,dx*dx+dz*dz-along*along);
        const until=(Math.sqrt(Math.max(0,strideReach**2-side2))-along)/speed;
        // On acceleration or a sharp turn, finish the swing before the
        // trailing leg reaches full extension and drags the planted shoe.
        rate=clamp((swing.duration-swing.age)/Math.max(.048,until),redirect ? 1.24 : 1,3.8);
      }
      swing.age+=dt*rate;
      const t=Math.min(1,swing.age/swing.duration);
      if (t<.73 || (swing.pivot || redirect || stopping) && t<.90) {
        const anticipation=Math.max(moving ? .084 : 0,swing.duration*(1.34-t)/rate);
        const [px,pz]=destination(foot,x,z,footYaw,vx,vz,anticipation);
        const correction=redirect || stopping ? 25 : 17;
        swing.toX=damp(swing.toX,px,correction,dt);
        swing.toZ=damp(swing.toZ,pz,correction,dt);
        swing.toY=floor(swing.toX,swing.toZ);
        swing.targetYaw=footYaw;
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
        const shuffle=swing.pivot ? .49/swing.duration : 0;
        const impactX=swing.velocityX+shuffle*(foot.x-swing.fromX);
        const impactZ=swing.velocityZ+shuffle*(foot.z-swing.fromZ);
        const wet=touchdown(foot.x,foot.y,foot.z,time,impactX,impactZ,foot);
        if(wet) wetLandings++;
        last={ foot:swing.index,x:foot.x,y:foot.y,z:foot.z,time,wet };
        next=1-swing.index;
        pause=swing.exchange;
        swing=null;
      }
    }
    if (!swing && (pause<=0 || moving && feet.some(foot=>Math.hypot(foot.x-x,foot.z-z)>strideReach*.92))) {
      const feetOffset=feet.map(foot=>{
        const [fx,fz]=nominal(foot,x,z,footYaw);
        return Math.hypot(fx-foot.x,fz-foot.z)+.12*Math.abs(angleDelta(foot.yaw,footYaw));
      });
      const pivot=!moving && (Math.abs(turning)>.31 || feet.some(foot=>Math.abs(angleDelta(foot.yaw,targetYaw))>.37));
      const shouldMove=Math.max(...feetOffset)>(moving ? .037 : pivot ? .049 : .117);
      if (shouldMove) {
        const stretched=moving ? feet.findIndex(foot=>Math.hypot(foot.x-x,foot.z-z)>strideReach*.89) : -1;
        const index=stretched>=0 ? stretched : feetOffset[next]>(moving ? .029 : pivot ? .040 : .069) ? next : 1-next;
        const foot=feet[index], support=feet[1-index];
        const inWater=MathUtils.smoothstep(depth,.015,.48);
        const run=MathUtils.smoothstep(speed,1.72,3.42);
        let duration=pivot ? .218 : .24, exchange=pivot ? .018 : .029;
        const direction=vx*Math.sin(yaw)+vz*Math.cos(yaw)>0 ? -1 : 1;
        if (moving) {
          exchange=.037*(1-run)*(1-.52*incline);
          const natural=MathUtils.lerp(.348,.174,run)*(1-.24*incline)+.040*inWater;
          const lead=((support.x-x)*vx+(support.z-z)*vz)/speed;
          duration=MathUtils.clamp((lead+strideReach)/speed-exchange,.088,natural);
        }
        const [toX,toZ]=destination(foot,x,z,footYaw,vx,vz,duration*1.34);
        const stride=Math.hypot(toX-foot.x,toZ-foot.z);
        swing={ index,age:0,fromX:foot.x,fromY:foot.y,fromZ:foot.z,
          toX,toY:floor(toX,toZ),toZ,yaw:foot.yaw,targetYaw:footYaw,duration,pivot,
          clearance:(pivot ? .023 : .030)+.071*Math.min(stride,.67)+.053*inWater,
          pitch:foot.pitch,release:moving ? -direction*(.23+.18*run) : 0,
          clearPitch:moving ? .12*direction : 0,
          contact:moving ? direction*(.21-.085*run)*(1-.61*inWater) : 0,exchange,
          velocityX:vx,velocityZ:vz };
      }
    }
    const motion=MathUtils.smoothstep(speed,.10,.92);
    const amount=swing ? Math.sin(Math.PI*Math.min(1,swing.age/swing.duration)) : 0;
    rise=MathUtils.damp(rise,(-.025+.027*amount)*motion,13,dt);
    let bound=Infinity;
    for (const [i,foot] of feet.entries()) {
      if (swing?.index===i) continue;
      const [hipX,hipZ]=nominal(foot,x,z,yaw);
      const contact=foot.pitch>=0 ? heel : toe;
      const sin=Math.sin(foot.pitch),cos=Math.cos(foot.pitch);
      const ankleShift=contact*(1-cos)+ankleHeight*sin;
      const ankleLift=ankleHeight*(cos-1)+contact*sin;
      const reach=Math.hypot(foot.x+ankleShift*Math.sin(foot.yaw)-hipX,foot.z+ankleShift*Math.cos(foot.yaw)-hipZ);
      const upperBound=foot.y+ankleHeight+ankleLift+Math.sqrt(Math.max(.012,(upper+lower-.029)**2-reach*reach))-hip;
      bound=Math.min(bound,upperBound);
    }
    // The pelvis leaves a low support gradually after the other boot takes the load.
    const target=Math.min(ground+rise,bound);
    height=Math.max(ground-.244,Math.min(bound,MathUtils.damp(height,target,11,dt)));
  }

  return {
    update,steer,rootHeight:(x,z)=>ready ? height : floor(x,z),feet,
    pivotLean:()=>swing?.pivot ? .115*feet[1-swing.index].side*Math.sin(Math.PI*swing.age/swing.duration) : 0,
    reset() { ready=false; swing=null; next=0; cadence=0; rise=0; pause=0; landings=wetLandings=0; last=null; },
    phase:()=>cadence+(swing ? Math.PI*Math.min(1,swing.age/swing.duration) : 0),
    inspect:()=>({ feet:feet.map((foot,i)=>({...foot,planted:swing?.index!==i})),landings,wetLandings,last }),
  };
}
