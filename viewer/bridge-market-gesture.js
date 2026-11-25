import * as THREE from "three";
import { sweepHorizontal,workerRadius } from "./bridge-collision.js";

const { clamp,damp,smoothstep }=THREE.MathUtils;
const exchangeDistance=.81;
const callDistance=2.18;
const exchangeAt=1.39;
const gestureEnd=2.74;
const turnToward=(a,b,dt)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*(1-Math.exp(-10*dt));
const facing=(a,b)=>Math.atan2(a.x-b.x,a.z-b.z);

export function createMarketHandoff(shopper,parcel,{city,floor,obstruction,placeActor}) {
  const body=shopper.worker, subject=shopper.body;
  const parcelPoint=new THREE.Vector3(), beltPoint=new THREE.Vector3(), handsPoint=new THREE.Vector3();
  const towardParcel=new THREE.Vector3();
  const aimedRotation=new THREE.Quaternion(), beltRotation=new THREE.Quaternion();
  const baseEuler=new THREE.Euler(), pathStart=new THREE.Vector3();
  let exchange=null,shared=false,pickedUp=false,notice=null;
  parcel.name="Parcel exchanged with the market shopper";
  parcel.visible=false;

  function nearby(player) {
    return Math.hypot(player.x-shopper.x,player.z-shopper.z)<=callDistance &&
      Math.abs(floor(player.x,player.z)-floor(shopper.x,shopper.z))<.18;
  }

  function armClear(player,spot) {
    for(const t of [.32,.50,.68]) {
      const x=THREE.MathUtils.lerp(player.x,spot.x,t),z=THREE.MathUtils.lerp(player.z,spot.z,t);
      if(city.blocking(x,z,floor(x,z)+.90,.13,.31,subject)) return false;
    }
    return true;
  }

  function meetingPoint(player) {
    const yaw=facing(player,shopper);
    const gap=Math.hypot(player.x-shopper.x,player.z-shopper.z);
    if(gap<.89 && armClear(player,shopper)) return {x:shopper.x,z:shopper.z};
    for(const turn of [0,.36,-.36,.76,-.76]) {
      const loc={x:player.x-Math.sin(yaw+turn)*exchangeDistance,
        z:player.z-Math.cos(yaw+turn)*exchangeDistance};
      if(!armClear(player,loc) || Math.abs(floor(loc.x,loc.z)-floor(player.x,player.z))>.14) continue;
      const dx=loc.x-shopper.x,dz=loc.z-shopper.z,dist=Math.hypot(dx,dz);
      const checks=Math.ceil(dist/.12),bearing=facing(shopper,loc);
      let clear=true;
      for(let i=1;i<=checks;i++) {
        const t=i/checks;
        if(!obstruction(shopper,shopper.x+dx*t,shopper.z+dz*t,bearing,player)) continue;
        clear=false;
        break;
      }
      if(clear) return loc;
    }
    return null;
  }

  function begin(player,time) {
    if(shared || exchange || !nearby(player)) return false;
    const standing={x:player.x,z:player.z,y:floor(player.x,player.z),radius:workerRadius};
    const point=meetingPoint(standing);
    if(!point) return false;
    exchange={point,started:time,posedAt:Infinity,age:0,pace:shopper.speed};
    return true;
  }

  function cancel(event=null) {
    if(exchange) shopper.speed=0;
    exchange=null;
    pickedUp=false;
    body.articulate(0);
    parcel.visible=shared;
    notice=event;
  }

  function carriedPoint(target) {
    return body.figure.localToWorld(target.set(-.244,.957,-.172));
  }

  function holdParcel(person,i,x,y,z,reach,grip) {
    parcel.localToWorld(handsPoint.set(x,y,z));
    person.reachHand(i,handsPoint,reach);
    const hand=person.limbs.hands[i];
    parcel.localToWorld(towardParcel.set(0,.033,0));
    hand.group.parent.worldToLocal(towardParcel).sub(hand.group.position);
    const medial=i===0 ? 1 : -1;
    const twist=Math.atan2(-towardParcel.z*medial,towardParcel.x*medial);
    hand.group.rotation.y=clamp(twist,-1.18,1.18)*reach;
    hand.setGrip(.14+reach*(grip-.14));
  }

  function stowInHand() {
    carriedPoint(parcel.position);
    parcel.rotation.set(-.13,shopper.yaw-.48,.34,"YXZ");
    parcel.visible=true;
    holdParcel(body,0,-.074,.047,.021,.98,.65);
  }

  function tick(dt,time,player) {
    if(!exchange) return false;
    const {point}=exchange;
    const oldX=shopper.x,oldZ=shopper.z;
    const remaining=Math.hypot(point.x-oldX,point.z-oldZ);
    const look=facing(shopper,player);
    const travel=remaining>.024 && !Number.isFinite(exchange.posedAt);
    const aim=travel ? facing(shopper,point) : look;
    shopper.yaw=turnToward(shopper.yaw,aim,dt);
    exchange.pace=damp(exchange.pace,travel ? .91 : 0,9,dt);
    if(travel) {
      const stride=Math.min(remaining,exchange.pace*dt);
      sweepHorizontal(shopper,-Math.sin(aim)*stride,-Math.cos(aim)*stride,
        (x,z)=>!obstruction(shopper,x,z,aim,player));
    }
    const dx=shopper.x-oldX,dz=shopper.z-oldZ;
    shopper.speed=Math.hypot(dx,dz)/dt;
    shopper.distance+=Math.hypot(dx,dz);
    shopper.blocked=null;
    shopper.blockedFor=0;
    shopper.bypass.length=0;
    shopper.lastThreat=false;
    shopper.behavior=travel ? "approaching gift" : "receiving gift";
    placeActor(shopper,dt,player,dx/dt,dz/dt);
    if(!Number.isFinite(exchange.posedAt)) {
      if(!travel && Math.cos(look-shopper.yaw)>.993 && armClear(player,shopper)) {
        exchange.posedAt=time;
      } else if(time-exchange.started>3.20) {
        cancel("blocked");
        return true;
      }
    }
    if(Number.isFinite(exchange.posedAt)) exchange.age=time-exchange.posedAt;
    if(exchange.age>=gestureEnd) {
      cancel();
      stowInHand();
    }
    return true;
  }

  function animate(giver,belt,dt) {
    if(!exchange) return;
    const {age}=exchange;
    const yaw=facing(giver.figure.position,body.figure.position);
    belt.getWorldPosition(beltPoint);
    belt.getWorldQuaternion(beltRotation);
    const bring=smoothstep(age,.28,1.08);
    const pull=smoothstep(age,1.47,2.22);
    const giverWeight=smoothstep(age,.04,.36)*(1-smoothstep(age,1.37,1.82));
    const receiverWeight=smoothstep(age,.56,1.21);
    giver.torsoPivot.rotation.x-=.17*giverWeight;
    body.torsoPivot.rotation.x-=.17*receiverWeight*(1-pull);
    giver.head.rotation.x+=.21*giverWeight;
    body.head.rotation.x+=.25*receiverWeight*(1-pull)+.23*Math.sin(Math.PI*smoothstep(age,1.94,2.77));
    const thanks=smoothstep(age,1.46,1.65)*(1-smoothstep(age,2.36,2.57));
    body.articulate(thanks*(.28+.60*Math.pow(.5+.5*Math.sin(age*34),2)));
    body.lookEyes(-.12*receiverWeight,-.92*receiverWeight*(1-pull),dt);
    giver.figure.updateMatrixWorld(true);
    body.figure.updateMatrixWorld(true);

    const p=giver.figure.position,q=body.figure.position;
    // Give both sets of hands their own face of the same parcel.
    parcelPoint.set(.52*p.x+.48*q.x,Math.max(p.y,q.y)+1.084,.52*p.z+.48*q.z);
    pathStart.copy(beltPoint).lerp(parcelPoint,bring);
    pathStart.y+=.078*Math.sin(bring*Math.PI);
    carriedPoint(parcelPoint);
    parcel.position.copy(pathStart).lerp(parcelPoint,pull);
    baseEuler.set(-.027,yaw,.02,"YXZ");
    aimedRotation.setFromEuler(baseEuler);
    parcel.quaternion.copy(beltRotation).slerp(aimedRotation,bring);
    baseEuler.set(-.13,shopper.yaw-.48,.34,"YXZ");
    parcel.quaternion.slerp(aimedRotation.setFromEuler(baseEuler),pull);
    pickedUp=age>=.29;
    parcel.visible=pickedUp;

    if(giverWeight>0) {
      const openGrip=.59-.19*smoothstep(age,1.30,1.70);
      holdParcel(giver,0,-.087,.059,.051,giverWeight,openGrip);
      const support=giverWeight*smoothstep(age,.57,1.11);
      if(support>0) holdParcel(giver,1,.083,.052,.053,support,openGrip);
    }
    if(receiverWeight>0) {
      const closedGrip=.36+.29*smoothstep(age,1.04,1.46);
      holdParcel(body,0,THREE.MathUtils.lerp(.085,-.074,pull),.047,
        THREE.MathUtils.lerp(-.058,.021,pull),receiverWeight,closedGrip);
      const support=receiverWeight*(1-smoothstep(age,1.53,2.08));
      if(support>0) holdParcel(body,1,-.085,.042,-.060,support,closedGrip);
    }
    if(age>=exchangeAt && !shared) {
      shared=true;
      notice="accepted";
    }
  }

  return {
    nearby,begin,cancel,tick,animate,
    carry() { if(shared && !exchange) stowInHand(); },
    face(player) { return exchange ? facing(player,shopper) : null; },
    active:()=>Boolean(exchange),
    lifted:()=>pickedUp,
    restore(given) { shared=given;cancel(); },
    event() { const event=notice;notice=null;return event; },
    inspect:()=>({stage:exchange ? (Number.isFinite(exchange.posedAt) ? shared ? "accepted" : "offering" : "approach")
      : shared ? "carried" : "idle",
      age:exchange?.age??null,received:shared,point:exchange?.point??null,
      position:parcel.visible ? parcel.position.toArray() : null}),
  };
}
