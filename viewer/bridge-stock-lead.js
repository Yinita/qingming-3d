import * as THREE from "three";
import { createLivestockRig } from "./bridge-livestock-model.js";
import { circleTouchesBox, sweepYaw, workerRadius } from "./bridge-collision.js";
import { detailedBox } from "./bridge-look.js";

const {clamp,damp,lerp,smoothstep}=THREE.MathUtils;
const difference=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const scale=.91, drinkDuration=4.85, ropeLength=2.22;
const chestClearance=.60;
const gaitOffsets=[.25,0,.75,.50];

function plantedLegs(rig,floor,hoofSound) {
  const target=new THREE.Vector3(), axis=new THREE.Vector3(), bend=new THREE.Vector3();
  const joint=new THREE.Vector3(), lowerAxis=new THREE.Vector3(), inverse=new THREE.Quaternion();
  const local=new THREE.Vector3();
  let cycle=0,ready=false;
  const tracks=rig.legs.map(({rest:[hip,knee,hoof]},i)=>{
    const upper=knee.clone().sub(hip), lower=hoof.clone().sub(knee);
    return {anchor:new THREE.Vector3(),start:new THREE.Vector3(),end:new THREE.Vector3(),
      lengthA:upper.length(),lengthB:lower.length(),upper:upper.normalize(),lower:lower.normalize(),
      bend:knee.clone().sub(hip),hoofOffset:hoof.clone().sub(rig.contacts[i]),swing:null,phase:gaitOffsets[i]};
  });
  function solve(i,point) {
    const {upper,knee,hoof,rest:[hip]}=rig.legs[i], t=tracks[i];
    rig.mesh.worldToLocal(local.copy(point));
    target.copy(local).add(t.hoofOffset).sub(hip);
    const reach=clamp(target.length(),.14,t.lengthA+t.lengthB-.0002);
    axis.copy(target).normalize();
    bend.copy(t.bend).addScaledVector(axis,-t.bend.dot(axis)).normalize();
    const along=(t.lengthA*t.lengthA-t.lengthB*t.lengthB+reach*reach)/(2*reach);
    joint.copy(axis).multiplyScalar(along).addScaledVector(bend,Math.sqrt(Math.max(0,t.lengthA*t.lengthA-along*along)));
    upper.quaternion.setFromUnitVectors(t.upper,local.copy(joint).normalize());
    lowerAxis.copy(axis).multiplyScalar(reach).sub(joint).normalize();
    knee.quaternion.setFromUnitVectors(t.lower,lowerAxis);
    hoof.quaternion.copy(knee.quaternion).invert();
    knee.quaternion.premultiply(inverse.copy(upper.quaternion).invert());
  }
  return {
    reset(){ready=false;cycle=0;},
    heightLimit(base) {
      if(!ready) return base;
      for(const [i,t] of tracks.entries()) {
        if(t.swing) continue;
        rig.mesh.worldToLocal(local.copy(t.anchor)).add(t.hoofOffset).sub(rig.legs[i].rest[0]);
        const vertical=Math.sqrt(Math.max(.2,(t.lengthA+t.lengthB-.001)**2-local.x**2-local.z**2));
        base=Math.min(base,rig.mesh.position.y+(local.y+vertical)*scale);
      }
      return base;
    },
    frame(dt,vx,vz,yawRate) {
      const travel=Math.hypot(vx,vz), pace=travel+.18*Math.abs(yawRate);
      cycle+=dt*pace/.49;
      let swinging=tracks.filter(t=>t.swing).length;
      for(const [i,t] of tracks.entries()) {
        const angle=(cycle+gaitOffsets[i])%1;
        rig.mesh.localToWorld(target.copy(rig.contacts[i]));
        target.y=floor(target.x,target.z);
        if(!ready) {
          t.anchor.copy(target);t.swing=null;t.phase=angle;
        }
        const drift=distance(t.anchor,target);
        const step=angle<t.phase && pace>.14 || drift>(pace>.14 ? .218 : .098);
        if(!t.swing && step && swinging<2) {
          t.swing={age:0,duration:lerp(.27,.17,smoothstep(pace,.18,1.30))};
          t.start.copy(t.anchor);
          t.end.set(target.x+vx*.145,target.y,target.z+vz*.145);
          swinging++;
        }
        if(t.swing) {
          t.swing.age+=dt;
          const time=clamp(t.swing.age/t.swing.duration,0,1);
          if(time<.78) {
            t.end.x=damp(t.end.x,target.x+vx*.142,19,dt);
            t.end.z=damp(t.end.z,target.z+vz*.142,19,dt);
          }
          t.end.y=floor(t.end.x,t.end.z);
          t.anchor.lerpVectors(t.start,t.end,smoothstep(time,0,1));
          t.anchor.y=Math.max(t.anchor.y,floor(t.anchor.x,t.anchor.z))+
            Math.sin(Math.PI*time)*lerp(.031,.078,smoothstep(pace,.1,1.1));
          if(time>=1) {
            t.swing=null;
            swinging--;
            if(pace>.23) hoofSound(t.anchor,pace);
          }
        }
        t.phase=angle;
        solve(i,t.anchor);
      }
      ready=true;
    },
    inspect:()=>tracks.map((t,i)=>({position:t.anchor.toArray(),planted:!t.swing,
      contact:rig.legs[i].hoof.localToWorld(local.copy(t.hoofOffset).negate()).toArray()})),
  };
}

function makeLead(parent,surface,clearance) {
  const geometry=new THREE.CylinderGeometry(1,1,1,7,22,true);
  const shape=geometry.attributes.position;
  const rings=shape.array.slice();
  const rope=new THREE.Mesh(geometry,surface("rail-wood",0xbc9870,.22,.94));
  rope.name="Braided hemp lead";
  rope.castShadow=true;
  rope.frustumCulled=false;
  parent.add(rope);
  const side=new THREE.Vector3(), up=new THREE.Vector3(), along=new THREE.Vector3();
  return (start,end,sag,time)=>{
    along.subVectors(end,start).normalize();
    side.set(along.z,0,-along.x).normalize();
    if(side.lengthSq()<.1) side.set(1,0,0);
    up.crossVectors(along,side).normalize();
    const span=start.distanceTo(end);
    for(let i=0;i<shape.count;i++) {
      const k=i*3,t=rings[k+1]+.5,curve=Math.sin(Math.PI*t);
      const braid=.0102+.0013*Math.cos(t*span*135+Math.atan2(rings[k],rings[k+2])*3);
      const c=rings[k]*braid+.007*Math.sin(time*3.4+t*7)*curve;
      const s=rings[k+2]*braid;
      const x=lerp(start.x,end.x,t)+side.x*c+up.x*s;
      const y=lerp(start.y,end.y,t)-sag*curve+up.y*s;
      const z=lerp(start.z,end.z,t)+side.z*c+up.z*s;
      const socketFade=smoothstep(t,0,.045)*(1-smoothstep(t,.955,1));
      shape.setXYZ(i,x,lerp(y,clearance(x,z,y),socketFade),z);
    }
    shape.needsUpdate=true;
    geometry.computeVertexNormals();
  };
}

export function createWateringDonkey(parent,city,surface,floor,well,dryAt,hoofSound) {
  const group=new THREE.Group();
  group.name="Well pack donkey and hitch";
  parent.add(group);
  const home={x:-74.52,z:-33.33,yaw:-.36};
  const dock={x:well.basin.x,z:well.basin.z+.90,yaw:0};
  const turnIn={x:dock.x,z:dock.z+1.17};
  const hitch=new THREE.Vector3(-75.53,floor(-75.53,-33.93)+1.07,-33.93);
  const rig=createLivestockRig("donkey",1,true), {mesh}=rig;
  mesh.name="Leadable pack donkey";
  mesh.scale.setScalar(scale);
  group.add(mesh);
  const pegWood=surface("rail-wood",0xae8962,.86,.92);
  function prop(geometry,material,at) {
    const part=new THREE.Mesh(geometry,material);
    part.position.copy(at);part.castShadow=part.receiveShadow=true;
    group.add(part);
    return part;
  }
  prop(detailedBox(.147,1.28,.158,pegWood,.024),pegWood,hitch.clone().add(new THREE.Vector3(0,-.48,0)));
  const plinth=surface("worn-stone",0xa29a80,.81,.96);
  prop(detailedBox(.39,.122,.37,plinth,.039),plinth,hitch.clone().add(new THREE.Vector3(0,-1.015,0)));
  const iron=new THREE.MeshStandardMaterial({color:0x57483b,metalness:.45,roughness:.57});
  const hitchRing=prop(new THREE.TorusGeometry(.046,.009,8,24),iron,hitch.clone());
  hitchRing.rotation.y=Math.PI*.5;
  const post=city.box("Donkey hitch",hitch.x-.085,hitch.x+.085,hitch.z-.09,hitch.z+.09,hitch.y-1.07,hitch.y+.16);
  const body=city.orientedBox("Pack donkey",.309,.595,.98);
  const [chest,head,tail,earL,earR]=rig.bones;
  const headRest=head.position.clone(), sipLocal=rig.sniff.clone().add(new THREE.Vector3(0,-.028,-.008));
  const noseRing=new THREE.Mesh(new THREE.TorusGeometry(.025,.0058,8,20),iron);
  noseRing.name="Halter lead ring";
  noseRing.position.copy(rig.sniff).add(new THREE.Vector3(0,-.068,.071));
  noseRing.rotation.y=Math.PI*.5;
  head.add(noseRing);
  const tie=new THREE.Vector3(), palm=new THREE.Vector3(), handAt=new THREE.Object3D();
  handAt.name="Donkey lead palm target";
  group.add(handAt);
  const end=new THREE.Vector3(), mouth=new THREE.Vector3(), drinkAt=new THREE.Vector3();
  const elbowAim=new THREE.Quaternion(), handFrame=new THREE.Euler();
  const string=makeLead(group,surface,well.leadClearance);
  const gait=plantedLegs(rig,floor,hoofSound);
  let x=home.x,z=home.z,y=floor(x,z),yaw=home.yaw,v=0, age=0, grip=0;
  let stage="tied", hydrated=false, blocked=false, linedUp=false, wait=0, tilt=0,lastTime=0;
  const locked=()=>stage==="align" || stage==="drink";
  const isHeld=()=>stage==="lead" || locked();
  function reachable(player) {
    return !isHeld() && distance(player,mesh.position)<1.67 &&
      Math.hypot(tie.x-player.x,tie.z-player.z)<1.12 &&
      !city.blocking((tie.x+player.x)*.5,(tie.z+player.z)*.5,tie.y-.07,.058,.14,body);
  }
  function atBasin(player) {
    return distance(player,dock)<1.55 && Math.abs(player.x-dock.x)>.78 &&
      player.z>well.basin.z+.31 && distance(mesh.position,dock)<2.13;
  }
  function canDrink(player) {
    return stage==="lead" && !hydrated && well.canWater() && atBasin(player);
  }
  function sync() {
    mesh.position.set(x,y,z);
    mesh.rotation.y=yaw;
    Object.assign(body,{enabled:group.visible,x,z,yaw,bottom:y+chestClearance,top:y+1.43});
  }
  function obstacle(cx,cz,angle,player) {
    const floorY=floor(cx,cz);
    if(!dryAt(cx,cz) || Math.abs(floorY-floor(x,z))>.16) return true;
    if(player && circleTouchesBox(player.x,player.z,workerRadius+.06,cx,cz,body.halfX,body.halfZ,angle)) return true;
    if(city.boxBlocking(cx,cz,floorY+chestClearance,body.halfX,body.halfZ,1.43-chestClearance,angle,body)) return true;
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const contact of rig.contacts) {
      const u=contact.x*scale,w=contact.z*scale;
      const fx=cx+u*c+w*s,fz=cz-u*s+w*c;
      if(city.blocking(fx,fz,floor(fx,fz),.084,.56,body) || !dryAt(fx,fz)) return true;
    }
    return false;
  }
  function moveToward(dt,target,stop,limit,player) {
    const gap=distance(mesh.position,target);
    const desired=gap>.055 ? Math.atan2(x-target.x,z-target.z) : target.yaw??yaw;
    const delta=difference(yaw,desired);
    const turn=clamp(delta,-2.45*dt,2.45*dt);
    const next=sweepYaw(yaw,yaw+turn,angle=>!obstacle(x,z,angle,player));
    blocked=Math.abs(turn)>.003 && Math.abs(next-yaw)<.001;
    yaw=next;
    v=damp(v,Math.min(limit,Math.max(0,gap-stop)*3.8)*(1-smoothstep(Math.abs(delta),.45,1.18)),8,dt);
    const step=Math.min(v*dt,Math.max(0,gap-stop));
    const cx=x-Math.sin(yaw)*step,cz=z-Math.cos(yaw)*step;
    if(step>.00001) {
      if(obstacle(cx,cz,yaw,player)) {
        blocked=true;
        v=0;
      } else {x=cx;z=cz;}
    }
  }
  function use(player) {
    if(stage==="lead") {
      if(canDrink(player)) {
        stage="align";age=wait=0;
        linedUp=Math.abs(x-dock.x)<.10 && z>=dock.z;
        return "drink";
      }
      return "release";
    }
    if(!reachable(player)) return null;
    stage="lead";age=wait=0;return "take";
  }
  function release() {
    if(!isHeld()) return;
    stage="free";age=wait=0;v=0;blocked=false;
    well.lap(0);
  }
  function frame(dt,time,player) {
    lastTime=time;
    const oldX=x,oldZ=z,oldYaw=yaw;
    age+=dt;
    blocked=false;
    let event=null;
    if(stage==="lead") {
      if(distance(mesh.position,player)>1.43) moveToward(dt,player,1.43,1.39,player);
      else v=0;
    }
    if(stage==="align") {
      if(!linedUp && distance(mesh.position,turnIn)<.079) linedUp=true;
      // Approach the trough straight on so the handler can wait at its side.
      if(!linedUp) moveToward(dt,turnIn,.042,.93,player);
      else if(distance(mesh.position,dock)>.060) moveToward(dt,dock,.037,.81,player);
      else {
        yaw=sweepYaw(yaw,yaw+clamp(difference(yaw,dock.yaw),-2*dt,2*dt),angle=>!obstacle(x,z,angle,player));
        v=0;
        if(Math.abs(difference(yaw,dock.yaw))<.057) {stage="drink";age=0;event="drinking";}
      }
      wait+=dt;
      if(stage==="align" && wait>9) {stage="lead";age=0;event="blocked";}
    }
    if(stage==="drink" && age>=drinkDuration) {
      stage="lead";age=0;hydrated=true;event="watered";
    }
    const speed=Math.hypot(x-oldX,z-oldZ)/dt,turn=difference(oldYaw,yaw)/dt;
    const ground=floor(x,z);
    y=damp(y,ground-.016*smoothstep(speed,.1,1.2),14,dt);
    mesh.position.set(x,y,z);
    mesh.rotation.y=yaw;
    if(speed>.10 || Math.abs(turn)>.12) y=Math.max(ground-.058,gait.heightLimit(y));
    sync();
    const sipping=stage==="drink" ? smoothstep(age,.05,1.05)*(1-smoothstep(age,3.74,4.76)) : 0;
    const previousTilt=tilt;
    tilt=damp(tilt,sipping,15,dt);
    if(stage==="drink" && previousTilt<=.92 && tilt>.92) event="sipping";
    const sipPulse=tilt**4*(.56+.44*Math.sin(age*16.7)**2);
    const nod=tilt*.021*Math.sin(age*16.7);
    head.position.copy(headRest);
    head.rotation.set(lerp(.012*Math.sin(time*1.18)-.055*Number(isHeld()),-1.05,tilt)+nod,
      .029*Math.sin(time*.71)*(1-tilt),.014*Math.sin(time*.96)*(1-tilt),"YXZ");
    if(tilt>.0001) {
      well.sipPoint(drinkAt);
      mesh.worldToLocal(mouth.copy(drinkAt));
      mouth.y+=.004+nod*.18;
      mouth.sub(end.copy(sipLocal).applyQuaternion(head.quaternion));
      head.position.lerp(mouth,tilt);
    }
    const breathing=Math.sin(time*1.52);
    chest.scale.set(1+.018*breathing,1+.008*breathing,1+.006*breathing);
    tail.rotation.set(.051*Math.sin(time*1.35),.21*Math.sin(time*2.03),.095*Math.sin(time*2.29));
    earL.rotation.set(.11*Math.sin(time*2.87)**7,.065,.10*tilt);
    earR.rotation.set(.13*Math.sin(time*2.37+.52)**9,-.09,-.08*tilt);
    gait.frame(dt,(x-oldX)/dt,(z-oldZ)/dt,turn);
    noseRing.getWorldPosition(tie);
    well.lap(sipPulse);
    grip=damp(grip,Number(isHeld()),13,dt);
    if(stage==="tied") string(tie,hitch,.13,lastTime);
    else if(!isHeld()) {
      end.set(tie.x-.19*Math.cos(yaw),tie.y-.32,tie.z+.19*Math.sin(yaw));
      string(tie,end,.12,lastTime);
    }
    return event;
  }
  function pose(person) {
    if(!isHeld()) return;
    const lead=person.figure.worldToLocal(end.copy(tie));
    const hand=person.figure.localToWorld(palm.set(.282,lerp(1.056,1.125,smoothstep(-lead.z,-.26,.46)),
      clamp(lead.z*.21,-.245,.156)));
    handAt.position.copy(hand);
    const angle=Math.atan2(tie.x-hand.x,tie.z-hand.z);
    handFrame.set(-.16,angle+Math.PI*.62,.17,"YXZ");
    person.graspProp(1,hand,elbowAim.setFromEuler(handFrame),grip,.84);
    const mark=person.limbs.hands[1].group.getObjectByName("Workyard palm contact");
    mark.getWorldPosition(palm);
    const slack=1-smoothstep(palm.distanceTo(tie),.48,ropeLength-.02);
    string(palm,tie,.036+.24*slack,lastTime);
  }
  function restore(sated=false) {
    hydrated=sated;stage="tied";x=home.x;z=home.z;y=floor(x,z);yaw=home.yaw;
    blocked=false;grip=tilt=v=age=wait=0;
    head.position.copy(headRest);
    head.quaternion.identity();gait.reset();
    sync();frame(.016,0,home);
  }
  restore();
  return {home,dock,show(visible){group.visible=body.enabled=post.enabled=visible;},restore,
    held:isHeld,locked,release,use,frame,pose,reachable,canDrink,hydrated:()=>hydrated,blocked:()=>blocked,
    drinking:()=>stage==="drink",
    canStep(x,z,player) {
      const span=Math.hypot(x-tie.x,z-tie.z);
      return span<=ropeLength || span<Math.hypot(player.x-tie.x,player.z-tie.z);
    },
    inspect:()=>({stage,x,y,z,yaw,speed:v,hydrated,blocked,tilt,box:[body.x,body.bottom,body.z],
      leadAt:tie.toArray(),mouth:head.localToWorld(mouth.copy(sipLocal)).toArray(),
      water:well.sipPoint(drinkAt).toArray(),hooves:gait.inspect()}),
  };
}
