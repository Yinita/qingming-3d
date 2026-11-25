import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";

const saveKey="qingming-west-saw-v1";
const {lerp,smoothstep}=THREE.MathUtils;
const angleBetween=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const strokes=5, border=.12, kerf=.012;
const plankBottom=.815, plankHeight=.106, plankWidth=.244;
const top=plankBottom+plankHeight;
const workDistance=.79, takeDistance=1.166;
const cycle=1.05, cutStart=.21, cutEnd=.73;
const settleTime=.40, flakesPerCut=12;

function sawTeeth() {
  const positions=[];
  for(let i=0;i<62;i++) {
    const z=-.305+i*.010;
    const x=i%2===0 ? .0033 : -.0033;
    positions.push(0,0,z,0,0,z+.010,x,-.0068,z+.0062);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createCourtSaw(parent,horse,materials,sound) {
  const {wood,darkWood,fresh,iron,endGrain}=materials;
  const root=new THREE.Group();
  root.name="Working frame saw and plank";
  root.position.copy(horse.position);
  root.rotation.copy(horse.rotation);
  parent.add(root);

  function mesh(group,geometry,material,x,y,z) {
    const part=new THREE.Mesh(geometry,material);
    part.position.set(x,y,z);
    part.castShadow=part.receiveShadow=true;
    part.layers.enable(1);
    group.add(part);
    return part;
  }
  function box(group,material,w,h,d,x,y,z,bevel=.010) {
    return mesh(group,detailedBox(w,h,d,material,bevel,.22+x*.17),material,x,y,z);
  }

  // Permanent stocks and wedges pin the long part while the short piece
  // remains free to shift when the teeth cut its last fibres.
  const peg=box(horse,darkWood,.066,.145,.088,-.580,.878,-.148);
  peg.rotation.z=.04;
  box(horse,darkWood,.143,.070,.077,-.480,.843,.149);
  box(horse,iron,.079,.008,.090,-.490,.883,.149,.002);
  const wedge=box(horse,wood,.132,.031,.085,-.364,.850,.150,.007);
  wedge.rotation.z=-.14;
  for(const x of [-.62,.58]) {
    box(horse,wood,.177,.024,.312,x,.803,0,.007);
    box(horse,iron,.046,.006,.019,x,.818,.138,.002);
  }
  // A shallow cutaway in the bench and the rest beneath it keep the blade
  // clear when the kerf reaches the bottom of the plank.
  const trench=box(horse,darkWood,.065,.014,.326,border,.782,0,.003);
  trench.name="Saw clearance below the cut";
  const gauge=new THREE.MeshStandardMaterial({color:0x483627,roughness:.83});
  for(let i=-7;i<=8;i++)
    box(horse,gauge,.004,.0015,i%5===0 ? .033 : .015,border+i*.043,.815,-.141,.0003);
  const handle=mesh(horse,new THREE.CylinderGeometry(.024,.029,.226,16),darkWood,.565,.846,.098);
  handle.rotation.set(0,.29,Math.PI*.5);
  box(horse,wood,.103,.098,.107,.437,.858,.134,.017).rotation.y=-.27;

  function plankSection(name,min,max,cutFace) {
    const section=new THREE.Group();
    section.name=name;
    const length=max-min, center=(max+min)/2;
    section.position.set(center,plankBottom+plankHeight/2,0);
    root.add(section);
    const shape=detailedBox(length,plankHeight,plankWidth,fresh,.004,0);
    const pos=shape.attributes.position,uv=shape.attributes.uv;
    for(let i=50;i<pos.count;i++) {
      const face=Math.floor(i/25);
      uv.setXY(i,((face===3 ? -1 : 1)*(pos.getX(i)+center)+.55)*.42,
        .127+(face<4 ? pos.getZ(i) : pos.getY(i))*.57);
    }
    mesh(section,shape,fresh,0,0,0);
    if(cutFace) {
      const cross=mesh(section,new THREE.PlaneGeometry(plankWidth-.004,plankHeight-.004),endGrain,
        cutFace*(length/2+.0005),0,0);
      cross.rotation.y=cutFace*Math.PI*.5;
      cross.castShadow=false;
    }
    return section;
  }
  const left=plankSection("Long timber cut",-.695,border-kerf/2,1);
  const right=plankSection("Short timber offcut",border+kerf/2,.632,-1);
  const fibres=plankSection("Remaining wood fibres",border-kerf/2,border+kerf/2,0);
  const centreX=right.position.x;
  left.userData.cutDepth=0;
  // The filler pivots about the underside, so only uncut fibres remain under the blade.
  fibres.position.y=plankBottom;
  fibres.children[0].position.y=plankHeight/2;

  const tool=new THREE.Group();
  tool.name="Tensioned wooden frame saw";
  root.add(tool);
  const steel=new THREE.MeshStandardMaterial({color:0x84908f,roughness:.42,metalness:.58,side:THREE.DoubleSide});
  box(tool,steel,.006,.026,.642,0,.012,0,.001);
  mesh(tool,sawTeeth(),steel,0,-.0004,0);
  for(const z of [-.333,.333]) {
    box(tool,wood,.067,.299,.072,0,.167,z,.013);
    box(tool,iron,.071,.039,.078,0,.041,z,.006);
    const pin=mesh(tool,new THREE.CylinderGeometry(.009,.009,.077,12),iron,0,.054,z);
    pin.rotation.z=Math.PI*.5;
    box(tool,darkWood,.066,.042,.075,0,.298,z,.008);
  }
  box(tool,darkWood,.051,.069,.638,0,.205,0,.012);
  const loopMat=new THREE.MeshStandardMaterial({color:0xb9a17a,roughness:.96});
  for(let strand=0;strand<2;strand++) {
    const points=Array.from({length:25},(_,i)=>{
      const t=i/24, theta=t*18.85+strand*Math.PI;
      return new THREE.Vector3(.0045*Math.sin(theta),.316+.0045*Math.cos(theta),lerp(-.344,.344,t));
    });
    mesh(tool,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),28,.0042,5,false),loopMat,0,0,0);
  }
  const toggle=box(tool,wood,.084,.020,.028,0,.316,.081,.004);
  toggle.rotation.z=.45;
  const handgrip=mesh(tool,new THREE.CylinderGeometry(.023,.019,.147,18),darkWood,0,.134,.349);
  handgrip.rotation.z=.12;
  const rightPalm=new THREE.Object3D(), leftPalm=new THREE.Object3D();
  rightPalm.name="Saw handle palm target";
  rightPalm.position.set(.028,.128,.362);
  rightPalm.rotation.set(.19,-1.32,.09,"YXZ");
  tool.add(rightPalm);
  leftPalm.name="Timber brace palm target";
  leftPalm.position.set(-.195,top+.011,.097);
  leftPalm.rotation.set(0,-Math.PI*.5,-Math.PI*.5,"YXZ");
  root.add(leftPalm);

  const dust=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),
    new THREE.MeshStandardMaterial({color:0xf0c891,roughness:1}),strokes*flakesPerCut);
  dust.name="Sawing dust and wood flakes";
  dust.receiveShadow=true;
  dust.frustumCulled=false;
  root.add(dust);

  const point=new THREE.Vector3(), frame=new THREE.Quaternion(), particle=new THREE.Object3D();
  const restPosition=new THREE.Vector3(-.255,.958,-.175);
  const restRotation=new THREE.Euler(0,Math.PI*.5,Math.PI*.5,"YXZ");
  const restOrientation=new THREE.Quaternion().setFromEuler(restRotation);
  let cut=0, active=false, age=0, cuttingAt=Infinity, initialYaw=0;
  let spent=0, startedSound=false;
  try {
    const stored=Number(localStorage.getItem(saveKey));
    if(Number.isInteger(stored)) cut=THREE.MathUtils.clamp(stored,0,strokes);
  } catch {}

  function geometry(depth,loose) {
    const remaining=1-depth;
    fibres.visible=remaining>.001;
    fibres.scale.y=Math.max(.001,remaining);
    left.userData.cutDepth=depth*plankHeight;
    if(right.parent===root) {
      right.position.set(centreX+.067*loose,plankBottom+plankHeight/2,.079*loose);
      right.rotation.set(0,.135*loose,0);
    }
  }
  function toolPose(t,depth) {
    const pull=smoothstep(t,cutStart,cutEnd);
    const back=smoothstep(t,.76,1);
    tool.position.set(border,top-depth*plankHeight+.033*(1-smoothstep(t,.06,.22)+back),
      -.149+.299*(pull-back));
    tool.rotation.set(0,0,0);
  }

  function particles(t) {
    const flight=active ? Math.floor(flakesPerCut*smoothstep(t,cutStart,cutEnd)) : 0;
    dust.count=cut*flakesPerCut+flight;
    for(let i=0;i<dust.count;i++) {
      const inFlight=i>=cut*flakesPerCut;
      const p=inFlight ? smoothstep(t,cutStart+(i%flakesPerCut)*.038,cutStart+(i%flakesPerCut)*.038+.45) : 1;
      const throwSide=Math.sin(i*6.731), scatter=.026+.098*Math.sin(i*3.171)**2;
      const landZ=.135+.142*Math.sin(i*5.7)**2;
      const size=.0019+.0031*Math.sin(i*7.132)**2;
      const landY=landZ<.159 ? .818 : .009;
      particle.position.set(border+throwSide*scatter*p,
        top+(landY-top)*p*p+.065*Math.sin(p*Math.PI),lerp(.072,landZ,p));
      particle.rotation.set(i*.34+p,i*2.40,i*1.86+p*.9);
      particle.scale.set(size*1.30,size*.55,size*2.0);
      particle.updateMatrix();
      dust.setMatrixAt(i,particle.matrix);
    }
    dust.instanceMatrix.needsUpdate=true;
  }

  function idle() {
    geometry(cut/strokes,Number(cut===strokes));
    toolPose(0,cut/strokes);
    if(cut===strokes) {
      // Lay the saw flat on the long piece after the offcut has moved.
      tool.position.copy(restPosition);
      tool.quaternion.copy(restOrientation);
    }
    particles(0);
  }
  idle();

  const yaw=horse.rotation.y, cos=Math.cos(yaw), sin=Math.sin(yaw);
  const station={x:horse.position.x+sin*workDistance,z:horse.position.z+cos*workDistance};
  const distance=player=>Math.hypot(player.x-station.x,player.z-station.z);
  function near(player) {
    const x=player.x-horse.position.x,z=player.z-horse.position.z;
    const side=x*cos-z*sin, forward=x*sin+z*cos;
    return Math.abs(side)<.46 && forward>=.708 && forward<1.24;
  }
  function use(player) {
    if(active || cut===strokes || !near(player)) return false;
    active=true;
    age=spent=0;
    cuttingAt=Infinity;
    initialYaw=player.yaw;
    startedSound=false;
    return true;
  }
  function update(dt,player,bodyYaw) {
    if(!active) return null;
    age+=dt;
    if(cuttingAt===Infinity) {
      if(age<settleTime || (distance(player)>.036 || Math.abs(angleBetween(bodyYaw,yaw))>.13) && age<2.35)
        return null;
      if(distance(player)>.090 || Math.abs(angleBetween(bodyYaw,yaw))>.30) {
        active=false;
        idle();
        return "sawRetry";
      }
      cuttingAt=age;
    }
    spent=age-cuttingAt;
    const t=Math.min(1,spent/cycle);
    const cutMotion=smoothstep(t,cutStart,cutEnd);
    if(!startedSound && t>=cutStart) {
      startedSound=true;
      sound("saw",horse.position.x,horse.position.z,.90);
    }
    const depth=(cut+cutMotion)/strokes;
    const loose=cut+1===strokes ? smoothstep(t,cutEnd,.99) : 0;
    geometry(depth,loose);
    toolPose(t,depth);
    if(cut+1===strokes && t>.76) {
      const rest=smoothstep(t,.76,1);
      tool.position.lerp(restPosition,rest);
      tool.quaternion.slerp(restOrientation,rest);
    }
    particles(t);
    if(t<1) return null;
    cut++;
    active=false;
    try { localStorage.setItem(saveKey,String(cut)); } catch {}
    idle();
    if(cut===strokes) {
      sound("impact",horse.position.x,horse.position.z,.37);
      return "sawDone";
    }
    return "sawStroke";
  }

  function pose(player) {
    if(!active || cuttingAt===Infinity) return;
    const t=Math.min(1,spent/cycle);
    const grip=smoothstep(spent,0,.15)*(1-smoothstep(t,cut+1===strokes ? .76 : .82,.99));
    const force=Math.sin(Math.PI*smoothstep(t,.09,.89));
    player.torsoPivot.position.z-=.122*grip+.047*force;
    player.torsoPivot.rotation.x-=.49*grip+.034*force;
    player.torsoPivot.rotation.y-=.054*grip;
    for(const [i,target] of [leftPalm,rightPalm].entries()) {
      player.graspProp(i,target.getWorldPosition(point),target.getWorldQuaternion(frame),grip);
      if(i===0) player.limbs.hands[0].setGrip(.045*grip);
    }
  }

  return {
    near,use,update,pose,
    viewAligned:player=>near(player) && Math.cos(player.yaw-yaw)>.72,
    unfinished:()=>cut<strokes,
    finished:()=>cut===strokes,
    takeOffcut(holder) {
      holder.attach(right);
      return right;
    },
    returnOffcut() {
      root.add(right);
      idle();
    },
    approach:station,
    takeStand:{x:horse.position.x+sin*takeDistance,z:horse.position.z+cos*takeDistance},
    action(player) {
      return !active && cut<strokes && near(player) ? "拉锯 "+(cut+1)+" / "+strokes+" E" : null;
    },
    active:()=>active,
    facing:()=>initialYaw+angleBetween(initialYaw,yaw)*smoothstep(age,0,settleTime),
    station:()=>cuttingAt===Infinity ? station : null,
    reset() {
      cut=0;
      active=false;
      try { localStorage.removeItem(saveKey); } catch {}
      idle();
    },
    inspect:()=>({cut,total:strokes,active,age,strokeAge:spent,station,depth:left.userData.cutDepth,
      flakes:dust.count,shortPiece:right.position.toArray(),tool:tool.position.toArray()}),
  };
}
