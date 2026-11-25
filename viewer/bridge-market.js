import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { circleTouchesBox,sweepHorizontal,workerHeight,workerRadius } from "./bridge-collision.js";
import { createMarketHandoff } from "./bridge-market-gesture.js";
import { buildBambooSteamer,cakeLiftDuration } from "./bridge-steamer.js";
import { createGroundedGait } from "./bridge-gait.js";
import { riverWorker } from "./bridge-people.js";
import { canalDepth,waterHeight } from "./bridge-canal-bed.js";

const shopX=-42.69, shopZ=-37.55;
const steamX=-.447, steamZ=-.077;
const counterY=.888, wrapX=.034, wrapZ=.087, servedZ=-.054, sellerZ=.511;
const {clamp,damp,lerp,smoothstep}=THREE.MathUtils;
const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const routes=[
  {role:"porter",name:"Market basket porter",speed:1.17,radius:.327,side:1,
    // Return through the stall frontage. The north lane is used by the draught cart.
    stops:[[-46.22,-39.19,2],[-43.05,-39.34,.25],[-39.13,-39.13,1.5],[-38.96,-36.75,.6],
      [-39.60,-38.27,.3],[-43.76,-38.98,.8],[-46.62,-37.0,.3]]},
  {role:"shopper",name:"Market errand shopper",speed:1.04,radius:.298,side:-1,
    stops:[[-39.59,-38.88,.8],[-41.62,-38.75,.8],[-42.11,-38.54,3.4],[-44.35,-38.65,.3],
      [-45.42,-36.31,2],[-44.85,-37.10,1.1],[-42.63,-38.49,.2]]},
];

function parcel(parent,paper,cord) {
  const group=new THREE.Group();
  group.name="Twine and folded rice paper parcel";
  parent.add(group);
  function attach(geometry,mat,x,y,z) {
    const piece=new THREE.Mesh(geometry,mat);
    piece.position.set(x,y,z);piece.castShadow=piece.receiveShadow=true;
    group.add(piece);
  }
  attach(detailedBox(.232,.071,.155,paper,.016,.39),paper,0,.038,0);
  const bottom=new THREE.BufferGeometry();
  bottom.setAttribute("position",new THREE.Float32BufferAttribute([
    -.108,.074,-.069, .108,.074,-.069, 0,.086,.017,
    .107,.076,.067, -.104,.074,.068, -.008,.083,-.016,
    -.114,.043,-.068, -.113,.042,.068, -.106,.077,.004,
    .114,.042,.068, .114,.042,-.067, .106,.076,.003,
  ],3));
  bottom.setAttribute("uv",new THREE.Float32BufferAttribute([
    0,0,1,0,.51,.6, 1,1,0,1,.48,.47, 0,0,1,0,.53,.6, 1,0,0,0,.48,.6,
  ],2));
  bottom.computeVertexNormals();
  attach(bottom,paper,0,0,0);
  for(const [curve,angle] of [[[.119,.045],0],[[.084,.045],Math.PI/2]]) {
    const [width,height]=curve;
    const rounded=new THREE.CurvePath();
    const points=[[-width,0],[-width*.98,height*.82],[-width*.52,height],[width*.53,height],
      [width*.98,height*.83],[width,0],[width*.97,-height*.85],[0,-height],
      [-width*.97,-height*.84],[-width,0]];
    rounded.add(new THREE.CatmullRomCurve3(points.map(([x,y])=>new THREE.Vector3(x,y,0)),true));
    attach(new THREE.TubeGeometry(rounded,36,.0026,5,false).rotateY(angle),cord,0,.039,0);
  }
  attach(new THREE.SphereGeometry(.009,8,6),cord,.005,.086,.006);
  return group;
}

export function buildLivingMarket(root,city,surface,floor,riverOrigin,sampleAir) {
  const market=new THREE.Group();
  market.name="Living east bank market";
  root.add(market);
  const stall=new THREE.Group();
  stall.name="Rice cake stall";
  stall.position.set(shopX,floor(shopX,shopZ),shopZ);
  market.add(stall);
  const wood=surface("tea-wood",0xd4ae88,.91,.84);
  const frame=surface("rail-wood",0xa38c72,.76,.90);
  const worn=surface("tea-wood",0xb49270,.84,.90);
  const stone=surface("worn-stone",0xcec1a4,.92,.95);
  const linen=surface("indigo-linen",0xc4a17e,.56,.93);
  const paper=surface("lime-plaster",0xf1dfb7,.31,.93);paper.side=THREE.DoubleSide;
  const rope=new THREE.MeshStandardMaterial({color:0x7b5e40,roughness:.96});
  const glaze=new THREE.MeshPhysicalMaterial({color:0x647a70,clearcoat:.33,roughness:.37});
  const food=new THREE.MeshStandardMaterial({color:0xe9d7ac,roughness:.69});
  const seeds=new THREE.MeshStandardMaterial({color:0x8c6650,roughness:.84});
  const parts=new Map();
  function place(parent,geometry,material,x,y,z) {
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z);
    mesh.castShadow=mesh.receiveShadow=true;
    mesh.layers.enable(1);
    parent.add(mesh);
    return mesh;
  }
  function solid(mat,w,h,d,x,y,z,collision=null) {
    const geometry=detailedBox(w,h,d,mat,.015,x*.7+y*3.1);
    geometry.translate(x,y,z);
    if(!parts.has(mat)) parts.set(mat,[]);
    parts.get(mat).push(geometry);
    if(collision) city.box(collision,shopX+x-w*.5,shopX+x+w*.5,shopZ+z-d*.5,shopZ+z+d*.5,
      stall.position.y+y-h*.5,stall.position.y+y+h*.5);
  }
  solid(wood,1.965,.075,.612,0,counterY-.0375,-.133,"Steam cake counter");
  solid(worn,1.83,.118,.48,0,.733,-.083);
  solid(frame,1.84,.092,.515,0,.312,-.075);
  solid(wood,1.73,.044,.49,0,.364,-.084);
  for(const x of [-.85,.85]) for(const z of [-.34,.18]) {
    solid(frame,.085,.838,.092,x,.421,z);
    solid(stone,.162,.101,.165,x,.05,z);
  }
  for(const x of [-1.137,1.137]) for(const z of [-.53,.55]) {
    solid(frame,.115,2.094,.110,x,1.15,z,"Market awning post");
    solid(stone,.191,.152,.176,x,.087,z);
    for(const y of [1.927,1.948,1.969]) solid(rope,.124,.016,.123,x,y,z);
  }
  for(const z of [-.68,.67]) solid(wood,2.603,.093,.120,0,2.084,z);
  for(const x of [-1.08,-.54,0,.54,1.08]) solid(frame,.047,.058,1.63,x,2.153,0);
  solid(frame,.44,.070,.41,1.37,.729,.35,"Market storage stand");
  for(const x of [1.20,1.54]) solid(worn,.064,.718,.063,x,.364,.34);
  for(const [mat,pieces] of parts) {
    const model=mergeGeometries(pieces);
    pieces.forEach(geometry=>geometry.dispose());
    place(stall,model,mat,0,0,0).name="Market wood joinery and stone footings";
  }

  const canopyWidth=2.66, run=.84, eave=2.135, slope=.23;
  const grid=new THREE.PlaneGeometry(canopyWidth,run*2,36,16).rotateX(-Math.PI/2);
  const vertices=grid.attributes.position, clothColor=[];
  const bands=[.89,.51,.92,.83,.89,.51,.92];
  for(let i=0;i<vertices.count;i++) {
    const x=vertices.getX(i), z=vertices.getZ(i), edge=Math.abs(z)/run;
    const arc=.028*(.5+.5*Math.cos(x*12))*Math.sin(Math.PI*edge);
    vertices.setY(i,eave+(run-Math.abs(z))*slope+.129*edge**4-arc);
    vertices.setZ(i,z+.016*Math.sin(x*9)*edge**4);
    const col=(x/canopyWidth+.5)*bands.length;
    const tone=(bands[Math.min(bands.length-1,Math.floor(col))]??.89)*
      (1-.09*Math.cos(col*Math.PI*2))*(.94+.06*Math.cos(x*12.2+z*3));
    clothColor.push(tone,tone*.985,tone*.95);
  }
  grid.setAttribute("color",new THREE.Float32BufferAttribute(clothColor,3));
  grid.computeVertexNormals();
  linen.vertexColors=true;linen.side=THREE.DoubleSide;
  linen.emissive.setHex(0x8e7359);
  linen.emissiveIntensity=.14;
  const canopy=place(stall,grid,linen,0,0,0);
  canopy.name="Canvas market canopy";
  canopy.userData.roofProfile={width:canopyWidth,run,eave,centreZ:0,slope,kind:"cloth"};
  stall.userData.rainFoundation={x:shopX,z:shopZ,halfX:1.17,halfZ:.53};
  const valance=new THREE.PlaneGeometry(canopyWidth,.159,36,4);
  const hem=valance.attributes.position;
  for(let i=0;i<hem.count;i++) {
    const x=hem.getX(i), y=hem.getY(i), hang=.5-y/.159;
    hem.setXYZ(i,x,y+.028*Math.sin(11*x)*hang,Math.sin(12*x)*(.008+.027*hang));
  }
  valance.computeVertexNormals();
  const border=surface("indigo-linen",0xdeb87e,.53,.94);
  border.side=THREE.DoubleSide;
  border.emissive.copy(linen.emissive);
  border.emissiveIntensity=linen.emissiveIntensity;
  const flap=place(stall,valance,border,0,eave+.051,-run+.007);
  flap.name="Soft hanging market awning hem";
  const reflectedLight=new THREE.PointLight(0xffe8c9,.79,3.15,2);
  reflectedLight.position.set(.14,1.61,-.86);
  stall.add(reflectedLight);

  const sign=document.createElement("canvas");sign.width=240;sign.height=84;
  const ink=sign.getContext("2d");
  ink.fillStyle="#ae9070";ink.fillRect(0,0,240,84);
  ink.strokeStyle="#533b2d";ink.lineWidth=4;ink.strokeRect(6,6,228,72);
  ink.fillStyle="#473226";ink.textAlign="center";ink.textBaseline="middle";ink.font="46px serif";
  ink.fillText("蒸糕",120,45);
  const label=new THREE.CanvasTexture(sign);label.colorSpace=THREE.SRGBColorSpace;
  const plaque=place(stall,new THREE.PlaneGeometry(.61,.214),
    new THREE.MeshStandardMaterial({map:label,roughness:.95}),.64,1.86,-.695);
  plaque.rotateY(Math.PI);

  const crock=new THREE.LatheGeometry([[0,0],[.11,.004],[.154,.085],[.145,.17],[.083,.209],[.081,.248],
    [.072,.253],[.067,.241],[.066,.199],[.13,.14],[.105,.043],[0,.041]].map(p=>new THREE.Vector2(...p)),28);
  place(stall,crock,glaze,1.38,.766,.35).name="Storage crock at the cake stall";
  const steamer=buildBambooSteamer(stall,surface,{x:steamX,y:counterY,z:steamZ,place,sampleAir});
  const cakes=[];
  const cakeGeo=detailedBox(.095,.056,.073,food,.013,0);
  const seed=new THREE.SphereGeometry(.0034,6,4);
  const assortment=[[-.112,-.085],[0,-.085],[.112,-.085],[-.114,.023],[0,.023],[.114,.023],[.005,.127]];
  const cakeHeight=counterY+.141;
  for(const [i,[x,z]] of assortment.entries()) {
    const cake=new THREE.Group();
    cake.name="Steamed rice cake";
    cake.position.set(steamX+x,cakeHeight,steamZ+z);
    cake.rotation.y=Math.sin(i*2.43)*.23;
    stall.add(cake);
    place(cake,cakeGeo,food,0,0,0);
    for(let j=0;j<4;j++)
      place(cake,seed,seeds,Math.sin(i+j*7)*.033,.029,Math.cos(i*4.3+j*2.8)*.024);
    cakes.push(cake);
  }
  const servingCake=cakes.at(-1);
  servingCake.name="Rice cake being served";
  const cakeStart=servingCake.position.clone();
  const cakeYaw=servingCake.rotation.y;
  const bowl=new THREE.LatheGeometry([[0,.004],[.08,.005],[.102,.040],[.104,.07],[.098,.069],
    [.092,.035],[.067,.017],[0,.015]].map(p=>new THREE.Vector2(...p)),24);
  place(stall,bowl,glaze,.61,counterY,-.165);
  const wrappingSheet=new THREE.PlaneGeometry(.265,.223,14,12).rotateX(-Math.PI/2);
  const sheetPositions=wrappingSheet.attributes.position;
  const foldedCorners=[];
  for(let i=0;i<sheetPositions.count;i++) {
    const x=sheetPositions.getX(i),z=sheetPositions.getZ(i);
    const outer=smoothstep(Math.max(Math.abs(x)/.1325,Math.abs(z)/.1115),.42,1);
    const ripple=(Math.sin(x*66+z*12)+Math.cos(z*62-x*9))*.0019*outer;
    sheetPositions.setY(i,ripple);
    foldedCorners.push(x*(1-.49*outer),ripple+.071*outer,z*(1-.53*outer));
  }
  wrappingSheet.computeVertexNormals();
  const foldedSheet=wrappingSheet.clone();
  const foldedPosition=new THREE.Float32BufferAttribute(foldedCorners,3);
  foldedSheet.setAttribute("position",foldedPosition);
  foldedSheet.computeVertexNormals();
  wrappingSheet.morphAttributes.position=[foldedPosition];
  wrappingSheet.morphAttributes.normal=[foldedSheet.attributes.normal];
  const sheet=place(stall,wrappingSheet,paper,wrapX,counterY+.004,wrapZ);
  sheet.name="Loose rice paper under the serving cake";
  const packet=parcel(stall,paper,rope);
  packet.visible=false;

  const seller=riverWorker(market,surface,"baker");
  seller.figure.name="Market rice cake seller";
  seller.figure.position.set(shopX,floor(shopX,shopZ+sellerZ),shopZ+sellerZ);
  seller.stand(floor,seller.figure.position.x,seller.figure.position.y,seller.figure.position.z,0);
  const sellerBody=city.cylinder("Cake seller",shopX,shopZ+sellerZ,seller.figure.position.y,
    seller.figure.position.y+workerHeight,.328);
  sellerBody.camera=false;
  let time=0,bought=false,claimed=false,began=-Infinity,peekAt=-Infinity;
  const grip=new THREE.Vector3(),workGrip=new THREE.Vector3();
  const wrapAge=()=>time-began-cakeLiftDuration;
  const openingAge=()=>time-peekAt;
  const peekBusy=()=>openingAge()<2.8;
  const serving=()=>bought && wrapAge()<0;
  const previewBusy=()=>peekBusy() || (bought && !claimed && wrapAge()<3.05);
  let groundContact=null, footSupport=null;
  const marketActors=routes.map(spec=>{
    const worker=riverWorker(market,surface,spec.role);
    worker.figure.name=spec.name;
    const [x,z,pause]=spec.stops[0];
    const y=floor(x,z);
    const body=city.cylinder(spec.name,x,z,y,y+workerHeight,spec.radius);
    const actor={worker,spec,body,x,z,yaw:0,speed:0,next:1,wait:pause,bypass:[],
      behavior:"waiting",blocked:null,blockedFor:0,retryAt:0,completed:0,yields:0,detours:0,look:0,distance:0,lastThreat:false};
    const renderedBasket=spec.role==="porter" ? wickerCarrier(worker.figure,wood,worn,rope,place) : null;
    const basket=renderedBasket ? city.orientedBox("Porter's wicker load",.276,.192,.322) : null;
    if(basket) basket.camera=false;
    actor.basket=basket;
    actor.load=renderedBasket;
    actor.gait=createGroundedGait(floor,(x,z)=>dry(x,z) &&
      !city.blocking(x,z,floor(x,z),.138,.18,body,basket),(x,y,z,time,vx,vz,foot)=>{
      groundContact?.(spec.role,foot,vx,vz);
      return false;
    });
    return actor;
  });
  const probe={x:0,z:0,bottom:0,top:0,yaw:0};
  const shopper=marketActors.find(actor=>actor.spec.role==="shopper");
  const handoff=createMarketHandoff(shopper,parcel(market,paper,rope),{city,floor,obstruction,placeActor});

  function dry(x,z) {
    return x>-47.10 && x<-38.29 && z>-40.42 && z<-34.05 &&
      canalDepth(riverOrigin,x,z)<=waterHeight+.02;
  }

  function loadPose(x,z,y,yaw,p) {
    p.x=x-Math.sin(yaw)*.287;
    p.z=z-Math.cos(yaw)*.287;
    p.bottom=y+.726;
    p.top=y+1.05;
    p.yaw=yaw;
  }

  function overlapsPlayer(x,z,y,radius,player) {
    return player && y<player.y+workerHeight && y+workerHeight>player.y &&
      Math.hypot(x-player.x,z-player.z)<radius+player.radius+.014;
  }

  function enteringPlayerPath(actor,x,z,y,player) {
    if(!player || (!player.moveX && !player.moveZ)) return false;
    const clearance=actor.body.radius+player.radius+(actor.basket ? .19 : .09);
    const aheadX=player.x+player.moveX*.78,aheadZ=player.z+player.moveZ*.78;
    const newGap=Math.hypot(x-aheadX,z-aheadZ);
    const oldGap=Math.hypot(actor.x-aheadX,actor.z-aheadZ);
    return y<player.y+workerHeight && y+workerHeight>player.y &&
      newGap<clearance && newGap<oldGap+.004;
  }

  function obstruction(actor,x,z,yaw,player) {
    if(!dry(x,z)) return "edge";
    const {body,basket}=actor,y=floor(x,z);
    if(overlapsPlayer(x,z,y,body.radius,player) || enteringPlayerPath(actor,x,z,y,player)) return "player";
    const carried=player?.cargo;
    if(carried && y<carried.top && y+workerHeight>carried.bottom &&
      circleTouchesBox(x,z,body.radius,carried.x,carried.z,carried.halfX,carried.halfZ,carried.yaw))
      return "player cargo";
    const fixed=city.blocking(x,z,y,body.radius,workerHeight,body,basket);
    if(fixed) return fixed.name;
    if(!basket) return null;
    loadPose(x,z,y,yaw,probe);
    if(player && probe.bottom<player.y+workerHeight && probe.top>player.y &&
      circleTouchesBox(player.x,player.z,player.radius,probe.x,probe.z,basket.halfX,basket.halfZ,yaw))
      return "player";
    return city.boxBlocking(probe.x,probe.z,probe.bottom,basket.halfX,basket.halfZ,probe.top-probe.bottom,yaw,
      body,basket)?.name??null;
  }

  function placeActor(actor,dt,player,vx,vz) {
    const {worker,body,basket,gait}=actor;
    const y=floor(actor.x,actor.z);
    Object.assign(body,{x:actor.x,z:actor.z,bottom:y,top:y+workerHeight});
    if(basket) loadPose(actor.x,actor.z,y,actor.yaw,basket);
    gait.update(dt,time,actor.x,actor.z,actor.yaw,vx,vz,0);
    const height=gait.rootHeight(actor.x,actor.z);
    worker.figure.position.set(actor.x,height,actor.z);
    worker.figure.rotation.y=actor.yaw;
    worker.walkBody(gait.phase()-Math.PI*.5,Math.hypot(vx,vz)>.13,false,dt);
    worker.poseFeet(gait.feet,floor,actor.x,height,actor.z,actor.yaw);
    footSupport?.(actor.spec.role,gait.feet);
    const dist=player ? Math.hypot(actor.x-player.x,actor.z-player.z) : Infinity;
    const look=dist<2.25 ? clamp(delta(Math.atan2(actor.x-player.x,actor.z-player.z),actor.yaw),-.83,.83)*
      (1-smoothstep(dist,1.08,2.25)) : .07*Math.sin(time*.92+actor.spec.side);
    actor.look=damp(actor.look,look,6,dt);
    worker.head.rotation.y=actor.look;
    if(actor.spec.role==="shopper") worker.lookEyes(clamp(actor.look,-1,1),0,dt);
    blink(worker,time+(actor.spec.side>0 ? .3 : 1.5));
    if(actor.load) {
      const p=gait.phase();
      actor.load.position.y=.865+.014*Math.cos(p*2)*smoothstep(actor.speed,.16,1.06);
      actor.load.rotation.set(.053+actor.speed*.032,0,.045*Math.sin(p)*smoothstep(actor.speed,.18,1.10));
      for(let i=0;i<2;i++) {
        actor.load.localToWorld(grip.set(i===0 ? -.158 : .158,.204,.008));
        worker.reachHand(i,grip,.97);
      }
    }
  }

  function blink(person,at) {
    const cycle=(at%4.05);
    person.blink(.98*Math.max(0,1-Math.abs(cycle-.14)/.099));
  }

  const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  function detour(actor,player,goal) {
    const stride=.43;
    const start={i:0,j:0,x:actor.x,z:actor.z,cost:0,previous:null};
    const distance=(x,z)=>Math.hypot(goal[0]-x,goal[1]-z);
    start.rank=distance(start.x,start.z);
    const open=[start], best=new Map([["0:0",0]]);
    function clear(from,x,z) {
      const dx=x-from.x,dz=z-from.z;
      const yaw=Math.atan2(-dx,-dz);
      const samples=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
      for(let i=1;i<=samples;i++)
        if(obstruction(actor,from.x+dx*i/samples,from.z+dz*i/samples,yaw,player)) return false;
      return true;
    }
    // Search only the dry lanes around the market. The same shape checks used
    // to take a step also check every proposed leg, including the wicker basket.
    for(let visited=0;open.length && visited<150;visited++) {
      open.sort((a,b)=>b.rank-a.rank);
      const from=open.pop();
      if(from.cost>best.get(from.i+":"+from.j)) continue;
      if(distance(from.x,from.z)<1.10 && clear(from,goal[0],goal[1])) {
        const waypoints=[[goal[0],goal[1]]];
        for(let node=from;node.previous;node=node.previous) waypoints.unshift([node.x,node.z]);
        while(waypoints.length>1 && clear(start,...waypoints[1])) waypoints.shift();
        return waypoints;
      }
      for(const [di,dj] of directions) {
        const i=from.i+di,j=from.j+dj,x=start.x+i*stride,z=start.z+j*stride;
        if(!dry(x,z)) continue;
        const cost=from.cost+stride*Math.hypot(di,dj);
        const key=i+":"+j;
        if(cost>=(best.get(key)??Infinity) || !clear(from,x,z)) continue;
        best.set(key,cost);
        open.push({i,j,x,z,cost,rank:cost+distance(x,z)*1.05,previous:from});
      }
    }
    return [];
  }

  function moveActor(actor,dt,player) {
    const waypoint=actor.spec.stops[actor.next];
    // An occupied waypoint is part of the path, so go around it instead of
    // trying to reach the same spot from every side of the player.
    if(actor.blockedFor>.90 && overlapsPlayer(waypoint[0],waypoint[1],floor(waypoint[0],waypoint[1]),
      actor.body.radius+.09,player)) {
      actor.next=(actor.next+1)%actor.spec.stops.length;
      actor.bypass=[];
      actor.blockedFor=0;
    }
    let stop=actor.bypass[0]??actor.spec.stops[actor.next];
    if(actor.bypass.length && Math.hypot(stop[0]-actor.x,stop[1]-actor.z)<.12) {
      actor.bypass.shift();
      stop=actor.bypass[0]??actor.spec.stops[actor.next];
    }
    let dx=stop[0]-actor.x,dz=stop[1]-actor.z,remaining=Math.hypot(dx,dz);
    if(!actor.bypass.length && actor.wait<=0 && remaining<.125) {
      actor.wait=stop[2];
      actor.next=(actor.next+1)%actor.spec.stops.length;
      if(actor.next===0) actor.completed++;
    }
    const oldX=actor.x,oldZ=actor.z;
    const due=actor.wait<=0 && remaining>.001;
    if(actor.wait>0) actor.wait=Math.max(0,actor.wait-dt);
    const direction=Math.atan2(-dx,-dz);
    const lookAhead=due ? Math.min(1,.48/remaining) : 0;
    const found=due ? obstruction(actor,actor.x+dx*lookAhead,actor.z+dz*lookAhead,direction,player) : null;
    const threat=found==="player" || found==="player cargo";
    if(threat && !actor.lastThreat) actor.yields++;
    actor.lastThreat=threat;
    actor.blocked=found;
    let aim=direction,canMove=due && !found, behavior=due ? "walking" : "waiting";
    actor.blockedFor=found ? actor.blockedFor+dt : 0;
    if(found && actor.blockedFor>.72 && time>=actor.retryAt) {
      actor.retryAt=time+.91+actor.spec.side*.11;
      const goals=actor.blockedFor>2.3 ? 3 : 1;
      for(let offset=0;offset<goals;offset++) {
        const next=(actor.next+offset)%actor.spec.stops.length;
        const goal=actor.spec.stops[next];
        const yaw=Math.atan2(actor.x-goal[0],actor.z-goal[1]);
        // A pause point can temporarily be occupied by a customer or a basket.
        if(obstruction(actor,goal[0],goal[1],yaw,player)) continue;
        const path=detour(actor,player,goal);
        if(!path.length) continue;
        actor.next=next;
        actor.bypass=path;
        dx=path[0][0]-actor.x;
        dz=path[0][1]-actor.z;
        remaining=Math.hypot(dx,dz);
        aim=Math.atan2(-dx,-dz);
        canMove=true;
        break;
      }
    }
    if(actor.bypass.length && canMove) behavior="passing";
    if(due && found && !canMove) behavior="yielding";
    if(behavior==="passing" && canMove && actor.behavior!=="passing") actor.detours++;
    actor.behavior=behavior;
    const lastYaw=actor.yaw;
    const face=canMove ? aim : lastYaw;
    const turn=lastYaw+delta(face,lastYaw)*(1-Math.exp(-8*dt));
    if(!obstruction(actor,actor.x,actor.z,turn,player)) actor.yaw=turn;
    actor.speed=damp(actor.speed,canMove ? actor.spec.speed*(behavior==="passing" ? .68 : 1)*(.38+.62*smoothstep(remaining,.15,.44)) : 0,8,dt);
    if(canMove) {
      const step=Math.min(remaining,actor.speed*dt);
      sweepHorizontal(actor,-Math.sin(aim)*step,-Math.cos(aim)*step,
        (x,z)=>!obstruction(actor,x,z,actor.yaw,player));
    }
    const vx=(actor.x-oldX)/dt,vz=(actor.z-oldZ)/dt;
    actor.distance+=Math.hypot(vx,vz)*dt;
    placeActor(actor,dt,player,vx,vz);
  }

  function arrangePacket(age) {
    const revealed=smoothstep(age,.70,1.18);
    const present=smoothstep(age,2.06,2.84);
    packet.position.set(wrapX,counterY+.004+Math.sin(Math.PI*present)*.019,lerp(wrapZ,servedZ,present));
    packet.rotation.y=lerp(-.12,.10,present);
    packet.scale.set(.80+revealed*.20,.57+revealed*.43,.82+revealed*.18);
    packet.visible=bought && !claimed && revealed>.03;
    sheet.visible=!bought || age<.88;
    sheet.morphTargetInfluences[0]=bought ? smoothstep(age,.35,.97) : 0;
  }

  function useSteamer() {
    const cooking=serving();
    const age=cooking ? time-began : openingAge();
    const opening=smoothstep(age,.19,.65)*(1-smoothstep(age,cooking ? 1.86 : 1.63,cooking ? 2.39 : 2.35));
    const heat=opening*(.5+.47*(1-smoothstep(age,.64,1.63)));
    steamer.showLid(opening*1.29,heat,time);

    const settled=bought && wrapAge()>=0 && wrapAge()<.83;
    const move=cooking ? smoothstep(age,1.06,1.94) : Number(settled);
    const lift=cooking ? smoothstep(age,.93,1.22)*(1-smoothstep(age,1.76,2.04)) : 0;
    const withdraw=cooking ? smoothstep(age,2.07,2.44) : 1;
    const toolUse=cooking ? smoothstep(age,.62,1.04)*(1-withdraw) : 0;
    servingCake.position.set(lerp(cakeStart.x,wrapX,move),lerp(cakeStart.y,counterY+.034,move)+.123*lift,
      lerp(cakeStart.z,wrapZ,move)-.018*lift);
    servingCake.rotation.set(.08*lift,lerp(cakeYaw,-.12,move),-.086*lift);
    servingCake.visible=!bought || cooking || settled;

    const toolTurn=.49-.21*move;
    const pinch=smoothstep(age,.77,1.04)*(1-smoothstep(age,1.98,2.14));
    const spread=cooking ? lerp(.27,.107,pinch) : .17;
    // Blend the actual jaws from the tool rest to the side of the selected cake.
    const restX=-.122, restY=counterY+.022, restZ=.002, restAngle=.37;
    steamer.positionTongs(restX,restY,restZ,lerp(restAngle,toolTurn,toolUse),spread);
    steamer.toolTip(workGrip);
    stall.worldToLocal(workGrip);
    steamer.alignTip(lerp(workGrip.x,servingCake.position.x,toolUse),
      lerp(workGrip.y,servingCake.position.y+.008,toolUse),
      lerp(workGrip.z,servingCake.position.z,toolUse));
    return {lidArm:smoothstep(age,.09,.26)*(1-smoothstep(age,2.30,2.60)),toolArm:toolUse};
  }

  function sellerFrame(dt,player) {
    const age=wrapAge();
    const wrapping=bought && !claimed && age<3.05;
    const progress=wrapping ? smoothstep(age,.14,.72)*(1-smoothstep(age,2.56,3.05)) : 0;
    arrangePacket(age);
    const service=useSteamer();
    seller.walkBody(0,false,false,dt);
    const near=player && Math.hypot(player.x-shopX,player.z-shopZ)<1.95;
    const look=near ? clamp(Math.atan2(shopX-player.x,shopZ+sellerZ-player.z),-.64,.64) : .12*Math.sin(time*.64);
    const stoveEffort=Math.max(service.lidArm,service.toolArm);
    seller.torsoPivot.rotation.x=-progress*(.25+.15*smoothstep(age,2.06,2.84))-.27*stoveEffort;
    seller.torsoPivot.position.x=-.131*stoveEffort;
    seller.torsoPivot.position.z=-.027*progress-.055*stoveEffort;
    seller.head.rotation.y=damp(seller.head.rotation.y,lerp(look,-.12,progress)+.45*stoveEffort,7,dt);
    seller.head.rotation.x=.012*Math.sin(time*1.77)-.26*progress-.23*stoveEffort;
    seller.lookEyes(lerp(clamp(look*1.4,-1,1),-.72,stoveEffort),-.94*Math.max(stoveEffort,progress),dt);
    blink(seller,time+.81);
    if(service.lidArm>0) seller.reachHand(0,steamer.lidGrip(grip),service.lidArm);
    if(service.toolArm>0) seller.reachHand(1,steamer.toolGrip(grip),service.toolArm);
    if(progress>0) for(let i=0;i<2;i++) {
      const side=i===0 ? -1 : 1;
      packet.localToWorld(grip.set(side*.100,.054,.003+side*.020*Math.sin(age*11)));
      seller.reachHand(i,grip,progress*.94);
    }
    seller.poseSleeves();
  }

  function resetActors() {
    for(const actor of marketActors) {
      const [x,z,wait]=actor.spec.stops[0];
      Object.assign(actor,{x,z,yaw:0,wait,next:1,speed:0,completed:0,yields:0,
        detours:0,bypass:[],distance:0,look:0,behavior:"waiting",blocked:null,blockedFor:0,retryAt:0,lastThreat:false});
      actor.gait.reset();
      placeActor(actor,.016,null,0,0);
    }
  }
  resetActors();

  const visitorPoint={x:shopX,z:shopZ-.65};
  return {
    speech(dialogue,dt) {
      seller.face.speak(dialogue.id==="cake" ? dialogue.shape : null,dt);
      shopper.worker.face.speak(dialogue.id==="shopper" ? dialogue.shape : null,dt);
    },
    frame(dt,player=null) {
      if(!dt) return;
      time+=dt;
      for(const actor of marketActors) {
        if(actor===shopper && player && handoff.tick(dt,time,player)) continue;
        moveActor(actor,dt,player);
      }
      handoff.carry();
      sellerFrame(dt,player);
      // The surrounding street is static and opts out of matrix updates.
      // Push this moving subtree through before the main and reflection passes.
      market.updateMatrixWorld(true);
    },
    visitorPoint,
    atCounter(player) {
      return player.z<shopZ-.28 && Math.hypot(player.x-visitorPoint.x,player.z-visitorPoint.z)<1.29;
    },
    ready:()=>bought && !claimed && wrapAge()>2.94,
    serving,previewBusy,
    preview() {
      if(previewBusy()) return false;
      peekAt=time;
      return true;
    },
    buy() { bought=true;claimed=false;began=time;peekAt=-Infinity; },
    claim() { claimed=true;arrangePacket(Infinity);market.updateMatrixWorld(true); },
    restore(on,owned,reset=false,given=false) {
      bought=on;claimed=on && owned;began=peekAt=-Infinity;
      if(reset) { time=0;resetActors(); }
      handoff.restore(claimed && given);
      handoff.carry();
      sellerFrame(.016,null);
      market.updateMatrixWorld(true);
    },
    nearShopper:handoff.nearby,
    shopperPosition:shopper.worker.figure.position,
    beginShare(player) { return handoff.begin(player,time); },
    shareFacing:handoff.face,
    sharing:handoff.active,
    stopShare:handoff.cancel,
    liftedParcel:handoff.lifted,
    shareEvent:handoff.event,
    poseShare(giver,belt,dt) {
      handoff.animate(giver,belt,dt);
      market.updateMatrixWorld(true);
    },
    setGroundContact(handler,support) { groundContact=handler;footSupport=support; },
    receipt(parent) { return parcel(parent,paper,rope); },
    inspect() {
      return {time,visitorPoint,bought,claimed,stage:!bought ? "for sale" : claimed ? "claimed" :
        wrapAge()>2.94 ? "ready" : wrapAge()<0 ? "serving" : "wrapping",stock:cakes.filter(item=>item.visible).length,
        wrapAge:Number.isFinite(began) ? wrapAge() : null,steamer:steamer.inspect(),
        preview:peekBusy(),handoff:handoff.inspect(),
        people:marketActors.map(actor=>({role:actor.spec.role,x:actor.x,z:actor.z,y:actor.worker.figure.position.y,
          yaw:actor.yaw,next:actor.next,behavior:actor.behavior,blocked:actor.blocked,distance:actor.distance,speed:actor.speed,
          completed:actor.completed,yields:actor.yields,detours:actor.detours,bypass:actor.bypass.length,
          look:actor.look,gait:actor.gait.inspect(),
          overlap:city.blocking(actor.x,actor.z,floor(actor.x,actor.z),actor.body.radius,workerHeight,
            actor.body,actor.basket)?.name??null}))};
    },
  };
}

function wickerCarrier(parent,wood,bamboo,rope,place) {
  const chest=new THREE.Group();
  chest.position.set(0,.865,-.287);
  chest.name="Porter's hand-held wicker basket";
  parent.add(chest);
  const profile=[[0,.016],[.159,0],[.19,.032],[.225,.145],[.234,.184],
    [.224,.19],[.208,.167],[.197,.108],[.168,.041],[.145,.021],[0,.018]];
  const basket=place(chest,new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),28),bamboo,0,0,0);
  basket.scale.z=.69;
  for(let i=0;i<9;i++) {
    const y=.031+i*.018, r=.189+.044*(i/8);
    const stripe=place(chest,new THREE.TorusGeometry(r,.0039,4,28).rotateX(Math.PI/2),i%3 ? wood : rope,0,y,0);
    stripe.scale.z=.701;
  }
  const folded=place(chest,detailedBox(.345,.027,.193,bamboo,.011,.78),bamboo,0,.182,-.004);
  folded.rotation.y=.092;
  for(const side of [-1,1]) {
    const spline=new THREE.CatmullRomCurve3([
      new THREE.Vector3(side*.169,.168,-.056),new THREE.Vector3(side*.157,.204,-.039),
      new THREE.Vector3(side*.158,.214,.012),new THREE.Vector3(side*.167,.170,.058),
    ]);
    place(chest,new THREE.TubeGeometry(spline,14,.010,7),rope,0,0,0);
  }
  return chest;
}
