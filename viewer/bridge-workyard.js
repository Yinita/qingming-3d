import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { rectanglesOverlap } from "./bridge-collision.js";

const saveKey="qingming-west-workyard-v1";
const footprint={halfX:.491,halfZ:.513,height:1.07};
const standOff=.895;
const {clamp,damp}=THREE.MathUtils;

const loads=[
  {id:"timber",name:"木料",x:-73.62,z:-44.96,bayX:-73.62,bayZ:-46.97,color:0xc2945b},
  {id:"jars",name:"陶罐",x:-70.92,z:-44.95,bayX:-70.88,bayZ:-48.42,color:0x647a6f},
];
export const workyardEntry={x:-73.62,z:-44.05};
const bollard={x:-70.90,z:-46.45,radius:.30};
const headingDelta=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));

function add(parent,geometry,material,x=0,y=0,z=0) {
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.set(x,y,z);
  mesh.castShadow=mesh.receiveShadow=true;
  mesh.layers.enable(1);
  parent.add(mesh);
  return mesh;
}
function plank(parent,material,w,h,d,x,y,z,bevel=.017) {
  return add(parent,detailedBox(w,h,d,material,bevel,x*3.1+z*1.7),material,x,y,z);
}
function lathe(parent,profile,material,x,y,z,segments=40) {
  return add(parent,new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r,h)),segments),material,x,y,z);
}
function cord(parent,points,material,radius=.009) {
  const path=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  return add(parent,new THREE.TubeGeometry(path,points.length*5,radius,6,false),material);
}
function mergeWoodwork(group) {
  group.updateMatrixWorld(true);
  const inverse=group.matrixWorld.clone().invert();
  const parts=new Map();
  group.traverse(mesh=>{
    if(!mesh.isMesh) return;
    const meshes=parts.get(mesh.material)??[];
    meshes.push(mesh);
    parts.set(mesh.material,meshes);
  });
  for(const [material,meshes] of parts) {
    if(meshes.length===1) continue;
    const pieces=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
    const geometry=mergeGeometries(pieces);
    for(const piece of pieces) piece.dispose();
    if(!geometry) continue;
    for(const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    add(group,geometry,material);
  }
}
function paint(text,ink) {
  const canvas=document.createElement("canvas");
  canvas.width=320;
  canvas.height=112;
  const brush=canvas.getContext("2d");
  brush.fillStyle="#b7a07b";
  brush.fillRect(0,0,320,112);
  brush.strokeStyle="#69503a";
  brush.lineWidth=5;
  brush.strokeRect(6,6,308,100);
  brush.font="54px 'Noto Serif CJK SC','Songti SC',serif";
  brush.fillStyle=ink;
  brush.textAlign="center";
  brush.textBaseline="middle";
  brush.fillText(text,160,58);
  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map,roughness:.93,side:THREE.DoubleSide});
}

function buildSled(group,spec,materials) {
  const {wood,raw,dark,rope,glaze,clay,metal,endGrain}=materials;
  for(const x of [-.332,.332]) {
    plank(group,dark,.105,.102,.798,x,.051,-.047,.027);
    plank(group,wood,.094,.060,.722,x,.136,-.033);
  }
  for(let i=0;i<5;i++) plank(group,i%2 ? raw : wood,.91,.068,.148,0,.177,-.355+.152*i);
  for(const x of [-.406,.406]) {
    plank(group,dark,.070,.073,.738,x,.247,-.033);
    plank(group,wood,.064,.792,.075,x,.604,.327);
    plank(group,wood,.061,.230,.082,x,.289,-.365);
    plank(group,metal,.076,.047,.088,x,.938,.325,.009);
    cord(group,[[x,.214,-.098],[x,.344,.032],[x,.531,.172],[x,.703,.325]],dark,.025);
    plank(group,wood,.076,.074,.198,x,1.022,.407,.018);
  }
  add(group,new THREE.CylinderGeometry(.036,.036,.894,24),wood,0,1.022,.474).rotation.z=Math.PI*.5;
  for(const x of [-.206,.206]) {
    for(let i=0;i<7;i++) {
      const band=add(group,new THREE.TorusGeometry(.038,.0042,7,20),rope,x+(i-3)*.011,1.022,.474);
      band.rotation.y=Math.PI*.5;
    }
  }
  if(spec.id==="timber") {
    for(let row=0;row<4;row++) for(let col=0;col<4-row%2;col++) {
      const x=(col-(3-row%2)*.5)*.202+.007*Math.sin(row*5+col);
      const y=.267+row*.119, length=.663+.054*Math.sin(col*6+row*4);
      const beam=plank(group,(row+col)%3===0 ? raw : wood,.176,.112,length,x,y,-.035,.011);
      beam.rotation.y=.026*Math.sin((row+1)*(col+4));
      for(const face of [-1,1]) {
        const end=add(group,new THREE.PlaneGeometry(.151,.091),endGrain,x,y,-.035+face*(length*.5+.001));
        end.rotation.y=face>0 ? 0 : Math.PI;
      }
    }
    for(const x of [-.244,.244]) {
      const runs=[[x,.211,-.413],[x,.508,-.361],[x,.666,-.302],[x,.688,-.233],
        [x,.692,.13],[x,.654,.262],[x,.512,.360],[x,.215,.373]];
      cord(group,runs,rope,.011);
      cord(group,runs.map(([px,y,z])=>[px+.023,y+.003,z]),rope,.008);
    }
  } else {
    const profile=[[0,.009],[.097,.009],[.146,.038],[.181,.120],[.194,.240],[.169,.375],
      [.112,.449],[.091,.486],[.106,.515],[.100,.534],[.085,.534],[.074,.505],[.077,.476],[0,.458]];
    for(const [i,x] of [-.209,.212].entries()) {
      const crock=new THREE.Group();
      crock.position.set(x,.215,i ? -.092 : -.051);
      crock.scale.setScalar(i ? .91 : 1.04);
      group.add(crock);
      lathe(crock,profile,i ? clay : glaze,0,0,0);
      for(const [radius,y] of [[.101,.037],[.169,.090],[.190,.218],[.191,.253],[.099,.503]]) {
        add(crock,new THREE.TorusGeometry(radius,.0055,8,36),i ? glaze : clay,0,y,0).rotation.x=-Math.PI*.5;
      }
      lathe(crock,[[0,.523],[.084,.524],[.118,.540],[.111,.568],[.075,.579],[.034,.582],[.032,.612],[0,.616]],clay,0,0,0);
      const ties=Array.from({length:11},(_,j)=>{
        const phase=j*Math.PI*.2;
        return [.115*Math.sin(phase),.545+.006*Math.sin(phase*3),.115*Math.cos(phase)];
      });
      cord(crock,ties,rope,.009);
    }
    for(const x of [-.367,.367]) {
      cord(group,[[x,.215,-.35],[x,.466,-.302],[x*.75,.65,-.232],[x*.47,.745,-.059],
        [x*.78,.65,.106],[x,.471,.191],[x,.218,.286]],rope,.013);
    }
  }
  add(group,new THREE.PlaneGeometry(.202,.092),paint(spec.name,"#433421"),0,.259,.346);
  return [-.206,.206].map(x=>{
    const grip=new THREE.Object3D();
    grip.name="Workyard bar grip";
    grip.position.set(x,1.023,.479);
    grip.rotation.set(Math.PI*.48,0,0,"YXZ");
    group.add(grip);
    return grip;
  });
}

export function woodEndGrain() {
  const canvas=document.createElement("canvas");
  canvas.width=canvas.height=128;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#a67c4f";
  ctx.fillRect(0,0,128,128);
  ctx.save();
  ctx.translate(31,86);
  ctx.scale(1,.51);
  for(let i=1;i<22;i++) {
    const r=5*i+.9*Math.sin(i*14);
    ctx.strokeStyle=i%5===0 ? "#75563c" : "#8f6a46";
    ctx.lineWidth=i%3===0 ? 1.6 : .7;
    ctx.beginPath();
    ctx.ellipse(1.7*Math.sin(i),0,r,r*1.12,.19,0,Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({map,roughness:.94});
}

export function createWorkyard(parent,city,surface,floor,dry) {
  const root=new THREE.Group();
  root.name="West bank workyard";
  parent.add(root);
  const standard=(color,roughness=.81,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const materials={
    wood:surface("rail-wood",0xbc9473,.78,.93), raw:surface("tea-wood",0xddb994,.79,.96),
    dark:surface("rail-wood",0x795a42,.74,.90), stone:surface("worn-stone",0xad9b80,.61,.94),
    rope:standard(0x8e714d,.94),glaze:standard(0x687c69,.39),clay:standard(0xa26544,.72),
    metal:standard(0x5e554a,.64,.27),endGrain:woodEndGrain(),
  };
  const blockY=floor(bollard.x,bollard.z);
  const block=lathe(root,[[0,0],[.305,0],[.302,.08],[.255,.135],[.228,.29],[.210,.37],[.158,.425],[0,.425]],
    materials.stone,bollard.x,blockY,bollard.z,10);
  block.name="Workyard stone bollard";
  const blockSolid=city.cylinder(block.name,bollard.x,bollard.z,blockY,blockY+.425,bollard.radius);
  add(root,new THREE.TorusGeometry(.244,.0095,7,30),materials.rope,bollard.x,blockY+.164,bollard.z).rotation.x=-Math.PI*.5;

  const items=loads.map(spec=>{
    const model=new THREE.Group();
    model.name="Workyard "+spec.id;
    root.add(model);
    const grips=buildSled(model,spec,materials);
    mergeWoodwork(model);
    const solid=city.orientedBox(model.name,footprint.halfX,footprint.halfZ,footprint.height);
    const groundColor=standard(spec.color,.98);
    const marker=standard(0x70513e,.93);
    for(const dx of [-.622,.622]) for(const dz of [-.593,.593]) {
      const x=spec.bayX+dx,z=spec.bayZ+dz,y=floor(x,z);
      plank(root,groundColor,.193,.041,.084,x-Math.sign(dx)*.065,y+.006,z);
      plank(root,groundColor,.083,.041,.192,x,y+.007,z-Math.sign(dz)*.064);
    }
    const x=spec.bayX+.58,z=spec.bayZ-.58,y=floor(x,z);
    plank(root,marker,.063,.49,.077,x,y+.243,z);
    plank(root,materials.wood,.38,.168,.043,x,y+.49,z);
    add(root,new THREE.PlaneGeometry(.35,.144),paint(spec.name+"位","#49372b"),x,y+.49,z+.023);
    return {...spec,model,solid,grips,groundColor,yaw:0,y:0};
  });
  const plaqueX=-74.73,plaqueZ=-45.36,plaqueY=floor(plaqueX,plaqueZ);
  for(const dx of [-.34,.34]) plank(root,materials.dark,.073,1.21,.083,plaqueX+dx,plaqueY+.591,plaqueZ);
  plank(root,materials.wood,.865,.242,.066,plaqueX,plaqueY+1.06,plaqueZ);
  add(root,new THREE.PlaneGeometry(.803,.214),paint("西岸料場","#43301e"),plaqueX,plaqueY+1.057,plaqueZ+.035);
  const placard=city.orientedBox("Workyard plaque",.44,.071,1.22);
  Object.assign(placard,{x:plaqueX,z:plaqueZ,bottom:plaqueY,top:plaqueY+1.22,camera:false});
  const fenceX=-75.48,fenceZ=-43.15,spacing=.76,span=9;
  const fencing=new THREE.Group();
  root.add(fencing);
  for(let i=0;i<=span;i++) {
    const z=fenceZ-i*spacing,y=floor(fenceX,z),post=.93+.082*Math.sin(i*6);
    plank(fencing,materials.dark,.108,post,.114,fenceX,y+post*.5-.016,z,.018);
    plank(fencing,materials.stone,.156,.061,.159,fenceX,y+.019,z,.019);
    if(i===span) continue;
    const middle=z-spacing*.5,grade=floor(fenceX,middle);
    for(const rail of [.36,.68]) plank(fencing,materials.wood,.072,.105,spacing+.042,fenceX,grade+rail,middle);
    for(let slat=0;slat<3;slat++) {
      const at=z-(slat+.5)*spacing/3,base=floor(fenceX,at),height=.71+.083*Math.sin(4*i+slat);
      const board=plank(fencing,slat%2 ? materials.dark : materials.wood,.055,height,.097,fenceX+.045,base+height*.53,at,.009);
      board.rotation.x=.05*Math.sin(7*i+slat*4);
    }
  }
  mergeWoodwork(fencing);
  const fence=city.box("Workyard boundary fence",fenceX-.10,fenceX+.11,fenceZ-span*spacing-.061,fenceZ+.06,-.03,1.12);
  fence.camera=false;

  let active=null, speed=0, turnRate=0, blocked=null, aligning=false, weight=0, distance=0, impactWait=0;
  let persist=true;
  const pose=new THREE.Vector3(),normal=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  const tilt=new THREE.Quaternion(),orientation=new THREE.Quaternion();
  const candidate={y:0,slopeX:0,slopeZ:0};
  const approach={x:0,z:0};
  const sample=new Float64Array(4);
  const corners=[[-.33,-.38],[.33,-.38],[-.33,.31],[.33,.31]];

  function parkStatus(item) {
    return Math.hypot(item.x-item.bayX,item.z-item.bayZ)<.31 && Math.abs(Math.sin(item.yaw))<.43;
  }
  function parked() { return items.filter(parkStatus).length; }

  function dockAt(out,x,z,yaw) {
    out.x=x+Math.sin(yaw)*standOff;
    out.z=z+Math.cos(yaw)*standOff;
  }
  function support(out,x,z,yaw) {
    const cos=Math.cos(yaw),sin=Math.sin(yaw);
    for(const [i,[u,v]] of corners.entries()) {
      const sx=x+u*cos+v*sin,sz=z-u*sin+v*cos;
      if(!dry(sx,sz)) return false;
      sample[i]=floor(sx,sz);
    }
    if(Math.max(...sample)-Math.min(...sample)>.23) return false;
    out.slopeX=(sample[1]+sample[3]-sample[0]-sample[2])/1.32;
    out.slopeZ=(sample[2]+sample[3]-sample[0]-sample[1])/1.38;
    out.y=sample.reduce((a,b)=>a+b,0)*.25+out.slopeZ*.035+
      Math.abs((sample[0]+sample[3]-sample[1]-sample[2])*.25);
    return true;
  }
  function open(item,x,z,yaw) {
    if(x< -74.37 || x> -69.65 || z< -48.58 || z> -43.70 || !support(candidate,x,z,yaw)) return "料场边缘";
    const obstruction=city.boxBlocking(x,z,candidate.y,footprint.halfX,footprint.halfZ,footprint.height,yaw,item.solid);
    if(obstruction) return obstruction.name;
    return null;
  }
  function apply(item,x,z,yaw) {
    Object.assign(item,{x,z,yaw,y:candidate.y});
    normal.set(-candidate.slopeX,1,-candidate.slopeZ).normalize();
    item.model.position.set(x,item.y,z);
    item.model.quaternion.copy(orientation.setFromAxisAngle(up,yaw)).multiply(tilt.setFromUnitVectors(up,normal));
    Object.assign(item.solid,{x,z,yaw,bottom:item.y,top:item.y+footprint.height});
    item.groundColor.color.setHex(parkStatus(item) ? 0x8e9a64 : item.color);
  }
  function reset() {
    release(false);
    for(const [i,item] of items.entries()) {
      const {x,z}=loads[i];
      support(candidate,x,z,0);
      apply(item,x,z,0);
    }
    if(persist) try { localStorage.removeItem(saveKey); } catch { persist=false; }
  }
  function save() {
    if(persist) try { localStorage.setItem(saveKey,JSON.stringify(items.map(({x,z,yaw})=>[x,z,yaw]))); }
    catch { persist=false; }
  }

  for(const item of items) {
    support(candidate,item.x,item.z,0);
    apply(item,item.x,item.z,0);
  }
  try {
    const data=JSON.parse(localStorage.getItem(saveKey));
    if(Array.isArray(data) && data.length===items.length && data.every(arr=>Array.isArray(arr) && arr.length===3 && arr.every(Number.isFinite))) {
      const [[ax,az,a],[bx,bz,b]]=data;
      const {halfX,halfZ}=footprint;
      if(!rectanglesOverlap(ax,az,halfX,halfZ,a,bx,bz,halfX,halfZ,b)) {
        for(const item of items) item.solid.enabled=false;
        const positions=data.map(([x,z,angle])=>[x,z,Math.atan2(Math.sin(angle),Math.cos(angle))]);
        if(positions.every(([x,z,yaw],i)=>!open(items[i],x,z,yaw))) {
          for(const [i,[x,z,yaw]] of positions.entries()) {
            support(candidate,x,z,yaw);
            apply(items[i],x,z,yaw);
          }
        }
        for(const item of items) item.solid.enabled=true;
      }
    }
  } catch { persist=false; }

  function nearest(player) {
    let result=null,best=.37;
    for(const item of items) {
      dockAt(approach,item.x,item.z,item.yaw);
      const d=Math.hypot(player.x-approach.x,player.z-approach.z);
      if(d<best) { result=item;best=d; }
    }
    return result;
  }
  function grab(player,canStand) {
    const item=nearest(player);
    if(!item) return null;
    dockAt(approach,item.x,item.z,item.yaw);
    if(!canStand(approach.x,approach.z,item.solid)) return null;
    active=item;
    speed=turnRate=weight=distance=impactWait=0;
    blocked=null;
    aligning=true;
    player.yaw=item.yaw;
    return item.name;
  }
  function release(write=true) {
    if(!active) return null;
    const name=active.name;
    active=null;
    speed=turnRate=weight=0;
    blocked=null;
    aligning=false;
    if(write) save();
    return name;
  }

  function frame(dt,player,bodyYaw,turn,drive,traction,canStand,hit) {
    if(!active) return;
    impactWait=Math.max(0,impactWait-dt);
    if(aligning) {
      dockAt(approach,active.x,active.z,active.yaw);
      const vx=approach.x-player.x,vz=approach.z-player.z;
      const gap=Math.hypot(vx,vz);
      const step=Math.min(1,1.60*dt/Math.max(.001,gap));
      pose.set(player.x+vx*step,0,player.z+vz*step);
      if(!canStand(pose.x,pose.z,active.solid)) { release();return; }
      player.x=pose.x;
      player.z=pose.z;
      aligning=gap>.021 || Math.abs(headingDelta(bodyYaw,active.yaw))>.17;
      return;
    }
    weight=damp(weight,1,19,dt);
    speed=damp(speed,drive*(drive>0 ? .80 : .52)*traction,drive ? 6 : 16,dt);
    turnRate=damp(turnRate,-turn*1.20*(drive ? .88 : 1),9,dt);
    blocked=null;
    const ticks=Math.max(1,Math.ceil(dt/.014));
    const attempt=(x,z,yaw)=>{
      const stop=open(active,x,z,yaw);
      if(stop) return stop;
      dockAt(approach,x,z,yaw);
      return !canStand(approach.x,approach.z,active.solid) ||
        Math.abs(floor(approach.x,approach.z)-candidate.y)>.25 ? "脚边有阻挡" : null;
    };
    for(let i=0;i<ticks;i++) {
      const steer=turnRate*dt/ticks;
      const lag=headingDelta(bodyYaw,active.yaw);
      // The sled can turn as the worker shifts their footing and follows the bar.
      const yaw=active.yaw+Math.sign(steer)*Math.min(Math.abs(steer),Math.max(0,.24-Math.sign(steer)*lag));
      const displacement=speed*dt/ticks;
      let x=active.x-Math.sin(yaw)*displacement,z=active.z-Math.cos(yaw)*displacement;
      blocked=attempt(x,z,yaw);
      if(blocked) {
        if(Math.abs(speed)>.19 && impactWait===0) {
          hit("impact",active.x,active.z,Math.abs(speed));
          impactWait=.28;
        }
        // If the front catches, leave enough freedom to steer out in place.
        speed=0;
        if(!turn || attempt(active.x,active.z,yaw)) { turnRate=0;break; }
        x=active.x;
        z=active.z;
      }
      const rotate=yaw-active.yaw;
      distance+=Math.hypot(x-active.x,z-active.z);
      apply(active,x,z,yaw);
      player.x=approach.x;
      player.z=approach.z;
      player.yaw+=rotate;
    }
    if(distance>.33) {
      distance-=.33;
      hit("slide",active.x,active.z,Math.abs(speed));
    }
  }

  return {
    grab, release, reset, frame, parked,
    timberReady:()=>active!==items[0] && parkStatus(items[0]),
    action(player) {
      if(active) return "放开"+active.name+" E";
      const item=nearest(player);
      return item ? "握住"+item.name+"推杆 E" : null;
    },
    active:()=>Boolean(active),
    blocked:()=>Boolean(blocked),
    near:player=>player.x>=-75.15 && player.x<=-69.55 && player.z>=-49.12 && player.z<=-43.71,
    yaw:()=>active?.yaw,
    gripWeight:()=>weight,
    grip:(i,out,frame)=>{
      active.grips[i].getWorldQuaternion(frame);
      return active.grips[i].getWorldPosition(out);
    },
    show(value) {
      root.visible=blockSolid.enabled=placard.enabled=fence.enabled=value;
      for(const item of items) item.solid.enabled=value;
    },
    inspect:()=>({active:active?.id??null,aligning,weight,blocked,speed,parked:parked(),entry:workyardEntry,bollard,
      cargo:items.map(({id,x,y,z,yaw,bayX,bayZ})=>({id,x,y,z,yaw,bayX,bayZ}))}),
  };
}
