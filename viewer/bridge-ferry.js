import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { legRig } from "./bridge-gait.js";
import { skiffBoardingSill } from "./bridge-boat.js";

const dockZ=-50.63, ferryZ=-51.76, deckY=.258;
const boardZ=dockZ-.065;
const moorings=[
  {west:true,land:-68.35,end:-64.06,boat:-65.46},
  {west:false,land:-48.54,end:-52.36,boat:-52.46},
];
const yaw=-Math.PI/2;
const seatZ=-.78, deckFootY=.049;
const boardLength=.505, gangwayWidth=.48, boardingZ=skiffBoardingSill.z;
const sillHeight=x=>skiffBoardingSill.y+skiffBoardingSill.slope*(x-skiffBoardingSill.x);
const travel=moorings[1].boat-moorings[0].boat;
const {damp,lerp,smoothstep}=THREE.MathUtils;

export function ferryDeckHeight(x,z) {
  if(Math.abs(z-dockZ)>.59) return -Infinity;
  for(const stop of moorings) {
    const along=stop.west ? x-stop.land : stop.land-x;
    if(along<0 || along>Math.abs(stop.land-stop.end)) continue;
    return along>=.60 ? deckY : .10+.056*Math.min(2,Math.floor(along/.20));
  }
  return -Infinity;
}

export function ferryLandingMaterial(x,z,footY) {
  const top=ferryDeckHeight(x,z);
  if(top<footY-.009) return null;
  return top===deckY ? "wood" : "stone";
}

export function buildFerryLanding(root,city,surface) {
  const timber=surface("rail-wood",0xbba28a,.86,.88);
  const worn=surface("tea-wood",0xc6a789,.94,.83);
  const wet=surface("rail-wood",0x837662,.91,.94);
  const stone=surface("worn-stone",0xc7c3b0,.94,.94);
  const iron=new THREE.MeshStandardMaterial({color:0x5b5143,roughness:.64,metalness:.46});
  const landings=new THREE.Group();
  landings.name="South canal ferry landings";
  root.add(landings);
  const colliders=[];
  const stands=[];
  const gangways=[];
  for(const stop of moorings) {
    const group=new THREE.Group();
    group.name=stop.west ? "West ferry landing" : "East ferry landing";
    landings.add(group);
    const dir=stop.west ? 1 : -1;
    const span=Math.abs(stop.land-stop.end);
    const parts=new Map();
    function box(mat,w,h,d,x,y,z,name=null,angle=0) {
      const geometry=detailedBox(w,h,d,mat,.012,Math.sin(x*27.67+z*5.34)*2.6);
      geometry.rotateY(angle);
      geometry.translate(x,y,z);
      if(!parts.has(mat)) parts.set(mat,[]);
      parts.get(mat).push(geometry);
      if(name) colliders.push(city.box(name,x-w*.5,x+w*.5,z-d*.5,z+d*.5,y-h*.5,y+h*.5));
    }
    const walkWidth=1.20, deckStart=stop.land+dir*.60;
    const sections=Math.ceil((span-.6)/.19);
    const boardWidth=(span-.6)/sections;
    const stand={x:stop.boat-seatZ,z:boardZ};
    stands.push(stand);
    const hinge=new THREE.Vector3(stop.boat-boardingZ,deckY+.019,dockZ-.408);
    const ramp=new THREE.Group();
    ramp.name=stop.west ? "West hinged gangway" : "East hinged gangway";
    group.add(ramp);
    const boards=[],straps=[];
    const part=(set,mat,w,h,d,x,y,z)=>{
      const geometry=detailedBox(w,h,d,mat,.012,z*11);
      geometry.translate(x,y,z);
      set.push(geometry);
    };
    for(let i=0;i<4;i++) part(boards,worn,gangwayWidth/4-.004,.048,boardLength,(i-1.5)*gangwayWidth/4,-.024,-boardLength*.5);
    for(const z of [-.075,-.222,-.385,-.544]) {
      part(boards,worn,gangwayWidth+.015,.016,.038,0,.006,z);
      for(const x of [-.168,.168]) part(straps,iron,.016,.006,.015,x,.017,z);
    }
    for(const x of [-.171,.171]) {
      part(boards,worn,.057,.057,boardLength-.032,x,-.053,-boardLength*.51);
      part(straps,iron,.047,.013,.153,x,.004,-.059);
      box(iron,.063,.046,.114,hinge.x+x,hinge.y-.013,hinge.z+.048);
    }
    for(const [mat,parts] of [[worn,boards],[iron,straps]]) {
      const model=new THREE.Mesh(mergeGeometries(parts),mat);
      parts.forEach(geometry=>geometry.dispose());
      model.castShadow=model.receiveShadow=true;
      model.layers.enable(1);
      ramp.add(model);
    }
    gangways.push({ramp,hinge,toe:new THREE.Vector3(),amount:0});
    for(let i=0;i<sections;i++) {
      const x=deckStart+dir*(i+.5)*boardWidth;
      box(i%5===1 ? worn : timber,boardWidth-.006,.054,walkWidth+Math.sin(i*6.11)*.041,x,deckY-.027,dockZ);
      for(const side of [-1,1])
        box(iron,.020,.004,.020,x+.02,deckY+.002,dockZ+side*.487);
    }
    for(let i=0;i<3;i++) {
      const x=stop.land+dir*(i+.5)*.20, top=.10+i*.056;
      box(i===0 ? stone : worn,.203,top+.036,walkWidth-.035,x,(top-.036)*.5,dockZ);
    }
    for(const z of [dockZ-.46,dockZ+.46]) {
      box(wet,span-.33,.134,.121,(stop.land+stop.end)*.5+dir*.14,.141,z);
      for(const offset of [.71,1.91,span-.16]) {
        const x=stop.land+dir*offset;
        box(wet,.133,1.61,.135,x,-.47,z);
        box(iron,.14,.044,.14,x,.192,z);
      }
    }
    const railZ=dockZ+.565;
    // Leave room at the landward end to turn with a crate or basket.
    for(const offset of [1.36,2.43,span-.10]) {
      const x=stop.land+dir*offset;
      box(timber,.119,.72,.119,x,.585,railZ,"Ferry landing post");
      box(worn,.15,.054,.145,x,.957,railZ);
    }
    box(timber,span-1.38,.093,.105,(stop.land+stop.end)*.5+dir*.63,.867,railZ,"Ferry landing rail");
    box(worn,.063,.103,1.20,stop.end-dir*.020,.278,dockZ);
    for(const x of [stand.x-.61,stand.x+.61]) {
      if(Math.abs(x-stop.end)<.12 || Math.abs(x-stop.land)<.20) continue;
      box(wet,.149,.435,.154,x,.255,dockZ-.572,"Ferry boarding post");
      box(worn,.162,.062,.165,x,.488,dockZ-.572);
      for(const y of [.358,.378,.399]) box(iron,.153,.019,.164,x,y,dockZ-.572);
    }
    const poleX=stop.land+dir*.27, poleZ=dockZ+.65;
    box(timber,.094,1.87,.095,poleX,.89,poleZ);
    box(worn,.512,.231,.054,poleX,1.58,poleZ+.035);
    const paper=document.createElement("canvas");
    paper.width=256;paper.height=100;
    const pen=paper.getContext("2d");
    pen.fillStyle="#d5bd91";pen.fillRect(0,0,256,100);
    pen.strokeStyle="#674c37";pen.lineWidth=5;pen.strokeRect(7,7,242,86);
    pen.fillStyle="#533a28";pen.font="45px serif";pen.textAlign="center";pen.textBaseline="middle";
    pen.fillText(stop.west ? "西岸渡口" : "東岸渡口",128,51);
    const map=new THREE.CanvasTexture(paper);map.colorSpace=THREE.SRGBColorSpace;
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(.475,.187),new THREE.MeshStandardMaterial({
      map,roughness:.92,side:THREE.DoubleSide,
    }));
    panel.position.set(poleX,1.58,poleZ+.063);
    group.add(panel);
    for(const [mat,fragments] of parts) {
      const mesh=new THREE.Mesh(mergeGeometries(fragments),mat);
      fragments.forEach(o=>o.dispose());
      mesh.name="Worked timber and iron ferry landing";
      mesh.castShadow=mesh.receiveShadow=true;
      mesh.layers.enable(1);
      group.add(mesh);
    }
  }

  const target=new THREE.Vector3(),axis=new THREE.Vector3(),backward=new THREE.Vector3(),side=new THREE.Vector3(),normal=new THREE.Vector3();
  const face=new THREE.Matrix4(),up=new THREE.Vector3(0,1,0),point=new THREE.Vector3();
  function poseRamp(i,amount,boat) {
    const {ramp,hinge,toe}=gangways[i];
    gangways[i].amount=amount;
    const setback=.083;
    toe.set(0,Math.sqrt(boardLength**2-setback**2),-setback);
    if(amount>0) {
      boat.toWorld(target.set(0,sillHeight(0)+.004,boardingZ));
      boat.toWorld(axis.set(1,sillHeight(1)+.004,boardingZ)).sub(target);
      const scale=axis.length();
      axis.divideScalar(scale);
      target.sub(hinge);
      const nearest=-target.dot(axis);
      const radial=target.lengthSq()-nearest*nearest;
      const onPad=THREE.MathUtils.clamp(nearest-Math.sqrt(Math.max(0,boardLength**2-radial)),
        skiffBoardingSill.minX*scale,skiffBoardingSill.maxX*scale);
      target.addScaledVector(axis,onPad);
      toe.lerp(target,amount);
    }
    toe.setLength(boardLength).add(hinge);
    backward.subVectors(hinge,toe).normalize();
    side.crossVectors(up,backward).normalize();
    normal.crossVectors(backward,side);
    ramp.position.copy(hinge);
    ramp.quaternion.setFromRotationMatrix(face.makeBasis(side,normal,backward));
    ramp.updateMatrixWorld();
  }
  for(let i=0;i<gangways.length;i++) poseRamp(i,0,null);
  return {stands,poseRamp,
    footOnRamp(i,side,along,out) {
      return gangways[i].ramp.localToWorld(out.set(side*.108,.015,-boardLength*along));
    },
    rampHeight(i,x,z) {
      const {ramp,hinge,amount}=gangways[i];
      if(amount<.985) return -Infinity;
      normal.set(0,1,0).applyQuaternion(ramp.quaternion);
      const y=hinge.y-(normal.x*(x-hinge.x)+normal.z*(z-hinge.z))/normal.y+.013;
      ramp.worldToLocal(point.set(x,y,z));
      return Math.abs(point.x)<=gangwayWidth*.52 && point.z>=-boardLength && point.z<=.011 ? y : -Infinity;
    },
    shoreFoot(i,side,out) {
      const {hinge}=gangways[i];
      return out.set(hinge.x+side*.107,deckY,dockZ-.22);
    },
    inspect:()=>gangways.map(({amount,toe})=>({amount,tip:toe.toArray()})),
    show(on) {
    landings.visible=on;
    for(const item of colliders) item.enabled=on;
  }};
}

export function createFerry(landing,boat,floor,onStep) {
  const worldSeat=new THREE.Vector3();
  const stance=[new THREE.Vector3(),new THREE.Vector3()];
  const stepFrom=new THREE.Vector3(), footPoint=new THREE.Vector3(), localCargo=new THREE.Vector3();
  const path=stance.map((_,i)=>({
    side:i===0 ? -1 : 1, waypoints:Array.from({length:4},()=>new THREE.Vector3()), contact:"dock",
  }));
  const times=[[0,.15,.30,.48,.64,.82],[.15,.30,.48,.64,.82,.985]];
  const supportSlots=["dock","dock","ramp","deck"];
  const angles=[0,0,0,Math.PI/2];
  const ramps=[0,0];
  const lastContact=["dock","dock"];
  let transferPhase=0;
  let boardSteps=0;
  const weight={x:0,y:0,z:0};
  const rider={y:0,feetY:0,facing:0,seated:0};
  let engaged=false, progress=0, speed=0, facingBank=0, motion=0, stroke=0, direction=0;
  let passenger="ashore", since=0, fromYaw=0, trips=0, exitBank=0, lastDock=0;

  function edge() {
    if(progress<=.001) return 0;
    if(progress>=.999) return 1;
    return null;
  }

  function nearby(player) {
    if(!Number.isFinite(ferryDeckHeight(player.x,player.z))) return -1;
    return landing.stands.findIndex(({x,z})=>
      Math.abs(player.x-x)<.85 && Math.abs(player.z-z)<.34);
  }

  function docked() {
    const bank=edge();
    return engaged && bank!==null && boat.at(moorings[bank].boat,ferryZ,yaw) ? bank : null;
  }

  function action(player) {
    if(passenger==="boarding" || passenger==="alighting") return null;
    if(passenger==="aboard") {
      const bank=docked();
      return bank!==null && ramps[bank]>=.992 ? "下船 G" : null;
    }
    const bank=nearby(player);
    if(bank<0) return null;
    if(docked()===bank) return ramps[bank]>=.992 ? "登船 G" : null;
    if(engaged && edge()===bank) return null;
    return "叫渡船 G";
  }

  function use(player,time) {
    if(!action(player)) return null;
    if(passenger==="aboard") {
      exitBank=docked();
      const shore=landing.stands[exitBank];
      stepFrom.set(shore.x,deckY,shore.z);
      fromYaw=player.yaw;
      lastContact.fill("deck");
      passenger="alighting";since=time;
      return "正在下船。";
    }
    const bank=nearby(player);
    if(docked()!==bank) {
      engaged=true;
      progress=bank;
      speed=0;
      command();
      return "渡船正在靠岸。";
    }
    passenger="boarding";
    since=time;
    facingBank=lastDock=exitBank=bank;
    stepFrom.set(player.x,floor(player.x,player.z),player.z);
    fromYaw=player.yaw;
    lastContact.fill("dock");
    return "沿跳板登船。坐稳后按 W 划向对岸，S 往回划。";
  }

  function command() {
    boat.command(lerp(moorings[0].boat,moorings[1].boat,progress),ferryZ,yaw,direction,stroke);
  }

  const faceYaw=yaw+Math.PI;
  const transferTime=()=>passenger==="boarding" ? 2.27 : 2.11;
  const oarsReady=()=>passenger==="aboard" && ramps[0]<.22 && ramps[1]<.22;
  function syncGangways() {
    for(let i=0;i<ramps.length;i++) landing.poseRamp(i,ramps[i],boat);
  }

  function transferFoot(i,t,anchor) {
    const {side,waypoints}=path[i], [start,shore,ramp,deck]=waypoints;
    const c=Math.cos(fromYaw),s=Math.sin(fromYaw);
    start.set(stepFrom.x+c*side*.112,stepFrom.y,stepFrom.z-s*side*.112);
    const y=floor(start.x,start.z);
    if(Number.isFinite(y)) start.y=y;
    landing.shoreFoot(exitBank,side,shore);
    landing.footOnRamp(exitBank,side,i===0 ? .64 : .81,ramp);
    boat.toWorld(deck.set(-side*.114,deckFootY,boardingZ));
    for(let step=0;step<3;step++) {
      const begin=times[i][step*2], end=times[i][step*2+1];
      if(t>end && step<2) continue;
      const travel=smoothstep(t,begin,end);
      const source=waypoints[step], next=waypoints[step+1];
      const lift=(step===2 ? .126 : .082)*Math.sin(Math.PI*travel);
      anchor.lerpVectors(source,next,travel);
      anchor.y+=lift;
      anchor.side=side;
      const startYaw=step===0 ? fromYaw : angles[step];
      const endYaw=angles[step+1];
      anchor.yaw=startYaw+Math.atan2(Math.sin(endYaw-startYaw),Math.cos(endYaw-startYaw))*travel;
      anchor.pitch=.105*Math.sin(Math.PI*2*travel);
      anchor.planted=travel===0 || travel===1;
      path[i].contact=anchor.planted ? supportSlots[step+Number(travel===1)] : "swing";
      return;
    }
  }

  function position(t,player) {
    boat.toWorld(worldSeat.set(0,.221,seatZ));
    if(passenger==="aboard") {
      player.x=worldSeat.x;
      player.z=worldSeat.z;
      rider.facing=faceYaw;
      rider.feetY=worldSeat.y-.167;
      rider.y=worldSeat.y-.628;
      rider.seated=1;
      return;
    }
    const step=passenger==="boarding" ? t : 1-t;
    transferPhase=step;
    for(let i=0;i<stance.length;i++) transferFoot(i,step,stance[i]);
    const turnOnDock=smoothstep(step,.015,.27);
    const shoreYaw=fromYaw+Math.atan2(Math.sin(-fromYaw),Math.cos(-fromYaw))*turnOnDock;
    rider.facing=lerp(shoreYaw,faceYaw,smoothstep(step,.61,.99));
    rider.seated=smoothstep(step,.79,1);
    const alignment=smoothstep(step,0,.098);
    player.x=lerp(stepFrom.x,(stance[0].x+stance[1].x)*.5,alignment);
    player.z=lerp(stepFrom.z,(stance[0].z+stance[1].z)*.5,alignment);
    rider.feetY=Math.min(stance[0].y,stance[1].y);
    const {separation,hip,upper,lower,ankle}=legRig;
    const cos=Math.cos(rider.facing),sin=Math.sin(rider.facing);
    const span=upper+lower-.012;
    let standing=rider.feetY-.018;
    for(const foot of stance) {
      const dx=foot.x-player.x-foot.side*separation*cos;
      const dz=foot.z-player.z+foot.side*separation*sin;
      standing=Math.min(standing,foot.y+ankle-hip+Math.sqrt(Math.max(.06,span*span-dx*dx-dz*dz)));
    }
    player.x=lerp(player.x,worldSeat.x,rider.seated);
    player.z=lerp(player.z,worldSeat.z,rider.seated);
    rider.y=lerp(standing,worldSeat.y-.628,rider.seated);
  }

  function update(dt,time,player,drive) {
    if(!engaged) return;
    const growing=passenger==="aboard";
    const bank=passenger==="boarding" || passenger==="alighting" ? exitBank : docked();
    let thrust=growing ? drive*(facingBank===0 ? 1 : -1) : 0;
    const departure=(bank===0 && thrust>0) || (bank===1 && thrust<0);
    for(let i=0;i<ramps.length;i++) {
      const desired=bank===i && !departure ? 1 : 0;
      ramps[i]=damp(ramps[i],desired,desired ? 9 : 11,dt);
      if(Math.abs(ramps[i]-desired)<.003) ramps[i]=desired;
    }
    syncGangways();
    if(departure && ramps[bank]>.025) thrust=0;
    speed=damp(speed,thrust*1.95,2.8,dt);
    const old=progress;
    progress=THREE.MathUtils.clamp(progress+dt*speed/travel,0,1);
    if(progress===0 || progress===1) speed=0;
    const rowing=Boolean(thrust && !(progress===old && edge()!==null));
    stroke=damp(stroke,Number(rowing),8,dt);
    if(rowing) {
      direction=Math.sign(thrust);
      motion+=dt*(6+Math.abs(speed)*1.40);
    }
    command();
    boat.stroke(motion,stroke,direction,oarsReady());
    if(!growing && passenger==="ashore") return;
    if(passenger==="boarding" || passenger==="alighting") {
      const t=Math.min(1,(time-since)/transferTime());
      position(t,player);
      for(const [i,foot] of stance.entries()) {
        const contact=path[i].contact;
        if(lastContact[i]==="swing" && foot.planted) {
          onStep(foot.x,foot.z,contact);
          boardSteps++;
        }
        lastContact[i]=contact;
      }
      if(t<1) return;
      if(passenger==="boarding") return void (passenger="aboard");
      passenger="ashore";
      return "landed";
    }
    const arrived=docked();
    if(arrived!==null && arrived!==lastDock) {
      trips++;
      lastDock=arrived;
    }
    position(1,player);
  }

  function feet() {
    if(passenger!=="aboard") return stance;
    for(const [i,foot] of stance.entries()) {
      foot.side=path[i].side;
      boat.toWorld(foot.set(-foot.side*.114,deckFootY,boardingZ));
      foot.pitch=0;
      foot.yaw=rider.facing;
      foot.planted=true;
    }
    return stance;
  }

  function grounding(x,z) {
    footPoint.set(x,rider.feetY,z);
    if(passenger==="aboard") return boat.deckHeight(footPoint,deckFootY);
    const ramp=landing.rampHeight(exitBank,x,z);
    const ground=floor(x,z);
    if(Number.isFinite(ramp)) return Math.max(ground,ramp);
    boat.fromWorld(footPoint);
    const length=Math.abs(footPoint.z-boardingZ);
    const boatSide=length<.2135 && footPoint.x>=skiffBoardingSill.minX && footPoint.x<=skiffBoardingSill.maxX;
    const height=sillHeight(footPoint.x);
    const live=length<.59 && Math.abs(footPoint.x)<.31;
    footPoint.set(x,rider.feetY,z);
    const deck=boatSide ? boat.deckHeight(footPoint,height) : live ? boat.deckHeight(footPoint,deckFootY) : -Infinity;
    return Math.max(ground,deck);
  }

  return {
    action,use,update,feet,rider,nearby,syncGangways,stands:landing.stands,
    arrivedAcross:()=>exitBank!==facingBank,
    deferTransfer(seconds) { since+=seconds; },
    viewYaw(yaw) {
      const turn=rider.facing-fromYaw;
      return yaw+Math.atan2(Math.sin(turn),Math.cos(turn));
    },
    gangwayPitch() {
      if(passenger!=="boarding" && passenger!=="alighting") return 0;
      return -.83*smoothstep(transferPhase,0,.28)*(1-smoothstep(transferPhase,.69,1));
    },
    active:()=>passenger!=="ashore",
    atMooring:()=>!engaged,
    rowing:()=>oarsReady() ? .18+.82*stroke : 0,
    grip:boat.grip,
    sync(time,player) { position(Math.min(1,(time-since)/transferTime()),player); },
    cargoAttitude:boat.attitude,
    grounding,
    cargo(fallback) {
      boat.toWorld(localCargo.set(0,.229,.05));
      weight.x=lerp(fallback.x,localCargo.x,rider.seated);
      weight.y=lerp(fallback.y,localCargo.y,rider.seated);
      weight.z=lerp(fallback.z,localCargo.z,rider.seated);
      return weight;
    },
    reset() {
      engaged=false;progress=speed=motion=stroke=direction=trips=boardSteps=0;passenger="ashore";
      rider.y=rider.feetY=rider.facing=rider.seated=0;
      ramps.fill(0);
      boat.reset();
      syncGangways();
    },
    inspect(player) {
      return {phase:passenger,engaged,near:nearby(player),docked:docked(),progress,speed,trips,
        standingY:rider.y,feetY:rider.feetY,stroke,stands:landing.stands,gangways:landing.inspect(),boardSteps,
        transfer:passenger==="boarding" || passenger==="alighting" ? {
          phase:transferPhase,feet:stance.map((foot,i)=>({position:foot.toArray(),planted:foot.planted,contact:path[i].contact})),
        } : null};
    },
  };
}
