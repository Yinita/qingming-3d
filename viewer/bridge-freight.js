import * as THREE from "three";
import { circleTouchesBox, rectanglesOverlap,workerHeight,workerRadius } from "./bridge-collision.js";
import { buildFreightModel,cargoFloor,passengerBench,wheelRadius,wheelTrack,wheelTyreWidth } from "./bridge-freight-model.js";

const route=[
  [-45.20,-35.60],[-40.35,-35.60],[-39.40,-34.85],[-39.40,-34.32],
  [-40.35,-33.65],[-45.20,-33.65],[-46.30,-34.32],[-46.30,-34.85],
];
const stops=[
  {at:.28125,name:"蒸糕摊后街"},
  {at:.83125,name:"北巷"},
];
const {clamp,damp,lerp,smoothstep}=THREE.MathUtils;
const wrap=(x,n)=>((x%n)+n)%n;
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const rearStep=.901, drawbar=1.70;
const standBack=[1.34,1.54,1.73];
const maxPace=.98;

function traceRoute() {
  const path=new THREE.CatmullRomCurve3(route.map(([x,z])=>new THREE.Vector3(x,0,z)),true,"catmullrom",.33);
  path.arcLengthDivisions=550;
  const length=path.getLength();
  const count=800;
  const team=Array.from({length:count},(_,i)=>path.getPointAt(i/count));
  const axles=[],axle=team[count-65].clone(),heading=new THREE.Vector3();
  // Pull the axle along the drawbar constraint before storing the closed loop.
  // The cart follows a tighter line than the donkey, with negligible sideways slip.
  for(let pass=0;pass<3;pass++) for(const head of team) {
    heading.subVectors(head,axle).setLength(drawbar);
    axle.copy(head).sub(heading);
    if(pass===2) axles.push(axle.clone());
  }
  function sample(points,s,target) {
    const index=wrap(s,length)/length*count;
    const a=Math.floor(index);
    return target.copy(points[a]).lerp(points[(a+1)%count],index-a);
  }
  const look=new THREE.Vector3(),back=new THREE.Vector3();
  return {length,axle(s,out){return sample(axles,s,out);},animal(s,out){
    sample(team,s,out);
    sample(team,s+.033,look);
    sample(team,s-.033,back);
    return Math.atan2(back.x-look.x,back.z-look.z);
  }};
}

const cartRoute=traceRoute();
const frameOrigin=new THREE.Vector3(), horseOrigin=new THREE.Vector3();
const hoofPlace=new THREE.Vector3(), footFrom=new THREE.Vector3(), footTo=new THREE.Vector3();
const seatWorld=new THREE.Vector3(), stepWorld=new THREE.Vector3(), stepStart=new THREE.Vector3();
const scratch=new THREE.Vector3();

function contactShadows(parent,terrain) {
  const spots=8, pointsPerSpot=4;
  const geometry=new THREE.BufferGeometry();
  const positions=new THREE.BufferAttribute(new Float32Array(spots*pointsPerSpot*3),3);
  const colors=new THREE.BufferAttribute(new Float32Array(spots*pointsPerSpot*4),4);
  const texels=[],indices=[];
  const corners=[[-1,-1],[1,-1],[-1,1],[1,1]];
  for(let i=0;i<spots;i++) {
    texels.push(0,0,1,0,0,1,1,1);
    const a=i*pointsPerSpot;
    indices.push(a,a+2,a+1,a+1,a+2,a+3);
  }
  geometry.setAttribute("position",positions.setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color",colors.setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(texels,2));
  geometry.setIndex(indices);
  const image=document.createElement("canvas");
  image.width=image.height=32;
  const pen=image.getContext("2d");
  const shade=pen.createRadialGradient(16,16,0,16,16,16);
  shade.addColorStop(0,"rgba(255,255,255,0.98)");
  shade.addColorStop(.43,"rgba(255,255,255,0.51)");
  shade.addColorStop(1,"rgba(255,255,255,0)");
  pen.fillStyle=shade;
  pen.fillRect(0,0,32,32);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({
    color:0x31241a,transparent:true,vertexColors:true,depthWrite:false,map:new THREE.CanvasTexture(image),
    polygonOffset:true,polygonOffsetFactor:-1,
  }));
  mesh.frustumCulled=false;
  mesh.name="Freight tyre, hoof and undercarriage contact shadows";
  parent.add(mesh);
  return {
    place(spot,x,z,yaw,halfWidth,halfLength,alpha) {
      const c=Math.cos(yaw),s=Math.sin(yaw);
      for(const [i,[u,v]] of corners.entries()) {
        const a=spot*pointsPerSpot+i;
        const px=x+c*u*halfWidth+s*v*halfLength,pz=z-s*u*halfWidth+c*v*halfLength;
        positions.setXYZ(a,px,terrain(px,pz)+.006,pz);
        colors.setXYZW(a,1,1,1,alpha);
      }
    },
    update() { positions.needsUpdate=colors.needsUpdate=true; },
  };
}

export function createFreightCart(parent,city,surface,terrain) {
  const root=new THREE.Group();
  root.name="East bank market freight cart";
  parent.add(root);
  const shadows=contactShadows(root,terrain);
  const {frame,chassis,wheels,animal,workDriver,speech}=buildFreightModel(root,surface);
  const stand=[-1,1].map(side=>({x:0,y:0,z:0,yaw:0,side,pitch:0}));
  const grip=new THREE.Vector3();
  root.traverse(object=>object.layers.enable(1));
  const exitReservation=city.cylinder("Freight cart boarding clearance",0,0,0,0,workerRadius);
  exitReservation.camera=false;
  exitReservation.enabled=false;
  const rider={y:0,feetY:0,facing:0,seat:0};
  const sections=[
    {name:"Freight cart wheels and bed",fore:.082,halfX:.743,halfZ:.837,height:1.14,bottom:.012},
    {name:"Freight cart draught shafts",fore:-.985,halfX:.388,halfZ:.456,height:.24,bottom:.48},
    {name:"Cart donkey",fore:-.073,halfX:.286,halfZ:.725,height:1.51,bottom:.016,animal:true},
  ];
  const assembly=Symbol("freight cart");
  for(const s of sections) {
    s.solid=city.orientedBox(s.name,s.halfX,s.halfZ,s.height);
    s.solid.assembly=assembly;
  }
  const poses=sections.map(()=>({}));
  const wheelPoints=wheels.map(()=>new THREE.Vector3());
  const wheelLast=wheels.map(()=>new THREE.Vector3());
  const roll=[0,0],wheelError=[0,0],hoofError=[0,0,0,0];
  let axleSideSlip=0;
  let distance=stops[0].at*cartRoute.length, speed=0, travelled=0, loops=0;
  let idle=0, stop=0, next=1, nextDistance=stops[1].at*cartRoute.length;
  let passenger="ground", transferAt=0, originYaw=0, contactY=0, asked=false;
  let awake=false, blocked=null, seatsTaken=0;
  let exitPoint=null;
  let hasWheels=false;
  let cartYaw=0,lastPassengerFacing=0,boardYaw=0,transferProgress=0;
  const footStep=new THREE.Vector3(), footDeck=new THREE.Vector3();

  function at(s) {
    cartRoute.axle(s,frameOrigin);
    const animalYaw=cartRoute.animal(s,horseOrigin);
    const heading=Math.atan2(frameOrigin.x-horseOrigin.x,frameOrigin.z-horseOrigin.z);
    for(const [i,spec] of sections.entries()) {
      const origin=spec.animal ? horseOrigin : frameOrigin;
      const yaw=spec.animal ? animalYaw : heading;
      const x=origin.x+Math.sin(yaw)*spec.fore,z=origin.z+Math.cos(yaw)*spec.fore;
      const bottom=terrain(x,z)+spec.bottom;
      Object.assign(poses[i],{x,z,yaw,bottom,top:bottom+spec.height});
    }
    return {heading,animalYaw};
  }

  const sweptLane=[];
  const laneSamples=Math.ceil(cartRoute.length/.12);
  for(let i=0;i<laneSamples;i++) {
    at(i*cartRoute.length/laneSamples);
    for(const [j,{halfX,halfZ}] of sections.entries()) {
      const {x,z,yaw}=poses[j];
      sweptLane.push({x,z,yaw,halfX,halfZ});
    }
  }

  function obstacle(atDistance,body,anticipate=false) {
    at(atDistance);
    for(const [i,spec] of sections.entries()) {
      const {x,z,yaw,bottom,top}=poses[i];
      const wall=city.boxBlocking(x,z,bottom,spec.halfX,spec.halfZ,top-bottom,yaw,spec.solid);
      if(wall) return wall.name;
      if(!body || passenger!=="ground") continue;
      const margin=anticipate ? .091 : .019;
      if(bottom<body.y+workerHeight && top>body.y &&
          circleTouchesBox(body.x,body.z,body.radius+margin,x,z,spec.halfX,spec.halfZ,yaw)) return "player";
      const c=body.cargo;
      if(c && c.bottom<top && c.top>bottom &&
        rectanglesOverlap(x,z,spec.halfX,spec.halfZ,yaw,c.x,c.z,c.halfX,c.halfZ,c.yaw)) return "player cargo";
    }
    return null;
  }

  function trajectory(leg,s,target) {
    const yaw=cartRoute.animal(s,target);
    const cos=Math.cos(yaw), sin=Math.sin(yaw);
    target.x+=leg.hip.x*cos+leg.hip.z*sin;
    target.z+=-leg.hip.x*sin+leg.hip.z*cos;
    target.y=.072+Math.max(terrain(target.x,target.z),
      terrain(target.x-.067*sin,target.z-.067*cos),terrain(target.x+.024*sin,target.z+.024*cos));
    return target;
  }

  function draw(time,rollWheels,recordWheel) {
    const {heading,animalYaw}=at(distance);
    cartYaw=heading;
    for(const [i,s] of sections.entries()) Object.assign(s.solid,poses[i]);
    const c=Math.cos(heading),s=Math.sin(heading);
    for(const [i,p] of wheelPoints.entries()) {
      const x=wheelTrack*(i*2-1);
      p.set(frameOrigin.x+c*x,0,frameOrigin.z-s*x);
      p.y=terrain(p.x,p.z);
    }
    const [left,right]=wheelPoints;
    shadows.place(0,frameOrigin.x,frameOrigin.z,heading,.744,.87,.40);
    shadows.place(1,horseOrigin.x,horseOrigin.z,animalYaw,.45,.82,.27);
    const bank=Math.asin(clamp((right.y-left.y)/(2*wheelTrack),-.27,.27));
    // The tyre contact points share one rigid axle; uneven ground rocks the chassis.
    const axleHeight=(left.y+right.y)*.5+wheelRadius*Math.cos(bank);
    const front=terrain(frameOrigin.x-.68*s,frameOrigin.z-.68*c);
    const rear=terrain(frameOrigin.x+.65*s,frameOrigin.z+.65*c);
    frame.position.set(frameOrigin.x,axleHeight,frameOrigin.z);
    frame.rotation.y=heading;
    chassis.rotation.set(clamp(Math.atan2(front-rear,1.33),-.13,.13),0,bank,"ZXY");
    if(rollWheels && hasWheels) {
      const dx=(left.x+right.x-wheelLast[0].x-wheelLast[1].x)*.5;
      const dz=(left.z+right.z-wheelLast[0].z-wheelLast[1].z)*.5;
      axleSideSlip+=Math.abs(dx*c-dz*s);
    }
    for(const [i,wheel] of wheels.entries()) {
      const p=wheelPoints[i],old=wheelLast[i];
      if(rollWheels && hasWheels) {
        const advance=(p.x-old.x)*(-s)+(p.z-old.z)*(-c);
        roll[i]-=advance/wheelRadius;
        if(advance>.0005) recordWheel?.(i,old,p,time,wheelTyreWidth);
      }
      old.copy(p);
      wheel.rotation.x=roll[i];
      shadows.place(2+i,p.x,p.z,heading,.089,.178,.79);
    }
    hasWheels=true;

    const pace=clamp(speed/maxPace,0,1);
    const stride=.53,stance=.72,lift=.065;
    const stridePhase=distance/stride;
    const animalY=terrain(horseOrigin.x,horseOrigin.z);
    animal.horse.position.set(horseOrigin.x,animalY+.014*pace*Math.sin(stridePhase*4*Math.PI),horseOrigin.z);
    animal.horse.rotation.y=animalYaw;
    root.updateMatrixWorld(true);
    for(const [i,leg] of animal.legs.entries()) {
      const phase=wrap(stridePhase+[0,.28,.50,.79][i],1);
      const heel=distance+(.5*stance-phase)*stride;
      trajectory(leg,heel,footFrom);
      if(phase>stance) {
        const raise=(phase-stance)/(1-stance);
        trajectory(leg,heel+stride,footTo);
        footFrom.lerp(footTo,smoothstep(raise,0,1));
        footFrom.y=Math.max(footFrom.y,terrain(footFrom.x,footFrom.z)+.072)+lift*smoothstep(pace,.02,.25)*Math.sin(Math.PI*raise);
      }
      hoofPlace.copy(footFrom);
      animal.horse.worldToLocal(hoofPlace);
      animal.poseLeg(leg,hoofPlace);
      animal.horse.localToWorld(scratch.copy(leg.hoof.position));
      hoofError[i]=scratch.y-.033-terrain(scratch.x,scratch.z);
      const shade=1-smoothstep(hoofError[i],0,.09);
      shadows.place(4+i,scratch.x,scratch.z,animalYaw,.098,.139,.59*shade);
    }
    shadows.update();
    animal.animate(time,pace,stridePhase*2*Math.PI);
    workDriver(time,pace);
    root.updateMatrixWorld(true);
    for(const [i,w] of wheels.entries()) {
      w.getWorldPosition(scratch);
      wheelError[i]=scratch.y-wheelRadius*Math.cos(bank)-terrain(wheelPoints[i].x,wheelPoints[i].z);
    }
  }

  function access(x,z) {
    return Math.hypot(x-frame.position.x,z-frame.position.z)<4;
  }

  function standings(player,walkable,fromGround) {
    const result=[];
    for(const z of standBack) {
      for(const x of [0,-.26,.26]) {
        chassis.localToWorld(scratch.set(x,0,z));
        const p={x:scratch.x,z:scratch.z};
        if(!walkable(p.x,p.z) || city.blocking(p.x,p.z,terrain(p.x,p.z),workerRadius+.02,workerHeight,sections[0].solid)) continue;
        if(fromGround && Math.hypot(player.x-p.x,player.z-p.z)>.78) continue;
        let clear=true;
        const from=fromGround ? player : chassis.localToWorld(stepWorld.set(0,0,rearStep+.15));
        for(let i=0;i<=5;i++) {
          const t=i/5, px=lerp(from.x,p.x,t), pz=lerp(from.z,p.z,t);
          if(!walkable(px,pz) || city.blocking(px,pz,terrain(px,pz),workerRadius,workerHeight,sections[0].solid)) {
            clear=false;break;
          }
        }
        if(clear) result.push(p);
      }
    }
    return result;
  }

  function action(player,walkable,withCrate) {
    if(passenger==="mounting" || passenger==="dismounting") return null;
    if(passenger==="seated") return stop===null ? "到站下车 X" : "下货车 X";
    if(!access(player.x,player.z) || stop===null) return null;
    chassis.worldToLocal(scratch.set(player.x,frame.position.y,player.z));
    if(scratch.z<1.11 || Math.abs(scratch.x)>.69 || !standings(player,walkable,true).length) return null;
    return withCrate ? "放下箱子后乘车" : "从后踏板上车 X";
  }

  function extendStop() {
    if(stop!==null) idle=0;
  }
  function use(player,walkable,withCrate,time) {
    if(!action(player,walkable,withCrate) || withCrate) return null;
    if(passenger==="seated" && stop===null) {
      asked=true;
      return "已喊车夫在下一站等候。";
    }
    originYaw=player.yaw;
    boardYaw=originYaw;
    lastPassengerFacing=originYaw;
    transferAt=time;
    if(passenger==="seated") {
      exitPoint=standings(player,walkable,false)[0];
      if(!exitPoint) return "踏板后有人，等让出空位再下车。";
      const y=terrain(exitPoint.x,exitPoint.z);
      Object.assign(exitReservation,{...exitPoint,bottom:y,top:y+workerHeight,enabled:true});
      passenger="dismounting";
      return "扶住车沿，从后踏板下车。";
    }
    passenger="mounting";
    awake=true;
    stepStart.set(player.x,terrain(player.x,player.z),player.z);
    return "坐上后座。到站按 X 下车。";
  }

  function posePassenger(player,time) {
    const goingUp=passenger==="mounting";
    const t=passenger==="seated" ? 1 : clamp((time-transferAt)/(goingUp ? 1.28 : 1.12),0,1);
    const progress=passenger==="dismounting" ? 1-t : t;
    transferProgress=progress;
    chassis.localToWorld(seatWorld.set(0,passengerBench.y,passengerBench.z));
    chassis.localToWorld(stepWorld.set(0,.049,rearStep));
    const base=passenger==="dismounting" ? exitPoint : stepStart;
    const baseY=passenger==="dismounting" ? terrain(base.x,base.z) : stepStart.y;
    const first=smoothstep(progress,0,.46),second=smoothstep(progress,.46,1);
    player.x=lerp(lerp(base.x,stepWorld.x,first),seatWorld.x,second);
    player.z=lerp(lerp(base.z,stepWorld.z,first),seatWorld.z,second);
    const stepY=stepWorld.y+.01;
    const standY=lerp(baseY,stepY,first)+.079*Math.sin(Math.PI*first);
    chassis.localToWorld(scratch.set(0,cargoFloor,passengerBench.z-.13));
    contactY=lerp(standY,scratch.y,second);
    rider.seat=smoothstep(progress,.66,1);
    rider.feetY=contactY;
    rider.y=lerp(contactY,seatWorld.y-.685,rider.seat)-.091*Math.sin(Math.PI*first);
    rider.facing=originYaw+angle(cartYaw,originYaw)*smoothstep(progress,.16,.91);
    player.yaw+=angle(rider.facing,lastPassengerFacing);
    lastPassengerFacing=rider.facing;
    if(goingUp && t===1) {
      passenger="seated";
      seatsTaken++;
      idle=Math.min(idle,4.1);
    }
    if(passenger==="dismounting" && t===1) {
      passenger="ground";
      exitReservation.enabled=false;
      return "landed";
    }
  }

  function update(dt,time,player,body,requestedDepot=null,recordWheel) {
    if(!awake && Math.hypot(player.x-frame.position.x,player.z-frame.position.z)>10) return;
    if(access(player.x,player.z)) awake=true;
    if(stop!==null && awake) {
      const transfer=passenger==="mounting" || passenger==="dismounting";
      if(!transfer && requestedDepot!==stop) idle+=dt;
      if(requestedDepot===stop) idle=0;
      if(idle>=(asked ? 18 : passenger==="seated" ? 5.5 : 9) && !transfer) {
        stop=null;
        asked=false;
      }
    }
    if(stop===null) {
      const horizon=clamp(.29+speed*.49,.29,.78);
      const remaining=nextDistance-distance;
      blocked=obstacle(distance+Math.min(remaining,horizon),body,true);
      const turnA=at(distance).heading,turnB=at(distance+.34).heading;
      const turning=Math.abs(angle(turnB,turnA));
      const requested=blocked ? 0 : Math.min(maxPace/(1+turning*.61),Math.sqrt(Math.max(0,2*1.24*remaining)));
      speed=damp(speed,requested,blocked ? 13 : 5.1,dt);
      const step=Math.min(remaining,speed*dt);
      const collision=obstacle(distance+step,body);
      if(collision) {
        speed=0;
        blocked=collision;
      } else if(step>0) {
        distance+=step;
        travelled+=step;
      }
      if(nextDistance-distance<.005 && !blocked) {
        distance=nextDistance;
        stop=next;
        idle=0;
        speed=0;
        next=(next+1)%stops.length;
        if(stop===0) loops++;
        nextDistance=(Math.floor(distance/cartRoute.length)+Number(next===0)+stops[next].at)*cartRoute.length;
      }
    } else {
      speed=0;
      blocked=null;
    }
    draw(time,true,recordWheel);
    if(passenger!=="ground") return posePassenger(player,time);
  }

  function reset() {
    passenger="ground";
    exitReservation.enabled=false;
    axleSideSlip=0;
    distance=stops[0].at*cartRoute.length;
    speed=travelled=loops=idle=seatsTaken=0;
    roll.fill(0);
    stop=0;
    next=1;
    nextDistance=stops[1].at*cartRoute.length;
    awake=asked=hasWheels=false;
    blocked=exitPoint=null;
    draw(0,false);
  }

  function feet() {
    const base=passenger==="dismounting" ? exitPoint : stepStart;
    const c=Math.cos(boardYaw), s=Math.sin(boardYaw);
    for(const [i,foot] of stand.entries()) {
      const {side}=foot;
      const toStep=smoothstep(transferProgress,.016+i*.19,.32+i*.19);
      const toDeck=smoothstep(transferProgress,.40+i*.19,.74+i*.19);
      chassis.localToWorld(footStep.set(side*.125,.056,rearStep));
      chassis.localToWorld(footDeck.set(side*.123,cargoFloor,passengerBench.z-.293));
      const x=base.x+c*side*.112,z=base.z-s*side*.112;
      foot.x=lerp(lerp(x,footStep.x,toStep),footDeck.x,toDeck);
      foot.z=lerp(lerp(z,footStep.z,toStep),footDeck.z,toDeck);
      const rise=.113*Math.sin(Math.PI*toStep)+.086*Math.sin(Math.PI*toDeck);
      foot.y=lerp(lerp(terrain(x,z),footStep.y,toStep),footDeck.y,toDeck)+rise;
      foot.yaw=boardYaw+angle(rider.facing,boardYaw)*toStep;
      foot.pitch=-.12*Math.sin(Math.PI*toStep);
    }
    return stand;
  }

  reset();
  return {root,rider,use,action,feet,reset,update,extendStop,
    speech,
    status() {
      if(stop!==null) return stops[stop].name+" · 已靠站";
      return "下一站 "+stops[next].name+(blocked ? " · 让行中" : " · 行驶中");
    },
    deferTransfer(dt) { transferAt+=dt; },
    depot:()=>stop,
    loadingPoint(target) { return chassis.localToWorld(target.set(0,cargoFloor+.018,-.069)); },
    stopPoint(index,target,lateral=0,rear=1.44) {
      const s=stops[index].at*cartRoute.length;
      const mark=cartRoute.axle(s,target);
      cartRoute.animal(s,scratch);
      const yaw=Math.atan2(mark.x-scratch.x,mark.z-scratch.z);
      mark.x+=Math.cos(yaw)*lateral+Math.sin(yaw)*rear;
      mark.z+=-Math.sin(yaw)*lateral+Math.cos(yaw)*rear;
      mark.y=terrain(mark.x,mark.z);
      return mark;
    },
    latchPoint(target) { return chassis.localToWorld(target.set(0,0,1.38)); },
    outsideLane(point,radius) {
      return sweptLane.every(p=>!circleTouchesBox(point.x,point.z,radius+.13,p.x,p.z,p.halfX,p.halfZ,p.yaw));
    },
    cargoAttitude(target) { return chassis.getWorldQuaternion(target); },
    active:()=>passenger!=="ground",
    grounding(x,z) {
      chassis.worldToLocal(scratch.set(x,contactY,z));
      if(scratch.z>=rearStep-.075 && scratch.z<=rearStep+.081 && Math.abs(scratch.x)<.275) return footStep.y;
      if(scratch.z<rearStep-.075 && scratch.z>-.70 && Math.abs(scratch.x)<.46) return footDeck.y;
      return terrain(x,z);
    },
    grip(side) {
      return chassis.localToWorld(grip.set((side ? 1 : -1)*.468,passengerBench.y+.116,passengerBench.z-.110));
    },
    inspect(player,walkable) {
      return {x:frame.position.x,y:frame.position.y,z:frame.position.z,yaw:cartYaw,
        horse:animal.horse.position.toArray(),speed,travelled,loops,passenger,seatsTaken,awake,
        stop:stop===null ? null : stops[stop].name,next:stops[next].name,blocked,
        rider:passenger==="ground" ? null : {...rider},
        wheels:roll.slice(),wheelContacts:wheelPoints.map(p=>p.toArray()),wheelError:wheelError.slice(),hoofClearance:hoofError.slice(),axleSideSlip,
        access:stop===null ? [] : standings(player,walkable,false)};
    },
  };
}
