import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";

const saveKey="qingming-west-timber-gate-v1";
const {lerp,smoothstep}=THREE.MathUtils;
const tx=-77.60, tz=-46.72, pivotZ=tz+.735, span=.622;
const deckY=.113, pivotY=1.017, raised=1.496;
const settleTime=.46, insertTime=.64, swingTime=.92;
const socketAt=new THREE.Vector3(0,-.096,.536);
const socketPoint=new THREE.Vector3(tx,pivotY+socketAt.y,pivotZ+socketAt.z);
const repairStand={x:tx-.92,z:socketPoint.z-.076};
const facingAngle=(from,to)=>Math.atan2(from.x-to.x,from.z-to.z);
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
export const timberGateZ=tz;

export function createTimberGate(parent,fixed,city,surface,saw,sound) {
  const root=new THREE.Group();
  root.name="West timber service gate";
  parent.add(root);
  const stone=surface("worn-stone",0x969688,.83,.90);
  const plank=surface("rail-wood",0x946c49,.76,.89);
  const upright=surface("tea-wood",0x906c4b,.55,.91);
  const iron=new THREE.MeshStandardMaterial({color:0x565550,roughness:.59,metalness:.57});
  const paleIron=new THREE.MeshStandardMaterial({color:0x8e8773,roughness:.51,metalness:.59});
  const fibre=new THREE.MeshStandardMaterial({color:0xad9673,roughness:.97});
  function mesh(group,geometry,material,x,y,z) {
    const part=new THREE.Mesh(geometry,material);
    part.position.set(x,y,z);
    part.castShadow=part.receiveShadow=true;
    part.layers.enable(1);
    group.add(part);
    return part;
  }
  function box(group,material,w,h,d,x,y,z,bevel=.018) {
    return mesh(group,detailedBox(w,h,d,material,bevel,3+x+z*.11),material,x,y,z);
  }
  function cylinder(group,material,radius,length,x,y,z,angle=0) {
    const metal=mesh(group,new THREE.CylinderGeometry(radius,radius*.97,length,14),material,x,y,z);
    metal.rotation.z=angle;
    return metal;
  }
  function rope(group,points,radius) {
    const curve=new THREE.CatmullRomCurve3(points.map(point=>new THREE.Vector3(...point)));
    return mesh(group,new THREE.TubeGeometry(curve,20,radius,5,false),fibre,0,0,0);
  }

  const colliders=[];
  function solid(name,x,z,w,d,bottom,top) {
    const item=city.box(name,x-w/2,x+w/2,z-d/2,z+d/2,bottom,top);
    colliders.push(item);
    return item;
  }
  // Cut stone bears on both banks. The second crossing is solid before the
  // mechanism is repaired, and the low gate is what bars through traffic.
  for(const [i,w] of [.40,.43,.40].entries()) {
    const x=tx+(i-1)*.410;
    box(fixed,stone,w,.201,1.307,x,deckY-.1005,tz,.023);
    for(const side of [-1,1]) {
      box(fixed,stone,w-.013,.124,.137,x,deckY-.023,tz+side*.672,.019);
    }
  }
  for(const side of [-1,1]) {
    const x=tx+side*.834;
    box(fixed,stone,.402,.109,1.28,x,.018,tz,.019).rotation.z=-side*.237;
    const z=tz+side*.73;
    for(const at of [-.515,.521]) {
      box(fixed,stone,.197,.112,.201,tx+at,.150,z,.016);
      box(fixed,upright,.087,.546,.096,tx+at,.458,z,.011);
    }
    box(fixed,plank,1.224,.066,.084,tx,.688,z,.009);
    solid("Timber gate stone crossing rail",tx,z,1.23,.09,.051,.73);
  }
  for(const z of [pivotZ,tz-.737]) {
    box(fixed,stone,.309,.229,.272,tx,.164,z,.024);
    if(z===pivotZ) {
      box(fixed,upright,.171,.653,.167,tx,.553,z,.015);
      for(const side of [-1,1]) {
        const cheek=tx+.080*side;
        box(fixed,upright,.044,.522,.167,cheek,1.114,z,.008);
        box(fixed,iron,.051,.094,.177,cheek,1.321,z,.008);
        box(fixed,plank,.061,.040,.193,cheek,1.385,z,.009);
      }
    } else {
      box(fixed,upright,.171,.727,.167,tx,.590,z,.015);
      box(fixed,iron,.193,.029,.190,tx,.957,z,.006);
      for(const side of [-1,1])
        box(fixed,iron,.027,.104,.191,tx+.067*side,1.012,z,.006);
    }
    solid(z===pivotZ ? "Timber gate pivot post" : "Timber gate keeper",
      tx,z,.199,.197,.111,z===pivotZ ? 1.415 : 1.07);
  }
  for(const x of [tx-.092,tx+.092]) cylinder(fixed,paleIron,.032,.024,x,pivotY,pivotZ,Math.PI*.5);
  const arm=new THREE.Group();
  arm.name="Counterweighted timber barrier";
  arm.position.set(tx,pivotY,pivotZ);
  root.add(arm);
  box(arm,plank,.089,.094,2.130,0,0,-.413,.019);
  box(arm,upright,.111,.063,.79,0,-.057,-.358,.010);
  for(const z of [-1.427,-.131,.221,.572]) {
    box(arm,iron,.105,.111,.036,0,0,z,.008);
    for(const side of [-1,1]) cylinder(arm,paleIron,.012,.014,side*.059,0,z,Math.PI*.5);
  }
  cylinder(arm,iron,.050,.177,0,0,0,Math.PI*.5);
  for(const x of [-.237,.237]) {
    box(arm,iron,.029,.170,.144,x,-.096,.536,.008);
    box(arm,iron,.083,.026,.144,x*.897,-.181,.536,.007);
    box(arm,iron,.082,.021,.113,x*.915,-.008,.548,.005);
    cylinder(arm,paleIron,.013,.023,x,-.091,.615,Math.PI*.5);
  }
  const pullLoop=new THREE.Group();
  pullLoop.position.set(0,-.02,-1.22);
  arm.add(pullLoop);
  rope(pullLoop,[[.05,0,-.018],[.073,-.15,-.003],[.069,-.28,.010],
    [.026,-.31,.018],[.014,-.24,.030],[.048,0,0]],.007);
  const guard=city.box("Lowered timber service gate",tx-.087,tx+.087,tz-.691,tz+.682,.74,1.37);
  guard.camera=false;
  const carrier=new THREE.Group(), weight=new THREE.Group();
  carrier.name="Offcut carried to the timber gate";
  weight.name="Timber gate counterweight";
  root.add(carrier);
  arm.add(weight);
  weight.position.copy(socketAt);
  const worldPoint=new THREE.Vector3(), from=new THREE.Vector3(), palm=new THREE.Vector3();
  const fromRotation=new THREE.Quaternion(), worldRotation=new THREE.Quaternion(), gripRotation=new THREE.Quaternion();
  const roll=new THREE.Quaternion().setFromEuler(new THREE.Euler(.08,-.04,-.10,"YXZ"));
  const hands=[
    new THREE.Quaternion().setFromEuler(new THREE.Euler(.15,1.42,-.23,"YXZ")),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(.15,-1.42,.23,"YXZ")),
  ];
  let stage="bench", piece=null, active=false, motion=null, angle=0;
  try {
    const saved=localStorage.getItem(saveKey);
    if(saw.finished() && ["carried","open","closed"].includes(saved)) stage=saved;
  } catch {}
  if(stage==="carried") piece=saw.takeOffcut(carrier);
  if(stage==="open" || stage==="closed") {
    piece=saw.takeOffcut(weight);
    piece.position.set(0,0,0);
    piece.quaternion.identity();
    angle=stage==="open" ? raised : 0;
  }

  function tilt() {
    arm.rotation.x=angle;
    pullLoop.rotation.x=-angle;
  }
  function sync() {
    tilt();
    guard.enabled=active && (stage!=="open" || Boolean(motion));
  }
  sync();

  function save(state) {
    try {
      if(state==="bench") localStorage.removeItem(saveKey);
      else localStorage.setItem(saveKey,state);
    } catch {}
  }
  function nearRepair(p) {
    return p.x<tx-.72 && p.x>tx-1.23 && Math.abs(p.z-repairStand.z)<.39;
  }
  function nearLever(p) {
    return Math.abs(p.x-tx)>.478 && Math.abs(p.x-tx)<1.17 && Math.abs(p.z-tz)<.52;
  }
  function action(p) {
    if(motion) return null;
    if(stage==="bench" && saw.finished() && saw.near(p)) return "拿起短木料 E";
    if(stage==="carried" && nearRepair(p)) return "装上横闸配重 E";
    if(stage==="carried" && saw.near(p)) return "把短木料放回锯台 E";
    if(stage==="open" && nearLever(p)) return "放下横闸 E";
    if(stage==="closed" && nearLever(p)) return "拉起横闸 E";
    return null;
  }
  function use(player) {
    if(!action(player)) return null;
    if(stage==="bench") {
      motion={take:true,startYaw:player.yaw,turn:0,age:0,placingAt:Infinity,position:saw.takeStand};
      return "把短木料从锯台上拿开。";
    }
    if(stage==="carried" && !nearRepair(player)) {
      saw.returnOffcut();
      piece=null;
      stage="bench";
      save(stage);
      return "短木料放回锯台了。";
    }
    const position=stage==="carried" ? repairStand : null;
    const aim=position ? facingAngle(position,socketPoint) : player.yaw;
    motion={startYaw:player.yaw,turn:angleDelta(player.yaw,aim),
      age:0,placingAt:Infinity,base:angle,up:stage!=="open",position,hit:false};
    if(position) return "把短木料嵌进铁箍，托住横闸尾部。";
    // A moving barrier stays solid even while lowering from the fully raised position.
    guard.enabled=active;
    return motion.up ? "正在升起横闸。" : "正在放下横闸。";
  }
  function update(dt,player,bodyYaw) {
    if(!motion) return null;
    const m=motion;
    m.age+=dt;
    let t=m.age;
    if(m.take) {
      const gap=Math.hypot(player.x-m.position.x,player.z-m.position.z);
      if(m.age<.38 || gap>.035 && m.age<1.8) return null;
      motion=null;
      if(gap>.07) return "timberTakeRetry";
      piece=saw.takeOffcut(carrier);
      stage="carried";
      save(stage);
      return "timberOffcutHeld";
    }
    if(m.position) {
      if(m.placingAt===Infinity) {
        const gap=Math.hypot(player.x-repairStand.x,player.z-repairStand.z);
        const turn=Math.abs(angleDelta(bodyYaw,m.startYaw+m.turn));
        if(m.age<settleTime || (gap>.039 || turn>.17) && m.age<2.4) return null;
        if(gap>.115 || turn>.32) {
          motion=null;
          return "timberGateRetry";
        }
        from.copy(piece.position);
        fromRotation.copy(piece.quaternion);
        m.placingAt=m.age;
      }
      t=m.age-m.placingAt;
      if(t<insertTime) {
        const progress=smoothstep(t,0,insertTime);
        piece.position.lerpVectors(from,socketPoint,progress);
        piece.position.y+=.102*Math.sin(progress*Math.PI);
        piece.quaternion.copy(fromRotation).slerp(gripRotation.identity(),progress);
        return null;
      }
      t-=insertTime;
      if(piece.parent!==weight) {
        weight.add(piece);
        piece.position.set(0,0,0);
        piece.quaternion.identity();
        sound("impact",tx,pivotZ+.536,.53);
      }
    }
    const k=smoothstep(t,0,swingTime);
    angle=lerp(m.base,m.up ? raised : 0,k)+Math.sin(k*Math.PI)*.015;
    tilt();
    if(!m.hit && t>=.13) {
      m.hit=true;
      sound("latch",tx,tz,.73);
    }
    if(t<swingTime) return null;
    const installed=Boolean(m.position);
    stage=m.up ? "open" : "closed";
    angle=m.up ? raised : 0;
    motion=null;
    sync();
    save(stage);
    sound("impact",tx,tz,m.up ? .44 : .61);
    return installed ? "timberGateRepaired" : m.up ? "timberGateOpen" : "timberGateClosed";
  }
  function pose(playerBody) {
    if(!piece || piece.parent!==carrier) return;
    const moving=motion?.position && motion.placingAt!==Infinity;
    const person=playerBody.figure;
    // The local board is less than shoulder width and stays against the torso
    // while walking. Release it gradually as the fixed iron cradle takes it.
    person.getWorldQuaternion(worldRotation);
    if(!moving) {
      piece.position.copy(person.localToWorld(worldPoint.set(0,1.015,-.290)));
      piece.quaternion.copy(worldRotation).multiply(roll);
    }
    const pressure=moving ? 1-smoothstep(motion.age-motion.placingAt,.16,.46) : 1;
    if(pressure<=0) return;
    for(const [i,rotation] of hands.entries()) {
      const side=i===0 ? -1 : 1;
      piece.localToWorld(palm.set(side*.206,.013,.096));
      gripRotation.copy(worldRotation).multiply(rotation);
      playerBody.graspProp(i,palm,gripRotation,pressure);
    }
  }
  return {
    action,use,update,pose,
    nearDeck:(x,z)=>Math.abs(x-tx)<.66 && Math.abs(z-tz)<span,
    support(x,z) {
      const reach=Math.abs(x-tx);
      if(Math.abs(z-tz)>span || reach>1.04) return -Infinity;
      return lerp(deckY,.018,smoothstep(reach,.615,1.034));
    },
    carrying:()=>stage==="carried" && !motion,
    locked:()=>Boolean(motion),
    facing:()=>motion.startYaw+motion.turn*smoothstep(motion.age,0,settleTime),
    station:()=>motion?.placingAt===Infinity ? motion.position : null,
    guide(player) {
      if(motion) return null;
      if(stage==="carried" && !nearRepair(player)) return {...repairStand,label:"横闸配重"};
      if(stage==="bench" && saw.finished() && !saw.near(player))
        return {...saw.approach,label:"领取短木料"};
      return null;
    },
    show(on) {
      root.visible=active=on;
      for(const collider of colliders) collider.enabled=on;
      sync();
    },
    reset() {
      if(piece) saw.returnOffcut();
      piece=null;
      stage="bench";
      motion=null;
      angle=0;
      save(stage);
      sync();
    },
    inspect:()=>({stage,angle,moving:Boolean(motion),age:motion?.age??0,
      stand:repairStand,centre:[tx,tz],board:piece?.getWorldPosition(worldPoint).toArray()??null,
      weightSeated:piece?.parent===weight,blocked:guard.enabled}),
  };
}
