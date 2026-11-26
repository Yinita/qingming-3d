import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";
import { cropBeds, gardenBounds } from "./bridge-west-bank.js";

const {clamp,lerp,smoothstep}=THREE.MathUtils;
const radius=.145, rim=.243, gripHeight=.409, capacity=.142;
const carryGrip={x:.335,y:.955,z:-.175}, narrowGrip={x:.228,y:1.015,z:-.255};
const duration={lift:1.20, lower:1.18, fill:2.30, refill:2.85, pour:2.18};
const easing=(x,a,b)=>smoothstep(x,a,b);
const away=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const yawTo=(a,b)=>Math.atan2(a.x-b.x,a.z-b.z);

function makePail(parent,surface) {
  const pail=new THREE.Group();
  pail.name="Portable garden pail";
  parent.add(pail);
  function piece(geometry,material,name) {
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;
    pail.add(mesh);
    return mesh;
  }
  const woods=[0xa98253,0x9a7447,0xbb9365,0xb08758].map(tone=>surface("tea-wood",tone,.82,.93));
  const iron=new THREE.MeshStandardMaterial({color:0x413d34,roughness:.67,metalness:.45});
  const stain=surface("rail-wood",0x846849,.80,1);
  const seam=Math.PI*2/14;
  for(let i=0;i<14;i++) {
    const angle=i*seam+.006, span=seam-.012;
    const stave=.003*Math.sin(i*5.61);
    const profile=[[.109,.012],[.114,.005],[.118,.014],[radius+stave,rim-.013],
      [radius+stave-.003,rim],[radius+stave-.014,rim+.002],[radius+stave-.018,rim-.009],[.103,.020],[.109,.012]];
    piece(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),3,angle,span),
      woods[i%woods.length],"Beveled oak stave");
  }
  const lining=[[.104,.022],[.128,rim-.014],[.131,rim-.015],[.109,.023]];
  piece(new THREE.LatheGeometry(lining.map(([r,y])=>new THREE.Vector2(r,y)),42),stain,"Sealed stave lining");
  const base=piece(new THREE.CylinderGeometry(.110,.109,.021,36),stain,"Inset pail bottom");
  base.position.y=.024;
  for(const [y,r] of [[.049,.122],[.201,.145]]) {
    const profile=[[r-.006,y-.010],[r+.001,y-.009],[r+.003,y-.006],[r+.003,y+.006],[r+.001,y+.009],[r-.006,y+.010]];
    piece(new THREE.LatheGeometry(profile.map(([a,b])=>new THREE.Vector2(a,b)),56),iron,"Tapered iron hoop");
  }
  for(const side of [-1,1]) {
    const lug=piece(detailedBox(.016,.046,.034,iron,.005,side),iron,"Peened bail lug");
    lug.position.set(side*.141,.223,0);
    const pin=piece(new THREE.SphereGeometry(.008,9,6),iron,"Bail rivet");
    pin.position.set(side*.150,.226,0);pin.scale.x=.54;
  }
  const bail=new THREE.Group();
  bail.position.y=.225;
  pail.add(bail);
  const arch=new THREE.CatmullRomCurve3(Array.from({length:13},(_,i)=>{
    const angle=Math.PI*i/12;
    return new THREE.Vector3(.148*Math.cos(angle),.184*Math.sin(angle),0);
  }));
  bail.add(piece(new THREE.TubeGeometry(arch,28,.0054,6),iron,"Wrought iron bail"));
  const grip=piece(new THREE.CylinderGeometry(.014,.014,.085,14),stain,"Rounded wooden bail grip");
  bail.add(grip);
  grip.position.y=gripHeight-bail.position.y;grip.rotation.z=Math.PI/2;

  const wet=new THREE.MeshStandardMaterial({color:0x817c50,roughness:.23,metalness:.07});
  const waterRoot=new THREE.Group();pail.add(waterRoot);
  const water=new THREE.Mesh(new THREE.CircleGeometry(.117,42),wet);
  water.name="Water inside the pail";water.rotation.x=-Math.PI/2;
  waterRoot.add(water);
  return {pail,bail,water,waterRoot};
}

function makeWater(parent) {
  const rings=11,sides=7;
  const coords=new THREE.BufferAttribute(new Float32Array(rings*sides*3),3).setUsage(THREE.DynamicDrawUsage);
  const indices=[];
  for(let i=1;i<rings;i++) for(let j=0;j<sides;j++) {
    const p=(i-1)*sides+j,q=(i-1)*sides+(j+1)%sides;
    indices.push(p,p+sides,q,q,p+sides,q+sides);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",coords);geometry.setIndex(indices);
  const material=new THREE.MeshPhysicalMaterial({color:0xb4b7a1,roughness:.26,metalness:.08,
    transparent:true,opacity:.79,depthWrite:false,side:THREE.DoubleSide});
  const stream=new THREE.Mesh(geometry,material);
  stream.name="Gravity-fed pail stream";stream.frustumCulled=false;stream.visible=false;parent.add(stream);
  const droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(.009,6,4),material,22);
  droplets.name="Irrigation splash droplets";droplets.frustumCulled=false;droplets.visible=false;parent.add(droplets);
  const transform=new THREE.Object3D(),point=new THREE.Vector3(),tau=Math.PI*2;
  return {
    hide(){stream.visible=droplets.visible=false;},
    draw(from,to,time,width) {
      stream.visible=droplets.visible=true;
      for(let i=0;i<rings;i++) {
        const t=i/(rings-1);
        point.lerpVectors(from,to,t);
        point.y+=(Math.max(0,from.y-to.y)*.56+.017)*t*(1-t);
        const r=width*(.86-.30*t+.13*Math.sin(time*43-t*22))*(t>.88 ? .78 : 1);
        for(let j=0;j<sides;j++) {
          const angle=tau*j/sides;
          coords.setXYZ(i*sides+j,point.x+Math.cos(angle)*r,point.y,point.z+Math.sin(angle)*r);
        }
      }
      coords.needsUpdate=true;geometry.computeVertexNormals();
      for(let i=0;i<droplets.count;i++) {
        const t=(time*(2.3+i%5*.12)+i*.619)%1, heading=i*2.39996;
        const d=(.045+i%6*.021)*t;
        transform.position.set(to.x+Math.cos(heading)*d,to.y+.006+(.048+i%4*.022)*4*t*(1-t),to.z+Math.sin(heading)*d);
        transform.scale.setScalar(.87*(1-.82*t));
        transform.updateMatrix();droplets.setMatrixAt(i,transform.matrix);
      }
      droplets.instanceMatrix.needsUpdate=true;
    },
  };
}

export function createIrrigation(parent,city,surface,floor,well,soil,clear) {
  const group=new THREE.Group();
  group.name="West bank irrigation";
  parent.add(group);
  const {pail,bail,water,waterRoot}=makePail(group,surface);
  const outlet=well.irrigationOutlet;
  const station={x:outlet.x-.036,z:outlet.z};
  const effects=makeWater(group);
  const collider=city.cylinder("Parked garden pail",station.x,station.z,0,rim,radius);
  const target=new THREE.Vector3(),actual=new THREE.Vector3(),offset=new THREE.Vector3();
  const standing=new THREE.Vector3(),parkGrip=new THREE.Vector3(),outflow=new THREE.Vector3();
  const wetPoint=new THREE.Vector3(),orientation=new THREE.Quaternion(),rotation=new THREE.Euler(0,0,0,"YXZ");
  let parked={...station,filled:false},wet=[],held=false,job=null,age=0,tucked=0,remaining=cropBeds.length;

  function location(point) {
    return [point?.x,point?.z].every(Number.isFinite) && point.x>=gardenBounds.west+.25 &&
      point.x<=-72.8 && point.z>=-39.8 && point.z<=gardenBounds.north;
  }
  function read(saved) {
    held=false;job=null;age=tucked=0;effects.hide();well.irrigationFlow(0);
    const p=saved?.pail;
    parked=location(p) ? {x:p.x,z:p.z,filled:p.filled===true} : {...station,filled:false};
    wet=Array.from({length:cropBeds.length},(_,i)=>{
      const point=saved?.beds?.[i],bed=cropBeds[i];
      return location(point) && Math.abs(point.x-bed.x)<=.17 && Math.abs(point.z-bed.z)<=bed.length*.5 ? {x:point.x,z:point.z} : null;
    });
    remaining=wet.filter(point=>!point).length;
    syncSoil();
    rest();
  }
  function syncSoil(pending=null,progress=0) {
    for(const [i,point] of wet.entries()) {
      const hit=point ?? (pending?.index===i ? pending : null);
      soil[i].set(hit?.x??0,hit?.z??0,point ? 1 : hit ? progress : 0);
    }
  }
  function rest() {
    const y=floor(parked.x,parked.z);
    pail.position.set(parked.x,y,parked.z);
    pail.rotation.set(0,0,0);
    bail.rotation.x=0;
    Object.assign(collider,{enabled:group.visible,x:parked.x,z:parked.z,bottom:y,top:y+rim});
    showWater(Number(parked.filled),0,0);
  }
  function showWater(fill,tip,time) {
    water.visible=fill>.026;
    waterRoot.rotation.x=tip*.70;
    water.position.y=.083+.114*fill-.061*Math.sin(tip);
    water.scale.setScalar(.85+.20*fill-.42*Math.abs(Math.sin(tip)));
    water.position.z=Math.sin(time*4.1)*Math.min(.006,Math.abs(tip)*.02);
  }
  function bedTarget(player) {
    if(player.x>=gardenBounds.east || player.x<=gardenBounds.west) return null;
    let best=null,nearest=1.10;
    for(const [index,bed] of cropBeds.entries()) {
      if(wet[index]) continue;
      const x=bed.x+clamp(player.x-bed.x,-.16,.16);
      const z=bed.z+clamp(player.z-bed.z,-bed.length*.5+.15,bed.length*.5-.15);
      const distance=Math.hypot(player.x-x,player.z-z);
      if(distance<.44 || distance>=nearest || Math.abs(player.x-bed.x)<.29 && Math.abs(player.z-bed.z)<bed.length*.5-.18) continue;
      best={index,x,z};nearest=distance;
    }
    return best;
  }
  function atStation(player) {
    return player.x<station.x-.25 && player.x>station.x-.79 && Math.abs(player.z-station.z)<.45;
  }
  function isAtTap(point) {return away(point,station)<.032;}
  function clearReach(player,point) {
    const start=floor(player.x,player.z)+.68,end=floor(point.x,point.z)+gripHeight;
    for(let i=1;i<=5;i++) {
      const t=i/6;
      if(city.blocking(lerp(player.x,point.x,t),lerp(player.z,point.z,t),lerp(start,end,t),.064,.126,collider)) return false;
    }
    return true;
  }
  function reach(player,point) {
    const d=away(player,point);
    return d>=.37 && d<=.72 && Math.abs(floor(player.x,player.z)-floor(point.x,point.z))<.20 && clearReach(player,point);
  }
  function action(player) {
    if(job) return null;
    if(!held) {
      if(!reach(player,parked)) return null;
      if(!parked.filled && isAtTap(parked) && well.canDraw(capacity)) return {type:"fill",point:parked};
      return {type:"lift",point:parked};
    }
    if(!parked.filled && atStation(player) && reach(player,station))
      return {type:well.canDraw(capacity) ? "refill" : "lower",point:station};
    const target=parked.filled && bedTarget(player);
    return target ? {type:"pour",point:target} : null;
  }
  function groundSpot(player,yaw) {
    for(const turn of [.44,-.39,0,.78,-.78]) {
      const point={x:player.x-.58*Math.sin(yaw+turn),z:player.z-.58*Math.cos(yaw+turn)};
      if(location(point) && clear(point,collider) &&
          Math.abs(floor(player.x,player.z)-floor(point.x,point.z))<.16 && clearReach(player,point)) return point;
    }
    return null;
  }
  function start(option,player) {
    if(job || !option) return false;
    const yaw=yawTo(player,option.point);
    job={...option,yaw,bodyYaw:option.type==="pour" ? yaw : yaw+.24};age=0;
    collider.enabled=false;
    return true;
  }
  function frame(dt) {
    if(!job) return null;
    age=Math.min(age+dt,duration[job.type]);
    if(age<duration[job.type]) return null;
    const {type,point}=job;
    job=null;effects.hide();well.irrigationFlow(0);
    if(type==="lower") {
      parked={...point,filled:parked.filled};held=false;rest();
    } else if(type==="fill" || type==="refill") {
      parked={...station,filled:well.draw(capacity)};
      held=true;
    } else if(type==="pour") {
      wet[point.index]={x:point.x,z:point.z};
      remaining--;
      parked.filled=false;syncSoil();
    } else held=true;
    return type;
  }
  function progress() {return job ? age/duration[job.type] : 0;}
  function crouch() {
    const t=progress(),type=job?.type;
    if(type==="lift") return .49*easing(t,.02,.41)*(1-easing(t,.56,.98));
    if(type==="lower") return .49*easing(t,.07,.54)*(1-easing(t,.73,1));
    if(type==="fill") return .49*easing(t,.38,.65)*(1-easing(t,.74,1));
    if(type==="refill") return .49*Math.max(easing(t,.04,.21)*(1-easing(t,.28,.46)),
      easing(t,.56,.76)*(1-easing(t,.81,1)));
    if(type==="pour") return .05*easing(t,.10,.39)*(1-easing(t,.78,1));
    return 0;
  }
  function obstruction(x,z,yaw,grip) {
    const px=x+grip.x*Math.cos(yaw)+grip.z*Math.sin(yaw);
    const pz=z-grip.x*Math.sin(yaw)+grip.z*Math.cos(yaw);
    return city.blocking(px,pz,floor(x,z)+grip.y-gripHeight,.143,.415,collider);
  }
  function pose(person,time,speed,dt) {
    if(!held && !job) return;
    const t=progress(),type=job?.type,point=job?.point;
    let grounded=0,tip=0,flow=0,amount=Number(parked.filled),yaw=person.figure.rotation.y;
    let reachWeight=1;
    const {x,z}=person.figure.position;
    const blocked=!job && obstruction(x,z,yaw,carryGrip);
    tucked=blocked ? 1 : THREE.MathUtils.damp(tucked,0,10,dt);
    standing.set(lerp(carryGrip.x,narrowGrip.x,tucked),lerp(carryGrip.y,narrowGrip.y,tucked),
      lerp(carryGrip.z,narrowGrip.z,tucked));
    target.copy(person.figure.localToWorld(standing));
    if(point && type!=="pour") {
      if(type==="lift") {
        grounded=1-easing(t,.48,.99);
        reachWeight=easing(t,.14,.43);
      } else if(type==="lower") {
        grounded=easing(t,.20,.64);
        reachWeight=1-easing(t,.73,.97);
      } else if(type==="fill") {
        grounded=1-easing(t,.73,1);reachWeight=easing(t,.52,.71);
        flow=easing(t,.12,.23)*(1-easing(t,.57,.68));
        amount=easing(t,.19,.70);
      } else {
        grounded=easing(t,.075,.25)*(1-easing(t,.79,1));
        reachWeight=1-easing(t,.26,.34)+easing(t,.68,.78);
        flow=easing(t,.33,.44)*(1-easing(t,.68,.77));
        amount=easing(t,.40,.77);
      }
      parkGrip.set(point.x,floor(point.x,point.z)+gripHeight,point.z);
      target.lerp(parkGrip,grounded);
      yaw=job.yaw;
    }
    if(type==="pour") {
      yaw=job.yaw;
      const reach=easing(t,.05,.36)*(1-easing(t,.74,.98));
      const reachX=person.figure.position.x,reachZ=person.figure.position.z;
      const length=away(person.figure.position,point);
      target.lerp(standing.set(reachX+(point.x-reachX)*.41/length,person.figure.position.y+1.015,
        reachZ+(point.z-reachZ)*.41/length),reach);
      tip=1.10*easing(t,.17,.40)*(1-easing(t,.70,.94));
      flow=easing(t,.29,.42)*(1-easing(t,.66,.76));
      amount=1-easing(t,.37,.75);
    } else if(!job) {
      tip=Math.sin(time*8.0)*Math.min(.065,speed*.027);
    }
    orientation.setFromEuler(rotation.set(.16,yaw,-.34,"YXZ"));
    if(reachWeight>.002) person.graspProp(1,target,orientation,reachWeight,.90);
    const palm=person.limbs.hands[1].group.getObjectByName("Workyard palm contact");
    palm.getWorldPosition(actual);
    const free=1-grounded;
    // Keep the pail exactly on its base while the fingers close around the bail.
    target.lerp(actual,free*reachWeight);
    pail.rotation.set(-tip,yaw,0,"YXZ");
    // The bucket turns at its side lugs while the bail stays in the player's hand.
    bail.rotation.x=tip*1.18;
    offset.set(0,gripHeight-bail.position.y,0).applyQuaternion(bail.quaternion).add(bail.position)
      .applyQuaternion(pail.quaternion);
    pail.position.copy(target).sub(offset);
    if(grounded>.99) pail.position.y=floor(point.x,point.z);
    showWater(amount,tip,time);
    if(type==="fill" || type==="refill") well.irrigationFlow(flow);
    if(flow>.006) {
      if(type==="pour") {
        pail.localToWorld(outflow.set(0,rim,-radius+.012));
        wetPoint.set(point.x,floor(point.x,point.z)+.012,point.z);
        effects.draw(outflow,wetPoint,time,.013*flow);
        syncSoil(point,.94*easing(t,.36,.79));
      } else {
        outflow.set(outlet.x,outlet.y,outlet.z);
        wetPoint.set(point.x,pail.position.y+.088+.097*amount,point.z);
        effects.draw(outflow,wetPoint,time,.010*flow);
      }
    } else effects.hide();
  }
  read();
  return {
    load:read, action, start, frame, pose, crouch, progress, groundSpot, station, location,
    held:()=>held, filled:()=>parked.filled, remaining:()=>remaining, locked:()=>job!==null,
    yaw:()=>job?.yaw, bodyYaw:()=>job?.bodyYaw, stage:()=>job?.type,
    fits(x,z,yaw) {
      return !held || !obstruction(x,z,yaw,carryGrip) || !obstruction(x,z,yaw,narrowGrip);
    },
    show(show){group.visible=show;collider.enabled=show && !held && !job;},
    snapshot:(spot=null)=>({pail:{...parked,...spot},beds:wet.slice()}),
    guide(player) {
      const inside=player.x<gardenBounds.east && player.z>gardenBounds.south && player.z<gardenBounds.north;
      return !held || job || !parked.filled || !inside ? null :
        cropBeds.filter((_,i)=>!wet[i]).sort((a,b)=>away(player,a)-away(player,b))[0]??null;
    },
    inspect:()=>({stage:job?.type??(held ? "carry" : "rest"),progress:progress(),held,filled:parked.filled,
      position:pail.position.toArray(),stream:group.getObjectByName("Gravity-fed pail stream").visible,
      station,parked:{...parked},beds:wet.map(point=>point && {...point}),wet:soil.map(v=>v.z)}),
  };
}
