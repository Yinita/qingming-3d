import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";

const dockZ=-50.63, ferryZ=-51.76, deckY=.258;
const boardZ=dockZ-.065;
const moorings=[
  {west:true,land:-68.35,end:-64.06,boat:-65.46},
  {west:false,land:-48.54,end:-52.36,boat:-52.46},
];
const yaw=-Math.PI/2;
const seatZ=-.78, deckFootY=.049;
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

  return {stands,show(on) {
    landings.visible=on;
    for(const item of colliders) item.enabled=on;
  }};
}

export function createFerry(landing,boat,floor) {
  const worldSeat=new THREE.Vector3();
  const stance=[new THREE.Vector3(),new THREE.Vector3()];
  const stepFrom=new THREE.Vector3(), footPoint=new THREE.Vector3(), localCargo=new THREE.Vector3();
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
    if(passenger==="aboard") return docked()!==null ? "下船 G" : null;
    const bank=nearby(player);
    if(bank<0) return null;
    if(docked()===bank) return "登船 G";
    if(engaged && edge()===bank) return null;
    return "叫渡船 G";
  }

  function use(player,time) {
    if(!action(player)) return null;
    if(passenger==="aboard") {
      exitBank=docked();
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
    return "扶住船沿跨上去。W 划向对岸，S 往回划。";
  }

  function command() {
    boat.command(lerp(moorings[0].boat,moorings[1].boat,progress),ferryZ,yaw,direction,stroke);
  }

  const faceYaw=yaw+Math.PI;
  const transferTime=()=>passenger==="boarding" ? 1.16 : .91;
  function position(t,player) {
    boat.toWorld(worldSeat.set(0,.221,seatZ));
    const destination=landing.stands[exitBank];
    const incoming=passenger==="boarding";
    const alignAcross=incoming ? smoothstep(t,0,.19) : 1;
    const alignAlong=incoming ? smoothstep(t,.08,.40) : 1;
    const amount=passenger==="aboard" ? 1 : incoming ? smoothstep(t,.40,1) : 1-smoothstep(t,0,1);
    const fromX=incoming ? lerp(stepFrom.x,destination.x,alignAlong) : destination.x;
    const fromZ=incoming ? lerp(stepFrom.z,destination.z,alignAcross) : destination.z;
    const fromY=incoming ? lerp(stepFrom.y,deckY,alignAlong) : deckY;
    const angleChange=Math.atan2(Math.sin(faceYaw-fromYaw),Math.cos(faceYaw-fromYaw));
    player.x=lerp(fromX,worldSeat.x,amount);
    player.z=lerp(fromZ,worldSeat.z,amount);
    rider.seated=smoothstep(amount,.53,1);
    rider.facing=fromYaw+angleChange*amount;
    const jump=.24*Math.sin(Math.PI*amount);
    rider.feetY=lerp(fromY,worldSeat.y-.167,amount)+jump;
    rider.y=lerp(rider.feetY,worldSeat.y-.628,rider.seated);
  }

  function update(dt,time,player,drive) {
    if(!engaged) return;
    const growing=passenger==="aboard";
    const thrust=growing ? drive*(facingBank===0 ? 1 : -1) : 0;
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
    boat.stroke(motion,stroke,direction,growing);
    if(!growing && passenger==="ashore") return;
    if(passenger==="boarding" || passenger==="alighting") {
      const t=Math.min(1,(time-since)/transferTime());
      position(t,player);
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

  function feet(player) {
    for(const [i,foot] of stance.entries()) {
      const side=i===0 ? -1 : 1;
      boat.toWorld(foot.set(-side*.114,deckFootY,seatZ+.304));
      const c=Math.cos(rider.facing),s=Math.sin(rider.facing);
      foot.x=lerp(player.x+c*side*.115,foot.x,rider.seated);
      foot.z=lerp(player.z-s*side*.115,foot.z,rider.seated);
      foot.y=lerp(rider.feetY,foot.y,rider.seated);
      foot.pitch=0;foot.side=side;foot.yaw=rider.facing;
    }
    return stance;
  }

  return {
    action,use,update,feet,rider,nearby,stands:landing.stands,
    arrivedAcross:()=>exitBank!==facingBank,
    deferTransfer(seconds) { since+=seconds; },
    viewYaw(yaw) {
      const offset=Math.atan2(Math.sin(faceYaw-fromYaw),Math.cos(faceYaw-fromYaw));
      return yaw+offset*rider.seated;
    },
    active:()=>passenger!=="ashore",
    atMooring:()=>!engaged,
    rowing:()=>passenger==="aboard" ? .18+.82*stroke : 0,
    grip:boat.grip,
    sync(time,player) { position(Math.min(1,(time-since)/transferTime()),player); },
    cargoAttitude:boat.attitude,
    grounding(x,z) {
      footPoint.set(x,rider.feetY,z);
      return lerp(rider.feetY,boat.deckHeight(footPoint,deckFootY),rider.seated);
    },
    cargo(fallback) {
      boat.toWorld(localCargo.set(0,.229,.05));
      weight.x=lerp(fallback.x,localCargo.x,rider.seated);
      weight.y=lerp(fallback.y,localCargo.y,rider.seated);
      weight.z=lerp(fallback.z,localCargo.z,rider.seated);
      return weight;
    },
    reset() {
      engaged=false;progress=speed=motion=stroke=direction=trips=0;passenger="ashore";
      rider.y=rider.feetY=rider.facing=rider.seated=0;
      boat.reset();
    },
    inspect(player) {
      return {phase:passenger,engaged,near:nearby(player),docked:docked(),progress,speed,trips,
        standingY:rider.y,feetY:rider.feetY,stroke,stands:landing.stands};
    },
  };
}
