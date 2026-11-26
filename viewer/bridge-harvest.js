import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { gardenBounds } from "./bridge-west-bank.js";

const {lerp,smoothstep}=THREE.MathUtils;
const tray={x:-80.89,z:-32.05};
const standTop=.47,trayRadius=.244,trayHeight=.192,palmHeight=.058;
const tau=Math.PI*2;
const durations={take:1.72,leave:1.34};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const towards=(a,b)=>Math.atan2(a.x-b.x,a.z-b.z);

function buildBasket(parent,city,surface,floor) {
  const group=new THREE.Group();
  group.name="West bank harvest basket and stand";
  const y=floor(tray.x,tray.z);
  group.position.set(tray.x,y,tray.z);
  parent.add(group);

  const elm=surface("rail-wood",0xb49a73,.83,.87);
  const straw=surface("tea-wood",0xc7a471,.73,.90);
  const edges=surface("tea-wood",0x98764d,.76,.92);
  function batch(parts,material,name) {
    const geometry=mergeGeometries(parts);
    for(const part of parts) part.dispose();
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;
    group.add(mesh);
  }
  const frame=[];
  for(const x of [-.21,.21]) {
    for(const z of [-.157,.157]) frame.push(detailedBox(.052,.432,.059,elm,.008,x+z)
      .rotateZ(x*.19).translate(x,.216,z));
    frame.push(detailedBox(.047,.076,.393,elm,.010,x+.31).translate(x,.304,0));
  }
  frame.push(detailedBox(.489,.064,.057,elm,.008,.9).translate(0,.366,-.152));
  frame.push(detailedBox(.489,.064,.057,elm,.008,1.3).translate(0,.366,.152));
  for(let i=0;i<5;i++)
    frame.push(detailedBox(.582,.047,.095,elm,.008,i*.72).translate(0,standTop-.022,(i-2)*.093));
  batch(frame,elm,"Low slatted harvest stand");
  city.box("Harvest stand",tray.x-.289,tray.x+.289,tray.z-.239,tray.z+.239,y,y+standTop+.036);

  const basketY=standTop+.009;
  const bottom=new THREE.CylinderGeometry(.159,.155,.022,32).translate(0,basketY+.008,0);
  const frameBamboo=[bottom];
  for(const [radius,at,width] of [[.157,0,.009],[.235,trayHeight-.008,.011],[trayRadius,trayHeight,.012]])
    frameBamboo.push(new THREE.TorusGeometry(radius,width,7,64).rotateX(-Math.PI/2).translate(0,basketY+at,0));
  const reeds=[], wicker=[];
  const curve=(points,segments,width)=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),segments,width,5);
  const uprights=36;
  for(let i=0;i<uprights;i++) {
    const theta=i/uprights*tau;
    const points=[];
    for(let link=0;link<=7;link++) {
      const t=link/7, radius=lerp(.154,.238,t)+.005*Math.sin(t*13.7+(i%2)*Math.PI);
      points.push(new THREE.Vector3(radius*Math.cos(theta),basketY+t*trayHeight,radius*Math.sin(theta)));
    }
    reeds.push(curve(points,9,.0045));
  }
  for(let i=0;i<15;i++) {
    const t=(i+.75)/16;
    const offset=lerp(.155,.237,t),points=[];
    for(let segment=0;segment<uprights*2;segment++) {
      const angle=tau*segment/(uprights*2),r=offset+.0049*Math.cos(angle*uprights*.5+i*Math.PI);
      points.push(new THREE.Vector3(r*Math.cos(angle),basketY+t*trayHeight+.002*Math.sin(angle*9+i*.7),r*Math.sin(angle)));
    }
    const band=new THREE.CatmullRomCurve3(points,true);
    wicker.push(new THREE.TubeGeometry(band,uprights*3,.0054,5,true));
  }
  for(let i=0;i<18;i++) {
    const a=i/18*tau, x=Math.cos(a), z=Math.sin(a);
    const binding=curve([new THREE.Vector3(x*.226,basketY+trayHeight-.013,z*.226),
      new THREE.Vector3(x*.247,basketY+trayHeight+.008,z*.247),
      new THREE.Vector3(x*.254,basketY+trayHeight-.005,z*.254)],9,.004);
    frameBamboo.push(binding);
  }
  batch(frameBamboo,edges,"Bound bamboo rim and base");
  batch(reeds,edges,"Split bamboo uprights");
  batch(wicker,straw,"Over-under bamboo weave");
  const items=new THREE.Group();
  items.name="Harvest laid in the basket";
  items.position.y=basketY;
  group.add(items);
  return {items,y:y+basketY};
}

export function createGardenHarvest(parent,city,surface,floor,crops) {
  const basket=buildBasket(parent,city,surface,floor);
  const putInBasket=crops.basket(basket.items);
  const prop=new THREE.Group();
  prop.name="Greens in the player's hand";
  prop.visible=false;parent.add(prop);
  const makeItem=crops.item(prop);
  const taper=new THREE.CylinderGeometry(.024,.012,.075,13);
  const stem=new THREE.Mesh(taper,new THREE.MeshStandardMaterial({color:0xbbb291,roughness:.82}));
  stem.name="Gathered stems and root end";stem.position.y=.012;
  stem.castShadow=stem.receiveShadow=true;
  prop.add(stem);
  const grip=new THREE.Object3D();
  grip.name="Harvest palm target";grip.position.y=palmHeight;
  prop.add(grip);
  const target=new THREE.Vector3(), upright=new THREE.Vector3(), startPoint=new THREE.Vector3(),
    actual=new THREE.Vector3(), offset=new THREE.Vector3(), contact=new THREE.Vector3();
  const wrist=new THREE.Euler(0,0,0,"YXZ"),orientation=new THREE.Quaternion();
  let taken=new Set(), carried=null, job=null, age=0;
  function fillBasket() {putInBasket([...taken].filter(id=>id!==carried),true);}
  function load(saved) {
    taken=new Set(Array.isArray(saved?.picked) ? saved.picked.filter(id=>crops.byId.has(id)) : []);
    carried=taken.has(saved?.carried) ? saved.carried : null;
    job=null;age=0;
    prop.visible=false;
    if(carried!==null) rack(carried);
    crops.restore(taken);
    fillBasket();
  }
  function rack(id) {
    makeItem([id]);
    stem.scale.setScalar(crops.byId.get(id).kind===0 ? 1 : .71);
  }
  function progress() {return job ? age/durations[job.type] : 0;}
  function crouch() {
    const t=progress();
    return job?.type==="take" ? .620*smoothstep(t,.05,.41)*(1-smoothstep(t,.59,.98)) :
      job?.type==="leave" ? .39*smoothstep(t,.06,.40)*(1-smoothstep(t,.72,1)) : 0;
  }
  function option(player,yaw) {
    if(job) return null;
    if(carried!==null) {
      const d=dist(player,tray);
      return d>.53 && d<.70 && player.z<tray.z-.37 && Math.abs(player.x-tray.x)<.43
        ? {type:"leave",point:tray,id:carried} : null;
    }
    const {x,z}=player;
    if(x>=gardenBounds.east-.28 || x<=gardenBounds.west || z<gardenBounds.south+.19 || z>gardenBounds.north-.19) return null;
    let nearest=.81, choice=null;
    for(const plant of crops.plants) {
      if(taken.has(plant.id)) continue;
      const distance=dist(player,plant);
      if(distance<.42 || distance>.775) continue;
      const facing=-(Math.sin(yaw)*(plant.x-x)+Math.cos(yaw)*(plant.z-z))/distance;
      // A nearby plant remains selectable at the side of the path.
      const priority=distance+Math.max(0,.74-facing)*.13;
      if(priority<nearest) {
        nearest=priority;
        choice={type:"take",point:plant,id:plant.id};
      }
    }
    return choice;
  }
  function start(action,player) {
    if(!action || job) return false;
    const facing=towards(player,action.point);
    job={...action,yaw:facing,heading:facing+.235,pulled:false};
    age=0;
    if(action.type==="take") rack(action.id);
    return true;
  }
  function cancel() {
    if(!job) return;
    if(job.type==="take" && !taken.has(job.id)) crops.adjust(job.point);
    job=null;age=0;prop.visible=carried!==null;
  }
  function frame(dt) {
    if(!job) return null;
    age=Math.min(age+dt,durations[job.type]);
    const t=progress();
    if(job.type==="take") {
      if(t>=.58 && !job.pulled) {
        crops.adjust(job.point,0,0,.0001);
        job.pulled=true;
      } else if(!job.pulled) {
        const tug=smoothstep(t,.40,.58);
        crops.adjust(job.point,.061*tug,.16*Math.sin(tug*Math.PI),1);
      }
    }
    if(t<1) return null;
    const {type,id}=job;
    if(type==="take") {
      taken.add(id);carried=id;
      crops.restore(taken);
    } else {
      carried=null;prop.visible=false;
      fillBasket();
    }
    job=null;
    return {type,kind:crops.byId.get(id).kind};
  }
  function pose(person) {
    const type=job?.type;
    if(carried===null && !type) {prop.visible=false;return;}
    const t=progress();
    const yaw=person.figure.rotation.y;
    upright.set(.30,1.012,-.235);
    target.copy(person.figure.localToWorld(upright));
    let strength=1, pitch=-.19, secured=1;
    if(type==="take") {
      const lean=smoothstep(t,.11,.40)*(1-smoothstep(t,.66,.99));
      const lift=.061*smoothstep(t,.40,.58);
      startPoint.set(job.point.x,job.point.y+palmHeight+lift,job.point.z);
      target.lerp(startPoint,lean);
      strength=smoothstep(t,.20,.48);
      pitch=-.16-.21*lean;
      prop.visible=job.pulled;
    } else if(type==="leave") {
      const lower=smoothstep(t,.10,.56);
      startPoint.set(tray.x,basket.y+.115+palmHeight,tray.z);
      target.lerp(startPoint,lower);
      strength=1-smoothstep(t,.75,1);
      pitch=.49*lower-.19;
      secured=1-smoothstep(t,.67,.76);
      prop.visible=true;
    } else prop.visible=true;
    orientation.setFromEuler(wrist.set(.18,yaw,-.48,"YXZ"));
    if(strength>.003) person.graspProp(1,target,orientation,strength,.89);
    const palm=person.limbs.hands[1].group.getObjectByName("Workyard palm contact");
    palm.getWorldPosition(actual);
    contact.copy(target).lerp(actual,secured);
    prop.rotation.set(pitch,yaw+.12,-.12,"YXZ");
    offset.copy(grip.position).applyQuaternion(prop.quaternion);
    prop.position.copy(contact).sub(offset);
    prop.visible=prop.visible && person.figure.visible;
  }
  load();
  return {load,cancel,option,start,frame,pose,crouch,progress,tray,
    count:()=>taken.size-Number(carried!==null),held:()=>carried!==null,locked:()=>job!==null,stage:()=>job?.type,
    turn:()=>job?.yaw,heading:()=>job?.heading,
    snapshot:()=>({picked:[...taken],carried}),
    inspect:()=>({picked:[...taken],carried,stage:job?.type??(carried===null ? "idle" : "carry"),progress:progress(),
      target:job ? {id:job.id,x:job.point.x,y:job.point.y??basket.y,z:job.point.z} : null,
      position:prop.position.toArray(),visible:prop.visible,basket:{...tray,y:basket.y},total:crops.plants.length}),
  };
}
