import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";

const {lerp,smoothstep}=THREE.MathUtils;
const tau=Math.PI*2;
const sackAt=new THREE.Vector3(-.418,.564,.888);
const scoopPath=[
  [0,-.205,.575,1.02,-.08,0],
  [.19,-.260,.516,.995,-.26,.02],
  [.32,-.245,.528,1.125,.14,.04],
  [.45,-.22,.88,.886,0,.06],
  [.58,-.406,.978,.855,0,.02],
  [.68,-.410,.930,.816,.96,.02],
  [.75,-.412,.914,.821,1.04,.02],
  [.85,-.185,.817,.887,-.03,0],
  [1,-.205,.575,1.02,-.08,0],
];


function prop(parent,geometry,material,name) {
  const item=new THREE.Mesh(geometry,material);
  item.name=name;
  item.castShadow=item.receiveShadow=true;
  parent.add(item);
  return item;
}

function grainSack(parent,surface) {
  const sack=new THREE.Group();
  sack.name="Hand-stitched millet sack";
  parent.add(sack);
  const linen=surface("rough-linen",0xc5b189,.92,.94);
  const fibre=new THREE.MeshStandardMaterial({color:0x95805d,roughness:.94});
  const body=new THREE.LatheGeometry([[0,0],[.086,0],[.118,.019],[.137,.055],[.141,.093],
    [.129,.136],[.102,.183],[.077,.220],[.074,.245],[.066,.247],[.061,.222],[.067,.204],
  ].map(([r,y])=>new THREE.Vector2(r,y)),40);
  const vertices=body.attributes.position;
  for(let i=0;i<vertices.count;i++) {
    const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i),a=Math.atan2(z,x);
    const fold=1+.035*Math.cos(5*a+13*y)+.042*Math.sin(3*a-23*y)
      +smoothstep(y,.14,.24)*.073*Math.sin(9*a+15*y);
    vertices.setXYZ(i,x*fold+.013*Math.sin(y*10),y+(Math.sin(8*a)*.004)*smoothstep(y,.15,.24),z*fold*.79);
  }
  body.computeVertexNormals();
  prop(sack,body,linen,"Folded linen sack with open mouth");
  const seam=new THREE.CatmullRomCurve3([[.003,.02,-.076],[.006,.054,-.108],[.011,.10,-.114],
    [.013,.144,-.099],[.014,.191,-.076],[.016,.218,-.060]].map(p=>new THREE.Vector3(...p)));
  prop(sack,new THREE.TubeGeometry(seam,18,.0024,5),fibre,"Whip-stitched side seam");
  for(let i=0;i<13;i++) {
    const p=seam.getPointAt((i+.5)/13);
    const stitch=prop(sack,new THREE.CapsuleGeometry(.0017,.010,3,6),fibre,"Hemp stitch");
    stitch.position.copy(p);
    stitch.rotation.z=.87;
  }
  const tie=prop(sack,new THREE.TorusGeometry(.067,.0046,6,28).rotateX(Math.PI*.5)
    .scale(1,1,.80),fibre,"Twisted sack cord");
  tie.position.set(.013,.211,0);
  const knot=prop(sack,new THREE.TorusKnotGeometry(.012,.003,18,5,2,3),fibre,"Hemp knot");
  knot.position.set(.057,.208,-.033);
  const closure=prop(sack,new THREE.SphereGeometry(1,22,9),linen,"Gathered linen above the knot");
  closure.scale.set(.061,.029,.052);
  closure.position.set(.014,.225,0);
  return {sack,close(value){closure.visible=knot.visible=value;}};
}

export function createGrainWork(parent,shed,surface,city,tradeAt) {
  const {root,binZ,millet,pile,kernels}=shed;
  const fir=surface("rail-wood",0xa98a62,.84,.92);
  const rest=new THREE.Group();
  rest.name="Millet scoop and grip";
  root.add(rest);
  const bowl=new THREE.LatheGeometry([[0,.002],[.072,.002],[.103,.015],[.112,.038],
    [.098,.049],[.091,.047],[.087,.025],[.065,.014],[0,.010]].map(p=>new THREE.Vector2(...p)),26);
  prop(rest,bowl,fir,"Carved wooden scoop");
  prop(rest,detailedBox(.037,.037,.223,fir,.011,.37),fir,"Rounded scoop handle").position.set(0,.031,-.147);
  const spoonGrip=new THREE.Vector3(0,.031,-.210);
  const loaded=prop(rest,new THREE.SphereGeometry(1,23,10),millet,"Millet held in the scoop");
  loaded.position.y=.026;
  loaded.scale.set(.080,.034,.080);
  const fillingShelf=prop(root,detailedBox(.362,.043,.348,fir,.012,.9),fir,"Sack-filling shelf");
  fillingShelf.position.set(sackAt.x,sackAt.y-.0215,sackAt.z);
  const {sack,close}=grainSack(parent,surface);
  const sackFill=prop(sack,new THREE.SphereGeometry(1,22,8),millet,"Millet inside the sack");
  sackFill.scale.set(.063,.018,.048);
  sackFill.position.set(.011,.199,0);
  const sealAt=new THREE.Vector3(tradeAt.x,tradeAt.y,tradeAt.z);
  prop(parent,detailedBox(.261,.036,.248,fir,.008,1.18),fir,"Garden keeper's sack shelf")
    .position.set(sealAt.x,sealAt.y-.018,sealAt.z);
  prop(parent,detailedBox(.094,.47,.097,fir,.007,1.33),fir,"Garden sack shelf leg")
    .position.set(sealAt.x-.077,sealAt.y-.235,sealAt.z-.046);
  city.box("Garden sack shelf",sealAt.x-.1305,sealAt.x+.1305,sealAt.z-.124,sealAt.z+.124,
    sealAt.y-.47,sealAt.y);
  const grains=new THREE.InstancedMesh(new THREE.SphereGeometry(1,6,4),millet,60);
  grains.name="Falling millet from scoop to sack";
  grains.frustumCulled=false;
  root.add(grains);
  const kernel=new THREE.Object3D(), flowStart=new THREE.Vector3(), flowEnd=new THREE.Vector3();
  const offset=new THREE.Vector3(), source=new THREE.Vector3(), grip=new THREE.Vector3(), wrist=new THREE.Quaternion(), angles=new THREE.Euler(0,0,0,"YXZ");
  const carryAt=new THREE.Vector3(.192,1.035,-.27);
  const beltAt=new THREE.Vector3(.332,.865,.015),belt=new THREE.Vector3();
  const poseStart=new THREE.Vector3(), gripCorrection=new THREE.Vector3();
  const palm=new THREE.Vector3(), anchored=new THREE.Vector3();
  const sackGrip=new THREE.Vector3(.014,.214,0);
  let state="ready", job=null, age=0, tipped=false, contactError=0, holster=0;
  const origin=root.position;
  const station={x:origin.x+.06,z:origin.z+.375};
  function scoop(t) {
    let i=1;
    while(i<scoopPath.length-1 && t>scoopPath[i][0]) i++;
    const [a,x,y,z,p,r]=scoopPath[i-1], [b,nx,ny,nz,np,nr]=scoopPath[i];
    const f=smoothstep(t,a,b);
    rest.position.set(lerp(x,nx,f),lerp(y,ny,f),lerp(z,nz,f)+binZ-1.095);
    rest.rotation.set(lerp(p,np,f),0,lerp(r,nr,f));
  }
  function restore(saved) {
    state=saved==="carrying" || saved==="sold" ? saved : "ready";
    job=null;age=0;tipped=false;contactError=0;holster=Number(saved==="carrying");
    scoop(0);loaded.visible=grains.visible=false;
    sack.visible=state!=="carrying";
    sack.rotation.set(0,0,0);
    sack.position.copy(state==="sold" ? sealAt : source.copy(origin).add(sackAt));
    close(state!=="ready");
    sackFill.visible=false;
    settleHeap(state!=="ready");
  }
  function settleHeap(filled) {
    pile.position.y=.436-.022*filled;
    kernels.position.y=-.022*filled;
  }
  function near(player) {
    return Math.abs(player.x-station.x)<.25 && player.z>origin.z+.25 && player.z<origin.z+.47;
  }
  function saleNear(player) {
    return player.z<sealAt.z-.41 && Math.hypot(player.x-sealAt.x,player.z-sealAt.z)<.65;
  }
  function start(type,player) {
    if(job) return false;
    if(type==="fill" ? state!=="ready" || !near(player) : state!=="carrying" || !saleNear(player)) return false;
    const to=type==="fill" ? source.copy(origin).add(offset.set(.053,0,binZ)) : sealAt;
    job={type,yaw:Math.atan2(player.x-to.x,player.z-to.z)};
    age=0;tipped=false;
    return true;
  }
  function progress() {return !job ? 0 : age/(job.type==="fill" ? 4.65 : 1.58);}
  function frame(dt,audio) {
    if(!job) return null;
    age+=dt;
    const t=progress();
    if(job.type==="fill" && t>=.58 && !tipped) {
      tipped=true;
      audio.play("earth",origin.x,origin.z+binZ,.32,"grainScoop",.95);
    }
    if(t<1) return null;
    const event=job.type;
    if(event==="sell") audio.play("wood",sealAt.x,sealAt.z,.13,"grainSale");
    restore(event==="fill" ? "carrying" : "sold");
    if(event==="fill") holster=0;
    return event;
  }
  function crouch() {
    const t=progress();
    return job?.type==="fill" ? .36*smoothstep(t,0,.23)*(1-smoothstep(t,.47,.71))+
      .25*smoothstep(t,.72,.86)*(1-smoothstep(t,.92,1)) :
      job?.type==="sell" ? .34*smoothstep(t,.13,.51)*(1-smoothstep(t,.69,1)) : 0;
  }
  function pour(t) {
    const a=smoothstep(t,.58,.68);
    const flowing=t>.575 && t<.73;
    grains.visible=flowing;
    loaded.visible=t>.30 && t<.678;
    loaded.scale.y=.034*(1-.83*a);
    sackFill.visible=t>.62 && t<.87;
    sackFill.position.y=.161+.038*a;
    settleHeap(smoothstep(t,.32,.45));
    if(!flowing) return;
    rest.localToWorld(flowStart.set(0,.036,.103));
    root.worldToLocal(flowStart);
    flowEnd.copy(sackAt).add(offset.set(.013,.224,0));
    grains.count=Math.floor(60*smoothstep(t,.58,.612)*(1-smoothstep(t,.69,.73)));
    for(let i=0;i<grains.count;i++) {
      const f=((t-.575)*19.2+i*.61803399)%1, spread=Math.sin(Math.PI*f)*.03+.006;
      kernel.position.set(lerp(flowStart.x,flowEnd.x,f)+spread*Math.sin(7.23*i),
        lerp(flowStart.y,flowEnd.y,f*f),lerp(flowStart.z,flowEnd.z,f)+spread*Math.cos(7.23*i));
      kernel.rotation.set(i*.39,t*23+i*.34,t*18);
      kernel.scale.set(.0068,.0035,.0036);
      kernel.updateMatrix();
      grains.setMatrixAt(i,kernel.matrix);
    }
    grains.instanceMatrix.needsUpdate=true;
  }
  function pose(person,visible,onBelt,dt) {
    if(!job && state!=="carrying") return;
    const t=progress(), filling=job?.type==="fill";
    const yaw=person.figure.rotation.y;
    const hand=person.limbs.hands[1].group.getObjectByName("Workyard palm contact");
    const stow=filling ? smoothstep(t,.838,.997) : 1;
    const carrying=state==="carrying" && !job;
    sack.visible=visible || filling;
    if(filling) {
      scoop(THREE.MathUtils.clamp((t-.14)/.659,0,1));
      const reach=smoothstep(t,.045,.18)*(1-smoothstep(t,.785,.83));
      if(reach>.003) {
        rest.localToWorld(grip.copy(spoonGrip));
        person.graspProp(1,grip,wrist.setFromEuler(angles.set(.10,yaw,-.52)),reach,.88);
        hand.getWorldPosition(palm);
        gripCorrection.copy(palm).sub(grip).multiplyScalar(smoothstep(reach,.65,1));
        rest.position.add(gripCorrection);
        contactError=palm.distanceTo(grip.add(gripCorrection));
      }
      pour(t);
    }
    const selling=job?.type==="sell";
    holster=THREE.MathUtils.damp(holster,Number(onBelt && !job),8,dt);
    const strength=filling ? smoothstep(t,.825,.92) : selling ?
      smoothstep(t,.025,.24)*(1-smoothstep(t,.72,.93)) : 1-holster;
    const release=selling ? smoothstep(t,.26,.68) : 0;
    person.figure.localToWorld(anchored.copy(carryAt));
    person.figure.localToWorld(belt.copy(beltAt));
    if(selling) anchored.lerp(belt,1-smoothstep(t,.08,.31));
    else if(!filling) anchored.lerp(belt,holster);
    sack.rotation.set(.12*(1-release)*stow,yaw*stow*(1-release),.11*(1-release)*stow,"YXZ");
    if(carrying) sack.rotation.z+=.08*person.limbs.arms[1].rotation.x+.19*holster;
    offset.copy(sackGrip).applyQuaternion(sack.quaternion);
    source.copy(origin).add(sackAt).add(offset);
    grip.copy(source).lerp(anchored,stow).lerp(poseStart.copy(sealAt).add(offset),release);
    if(strength>.003) {
      person.graspProp(1,grip,wrist.setFromEuler(angles.set(.09,yaw,-.47)),strength,.87);
      hand.getWorldPosition(palm);
      contactError=palm.distanceTo(grip);
      grip.lerp(palm,(filling ? smoothstep(t,.875,.94) : 1)*(1-smoothstep(release,.82,1))*strength);
    }
    sack.position.copy(grip).sub(offset);
    close(stow>.11);
  }
  restore();
  return {restore,near,saleNear,start,frame,pose,crouch,station,
    locked:()=>job!==null,held:()=>state==="carrying",yaw:()=>job?.yaw,
    ready:()=>state==="ready",inspect:()=>({state,stage:job?.type??null,progress:progress(),contactError,
      station,sale:{x:sealAt.x,z:sealAt.z},pouring:grains.visible,
      scoop:rest.position.toArray(),sack:sack.position.toArray()})};
}
