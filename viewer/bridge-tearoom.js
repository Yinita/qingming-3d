import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { tileRoof } from "./bridge-architecture.js";
import { circleTouchesBox, rectanglesOverlap, workerHeight, workerRadius } from "./bridge-collision.js";
import { riverWorker } from "./bridge-people.js";
import { buildTea } from "./bridge-tea.js";

const width=3.30, front=.80, back=-2.28, floorY=.132;
const doorWidth=1.29, doorHeight=1.942, doorDepth=.085, hingeX=-.27;
const openAngle=Math.PI*.544;
const sillDepth=.164, stepDepth=.249, stepHeight=.071;
const stepWidth=doorWidth+.33;
const contactStart=.45, contactRelease=.65, pushEnd=.94;
const {damp,smoothstep,lerp,clamp}=THREE.MathUtils;

export function buildTeaRoom(stall,city,surface,onDoorTouch) {
  const room=new THREE.Group();
  room.name="Bridge tea room";
  room.position.x=-4.01;
  stall.add(room);
  const origin=room.getWorldPosition(new THREE.Vector3());
  const bounds={
    minX:origin.x-width*.5,maxX:origin.x+width*.5,minZ:origin.z+back,maxZ:origin.z+front,
  };
  const entrance={x:origin.x+hingeX+doorWidth*.5,z:origin.z+front};
  const solids=[];
  const shell=new Map();
  const frame=surface("tea-wood",0xa98a6f,.82,.87);
  const boards=[0xbba083,0xad987c,0xb6aa96].map(color=>surface("rail-wood",color,.78,.87));
  const worn=surface("tea-wood",0xd1b297,.91,.79);
  const plaster=surface("lime-plaster",0xe0ceb3,.65,.99);
  const roof=surface("gray-roof-tile",0xa6aba0,.89,.83);
  const footing=surface("stone-paving",0xc7c5b4,.97,.96);
  const iron=new THREE.MeshStandardMaterial({color:0x524c40,roughness:.62,metalness:.48});
  const bronze=new THREE.MeshStandardMaterial({color:0x8f7952,roughness:.47,metalness:.55});
  const glazed=new THREE.MeshPhysicalMaterial({color:0x667b66,roughness:.44,clearcoat:.30});
  const clay=new THREE.MeshStandardMaterial({color:0x93664b,roughness:.84});
  const fabric=surface("indigo-linen",0xeadaba,.46,.92);
  function mesh(parent,geometry,material,x,y,z) {
    const piece=new THREE.Mesh(geometry,material);
    piece.position.set(x,y,z);
    piece.castShadow=piece.receiveShadow=true;
    piece.layers.enable(1);
    parent.add(piece);
    return piece;
  }
  function timber(parent,mat,w,h,d,x,y,z,phase=0) {
    return mesh(parent,detailedBox(w,h,d,mat,.016,phase),mat,x,y,z);
  }
  function append(parts,material,geometry) {
    if(!parts.has(material)) parts.set(material,[]);
    parts.get(material).push(geometry);
  }
  function fittedParts(parent,parts,name) {
    for(const [mat,shapes] of parts) {
      const combined=mergeGeometries(shapes);
      for(const shape of shapes) shape.dispose();
      mesh(parent,combined,mat,0,0,0).name=name;
    }
  }
  function fixed(mat,w,h,d,x,y,z,name) {
    const detail=detailedBox(w,h,d,mat,.019,Math.sin(x*8.12+y*8.3+z*6.1)*2);
    detail.translate(x,y,z);
    append(shell,mat,detail);
    if(name) solids.push(city.box(name,origin.x+x-w*.5,origin.x+x+w*.5,origin.z+z-d*.5,origin.z+z+d*.5,
      origin.y+y-h*.5,origin.y+y+h*.5));
  }

  const middle=(front+back)*.5, depth=front-back;
  fixed(footing,width+.08,.14,depth+.09,0,.015,middle);
  for(let i=0;i<16;i++) {
    const x=(i+.5)/16*width-width*.5, seam=.34*Math.sin(i*8.15);
    const center=middle+seam;
    for(const [a,b] of [[back,center],[center,front]]) {
      fixed(boards[i%boards.length],width/16-.005,.047,b-a-.006,x,floorY-.0235,(a+b)*.5);
    }
  }
  const entryX=hingeX+doorWidth*.5;
  const nosing=surface("tea-wood",0xbda48b,.96,.86);
  const tread=surface("stone-paving",0xada898,1.03,.91);
  fixed(worn,doorWidth+.12,.052,sillDepth+.137,entryX,floorY-.026,front+(sillDepth-.137)*.5);
  fixed(nosing,doorWidth+.105,.022,.045,entryX,floorY-.011,front+sillDepth-.026);
  const treadBack=sillDepth-.016, treadFront=sillDepth+stepDepth;
  const stepWidths=[.429,.708,stepWidth-.429-.708];
  let stoneLeft=entryX-stepWidth*.5;
  for(const [i,w] of stepWidths.entries()) {
    const stone=detailedBox(w-.006,stepHeight+.038,treadFront-treadBack,tread,.017,i*2.38);
    stone.translate(stoneLeft+w*.5,(stepHeight-.038)*.5,front+(treadBack+treadFront)*.5);
    append(shell,tread,stone);
    stoneLeft+=w;
  }
  for(const x of [-width*.5,width*.5]) {
    fixed(plaster,.142,2.05,depth,x,1.15,middle,"Tea room side wall");
    fixed(footing,.18,.45,depth,x,.29,middle);
  }
  fixed(plaster,width,2.10,.15,0,1.16,back,"Tea room back wall");
  for(const x of [-.61,.72]) fixed(frame,.081,2.03,.143,x,1.18,back+.060);
  fixed(frame,width,.071,.145,0,1.216,back+.054);
  for(const x of [-1.65,1.65]) for(const z of [front,back]) {
    fixed(frame,.16,2.21,.16,x,1.10,z,"Tea room corner post");
    fixed(footing,.25,.20,.26,x,.11,z);
  }
  const pier=hingeX-(-1.65), right=hingeX+doorWidth;
  fixed(plaster,pier,1.02,.13,hingeX-pier*.5,.61,front,"Tea room window base");
  fixed(plaster,1.65-right,2.08,.15,(1.65+right)*.5,1.16,front,"Tea room front wall");
  for(const x of [hingeX-.054,right+.054]) {
    fixed(frame,.105,2.06,.20,x,1.125,front,"Tea room door jamb");
  }
  fixed(frame,width+.20,.158,.20,0,2.156,front,"Tea room lintel");
  fixed(frame,width+.20,.157,.20,0,2.16,back,"Tea room rear beam");
  for(const z of [front,back]) fixed(plaster,width,.205,.144,0,2.315,z);
  for(let i=0;i<11;i++) {
    const x=(i/10-.5)*width;
    fixed(frame,.073,.107,depth+.54,x,2.225,middle);
  }
  fixed(frame,width+.31,.126,.137,0,2.17,middle);
  fixed(frame,pier,.095,.235,hingeX-pier*.5,1.112,front);
  const slitStart=-1.49, slitEnd=hingeX-.13;
  for(let i=0;i<=8;i++) {
    const x=lerp(slitStart,slitEnd,i/8);
    fixed(boards[1],.032,.914,.066,x,1.582,front+.038);
  }
  for(const y of [1.34,1.51,1.78,2.013]) fixed(boards[0],pier-.14,.034,.066,hingeX-pier*.5,y,front+.05);

  const prep={x:.13,z:-.57,w:1.47,d:.74,y:.885};
  fixed(worn,prep.w,.085,prep.d,prep.x,prep.y-.0425,prep.z,"Tea service table");
  fixed(frame,prep.w-.12,.137,prep.d-.10,prep.x,prep.y-.146,prep.z);
  for(const x of [-.60,.60]) for(const z of [-.275,.275]) {
    fixed(frame,.079,.663,.074,prep.x+x,.465,prep.z+z);
  }
  const bench={x:-1.09,z:-.39};
  fixed(boards[0],.415,.067,1.35,bench.x,.554,bench.z,"Tea room bench");
  for(const z of [-.54,.54]) fixed(frame,.305,.41,.092,bench.x,.339,bench.z+z);
  fixed(frame,.392,.062,1.06,bench.x,.740,bench.z-.18);
  fixed(frame,.072,.68,1.51,bench.x-.152,.465,bench.z);
  fixed(worn,1.02,.048,.279,-.82,1.57,back+.18);
  fixed(worn,.64,.046,.289,1.13,1.13,back+.18);
  fixed(boards[1],.346,.042,.346,.53,prep.y+.008,-.59);
  fixed(fabric,.317,.023,.239,-1.09,.604,-.63);
  fixed(frame,.18,.90,.22,1.492,.584,-1.81);
  const stool={x:1.075,z:.34,y:.54};
  fixed(worn,.377,.062,.376,stool.x,stool.y-.031,stool.z,"Tea room stool");
  for(const x of [-.152,.152]) for(const z of [-.147,.147]) {
    fixed(frame,.055,.382,.057,stool.x+x,.325,stool.z+z);
  }
  for(const x of [-.151,.151]) fixed(frame,.041,.049,.294,stool.x+x,.284,stool.z);
  fittedParts(room,shell,"Tea room fitted joinery");
  const run=depth*.5+.39, eave=2.273, slope=.30;
  tileRoof(room,roof,width+.46,run,eave,middle,slope);
  for(const side of [-1,1]) {
    const deck=timber(room,boards[1],width+.38,.041,Math.hypot(run,run*slope)+.012,
      0,eave+run*slope*.5-.024,middle+side*run*.5);
    deck.name="Tea room roof boarding";
    deck.rotation.x=side*Math.atan(slope);
  }
  const gable=new THREE.Shape();
  const edgeY=eave+(run-depth*.5)*slope-.04;
  gable.moveTo(-depth*.5,2.16);gable.lineTo(depth*.5,2.16);
  gable.lineTo(depth*.5,edgeY);gable.lineTo(0,eave+run*slope-.04);gable.lineTo(-depth*.5,edgeY);
  gable.closePath();
  const end=new THREE.ExtrudeGeometry(gable,{depth:.132,bevelEnabled:false}).rotateY(Math.PI*.5);
  for(const x of [-width*.5,width*.5]) mesh(room,end,plaster,x-.066,0,middle).name="Filled tea room gable";
  const ridge=timber(room,frame,width+.39,.121,.141,0,eave+run*slope+.054,middle);
  ridge.name="Tea room ridge beam";
  room.userData.rainFoundation={x:origin.x,z:origin.z+middle,halfX:width*.5,halfZ:depth*.5};

  const crock=(radius,scale)=>new THREE.LatheGeometry([
    [0,0],[.62,0],[.78,.09],[.98,.43],[1,.58],[.81,.83],[.55,.89],[.59,.98],
    [.47,1],[.46,.90],[.43,.85],[.51,.62],[.63,.30],[.45,.11],[0,.11],
  ].map(([r,y])=>new THREE.Vector2(r*radius,y*scale)),28);
  for(const [i,[x,y,z,r,height]] of [
    [-1.12,1.597,-2.076,.087,.26],[-.91,1.597,-2.073,.076,.19],[-.69,1.597,-2.07,.079,.23],
    [1.02,1.156,-2.058,.093,.19],[1.19,1.156,-2.058,.070,.128],[1.23,floorY,-1.61,.25,.46],
  ].entries()) {
    mesh(room,crock(r,height),i%3===1 ? clay : glazed,x,y,z).name="Tea room crock";
  }
  solids.push(city.cylinder("Tea room storage jar",origin.x+1.23,origin.z-1.61,
    origin.y+floorY,origin.y+floorY+.46,.244));
  const lantern=new THREE.Group();
  lantern.position.set(-.26,1.97,-.30);
  lantern.name="Paper lantern above the tea table";
  room.add(lantern);
  const lanternPaper=new THREE.MeshStandardMaterial({color:0xfbdcad,roughness:.91,
    emissive:0xc77e3c,emissiveIntensity:.37});
  const lanternProfile=[[0,-.169],[.084,-.148],[.136,-.094],[.155,-.012],[.152,.063],[.112,.131],[.066,.151],[0,.163]];
  mesh(lantern,new THREE.LatheGeometry(lanternProfile.map(p=>new THREE.Vector2(...p)),36),lanternPaper,0,0,0).castShadow=false;
  for(const [r,y] of lanternProfile.slice(1,-1)) {
    mesh(lantern,new THREE.TorusGeometry(r+.0025,.0034,5,36).rotateX(Math.PI/2),frame,0,y,0).castShadow=false;
  }
  mesh(lantern,new THREE.CylinderGeometry(.005,.005,.21,8),iron,0,.268,0);
  mesh(lantern,new THREE.CylinderGeometry(.073,.082,.020,20),worn,0,-.150,0);
  const light=new THREE.PointLight(0xffdda8,2.05,3.7,2);
  light.position.set(-.26,1.76,-.20);
  light.layers.enable(1);
  room.add(light);
  const bounce=new THREE.PointLight(0xf0dcc1,.51,2.8,2);
  bounce.position.set(.56,1.13,front-.17);
  bounce.layers.enable(1);
  room.add(bounce);

  const sign=document.createElement("canvas");
  sign.width=240; sign.height=100;
  const ink=sign.getContext("2d");
  ink.fillStyle="#a9936e";
  ink.fillRect(0,0,240,100);
  ink.strokeStyle="#594333";
  ink.lineWidth=4;
  ink.strokeRect(7,7,226,86);
  ink.fillStyle="#46372a";
  ink.textAlign="center";ink.textBaseline="middle";ink.font="51px serif";
  ink.fillText("茶間",120,53);
  const signTexture=new THREE.CanvasTexture(sign);
  signTexture.colorSpace=THREE.SRGBColorSpace;
  const plate=mesh(room,new THREE.PlaneGeometry(.61,.248),
    new THREE.MeshStandardMaterial({map:signTexture,roughness:.88}),entrance.x-origin.x,2.17,front+.108);
  plate.castShadow=false;

  const pivot=new THREE.Group();
  pivot.name="Hinged tea room door";
  pivot.position.set(hingeX,floorY+.012,front);
  room.add(pivot);
  for(let i=0;i<7;i++) {
    const add=.0025*Math.sin(i*7.1);
    const per=doorWidth/7;
    timber(pivot,boards[i%boards.length],per-.004,doorHeight,doorDepth+add,(i+.5)*per,doorHeight*.5,0,i*2.134);
  }
  for(const x of [.022,doorWidth-.034]) timber(pivot,worn,.062,doorHeight-.027,.028,x,doorHeight*.5,.052,x*12);
  for(const y of [.26,1.59]) {
    timber(pivot,frame,doorWidth,.081,.032,doorWidth*.5,y,-.060,y*3);
    timber(pivot,iron,.279,.049,.017,.127,y,.056);
    mesh(pivot,new THREE.CylinderGeometry(.026,.026,.124,14),iron,.009,y,-.013);
    for(const x of [.058,.119,.197,.240]) mesh(pivot,new THREE.SphereGeometry(.011,8,6),bronze,x,y,.069);
  }
  for(const side of [-1,1]) {
    const x=doorWidth-.172, y=1.029, z=side*.069;
    timber(pivot,iron,.097,.124,.015,x,y+.025,side*.049);
    const ring=mesh(pivot,new THREE.TorusGeometry(.043,.008,10,24),bronze,x,y-.006,z);
    ring.rotation.x=side*.30;
    mesh(pivot,new THREE.SphereGeometry(.022,12,8),iron,x,y+.048,z*.90);
  }
  const joinery=new Map();
  for(const part of pivot.children) {
    part.updateMatrix();
    append(joinery,part.material,part.geometry.applyMatrix4(part.matrix));
  }
  pivot.clear();
  fittedParts(pivot,joinery,"Door boards and hardware");
  const door=city.orientedBox("Tea room door",doorWidth*.5,.082,doorHeight);
  const bottom=origin.y+pivot.position.y;
  door.bottom=bottom; door.top=bottom+doorHeight;
  let angle=0, target=0, speed=0, blocked=false;
  let push=null;
  const contact=new THREE.Object3D();
  contact.name="Tea room door palm target";
  pivot.add(contact);
  const contactPoint=new THREE.Vector3(), contactFrame=new THREE.Quaternion();
  const palmOrientations=[-1,1].map(side=>new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,side),new THREE.Vector3(0,-1,0),new THREE.Vector3(side,0,0))));
  let cx=0,cz=0;
  function center(at) {
    cx=origin.x+hingeX+Math.cos(at)*doorWidth*.5;
    cz=origin.z+front-Math.sin(at)*doorWidth*.5;
  }
  function position(at) {
    angle=at;
    center(angle);
    pivot.rotation.y=angle;
    Object.assign(door,{x:cx,z:cz,yaw:angle});
  }
  position(0);
  function hit(at,actors) {
    center(at);
    if(chair.phase!=="standing" && circleTouchesBox(standing.x,standing.z,workerRadius,
      cx,cz,door.halfX,door.halfZ,at)) return true;
    return actors.some(body=>{
      if(!body.enabled || body.bottom+.020>=door.top || body.top<=door.bottom) return false;
      return body.radius>0 ? circleTouchesBox(body.x,body.z,body.radius,cx,cz,door.halfX,door.halfZ,at) :
        rectanglesOverlap(cx,cz,door.halfX,door.halfZ,at,body.x,body.z,body.halfX,body.halfZ,body.yaw);
    });
  }

  function toggleDoor(player,freeHands) {
    if(push) return "busy";
    const outside=player.z>=entrance.z;
    if(target===0 && angle<.025 && outside && freeHands) {
      const offset=player.x-entrance.x, setback=player.z-entrance.z;
      if(Math.abs(offset)>.50 || setback>.60) return "closer";
      const hand=offset>.17 ? 0 : 1;
      const side=hand===0 ? -1 : 1;
      contact.position.set(clamp(player.x-origin.x-hingeX+side*.226,.11,doorWidth-.15),1.099,doorDepth*.5);
      push={age:0,hand,lean:clamp(.172+(setback-.44)*.66,.156,.278)};
    }
    target=target>0 ? 0 : openAngle;
    speed=0;
    blocked=false;
    return push ? "push" : "swing";
  }

  function pushWeight() {
    return push ? smoothstep(push.age,.06,contactStart)*(1-smoothstep(push.age,contactRelease,pushEnd)) : 0;
  }

  function poseDoor(playerBody) {
    if(!push) return;
    const pressure=pushWeight();
    playerBody.torsoPivot.position.z-=push.lean*pressure;
    playerBody.torsoPivot.rotation.x-=.145*pressure;
    contact.getWorldPosition(contactPoint);
    pivot.getWorldQuaternion(contactFrame).multiply(palmOrientations[push.hand]);
    playerBody.graspProp(push.hand,contactPoint,contactFrame,pressure,.10);
  }

  function cancelPush() {
    if(push && push.age<contactStart) target=angle;
    push=null;
  }

  const station=new THREE.Group();
  station.position.set(-.46,prep.y-.886,-1.66);
  room.add(station);
  const tea=buildTea(station);
  const server=riverWorker(room,surface,"attendant");
  server.figure.name="Tea room attendant";
  server.figure.position.set(.62,floorY,-1.34);
  server.figure.rotation.y=Math.PI;
  server.stand(()=>origin.y+floorY,origin.x+.62,origin.y+floorY,origin.z-1.34,Math.PI);
  server.figure.traverse(object=>object.layers.enable(1));
  const attendant=city.cylinder("Tea room attendant",origin.x+.62,origin.z-1.34,
    origin.y+floorY,origin.y+floorY+workerHeight,workerRadius);
  solids.push(attendant);
  const grip=new THREE.Vector3(), handFrame=new THREE.Quaternion();
  const cup={x:origin.x-.18,z:origin.z-.45};
  let served=false;

  function contains(x,z) {
    return x>bounds.minX && x<bounds.maxX && z>bounds.minZ && z<bounds.maxZ;
  }

  const stoolPoint={x:origin.x+stool.x,z:origin.z+stool.z};
  const standing={x:origin.x+.45,z:origin.z+.245};
  const floorHeight=origin.y+floorY;
  const seatedRoot=origin.y+stool.y-.647;
  const stoolYaw=.62;
  const chairFeet=[-1,1].map(side=>({side,x:0,y:floorHeight,z:0,yaw:0,pitch:0}));
  const chair={phase:"standing",age:0,y:floorHeight,yaw:stoolYaw,weight:0};
  const transfer={x:0,z:0,yaw:0};
  function atChair(player) {
    return contains(player.x,player.z) && Math.hypot(player.x-standing.x,player.z-standing.z)<.33 &&
      !city.blocking(standing.x,standing.z,floorHeight,workerRadius,workerHeight);
  }
  function beginChair(player,yaw) {
    if(chair.phase!=="standing" || !atChair(player)) return false;
    Object.assign(transfer,{x:player.x,z:player.z,yaw});
    chair.phase="sitting";
    chair.age=0;
    return true;
  }
  function standUp() {
    if(chair.phase!=="seated" ||
        city.blocking(standing.x,standing.z,floorHeight,workerRadius,workerHeight)) return false;
    chair.phase="rising";
    chair.age=0;
    return true;
  }
  function seatFrame(dt,player) {
    if(chair.phase==="standing") return false;
    chair.age+=dt;
    const elapsed=chair.age, sitting=chair.phase==="sitting";
    const travel=sitting ? smoothstep(elapsed,0,.59) : chair.phase==="rising" ? 1-smoothstep(elapsed,.16,.63) : 1;
    const fold=sitting ? smoothstep(elapsed,.12,.70) : chair.phase==="rising" ? 1-smoothstep(elapsed,0,.54) : 1;
    const source=sitting ? transfer : standing;
    player.x=lerp(source.x,stoolPoint.x,travel);
    player.z=lerp(source.z,stoolPoint.z,travel);
    chair.weight=fold;
    chair.y=lerp(floorHeight,seatedRoot,fold);
    const turn=Math.atan2(Math.sin(stoolYaw-transfer.yaw),Math.cos(stoolYaw-transfer.yaw));
    chair.yaw=sitting ? transfer.yaw+turn*smoothstep(elapsed,0,.59) : stoolYaw;
    const cos=Math.cos(chair.yaw),sin=Math.sin(chair.yaw);
    const forward=.245*fold;
    for(const foot of chairFeet) {
      const spread=foot.side*.109;
      foot.yaw=chair.yaw+foot.side*.10;
      foot.x=player.x+spread*cos-forward*sin;
      foot.z=player.z-spread*sin-forward*cos;
    }
    if(sitting && elapsed>=.70) {
      chair.phase="seated";
      return true;
    }
    if(chair.phase==="rising" && elapsed>=.63) {
      chair.phase="standing";
      return true;
    }
    return false;
  }

  return {
    entrance,contains,atChair,beginChair,standUp,seatFrame,chair,chairFeet,standing,
    show(visible) {
      room.visible=visible;
      for(const solid of solids) solid.enabled=visible;
      door.enabled=visible;
    },
    seated:()=>chair.phase==="seated",
    chairActive:()=>chair.phase!=="standing",
    leaveChair(player) {
      if(chair.phase==="standing") return false;
      Object.assign(player,standing);
      chair.phase="standing";
      chair.weight=0;
      return true;
    },
    speech(shape,dt) { server.face.speak(shape,dt); },
    support(x,z) {
      if(contains(x,z)) return origin.y+floorY;
      if(Math.abs(x-entrance.x)<doorWidth*.5+.06 && z>=entrance.z && z<entrance.z+sillDepth) return origin.y+floorY;
      if(Math.abs(x-entrance.x)<stepWidth*.5 && z>=entrance.z+treadBack && z<entrance.z+treadFront) return origin.y+stepHeight;
      return -Infinity;
    },
    atDoor(player) {
      return Math.hypot(player.x-entrance.x,player.z-entrance.z)<1.62;
    },
    atTable(player) {
      return chair.phase==="seated" || (contains(player.x,player.z) && Math.hypot(player.x-cup.x,player.z-cup.z)<.98);
    },
    toggleDoor,poseDoor,cancelPush,
    pushing:()=>push!==null,
    pushHand:()=>push?.hand,
    pushLook() {
      const weight=pushWeight();
      return weight ? {yaw:(push.hand===0 ? .23 : -.23)*weight,pitch:-.47*weight,forward:.115*weight} : null;
    },
    doorLabel() {
      if(push) return "正在推门";
      if(blocked) return target>0 ? "门前有阻挡 · 取消 E" : "门前有阻挡 · 打开 E";
      return target>0 ? "关茶间门 E" : "推开茶间门 E";
    },
    update(dt,time,actors,player) {
      if(push) {
        const previousAge=push.age;
        push.age+=dt;
        if(previousAge<contactStart && push.age>=contactStart) {
          contact.getWorldPosition(contactPoint);
          onDoorTouch(contactPoint.x,contactPoint.z);
        }
        if(push.age>=pushEnd) push=null;
      }
      if(dt>0 && target!==angle && (!push || push.age>=contactStart)) {
        const delta=target-angle, remaining=Math.abs(delta);
        const direction=Math.sign(delta);
        // Leave a little clearance before resuming a stopped swing. Otherwise
        // tiny restart steps chatter against the same contact point.
        if(!blocked || !hit(angle+direction*Math.min(.023,remaining),actors)) {
          blocked=false;
          const underHand=push && push.age<contactRelease;
          speed=damp(speed,underHand ? .71 : .53+1.99*smoothstep(remaining,0,.81),13,dt);
          const amount=Math.min(remaining,speed*dt), steps=Math.ceil(amount/.035);
          for(let i=0;i<steps;i++) {
            const next=Math.abs(target-angle)<=amount/steps+.00001 ? target : angle+direction*amount/steps;
            if(hit(next,actors)) { speed=0;blocked=true;break; }
            position(next);
          }
        }
      }
      tea.update(time);
      const age=tea.age();
      const lean=smoothstep(age,-.53,-.12)*(1-smoothstep(age,4.31,4.60));
      const reach=smoothstep(age,-.46,-.024)*(1-smoothstep(age,4.28,4.58));
      server.torsoPivot.position.z=-.236*lean;
      server.torsoPivot.rotation.x=-.30*lean;
      const dx=player.x-origin.x-server.figure.position.x,dz=player.z-origin.z-server.figure.position.z;
      const watching=contains(player.x,player.z) && Math.hypot(dx,dz)<2.8;
      const yaw=(watching ? clamp(Math.atan2(dx,dz),-.55,.55) : -.06)*(1-lean)-.13*lean;
      server.head.rotation.x=damp(server.head.rotation.x,.024*Math.sin(time*1.42)-.12*lean,9,dt);
      server.head.rotation.y=damp(server.head.rotation.y,yaw,9,dt);
      server.face.lookEyes(.45*yaw,-.68*lean,dt);
      server.face.blink(Math.max(0,1-Math.abs(time%4.17-.15)/.11));
      server.holdKettle(tea.grip(grip,handFrame),handFrame,reach);
      server.poseSleeves();
      return served && age>=tea.duration;
    },
    serve(time) { served=true;tea.start(time); },
    restore(alreadyServed,time,resetDoor=false) {
      cancelPush();
      served=alreadyServed;
      tea.reset();
      if(served) tea.start(time-tea.duration);
      if(resetDoor) {
        chair.phase="standing";
        chair.weight=0;
        target=0;
        speed=0;
        blocked=false;
        position(0);
      }
    },
    inspect(player) {
      return {inside:contains(player.x,player.z),nearDoor:this.atDoor(player),atTable:this.atTable(player),
        entrance,cup,chair:{...chair,atChair:atChair(player)},
        door:{angle,target,blocked,x:door.x,z:door.z,push:push && {age:push.age,hand:push.hand}},served,tea:tea.inspect()};
    },
  };
}
