import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sweepHorizontal,workerHeight,workerRadius } from "./bridge-collision.js";
import { createGroundedGait } from "./bridge-gait.js";
import { detailedBox } from "./bridge-look.js";
import { riverWorker } from "./bridge-people.js";
import { gardenBounds } from "./bridge-west-bank.js";

const {lerp,smoothstep}=THREE.MathUtils;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const facing=(a,b)=>Math.atan2(a.x-b.x,a.z-b.z);
const turn=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const radius=.277, workZ=-31.475, bin={x:-80.89,z:-29.91};
const benchHeight=.428, carryTime=1.55, unloadTime=1.48, gripRise=.075;

function produceCrate(parent,city,surface,floor,crops) {
  const frame=new THREE.Group();
  frame.name="Harvest packing stand and produce crate";
  const y=floor(bin.x,bin.z);
  frame.position.set(bin.x,y,bin.z);
  parent.add(frame);
  const elm=surface("rail-wood",0xb09368,.78,.93);
  const rough=surface("tea-wood",0xbda278,.87,.85);
  const seam=surface("tea-wood",0x826446,.75,.98);
  const hemp=new THREE.MeshStandardMaterial({color:0x917655,roughness:.88});
  const boards=[], supports=[], cords=[];
  function add(parts,w,h,d,mat,x,y,z,r=.010) {
    parts.push(detailedBox(w,h,d,mat,r,(x+y+z)*5).translate(x,y,z));
  }
  for(const x of [-.248,.248]) {
    for(const z of [-.161,.161]) {
      add(supports,.060,benchHeight,.069,elm,x,benchHeight*.5,z);
      add(supports,.084,.046,.088,elm,x,.037,z);
    }
    add(supports,.068,.064,.378,elm,x,.254,0);
  }
  add(supports,.577,.050,.462,elm,0,benchHeight-.025,0);
  for(const z of [-.162,.162]) add(supports,.569,.067,.044,elm,0,.352,z);
  const width=.487,depth=.339;
  for(let i=0;i<4;i++) add(boards,width,.026,.083,rough,0,benchHeight+.013,(i-1.5)*.084,.005);
  for(const x of [-.234,.234]) {
    for(const z of [-.160,.160]) add(supports,.036,.179,.031,elm,x,benchHeight+.089,z,.005);
    for(const at of [.042,.102,.154]) add(boards,.025,.041,depth,rough,x,benchHeight+at,0,.004);
  }
  for(const z of [-.167,.167])
    for(const at of [.042,.102,.154]) add(boards,width,.042,.022,rough,0,benchHeight+at,z,.0046);
  const lower=new THREE.Vector3(), upper=new THREE.Vector3();
  for(const side of [-1,1]) {
    const points=[[.004,.106,-.106],[.032,.118,-.084],[.054,.151,-.044],[.058,.171,0],
      [.054,.151,.044],[.032,.118,.084],[.004,.106,.106]].map(([dx,dy,z])=>
        new THREE.Vector3(side*(.248+dx),benchHeight+dy,z));
    cords.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),26,.0077,6));
    for(const z of [-.107,.107]) {
      lower.set(side*.254,benchHeight+.090,z-.006);
      upper.set(side*.254,benchHeight+.119,z+.006);
      const curve=new THREE.CatmullRomCurve3([lower.clone(),
        new THREE.Vector3(side*.272,benchHeight+.104,z),upper.clone()]);
      cords.push(new THREE.TubeGeometry(curve,10,.009,6));
    }
  }
  for(const z of [-.182,.182]) for(const x of [-.218,.218]) for(const at of [.041,.105,.155])
    supports.push(new THREE.CylinderGeometry(.0051,.0066,.006,7).rotateX(Math.PI*.5)
      .translate(x,benchHeight+at,z));
  for(const [parts,material,name] of [[boards,rough,"Slatted crate boards"],[supports,elm,"Pinned packing stand"],
    [cords,hemp,"Twisted hemp crate handles"]]) {
    const geometry=mergeGeometries(parts);
    for(const part of parts)part.dispose();
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;frame.add(mesh);
  }
  // A shallow recessed floor supports the leaves between the wood slats.
  const liner=new THREE.Mesh(detailedBox(width-.035,.016,depth-.034,seam,.004,7),seam);
  liner.position.y=benchHeight+.036;liner.receiveShadow=true;frame.add(liner);
  city.box("Produce crate stand",bin.x-.289,bin.x+.289,bin.z-.230,bin.z+.230,y,y+benchHeight+.175);
  const contents=new THREE.Group();
  contents.name="Greens packed for the market";
  contents.position.y=benchHeight-.018;frame.add(contents);
  return {pack:crops.basket(contents),y:y+benchHeight};
}

export function createGardenTrade(parent,city,surface,floor,crops,harvest) {
  const keeper=riverWorker(parent,surface,"gardenKeeper");
  keeper.figure.name="West bank garden keeper";
  const crate=produceCrate(parent,city,surface,floor,crops);
  const bundle=new THREE.Group();bundle.name="Vegetables carried by the garden keeper";
  parent.add(bundle);
  const display=crops.bundle(bundle);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.036,.023,.075,12),
    new THREE.MeshStandardMaterial({color:0xbab38f,roughness:.84}));
  stem.position.y=.015;stem.castShadow=true;bundle.add(stem);
  const grip=new THREE.Object3D();grip.name="Keeper's crop bundle grip";grip.position.y=gripRise;bundle.add(grip);
  const home={x:harvest.tray.x+.018,z:workZ};
  const unload={x:bin.x+.018,z:bin.z-.666};
  const actor=keeper.figure.position;
  const body=city.cylinder("Garden keeper",home.x,home.z,0,workerHeight,radius);
  let stepSound;
  const gait=createGroundedGait(floor,(x,z)=>available(x,z,.11,.24),(x,y,z,time,vx,vz)=>{
    stepSound(x,y,z,vx,vz,"gardenKeeper",false,transferred);
  });
  const handle=new THREE.Vector3(), start=new THREE.Vector3(), actual=new THREE.Vector3(), offset=new THREE.Vector3();
  const handFrame=new THREE.Quaternion(),wrist=new THREE.Euler(0,0,0,"YXZ");
  let stage="idle",age=0,heading=0,ids=null,transferred=false,blocked=false,turning=0;
  const hand=keeper.limbs.hands[1].group.getObjectByName("Garden keeper palm contact");

  function available(x,z,clearance,height) {
    return x>gardenBounds.west+clearance && x<gardenBounds.east-clearance &&
      z>gardenBounds.south+clearance && z<gardenBounds.north-clearance &&
      !city.blocking(x,z,floor(x,z),clearance,height,body);
  }
  function syncBody() {
    const y=floor(actor.x,actor.z);
    Object.assign(body,{x:actor.x,z:actor.z,bottom:y,top:y+workerHeight});
  }
  function restore() {
    harvest.cancelSale();
    crate.pack(harvest.sold(),true);
    stage="idle";age=0;ids=null;transferred=false;blocked=false;turning=0;
    bundle.visible=false;
    actor.set(home.x,floor(home.x,home.z),home.z);
    heading=facing(home,harvest.tray);
    keeper.figure.rotation.y=heading;
    gait.reset();
    keeper.stand(floor,actor.x,actor.y,actor.z,heading);
    syncBody();
  }
  function near(player) {
    return Math.abs(player.x-harvest.tray.x)<.61 && player.z<harvest.tray.z-.37 &&
      distance(player,harvest.tray)<1.07;
  }
  function use(player) {
    if(stage!=="idle" || !near(player)) return null;
    ids=harvest.saleLot();
    if(!ids) return "gardenOffer";
    display(ids);age=0;stage="collect";transferred=false;blocked=false;
    return "gardenSorting";
  }
  function motionTarget() {
    if(stage==="haul" || stage==="return") {
      const destination=stage==="haul" ? unload : home;
      const remaining=distance(actor,destination);
      if(remaining>.044) return {yaw:facing(actor,destination),destination,remaining};
      return {yaw:facing(actor,stage==="haul" ? bin : harvest.tray)};
    }
    return {yaw:facing(actor,stage==="stow" ? bin : harvest.tray)};
  }
  function advance(dt,time,player) {
    const movement=motionTarget();
    const gap=turn(heading,movement.yaw);
    const oldX=actor.x,oldZ=actor.z;
    blocked=false;
    if(movement.destination && Math.abs(gap)<.58) {
      const travel=Math.min(movement.remaining,dt*(ids ? .89 : 1.14));
      const nextX=(movement.destination.x-actor.x)*travel/movement.remaining;
      const nextZ=(movement.destination.z-actor.z)*travel/movement.remaining;
      sweepHorizontal(actor,nextX,nextZ,(x,z)=>available(x,z,radius,workerHeight) &&
        Math.hypot(x-player.x,z-player.z)>radius+workerRadius+.018);
      blocked=Math.hypot(actor.x-oldX,actor.z-oldZ)<travel*.17;
    }
    const vx=(actor.x-oldX)/dt,vz=(actor.z-oldZ)/dt;
    const speed=Math.hypot(vx,vz);
    heading=gait.steer(dt,heading,movement.yaw,speed,transferred);
    turning=Math.abs(turn(heading,movement.yaw));
    keeper.figure.rotation.y=heading;
    gait.update(dt,time,actor.x,actor.z,heading,vx,vz,0,movement.yaw);
    syncBody();
    return {speed,aligned:!movement.destination && turning<.075};
  }
  function frame(dt,time,player,speech,attend,footfall) {
    if(distance(player,home)>16 && stage==="idle") return null;
    stepSound=footfall;
    const {speed,aligned}=advance(dt,time,player);
    let event=null;
    age+=dt;
    if(stage==="collect" && age>.86 && !transferred) {
      harvest.stageSale(ids);transferred=true;
    }
    if(stage==="collect" && age>=carryTime) {
      stage="haul";age=0;
    } else if(stage==="haul" && aligned) {
      stage="stow";age=0;
    } else if(stage==="stow" && age>=unloadTime) {
      if(harvest.commitSale()) {
        crate.pack(harvest.sold(),true);
        event="sold";
      }
      stage="return";age=0;ids=null;transferred=false;
    } else if(stage==="return" && aligned) {
      stage="idle";age=0;
    }
    const collect=stage==="collect", stow=stage==="stow";
    const t=collect ? age/carryTime : age/unloadTime;
    const bend=collect ? .356*smoothstep(t,.04,.40)*(1-smoothstep(t,.62,.97)) :
      stow ? .330*smoothstep(t,.05,.43)*(1-smoothstep(t,.78,1)) : 0;
    const bodyY=gait.rootHeight(actor.x,actor.z)-bend;
    actor.y=bodyY;
    keeper.walkBody(gait.phase()-Math.PI*.5,speed>.065,false,dt);
    keeper.torsoPivot.position.z=-.32*bend;
    keeper.torsoPivot.rotation.x-=1.13*bend;
    keeper.poseFeet(gait.feet,floor,actor.x,actor.y,actor.z,heading);

    const speaking=speech.id==="gardenOffer" || speech.id==="gardenSorting" || speech.id==="gardenSold";
    if(collect || stow) {
      const target=collect ? harvest.tray : bin;
      attend(keeper,target.x,collect ? harvest.basketBase+.14 : crate.y+.16,target.z,dt,.026);
    } else if(near(player) || speaking) {
      attend(keeper,player.x,floor(player.x,player.z)+1.50,player.z,dt,.038*speech.emphasis);
    } else if(speed<.15) {
      attend(keeper,harvest.tray.x+.15*Math.sin(time*.8),harvest.basketBase+.38,harvest.tray.z,dt,0);
    } else attend(keeper,actor.x-Math.sin(heading)*1.75,actor.y+1.51,actor.z-Math.cos(heading)*1.75,dt,0);
    keeper.face.speak(speaking ? speech.shape : null,dt);
    const blink=(time+.96)%4.23;
    keeper.face.blink(Math.max(0,1-Math.abs(blink-.13)/.096));

    bundle.visible=transferred;
    if(collect || transferred) {
      handle.copy(keeper.figure.localToWorld(start.set(.272,1.018,-.235)));
      let amount=1, release=0;
      if(collect) {
        const reach=smoothstep(t,.10,.49)*(1-smoothstep(t,.61,.99));
        handle.lerp(start.set(harvest.tray.x+.013,harvest.basketBase+.112+gripRise,harvest.tray.z+.045),reach);
        amount=smoothstep(t,.16,.47);
      } else if(stow) {
        const lower=smoothstep(t,.08,.56);
        handle.lerp(start.set(bin.x-.052,crate.y+.104+gripRise,bin.z-.133),lower);
        amount=1-smoothstep(t,.76,.98);
        release=smoothstep(t,.68,.81);
      }
      handFrame.setFromEuler(wrist.set(.18,heading,-.39,"YXZ"));
      keeper.graspProp(1,handle,handFrame,amount,.87);
      hand.getWorldPosition(actual);
      handle.lerp(actual,1-release);
      bundle.rotation.set(-.19+.45*release,heading+.12,-.11,"YXZ");
      offset.copy(grip.position).applyQuaternion(bundle.quaternion);
      bundle.position.copy(handle).sub(offset);
    }
    keeper.poseSleeves();
    return event;
  }
  restore();

  return {near,use,frame,restore,ready:()=>stage==="idle",busy:()=>ids!==null,blocked:()=>blocked,
    inspect:()=>({stage,age,blocked,turning,position:actor.toArray(),home,crate:{...bin,y:crate.y},bundle:bundle.visible,
      onHand:ids?.slice()??[],sold:harvest.sold(),steps:gait.inspect().landings})};
}
