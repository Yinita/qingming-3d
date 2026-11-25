import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";
import { createGroundedGait } from "./bridge-gait.js";
import { riverWorker } from "./bridge-people.js";
import { circleTouchesBox, sweepHorizontal, workerHeight } from "./bridge-collision.js";

const saveKey="qingming-west-timber-delivered-v1";
const {clamp,damp,lerp,smoothstep}=THREE.MathUtils;
const turnDelta=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const location=(x,z)=>({x,z});
const nodes={
  home:location(-79.76,-47.96),
  court:location(-79.32,-46.72),
  gateWest:location(-78.78,-46.72),
  gateEast:location(-76.24,-46.72),
  alley:location(-76.23,-42.99),
  road:location(-76.22,-41.422),
  courtSouth:location(-79.25,-41.422),
  turn:location(-75.33,-41.42),
  delivery:location(-75.24,-41.11),
};
const links=[
  ["home","court"],["court","gateWest"],["gateWest","gateEast","gate"],
  ["gateEast","alley"],["alley","road"],["court","courtSouth"],
  ["courtSouth","road","footbridge"],["road","turn"],["turn","delivery"],
];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const bays={
  gateWest:location(-79.13,-47.28),
  gateEast:location(-76.03,-47.40),
  courtSouth:location(-79.45,-42.16),
  road:location(-76.02,-40.48),
};
const pickupYaw=0, dropYaw=Math.PI;
const bodyRadius=.293, spanX=.229, spanZ=.142;
const crateY=.854, crateForward=.301;
const pickupTime=1.18, depositTime=1.31;

function routeFrom(start,goal,gate) {
  const distances=new Map([[start,0]]);
  const next=new Map(), remaining=new Set(Object.keys(nodes));
  while(remaining.size) {
    let at, cheapest=Infinity;
    for(const key of remaining) {
      const cost=distances.get(key)??Infinity;
      if(cost<cheapest) {
        at=key;
        cheapest=cost;
      }
    }
    if(!at || at===goal) break;
    remaining.delete(at);
    for(const [a,b,kind] of links) {
      if(kind==="gate" && !gate) continue;
      const to=at===a ? b : at===b ? a : null;
      if(!remaining.has(to)) continue;
      const cost=cheapest+distance(nodes[at],nodes[to])*(kind==="footbridge" ? 1.19 : 1);
      if(cost<(distances.get(to)??Infinity)) {
        distances.set(to,cost);
        next.set(to,at===start ? to : next.get(at));
      }
    }
  }
  return next.get(goal)??null;
}

export function createTimberPorter(parent,city,surface,floor,canStep,gateOpen,stepSound) {
  const root=new THREE.Group();
  root.name="West bank timber errands";
  parent.add(root);
  const worker=riverWorker(root,surface,"timberPorter");
  worker.figure.name="West bank timber porter";
  const raw=surface("tea-wood",0xc9a172,.66,.88);
  const beam=surface("rail-wood",0xa27d56,.62,.93);
  const peg=surface("tea-wood",0x775640,.53,.90);
  const worn=surface("worn-stone",0x9f9d89,.62,.95);
  const twine=new THREE.MeshStandardMaterial({color:0xb9a27c,roughness:.96});
  const iron=new THREE.MeshStandardMaterial({color:0x61594c,roughness:.56,metalness:.36});
  function mesh(group,geometry,mat,x,y,z) {
    const piece=new THREE.Mesh(geometry,mat);
    piece.position.set(x,y,z);
    piece.castShadow=piece.receiveShadow=true;
    piece.layers.enable(1);
    group.add(piece);
    return piece;
  }
  function box(group,mat,w,h,d,x,y,z,bevel=.012) {
    return mesh(group,detailedBox(w,h,d,mat,bevel,x*.13+z*.91),mat,x,y,z);
  }
  function braid(group,points,radius) {
    const profile=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    mesh(group,new THREE.TubeGeometry(profile,21,radius,5,false),twine,0,0,0);
  }
  const shelfHeight=.684;
  const source=new THREE.Vector3(nodes.home.x,.145+shelfHeight,-48.555);
  const sink=new THREE.Vector3(nodes.delivery.x,shelfHeight,-40.51);
  sink.y+=Math.max(0,floor(sink.x,sink.z));
  const shelfBodies=[];
  for(const [i,bed] of [source,sink].entries()) {
    const table=new THREE.Group();
    table.name=i===0 ? "Timber court loading shelf" : "West bridge receiving shelf";
    root.add(table);
    table.position.set(bed.x,bed.y-shelfHeight,bed.z);
    box(table,beam,.672,.084,.414,0,.642,0,.017);
    for(const side of [-1,1]) {
      for(const z of [-.142,.142]) {
        box(table,worn,.104,.071,.113,side*.269,.037,z,.014);
        box(table,beam,.073,.56,.078,side*.269,.347,z,.012);
      }
      box(table,peg,.091,.067,.332,side*.258,.292,0,.011);
    }
    box(table,peg,.544,.073,.080,0,.292,0,.010);
    shelfBodies.push(city.box(table.name,bed.x-.338,bed.x+.338,bed.z-.205,bed.z+.205,table.position.y,bed.y));
  }
  const crate=new THREE.Group();
  crate.name="Porter's timber delivery tray";
  root.add(crate);
  box(crate,raw,.427,.034,.268,0,.022,0,.007);
  for(const side of [-1,1]) {
    for(const i of [0,1]) {
      box(crate,beam,.417,.039,.025,0,.061+i*.049,side*.130,.006);
      box(crate,beam,.023,.041,.255,side*.207,.061+i*.049,0,.006);
    }
    for(const z of [-.108,.108])
      box(crate,peg,.041,.115,.041,side*.184,.076,z,.007);
    for(const z of [-.114,.114]) {
      const tack=mesh(crate,new THREE.CylinderGeometry(.006,.007,.006,8),iron,side*.182,.142,z);
      tack.rotation.x=.09*Math.sin(z*23);
    }
    braid(crate,[[side*.210,.088,-.059],[side*.234,.119,-.041],[side*.244,.143,0],
      [side*.233,.111,.043],[side*.210,.088,.063]],.010);
  }
  for(let i=0;i<4;i++) {
    const packing=box(crate,i%2 ? raw : beam,.318-.034*(i%3),.044+.005*i,.047,-.013+.009*i,.059,
      -.089+i*.054,.005);
    packing.rotation.y=.035*Math.sin(i*9.37);
  }
  for(const z of [-.042,.042]) {
    const packing=box(crate,raw,.275,.047,.055,.006,.102,z,.006);
    packing.rotation.y=-.152;
  }
  braid(crate,[[-.117,.047,-.104],[-.123,.124,-.083],[-.102,.128,.062],[-.099,.047,.103]],.0045);
  braid(crate,[[.101,.044,-.104],[.108,.131,-.076],[.113,.128,.066],[.11,.040,.109]],.0045);

  const body=city.cylinder("Timber porter",nodes.home.x,nodes.home.z,0,workerHeight,bodyRadius);
  body.camera=false;
  const load=city.orientedBox("Timber porter's loaded tray",spanX,spanZ,.168);
  load.camera=false;
  const actor={x:nodes.home.x,z:nodes.home.z,yaw:pickupYaw};
  const palm=new THREE.Vector3(),cameraLook=new THREE.Vector3();
  const handFrame=new THREE.Quaternion();
  const gripFrames=[
    new THREE.Quaternion().setFromEuler(new THREE.Euler(.11,1.43,-.21,"YXZ")),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(.11,-1.43,.21,"YXZ")),
  ];
  const crateFrame=new THREE.Quaternion(), trayOrientation=new THREE.Quaternion();
  const matrix=new THREE.Euler();
  const trial={x:0,z:0,bottom:0,top:0,yaw:0};
  let live=false, stage="waiting", age=0, time=0, speed=0, greetingYaw=0;
  let anchor="home", next=null, yieldTask=null;
  let yields=0, gateTrips=0, footbridgeTrips=0, block=null, speechId=null;
  let lastRoute=null;
  try {if(localStorage.getItem(saveKey)==="done") stage="done";} catch {}

  function laden() {
    return stage==="outbound" || stage==="unloading" || stage==="lifting" && age>.42;
  }
  const floorGait=createGroundedGait(floor,(x,z)=>canStep(x,z,.134,body,.22,load),
    (x,y,z,t,vx,vz)=>{
      stepSound(x,y,z,vx,vz,laden());
      return false;
    });
  worker.figure.position.set(actor.x,floor(actor.x,actor.z),actor.z);

  function trayPose(x,z,y,yaw,output) {
    output.x=x-Math.sin(yaw)*crateForward;
    output.z=z-Math.cos(yaw)*crateForward;
    output.bottom=y+crateY;
    output.top=output.bottom+.168;
    output.yaw=yaw;
  }
  function playerBlocks(player,x,z,y,radius) {
    return distance({x,z},player)<player.radius+radius+.022 &&
      player.y<y+workerHeight && player.y+workerHeight>y;
  }
  function obstacle(x,z,yaw,player) {
    const y=floor(x,z);
    if(player && playerBlocks(player,x,z,y,bodyRadius)) return "player";
    if(player?.cargo && y<player.cargo.top && y+workerHeight>player.cargo.bottom) {
      const c=player.cargo;
      if(circleTouchesBox(x,z,bodyRadius,c.x,c.z,c.halfX,c.halfZ,c.yaw)) return "player";
    }
    if(!canStep(x,z,bodyRadius,body,workerHeight,load)) return "world";
    if(!laden()) return null;
    trayPose(x,z,y,yaw,trial);
    if(player && trial.top>player.y && trial.bottom<player.y+workerHeight &&
      circleTouchesBox(player.x,player.z,player.radius+.022,trial.x,trial.z,spanX,spanZ,yaw)) return "player";
    return city.boxBlocking(trial.x,trial.z,trial.bottom,spanX,spanZ,.168,yaw,body,load) ? "world" : null;
  }
  function clearWalk(to,player) {
    const length=distance(actor,to), n=Math.max(1,Math.ceil(length/.11));
    for(let i=1;i<=n;i++)
      if(obstacle(lerp(actor.x,to.x,i/n),lerp(actor.z,to.z,i/n),actor.yaw,player)) return false;
    return true;
  }
  function passedVisitor(player,rejoin) {
    if(distance(actor,player)>2.1) return true;
    const goal=nodes[next];
    const span=distance(rejoin,goal);
    if(span<.02) return true;
    const dx=(goal.x-rejoin.x)/span,dz=(goal.z-rejoin.z)/span;
    const x=player.x-rejoin.x,z=player.z-rejoin.z;
    const margin=player.radius+bodyRadius+.12, along=x*dx+z*dz;
    return along<-margin || along>span+margin || Math.abs(x*dz-z*dx)>margin;
  }
  function findYieldSpace(player,goal) {
    const span=Math.max(.01,distance(actor,goal));
    const dx=(goal.x-actor.x)/span,dz=(goal.z-actor.z)/span;
    for(const [side,back] of [[1,.12],[-1,.12],[1,.55],[-1,.55]]) {
      const bay=location(actor.x-dx*back-side*dz*.74,actor.z-dz*back+side*dx*.74);
      if(distance(bay,player)>player.radius+bodyRadius+.13 && clearWalk(bay,player))
        return {bay,rejoin:location(actor.x,actor.z)};
    }
    const rejoin=nodes[anchor];
    return {bay:bays[anchor]??rejoin,rejoin,retreat:true};
  }
  function sync() {
    const y=floor(actor.x,actor.z);
    Object.assign(body,{x:actor.x,z:actor.z,bottom:y,top:y+workerHeight,enabled:live});
    load.enabled=live && laden();
    if(load.enabled) trayPose(actor.x,actor.z,y,actor.yaw,load);
  }
  function seatTray() {
    if(stage==="waiting") {
      crate.position.copy(source);
      crate.rotation.set(0,.03,0);
    } else if(stage==="done" || stage==="returning") {
      crate.position.copy(sink);
      crate.rotation.set(0,-.08,0);
    }
  }
  seatTray();

  function prepareJob(player) {
    stage="acknowledging";
    age=0;
    greetingYaw=Math.atan2(actor.x-player.x,actor.z-player.z);
    block=null;
    return gateOpen() ? "timberShort" : "timberBridge";
  }
  function canTalk(player) {
    return live && (stage==="waiting" || stage==="done") &&
      distance(actor,player)>.55 && distance(actor,player)<1.78;
  }
  function completeLeg() {
    const link=links.find(([a,b])=>(a===anchor && b===next)||(a===next && b===anchor));
    if(link?.[2]==="gate") gateTrips++;
    if(link?.[2]==="footbridge") footbridgeTrips++;
    if(link?.[2]) lastRoute=link[2];
    anchor=next;
    next=null;
    return anchor;
  }
  function desired(player) {
    if(stage!=="outbound" && stage!=="returning") return null;
    const goal=stage==="outbound" ? "delivery" : "home";
    if(anchor===goal) {
      age=0;
      speed=0;
      if(goal==="delivery") {
        stage="unloading";
        speechId="timberArrived";
      } else {
        stage="done";
      }
      return null;
    }
    const gate=gateOpen();
    if(!next) next=routeFrom(anchor,goal,gate);
    if(next && distance(actor,nodes[next])<.045 && !yieldTask) {
      completeLeg();
      return null;
    }
    if(!next) return null;
    const to=nodes[next];
    const remaining=Math.max(.001,distance(actor,to));
    const look=Math.min(.45,remaining);
    const dx=(to.x-actor.x)/remaining,dz=(to.z-actor.z)/remaining;
    const peek=obstacle(actor.x+dx*look,actor.z+dz*look,actor.yaw,player);
    if(!yieldTask && peek==="player") {
      yieldTask=findYieldSpace(player,to);
      yields++;
    }
    if(yieldTask) {
      block="player";
      const task=yieldTask;
      if(task.rejoinNow) {
        if(distance(actor,task.rejoin)<.100) yieldTask=null;
        else return task.rejoin;
      } else if(distance(actor,task.bay)>.10) {
        // First withdraw along the same centre line, then move into the bay
        // outside the handrail. A loaded carrier never turns in the gap.
        if(task.retreat && distance(actor,task.rejoin)>.10 && !task.atApproach) return task.rejoin;
        task.atApproach=true;
        return task.bay;
      } else if(passedVisitor(player,task.rejoin) && clearWalk(task.rejoin,player)) {
        task.rejoinNow=true;
      }
      return null;
    }
    block=peek;
    if(peek==="world" && !gate && ((anchor==="gateWest" && next==="gateEast") ||
      (anchor==="gateEast" && next==="gateWest"))) {
      next=null;
      return nodes[anchor];
    }
    return peek ? null : to;
  }

  function frame(dt,player,attend) {
    if(!live) return null;
    time+=dt;
    age+=dt;
    const wasX=actor.x,wasZ=actor.z;
    const to=desired(player);
    let desiredYaw=actor.yaw;
    if(stage==="acknowledging") desiredYaw=greetingYaw;
    else if(stage==="turning" || stage==="lifting") desiredYaw=pickupYaw;
    else if(stage==="unloading") desiredYaw=dropYaw;
    else if(to && !yieldTask) desiredYaw=Math.atan2(actor.x-to.x,actor.z-to.z);
    else if(stage==="waiting" || stage==="done") desiredYaw=.67;
    const direction=floorGait.steer(dt,actor.yaw,desiredYaw,speed,laden());
    if(!obstacle(actor.x,actor.z,direction,null)) actor.yaw=direction;
    const remaining=to ? distance(actor,to) : 0;
    const velocity=to ? (yieldTask ? .59 : laden() ? 1.14 : 1.36)*lerp(.32,1,smoothstep(remaining,.05,.44)) : 0;
    speed=damp(speed,velocity,10,dt);
    if(to && remaining>.001) {
      const travel=Math.min(remaining,speed*dt);
      sweepHorizontal(actor,(to.x-actor.x)*travel/remaining,(to.z-actor.z)*travel/remaining,
        (x,z)=>!obstacle(x,z,actor.yaw,player));
    }
    const vx=(actor.x-wasX)/dt,vz=(actor.z-wasZ)/dt;
    floorGait.update(dt,time,actor.x,actor.z,actor.yaw,vx,vz,0,desiredYaw);
    const y=floorGait.rootHeight(actor.x,actor.z);
    worker.figure.position.set(actor.x,y,actor.z);
    worker.figure.rotation.y=actor.yaw;
    worker.walkBody(floorGait.phase()-Math.PI*.5,Math.hypot(vx,vz)>.085,false,dt);
    worker.poseFeet(floorGait.feet,floor,actor.x,y,actor.z,actor.yaw);

    worker.torsoPivot.position.z=0;
    let weight=0;
    if(stage==="lifting" || stage==="unloading" || stage==="outbound") {
      const put=stage==="unloading";
      const motion=stage==="outbound" ? 1 : smoothstep(age,.20,put ? 1.0 : .91);
      const pose=put ? 1-motion : motion;
      const effort=stage==="outbound" ? .012 : Math.sin(motion*Math.PI);
      const rhythm=smoothstep(speed,.12,1.14);
      worker.torsoPivot.position.z=-.055*pose-.083*effort;
      worker.torsoPivot.rotation.x-=.092*pose+.22*effort;
      trayPose(actor.x,actor.z,y,actor.yaw,trial);
      const table=put ? sink : source;
      const shake=.010*Math.sin(floorGait.phase()*2.0)*rhythm;
      crate.position.set(lerp(table.x,trial.x,pose),lerp(table.y,trial.bottom+shake,pose)+.085*effort,
        lerp(table.z,trial.z,pose));
      crateFrame.setFromEuler(matrix.set(.044*pose,actor.yaw,.032*Math.sin(floorGait.phase())*rhythm,"YXZ"));
      trayOrientation.setFromEuler(matrix.set(0,put ? -.08 : .03,0));
      crate.quaternion.copy(trayOrientation).slerp(crateFrame,pose);
      weight=stage==="outbound" ? 1 : put ? 1-smoothstep(age,.90,1.18) : smoothstep(age,.03,.48);
      for(const [i,grip] of gripFrames.entries()) {
        crate.localToWorld(palm.set(i ? .235 : -.235,.123,.002));
        handFrame.copy(crate.quaternion).multiply(grip);
        worker.graspProp(i,palm,handFrame,weight);
      }
    }
    if(stage==="acknowledging" && (age>.77 && Math.abs(turnDelta(actor.yaw,greetingYaw))<.29 || age>1.31)) {
      stage="turning";
      age=0;
    }
    if(stage==="turning" && (age>.35 && Math.abs(turnDelta(actor.yaw,pickupYaw))<.14 || age>1.42)) {
      stage="lifting";
      age=0;
    }
    if(stage==="lifting" && age>=pickupTime) {
      stage="outbound";
      age=0;
    }
    if(stage==="unloading" && age>=depositTime) {
      stage="returning";
      seatTray();
      try {localStorage.setItem(saveKey,"done");} catch {}
    }
    const span=distance(actor,player);
    const greeting=stage==="acknowledging";
    if(span<2.20 && (yieldTask || greeting || stage==="waiting" || stage==="done" || stage==="unloading"))
      attend(worker,player.x,player.y+1.47,player.z,dt,greeting ? .128*Math.sin(Math.PI*smoothstep(age,.30,.88)) :
        yieldTask ? .024 : .012);
    else {
      cameraLook.set(actor.x-.9*Math.sin(actor.yaw),y+(weight>.60 ? 1.26 : 1.47),actor.z-.9*Math.cos(actor.yaw));
      attend(worker,cameraLook.x,cameraLook.y,cameraLook.z,dt,0);
    }
    worker.face.blink(Math.max(0,1-Math.abs((time+.75)%4.21-.13)/.095));
    worker.poseSleeves();
    sync();
    const notice=span<3.5 ? speechId : null;
    speechId=null;
    return notice;
  }

  return {
    frame,
    action(player) {
      if(!canTalk(player)) return null;
      return stage==="waiting" ? "请伙计送木料 E" : "问搬料伙计 E";
    },
    talk(player) {return canTalk(player) ? (stage==="done" ? "timberFinished" : prepareJob(player)) : null;},
    speech(dialogue,dt) {
      worker.face.speak(dialogue.id?.startsWith("timber") ? dialogue.shape : null,dt);
    },
    crossing() {
      return live && ((anchor==="gateWest" && next==="gateEast") ||
        (anchor==="gateEast" && next==="gateWest") ||
        Math.abs(actor.x+77.60)<.74 && Math.abs(actor.z+46.72)<.68);
    },
    show(on) {
      live=root.visible=on;
      for(const shelf of shelfBodies) shelf.enabled=on;
      sync();
    },
    reset() {
      stage="waiting";
      age=time=speed=yields=gateTrips=footbridgeTrips=0;
      anchor="home";
      next=yieldTask=lastRoute=block=speechId=null;
      Object.assign(actor,nodes.home,{yaw:pickupYaw});
      worker.figure.position.set(actor.x,floor(actor.x,actor.z),actor.z);
      worker.figure.rotation.y=actor.yaw;
      floorGait.reset();
      seatTray();
      sync();
      try {localStorage.removeItem(saveKey);} catch {}
    },
    inspect() {return {stage,position:[actor.x,floor(actor.x,actor.z),actor.z],yaw:actor.yaw,anchor,next,
      block,yields,gateTrips,footbridgeTrips,lastRoute,carrying:laden(),tray:crate.position.toArray(),
      finished:stage==="done" || stage==="returning",gait:floorGait.inspect()};},
  };
}
