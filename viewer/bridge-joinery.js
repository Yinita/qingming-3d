import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";
import { riverWorker } from "./bridge-people.js";

const saveKey="qingming-west-joinery-v1";
const passes=6, rhythm=1.28, readyTime=1.18;
const cutStart=.12, cutEnd=.64;
const {clamp,damp,lerp,smoothstep}=THREE.MathUtils;

function add(group,shape,material,x=0,y=0,z=0) {
  const mesh=new THREE.Mesh(shape,material);
  mesh.castShadow=mesh.receiveShadow=true;
  mesh.position.set(x,y,z);
  mesh.layers.enable(1);
  group.add(mesh);
  return mesh;
}

function curvedShaving() {
  const positions=[],index=[];
  for(let i=0;i<=9;i++) {
    const phase=i/9*5.15, radius=.012+.003*Math.sin(phase*.35);
    const width=.012*(.45+.55*Math.sin(Math.PI*i/9));
    for(const side of [-1,1]) positions.push(side*width,radius*Math.sin(phase),radius*(1-Math.cos(phase)));
    if(i) {
      const a=i*2;
      index.push(a-2,a,a-1,a,a+1,a-1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function createJoinery(parent,city,surface,floor,worktop,timberReady,sound) {
  const root=new THREE.Group();
  root.name="West bank joinery";
  parent.add(root);
  const desk=new THREE.Group();
  desk.name="Joiner's planing station";
  desk.position.set(worktop.x,worktop.y,worktop.z-.04);
  root.add(desk);
  const x=-.197, boardW=.225,boardL=.94, rawHeight=.060;
  const timber=surface("tea-wood",0xd6a475,.76,.88);
  const hardwood=surface("rail-wood",0xb58b63,.67,.91);
  const toolWood=surface("rail-wood",0x98694c,.57,.91);
  const iron=new THREE.MeshStandardMaterial({color:0x514c44,roughness:.47,metalness:.57});
  const cutIron=new THREE.MeshStandardMaterial({color:0xa39d8d,roughness:.29,metalness:.69});
  const brass=new THREE.MeshStandardMaterial({color:0x8e694e,roughness:.45,metalness:.43});
  function block(group,material,w,h,d,x,y,z,round=.011) {
    return add(group,detailedBox(w,h,d,material,round,(x+z)*3),material,x,y,z);
  }

  const boardAssembly=new THREE.Group();
  boardAssembly.name="West bank planed board";
  function returnBoard() {
    desk.add(boardAssembly);
    boardAssembly.position.set(x,0,0);
    boardAssembly.quaternion.identity();
  }
  returnBoard();
  const board=block(boardAssembly,hardwood,boardW,.054,boardL,0,.0324,0,.004);
  board.name="Rough wooden blank";
  const surfaceGeometry=new THREE.PlaneGeometry(boardW-.002,boardL-.002,18,49);
  surfaceGeometry.rotateX(-Math.PI*.5);
  const boardTop=add(boardAssembly,surfaceGeometry,timber);
  boardTop.name="Planed board surface";
  const points=surfaceGeometry.attributes.position;
  function rough(u,v) {
    const ridges=Math.sin(u*103+v*10)+.52*Math.sin(u*172-v*37)+.34*Math.cos(v*61+u*40);
    const edge=(1-smoothstep(Math.abs(u),boardW*.34,boardW*.50))*
      (1-smoothstep(Math.abs(v),boardL*.43,boardL*.50));
    return edge*(.009+.0066*ridges+.004*Math.sin(v*19+u*9));
  }
  const relief=Float32Array.from({length:points.count},(_,i)=>rough(points.getX(i),points.getZ(i)));
  function topAt(z,amount) {return rawHeight+rough(0,z)*(1-amount);}
  function boardSurface(done,cutTo,engaged) {
    for(let i=0;i<points.count;i++) {
      const edge=engaged ? smoothstep(points.getZ(i),cutTo-.042,cutTo+.042) : 0;
      const finished=clamp((done+edge)/passes,0,1);
      points.setY(i,rawHeight+relief[i]*(1-finished));
    }
    points.needsUpdate=true;
    surfaceGeometry.computeVertexNormals();
  }

  for(const z of [-.535,.535]) {
    block(desk,hardwood,.158,.047,.096,x,.024,z);
    block(desk,iron,.13,.022,.024,x,.055,z-Math.sign(z)*.034,.006);
  }
  for(const [i,length] of [.239,.304,.26].entries()) {
    const chisel=block(desk,cutIron,.025,.010,length,.208+i*.049,.033,.36-i*.052,.004);
    chisel.rotation.y=.23-i*.18;
    block(desk,toolWood,.037,.034,.112,.208+i*.049,.041,.47-i*.061,.009);
  }
  const plane=new THREE.Group();
  plane.name="Wooden hand plane";
  desk.add(plane);
  block(plane,toolWood,.139,.064,.282,0,.037,0,.017);
  block(plane,iron,.104,.010,.239,0,.003,-.003,.004);
  const blade=block(plane,cutIron,.112,.136,.011,0,.071,-.026,.003);
  blade.rotation.x=-.52;
  const wedge=block(plane,hardwood,.088,.112,.041,0,.078,.010,.006);
  wedge.rotation.x=-.51;
  for(const z of [-.101,.1]) {
    block(plane,brass,.108,.010,.025,0,.071,z,.005);
    const handle=add(plane,new THREE.LatheGeometry([
      [.023,0],[.027,.022],[.027,.042],[.035,.081],[.032,.105],[.019,.118],[0,.12],
    ].map(([r,y])=>new THREE.Vector2(r,y)),24),hardwood,0,.063,z);
    handle.rotation.z=-.18;
  }
  const grips=[-.101,.100].map(z=>{
    const grip=new THREE.Object3D();
    grip.name="Hand plane grip";
    grip.position.set(.011,.151,z);
    grip.rotation.set(.58,-Math.PI*.5,0,"YXZ");
    plane.add(grip);
    return grip;
  });

  const shaveStock=passes*11;
  const shavings=new THREE.InstancedMesh(curvedShaving(),
    new THREE.MeshStandardMaterial({color:0xe2b487,roughness:.88,side:THREE.DoubleSide}),shaveStock);
  shavings.name="Curled wood shavings";
  shavings.count=0;
  shavings.castShadow=shavings.receiveShadow=true;
  shavings.layers.enable(1);
  shavings.frustumCulled=false;
  desk.add(shavings);
  const scraps=[];
  const anchor=new THREE.Object3D();
  const joiner=riverWorker(root,surface,"joiner");
  joiner.figure.name="West bank joiner";
  const stand={x:worktop.x-.646,y:worktop.floorLevel,z:worktop.z-.035,yaw:-Math.PI*.5};
  joiner.figure.position.set(stand.x,stand.y,stand.z);
  joiner.figure.rotation.y=stand.yaw;
  const feet=joiner.stand(floor,stand.x,stand.y,stand.z,stand.yaw);
  const body=city.cylinder("West bank joiner",stand.x,stand.z,stand.y,stand.y+1.73,.29);
  const palm=new THREE.Vector3(),palmFrame=new THREE.Quaternion();
  let mode="waiting",elapsed=0,clock=0,lastCount=-1,scrapCount=0,strokes=0,grip=0,showcase=0;
  let persisted=true;

  function loadScrap(i,at,from) {
    const step=i%11;
    const length=.13+.15*(.5+.5*Math.cos(i*5.21));
    const side=i%4===0 ? -1 : 1;
    return {at,from,side,dx:x+side*(.105+length),dz:from+.127*Math.sin(i*4.22),
      angle:i*2.399,scale:.59+.45*Math.sin((step+.5)*.29)**2};
  }
  function poseScraps() {
    for(const [i,p] of scraps.entries()) {
      const t=clamp((clock-p.at)/.50,0,1);
      anchor.position.set(lerp(x+.022*p.side,p.dx,t),.079+Math.sin(Math.PI*t)*.17-.059*t,
        lerp(p.from,p.dz,t));
      anchor.rotation.set(p.angle+t*4.9,p.angle+t*2.1,.31+t*2.6);
      anchor.scale.setScalar(p.scale);
      anchor.updateMatrix();
      shavings.setMatrixAt(i,anchor.matrix);
    }
    shavings.count=scrapCount;
    shavings.instanceMatrix.needsUpdate=true;
  }
  function parkTool() {
    const atBench=boardAssembly.parent===desk;
    plane.position.set(x+.012,atBench ? topAt(.435,mode==="done" ? 1 : 0) : .010,.432);
    plane.rotation.set(0,0,-.024);
  }
  function restore() {
    try {
      if(localStorage.getItem(saveKey)==="done") {
        mode="done";
        strokes=passes;
        for(let i=0;i<shaveStock;i++) scraps.push(loadScrap(i,-2,lerp(.408,-.4,(i%11+.45)/11)));
        scrapCount=scraps.length;
      }
    } catch { persisted=false; }
    boardSurface(strokes,0,false);
    parkTool();
    poseScraps();
  }
  restore();

  function near(player) {
    return player.x>worktop.x+.43 && player.x<worktop.x+1.79 && Math.abs(player.z-desk.position.z)<1.08 &&
      player.z<worktop.z+.99;
  }
  function use(player) {
    if(!near(player) || mode==="working") return null;
    if(mode==="done") {
      showcase=2.50;
      return "joinerDone";
    }
    if(!timberReady()) return "joinerWaiting";
    elapsed=strokes=0;
    lastCount=-1;
    mode="working";
    return "joinerWork";
  }

  function frame(dt,player,speech,look) {
    clock+=dt;
    showcase=Math.max(0,showcase-dt);
    const speaking=speech.id?.startsWith("joiner");
    if(mode!=="working" && !speaking && !showcase && Math.hypot(player.x-stand.x,player.z-stand.z)>11) return;
    joiner.walkBody(0,false,false,dt);
    for(const hand of joiner.limbs.hands) hand.group.quaternion.identity();
    const working=mode==="working";
    let follow=0,effort=0;
    if(working) {
      elapsed+=dt;
      const run=Math.max(0,elapsed-readyTime);
      const stride=Math.min(passes,Math.floor(run/rhythm));
      if(stride===passes) {
        mode="done";
        strokes=passes;
        boardSurface(strokes,0,false);
        parkTool();
        if(persisted) try { localStorage.setItem(saveKey,"done"); } catch { persisted=false; }
      } else {
        const t=run/rhythm-stride;
        const push=smoothstep(t,cutStart,cutEnd);
        const back=smoothstep(t,.67,.99);
        const z=lerp(.419,-.414,push-back);
        const cutting=t>=cutStart && t<cutEnd;
        const undoLift=.071*Math.sin(Math.PI*smoothstep(t,.65,.995));
        const cutTo=z-.043;
        const pose=smoothstep(elapsed,.19,.97);
        if(cutting && lastCount!==stride) {
          lastCount=stride;
          sound("plane",desk.position.x+x,desk.position.z+z,.83);
        }
        if(cutting || t>=cutEnd) {
          const count=stride*11+Math.round(11*push);
          for(let i=scrapCount;i<count;i++) {
            scraps.push(loadScrap(i,clock,lerp(.389,-.435,(i%11+.5)/11)));
          }
          scrapCount=Math.max(scrapCount,count);
        }
        const complete=stride+Number(t>=cutEnd);
        if(cutting || complete!==strokes) boardSurface(complete,cutTo,cutting);
        strokes=complete;
        plane.position.set(x,topAt(z,clamp((stride+push)/passes,0,1))+undoLift,z);
        plane.rotation.set(.25*undoLift,0,-.028*pose);
        follow=z*.68*pose;
        effort=pose*(.90+.10*Math.sin(push*Math.PI));
      }
    }
    grip=damp(grip,mode==="working" ? smoothstep(elapsed,.19,1.06) : 0,13,dt);
    joiner.torsoPivot.position.x=follow;
    joiner.torsoPivot.position.z=-.143*effort;
    joiner.torsoPivot.rotation.x=-.58*effort;
    joiner.torsoPivot.rotation.z=-follow*.43;
    joiner.poseFeet(feet,floor,stand.x,stand.y,stand.z,stand.yaw);
    if(mode==="working") for(const [i,handle] of grips.entries()) {
      handle.getWorldQuaternion(palmFrame);
      joiner.graspProp(i,handle.getWorldPosition(palm),palmFrame,grip);
    }
    if(mode==="working" && elapsed>.71) {
      look(joiner,desk.position.x+x,desk.position.y+.14,desk.position.z+plane.position.z,dt,0);
    } else if(showcase>.40 && showcase<2.11 && !speaking) {
      look(joiner,desk.position.x+x,desk.position.y+.07,desk.position.z,dt,.032);
      joiner.reachHand(1,palm.set(desk.position.x+x-.047,desk.position.y+.17,desk.position.z+.17),
        .55*Math.sin(Math.PI*showcase/2.5));
    } else if(near(player) || speaking) look(joiner,player.x,floor(player.x,player.z)+1.49,player.z,dt,speech.emphasis*.026);
    else look(joiner,desk.position.x+x,desk.position.y+.22,desk.position.z,dt,.035);
    joiner.face.speak(speaking ? speech.shape : null,dt);
    joiner.face.blink(Math.max(0,1-Math.abs((clock+2.2)%4.47-.18)/.11));
    joiner.poseSleeves();
    if(scrapCount && (working || clock-scraps[scrapCount-1].at<.55)) poseScraps();
  }

  return {
    use,frame,near,
    returnBoard() {
      returnBoard();
      parkTool();
    },
    planed:()=>mode==="done",
    moveBoard(holder) {
      holder.attach(boardAssembly);
      parkTool();
      return boardAssembly;
    },
    action() {
      if(mode==="working") return null;
      return mode==="done" ? "问木匠看成品 E" : timberReady() ? "请木匠刨板 E" : "问木匠 E";
    },
    status:()=>mode==="working" ? "木匠刨板 "+strokes+" / "+passes : mode==="done" ? "木板已刨好" : null,
    show(on) { root.visible=body.enabled=on; },
    reset() {
      mode="waiting"; elapsed=strokes=scrapCount=grip=showcase=0;
      lastCount=-1;
      scraps.length=0;
      shavings.count=0;
      boardSurface(0,0,false);
      parkTool();
      if(persisted) try { localStorage.removeItem(saveKey); } catch { persisted=false; }
    },
    inspect:()=>({mode,elapsed,strokes,scraps:scrapCount,grip,timberReady:timberReady(),
      station:{x:desk.position.x,z:desk.position.z,y:desk.position.y},tool:plane.position.toArray()}),
  };
}
