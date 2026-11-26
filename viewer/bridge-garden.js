import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { circleTouchesBox,sweepYaw,workerRadius } from "./bridge-collision.js";
import { createKitchenCrops } from "./bridge-crops.js";
import { createGardenHarvest } from "./bridge-harvest.js";
import { createGardenTrade } from "./bridge-garden-trade.js";
import { detailedBox } from "./bridge-look.js";
import { cropBeds,gardenBounds,gardenGate,vergeEdge } from "./bridge-west-bank.js";
import { fieldOpening } from "./bridge-field-layout.js";

const {damp,lerp,smoothstep}=THREE.MathUtils;
const {west,east,north,south}=gardenBounds;

function seedFrom(state) {
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
}

function installBatch(parent,parts,material,name) {
  const geometry=mergeGeometries(parts);
  for(const g of parts) g.dispose();
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=name;
  mesh.castShadow=mesh.receiveShadow=true;
  parent.add(mesh);
}

export function buildKitchenGarden(root,city,surface,height) {
  const group=new THREE.Group();
  group.name="West bank kitchen garden";
  root.add(group);
  const crops=createKitchenCrops(group,height);
  const harvest=createGardenHarvest(group,city,surface,height,crops);
  const trade=createGardenTrade(group,city,surface,height,crops,harvest);
  const timber=surface("rail-wood",0xb59b74,.83,.91);
  const reed=surface("tea-wood",0xab9069,.66,.88);
  const stone=surface("worn-stone",0xc0b69c,.91,.96);
  const iron=new THREE.MeshStandardMaterial({color:0x463e32,metalness:.37,roughness:.64});
  const nearParts=[], stones=[], strands=[];
  const random=seedFrom(13888);
  const pivotZ=gardenGate.z-gardenGate.width*.5+.064;
  const gateEnd=gardenGate.z+gardenGate.width*.5-.064;
  const gateWidth=gateEnd-pivotZ;
  const y=height(east,gardenGate.z);
  const gatePanels=new Set();
  function timberBlock(parts,material,w,h,d,x,y,z,rotation=0,b=.015) {
    parts.push(detailedBox(w,h,d,material,b,random()*7).rotateY(rotation).translate(x,y,z));
  }
  function weave(parts,mat,from,to,baseRise,rails,followTerrain=true) {
    const span=Math.hypot(to.x-from.x,to.z-from.z);
    const nx=-(to.z-from.z)/span,nz=(to.x-from.x)/span;
    const posts=Math.max(2,Math.ceil(span/.46));
    for(let j=0;j<rails;j++) {
      const points=[];
      for(let i=0;i<=posts*3;i++) {
        const t=i/(posts*3);
        const x=lerp(from.x,to.x,t),z=lerp(from.z,to.z,t);
        const bend=.032*Math.cos(t*posts*Math.PI+j*Math.PI);
        const floor=followTerrain ? height(x,z) : 0;
        points.push(new THREE.Vector3(x+nx*bend,
          floor+baseRise+.059*j+.011*Math.sin(i*.55+j*2),z+nz*bend));
      }
      const curve=new THREE.CatmullRomCurve3(points);
      const tube=new THREE.TubeGeometry(curve,posts*5,.013+.003*random(),5,false);
      const uv=tube.attributes.uv;
      const phase=random()*4;
      for(let i=0;i<uv.count;i++) uv.setXY(i,phase+uv.getX(i)*span/(mat.userData.tileMetres||1),uv.getY(i)*.19+j*.21);
      parts.push(tube);
    }
  }
  function fence(x,z,toX,toZ,gateSide=false) {
    const span=Math.hypot(toX-x,toZ-z), dx=(toX-x)/span,dz=(toZ-z)/span;
    const angle=Math.atan2(dx,dz);
    const bays=Math.max(1,Math.ceil(span/1.92));
    for(let i=0;i<=bays;i++) {
      const px=lerp(x,toX,i/bays),pz=lerp(z,toZ,i/bays),at=height(px,pz);
      timberBlock(nearParts,timber,.110,1.17,.143,px,at+.535,pz,angle,.024);
      timberBlock(stones,stone,.244,.149,.253,px,at+.023,pz,angle,.037);
    }
    for(let at=.24;at<span-.07;at+=.42) {
      const px=x+dx*at,pz=z+dz*at,base=height(px,pz);
      timberBlock(nearParts,reed,.057,.736,.045,px,base+.538,pz,angle,.01);
    }
    weave(strands,reed,{x,z},{x:toX,z:toZ},.22,12);
    for(let offset=.23;offset<span;offset+=.50) {
      const px=x+dx*offset,pz=z+dz*offset;
      timberBlock(stones,stone,.221,.165,.48,px,height(px,pz)+.036,pz,angle+random()*.25-.125,.04);
    }
    const middleX=(x+toX)*.5,middleZ=(z+toZ)*.5,feet=Math.min(height(x,z),height(toX,toZ),height(middleX,middleZ));
    const solid=city.orientedBox("Garden woven fence",.099,span*.5,1.10);
    Object.assign(solid,{x:middleX,z:middleZ,yaw:angle,bottom:feet-.11,top:feet+1.13});
    if(gateSide) gatePanels.add(solid);
  }
  fence(west,south,west,fieldOpening.z-fieldOpening.width*.5);
  fence(west,fieldOpening.z+fieldOpening.width*.5,west,north);
  fence(west,south,east,south);
  fence(west,north,east,north);
  fence(east,south,east,pivotZ,true);
  fence(east,gateEnd,east,north,true);
  fence(east,north,vergeEdge,north);
  fence(vergeEdge,north,vergeEdge,-31.29);
  installBatch(group,nearParts,timber,"Weathered garden fence posts and stakes");
  installBatch(group,stones,stone,"Fieldstone fence footings");
  installBatch(group,strands,reed,"Hand-woven wattle fence");
  const pivot=new THREE.Group();
  pivot.name="Hinged garden gate";
  pivot.position.set(east,y,pivotZ);
  group.add(pivot);
  const gateTimbers=[], woven=[], fasteners=[];
  for(const end of [.067,gateWidth-.067])
    timberBlock(gateTimbers,timber,.095,1.03,.13,0,.56,end,0,.016);
  for(const high of [.174,.910]) timberBlock(gateTimbers,timber,.104,.113,gateWidth,0,high,gateWidth*.5,0,.019);
  const brace=new THREE.Vector3(0,.74,gateWidth-.16);
  gateTimbers.push(detailedBox(.066,brace.length(),.060,timber,.013)
    .rotateX(Math.atan2(brace.z,brace.y)).translate(-.031,.546,gateWidth*.5));
  weave(woven,reed,{x:0,z:.079},{x:0,z:gateWidth-.079},.27,10,false);
  for(const high of [.21,.853]) fasteners.push(new THREE.CylinderGeometry(.037,.037,.124,16)
    .translate(0,high,0));
  const latchAt=new THREE.Vector3(.072,.956,gateWidth-.131);
  const latch=new THREE.Object3D();latch.name="Garden gate handle";latch.position.copy(latchAt);
  pivot.add(latch);
  fasteners.push(new THREE.TorusGeometry(.061,.008,8,20).rotateY(Math.PI*.5).translate(...latchAt.toArray()));
  installBatch(pivot,gateTimbers,timber,"Joined gate timbers");
  installBatch(pivot,woven,reed,"Woven gate panel");
  installBatch(pivot,fasteners,iron,"Gate hinges and iron ring");
  const door=city.orientedBox("Garden gate",.057,(gateWidth-.11)*.5,1.06);
  door.assembly="kitchen-garden-gate";
  for(const part of gatePanels) part.assembly=door.assembly;

  const plate=document.createElement("canvas");
  plate.width=196;plate.height=78;
  const ink=plate.getContext("2d");
  ink.fillStyle="#b6a182";ink.fillRect(0,0,plate.width,plate.height);
  ink.strokeStyle="#6e5639";ink.lineWidth=3;ink.strokeRect(6,6,184,66);
  ink.font="48px 'Noto Serif CJK SC',serif";ink.textAlign="center";ink.textBaseline="middle";
  ink.fillStyle="#4b392b";ink.fillText("菜園",98,43);
  const signMap=new THREE.CanvasTexture(plate);signMap.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(.56,.218),new THREE.MeshStandardMaterial({map:signMap,roughness:.91}));
  sign.rotation.y=Math.PI*.5;sign.position.set(east+.071,height(east,gateEnd+.58)+.86,gateEnd+.58);
  group.add(sign);

  const potX=-81.66,potZ=-32.02,potY=height(potX,potZ);
  const clay=new THREE.MeshStandardMaterial({color:0x836453,roughness:.82});
  const pot=new THREE.Mesh(new THREE.LatheGeometry([[0,0],[.12,0],[.168,.045],[.219,.234],[.191,.392],[.108,.482],
    [.113,.51],[.094,.51],[.09,.473],[.165,.37],[.177,.198],[.094,.05],[0,.05]].map(p=>new THREE.Vector2(...p)),26),clay);
  pot.position.set(potX,potY,potZ);
  pot.castShadow=pot.receiveShadow=true;
  group.add(pot);
  city.cylinder("Garden clay jar",potX,potZ,potY,potY+.51,.218);

  const opens=-Math.PI*.54;
  let angle=0, target=0, blocked=false;
  const grip=new THREE.Vector3(), turnFrame=new THREE.Quaternion(), wrist=new THREE.Euler();
  function sync(next) {
    angle=pivot.rotation.y=next;
    const radius=(gateWidth+.015)*.5;
    Object.assign(door,{x:east+Math.sin(next)*radius,z:pivotZ+Math.cos(next)*radius,yaw:next,
      bottom:y,top:y+1.06});
  }
  sync(0);
  function near(player) {
    if(Math.abs(player.x-east)>1.94 || Math.abs(player.z-gardenGate.z)>1.48) return false;
    latch.getWorldPosition(grip);
    return Math.hypot(player.x-grip.x,player.z-grip.z)<1.12;
  }
  function use(player) {
    if(!near(player)) return false;
    target=target===0 ? opens : 0;
    blocked=false;
    return true;
  }
  function frame(dt,player) {
    if(Math.abs(angle-target)<.002) return null;
    const wasBlocked=blocked;
    const next=damp(angle,target,4.7,dt);
    const end=sweepYaw(angle,next,candidate=>{
      const r=(gateWidth+.015)*.5;
      const x=east+Math.sin(candidate)*r,z=pivotZ+Math.cos(candidate)*r;
      return !circleTouchesBox(player.x,player.z,workerRadius+.014,x,z,door.halfX,door.halfZ,candidate) &&
        !city.boxBlocking(x,z,y+.04,door.halfX,door.halfZ,.99,candidate,door);
    });
    blocked=Math.abs(end-angle)<.00016;
    if(Math.abs(end-target)<.002) {
      sync(target);
      blocked=false;
      return "settled";
    }
    sync(end);
    return blocked && !wasBlocked ? "blocked" : null;
  }
  function reach(player,yaw) {
    if(Math.abs(angle-target)<.025 || blocked) return 0;
    const hand=latch.getWorldPosition(grip);
    const dx=hand.x-player.x,dz=hand.z-player.z;
    return -dx*Math.sin(yaw)-dz*Math.cos(yaw)<.20 ? 0 : .92*(1-smoothstep(Math.hypot(dx,dz),.36,.66));
  }
  function pose(person,player,yaw,hand=1) {
    const amount=reach(player,yaw);
    if(amount<.01) return;
    wrist.set(.11,angle+.22,.14,"YXZ");
    person.graspProp(hand,grip,turnFrame.setFromEuler(wrist),amount,.60);
  }
  return {near,use,frame,pose,reach,breeze:crops.breeze,harvest,trade,
    restore(open=false){target=open ? opens : 0;blocked=false;sync(target);},
    opened:()=>angle===opens,
    name:()=>target===0 ? "推开菜园门" : "合上菜园门",
    inspect:()=>({angle,target,blocked,gate:{...gardenGate},bounds:{...gardenBounds},beds:cropBeds.length}),
  };
}
