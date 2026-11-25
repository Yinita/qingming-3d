import * as THREE from "three";
import { bridgeDeckHeight, bridgeRailOffset, buildBridgeLook, createPlayLighting, createSurfaceLibrary, detailedBox } from "./bridge-look.js";
import { buildForeground, willowSites } from "./bridge-foreground.js";
import { counterCeramics, riverWorker } from "./bridge-people.js";
import { buildTea } from "./bridge-tea.js";
import { canalDepth, canalHalfLength, canalOrigin, waterHeight } from "./bridge-canal-bed.js";
import { buildPebbleToss } from "./bridge-pebbles.js";
import { createGroundedGait } from "./bridge-gait.js";
import { circleTouchesBox, sweepHorizontal, workerHeight, workerRadius } from "./bridge-collision.js";
import { tileRoof } from "./bridge-architecture.js";
import { TEA_QUEST, createQuestJournal, maxCoins, record, stageOf } from "./bridge-quests.js";

const SAVE = "qingming-bridge-mission-v1";
export const bridgeAnchor = { x: -59.014, z: -41.422 };
const center=bridgeAnchor;
const pickup = { x: -71.0, z: center.z, yaw: -Math.PI / 2 };
const counter = { x: -43.15, z: center.z - 1.35 };
const routeZ = center.z;
const deliveryReach=2.35;
const laneHalf=.63;
const cargoWidth=.385, cargoDepth=.351, cargoHeight=.616;
const harnessBack=.596, harnessHeight=.79;
const riverOrigin=canalOrigin(center);
const trees=willowSites(center);
const trail = [[-70, routeZ], [-48.2, routeZ], [-44, routeZ], [counter.x, counter.z + .82]];

function deck(x) {
  return bridgeDeckHeight(center,x);
}

function onBridge(x,z) {
  return Math.abs(x-center.x)<10.62 && Math.abs(z-routeZ)<=bridgeRailOffset-.06;
}

function depthAt(x,z) {
  if (Math.abs(z-riverOrigin.y)>=canalHalfLength) return 0;
  const depth=canalDepth(riverOrigin,x,z);
  return depth<=waterHeight+.002 ? 0 : depth;
}

function walkable(x,z) {
  if (x<-76 || x>-37 || Math.abs(z-routeZ)>8.4) return false;
  if (onBridge(x,z)) return Math.abs(z-routeZ)<=laneHalf;
  if (Math.abs(x-center.x)<10.62 && Math.abs(z-routeZ)<bridgeRailOffset+.21) return false;
  const hitsTrunk=trees.some(tree=>Math.hypot(x-tree.x,z-tree.z)<.27+.41*tree.scale);
  return !hitsTrunk && depthAt(x,z)<.56;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const spawn={x:-73.18,z:routeZ,yaw:-Math.PI/2,pitch:0};
function newMission() {
  return { phase:"waiting", crate:{...pickup}, coins:TEA_QUEST.economy.startCoins, method:null, started:false, log:[] };
}
function loadSave() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE));
    const crate = saved?.crate;
    if (crate && [crate.x, crate.z, crate.yaw].every(Number.isFinite) &&
        Number.isInteger(saved.coins) && saved.coins >= 0 && saved.coins <= maxCoins() &&
        ["waiting", "delivered"].includes(saved.phase) &&
        (saved.phase === "delivered" || walkable(crate.x, crate.z))) {
      return {...saved,started:saved.started===true || saved.phase==="delivered" || distance(crate,pickup)>=.04};
    }
  } catch (err) {
    // The mission can run without storage.
  }
  return newMission();
}

export function createBridgeMission({ scene, camera, renderer, ambient, sun, ground, apron, street, setMode, clearInput }) {
  const canvas = renderer.domElement;
  const root = new THREE.Group();
  root.name = "Bridge delivery";
  root.visible = false;
  scene.add(root);
  const city=street.collisions;
  const livestock=street.livestock;
  const workshop=street.housing.workshop;
  const localColliders=[];
  const plain = color => new THREE.MeshStandardMaterial({ color, roughness: .81 });
  const material = createSurfaceLibrary();
  const bridgeLook = buildBridgeLook(root, center, material, ground, apron);
  const stones = buildPebbleToss(root,depthAt,bridgeLook.hit,bridgeLook.field.height);
  const light = createPlayLighting(scene, renderer, center, ambient, sun);
  const wood = material("tea-wood", 0xf1dbc1, .88);
  const agedWood = material("tea-wood", 0xd9c6ac, .88);
  const timber = material("rail-wood", 0xe2d3bd, .70);
  const iron = new THREE.MeshStandardMaterial({ color: 0x5c5547, metalness: .36, roughness: .61 });
  const rivet = plain(0x887558);
  const wall = material("lime-plaster", 0xf5e7cf, .55);
  const tile = material("gray-roof-tile", 0xe3ded1, .72);
  const stone = material("stone-paving", 0xe9dfc9, .72);
  const ink = plain(0x43372e);
  const signPaint = plain(0x8b4538);

  function mesh(shape, mat, parent, x, y, z) {
    const part = new THREE.Mesh(shape, mat);
    part.position.set(x, y, z);
    if (mat.isMeshStandardMaterial) part.castShadow = part.receiveShadow = true;
    parent.add(part);
    return part;
  }

  function box(parent, mat, w, h, d, x, y, z) {
    return mesh(detailedBox(w, h, d, mat, .014, Math.sin(x * 2.57 + y * 7.83 + z) * 3),
                mat, parent, x, y, z);
  }

  const crateMesh = new THREE.Group();
  const crateCore = plain(0x4c3121);
  box(crateMesh, crateCore, .686, .568, .592, 0, .289, 0);
  for (const [i, y] of [.10, .294, .49].entries()) {
    const mat = i === 1 ? agedWood : wood;
    for (const z of [-.304, .304]) box(crateMesh, mat, .713, .188, .031, 0, y, z);
    for (const x of [-.351, .351]) box(crateMesh, mat, .031, .188, .588, x, y, 0);
  }
  for (const z of [-.206, 0, .206]) box(crateMesh, wood, .713, .035, .199, 0, .589, z);
  for (const y of [.142, .457]) {
    for (const z of [-.325, .325]) {
      box(crateMesh, iron, .735, .061, .023, 0, y, z);
      for (const x of [-.286, .286]) {
        mesh(new THREE.SphereGeometry(.012, 8, 6), rivet, crateMesh, x, y, z + Math.sign(z) * .012);
      }
    }
    for (const x of [-.371, .371]) box(crateMesh, iron, .023, .061, .65, x, y, 0);
  }
  box(crateMesh, signPaint, .14, .139, .009, .11, .32, .314);
  crateMesh.name = "茶叶货箱";
  root.add(crateMesh);

  const stall = new THREE.Group();
  stall.name="Tea stall";
  stall.position.set(counter.x, .01, counter.z - 1.04);
  root.add(stall);
  const stonePlatform=box(stall,stone,4.55,.1,2.6,0,.03,.34);
  function stallSolid(name,mat,w,h,d,x,y,z) {
    const part=box(stall,mat,w,h,d,x,y,z);
    localColliders.push(city.meshBox(name,part));
  }
  stallSolid("stall back wall",wall,4.2,2.34,.13,0,1.17,-.73);
  stallSolid("counter",timber,3.05,.76,.68,0,.4,1.04);
  stallSolid("countertop",wood,3.26,.10,.78,0,.83,1.04);
  for (const x of [-1.98, 1.98]) {
    stallSolid("stall column",timber,.19,2.7,.19,x,1.35,1.48);
    stallSolid("stall column",timber,.19,2.7,.19,x,1.35,-.78);
    stallSolid("stall side wall",wall,.12,1.72,1.35,x,.86,-.08);
    for (const z of [-.78, 1.48]) box(stall, stone, .26, .16, .25, x, .08, z);
  }
  for (const z of [1.55, -.85]) box(stall, timber, 4.48, .18, .16, 0, 2.65, z);
  for (const side of [-1, 1]) {
    for(let i=0;i<23;i++)
      box(stall,timber,.068,.094,.46,-2.32+i*.211,2.693,.33+side*1.25);
  }
  tileRoof(stall,tile,4.87,1.49,2.72,.33,.323);
  box(stall, ink, 4.9, .13, .17, 0, 3.255, .33);
  counterCeramics(stall);
  const tea = buildTea(stall);
  const counterFill = new THREE.PointLight(0xffdeb0, 2.3, 4.5, 2);
  counterFill.position.set(.54, 2.25, 1.39);
  stall.add(counterFill);
  const paintedSign = document.createElement("canvas");
  paintedSign.width = 320;
  paintedSign.height = 116;
  const pen = paintedSign.getContext("2d");
  pen.fillStyle = "#e9d8ae";
  pen.fillRect(0, 0, 320, 116);
  pen.strokeStyle = "#825237";
  pen.lineWidth = 4;
  pen.strokeRect(7, 7, 306, 102);
  pen.font = "54px 'Noto Serif CJK SC', 'Songti SC', serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillStyle = "#443729";
  pen.fillText("桥畔茶铺", 160, 58);
  const signMap = new THREE.CanvasTexture(paintedSign);
  signMap.colorSpace = THREE.SRGBColorSpace;
  mesh(new THREE.PlaneGeometry(1.8, .65), new THREE.MeshBasicMaterial({ map: signMap, side: THREE.DoubleSide }),
       stall, 0, 2.25, 1.59);
  const foreground = buildForeground(root, center, material);
  bridgeLook.leafSource(foreground.shedLeaf);
  const stallFloor=new THREE.Box3().setFromObject(stonePlatform);
  function floor(x,z) {
    if (onBridge(x,z)) return deck(x);
    if(x>=stallFloor.min.x && x<=stallFloor.max.x && z>=stallFloor.min.z && z<=stallFloor.max.z) {
      return stallFloor.max.y;
    }
    const depth=depthAt(x,z);
    const ground=Math.max(workshop.support(x,z),foreground.floor(x,z),depth===0 ? street.streetHeight(x,z) : 0);
    return ground>0 || depth===0 ? ground : waterHeight-depth;
  }
  function wadeDepth(x,z) {
    return onBridge(x,z) ? 0 : Math.max(0,waterHeight-floor(x,z));
  }
  const railSections=[-10.606,-2.62,3.62,10.606];
  for(const side of [-1,1]) {
    const z=routeZ+side*bridgeRailOffset;
    for(let i=0;i<railSections.length-1;i++){
      const a=center.x+railSections[i], b=center.x+railSections[i+1];
      localColliders.push(city.box("bridge rail",a,b,z-.073,z+.073,
        Math.min(deck(a),deck(b))+.10,Math.max(deck(a),deck(b))+1.12));
    }
  }
  for(const tree of trees) {
    localColliders.push(city.cylinder("willow",tree.x,tree.z,0,4.3*tree.scale,.42*tree.scale));
  }
  const mooring=bridgeLook.mooring;
  localColliders.push(city.cylinder("mooring post",mooring.x,mooring.z,0,.62,.104));
  const shipSolid=city.box("skiff hull",0,0,0,0,-.14,.46);
  const looseCargo=city.orientedBox("crate",cargoWidth,cargoDepth,cargoHeight);
  const courierSolid=city.cylinder("courier",0,0,0,0,workerRadius);
  const merchantSolid=city.cylinder("merchant",0,0,0,0,workerRadius);
  const courierCargo=city.orientedBox("courier cargo",cargoWidth,cargoDepth,cargoHeight);
  localColliders.push(looseCargo,courierSolid,merchantSolid,courierCargo,shipSolid);
  const playerBody = riverWorker(root, material, "player");
  playerBody.figure.name="Player body";
  const armMeshes=new Set();
  for(const arm of playerBody.limbs.arms) arm.traverse(part=>armMeshes.add(part));
  const bodyMeshes=[];
  playerBody.figure.traverse(part=>{if(part.isMesh && !armMeshes.has(part)) bodyMeshes.push([part,part.visible]);});
  let handsOnly=false;
  function showGreetingArms(show) {
    if(show===handsOnly) return;
    handsOnly=show;
    for(const [part,wasVisible] of bodyMeshes) part.visible=!show && wasVisible;
  }
  playerBody.figure.traverse(part => part.layers.enable(1));
  const merchant = riverWorker(root, material, "merchant");
  merchant.figure.name="Tea merchant";
  merchant.figure.position.set(counter.x + 1.16, .09, counter.z - .78);
  merchant.figure.rotation.y = Math.PI;
  const helper = riverWorker(root, material, "helper");
  helper.figure.name="Bridge courier";
  helper.figure.position.set(pickup.x - .5, floor(pickup.x - .5, routeZ + 1.03), routeZ + 1.03);

  const labels = document.createElement("section");
  labels.id = "missionHud";
  labels.setAttribute("aria-label","桥畔茶铺任务");
  labels.hidden = true;
  labels.innerHTML = `
    <header class="mission-title">
      <div>
        <div id="missionStage" class="mission-kicker"></div>
        <h1>桥畔茶铺</h1>
      </div>
      <div id="missionTools" role="group" aria-label="任务选项">
        <button id="missionJournal" type="button" title="任务簿 J">任务簿</button>
        <button id="missionRestart" type="button" title="Shift + R" aria-keyshortcuts="Shift+R"
          aria-haspopup="dialog" aria-controls="missionRestartDialog">重置任务</button>
      </div>
    </header>
    <progress id="missionProgress" max="2" value="0" aria-label="桥畔茶铺任务进度"></progress>
    <ol id="missionSteps" aria-label="送茶路线">
      <li>桥头取箱</li>
      <li>茶铺交货</li>
    </ol>
    <p id="missionObjective" aria-live="polite"></p>
    <p class="mission-metrics" id="missionEconomy"></p>
    <div class="mission-actions">
      <button id="missionInteract">拿取</button>
      <button id="missionHire">委托伙计</button>
      <button id="missionCamera">切换第一人称</button>
      <button id="missionTea" hidden>看掌柜斟茶</button>
      <button id="missionReplay" type="button" hidden aria-haspopup="dialog"
        aria-controls="missionRestartDialog">再玩一次</button>
      <button id="missionPebble" hidden title="朝向河面投掷小石子">投石 F</button>
      <button id="missionMooring" hidden>拉缆绳 R</button>
      <button id="missionAnimal" hidden type="button" aria-keyshortcuts="P">伸手 P</button>
      <button id="missionWorkshop" hidden type="button" aria-keyshortcuts="E">拉开木格门 E</button>
    </div>
    <div class="mission-actions">
      <button id="missionScroll">查看任务画卷</button>
      <button id="missionUndo">撤销上一步</button>
      <button id="missionExit">回到全卷</button>
    </div>
    <p id="missionSpeech" aria-live="polite"></p>
    <p class="mission-controls">WASD 移动 · 拖动转向 · E 拿取 / 放下 · V 视角 · J 任务簿 · Tab 画卷</p>
    <dialog id="missionRestartDialog" aria-labelledby="missionRestartTitle" aria-describedby="missionRestartDetail">
      <h2 id="missionRestartTitle">重置桥畔茶铺任务？</h2>
      <p id="missionRestartDetail"></p>
      <div class="mission-actions">
        <button id="missionRestartCancel" type="button" autofocus>取消</button>
        <button id="missionRestartConfirm" type="button">确认重开</button>
      </div>
    </dialog>`;
  document.body.appendChild(labels);
  const byId = id => labels.querySelector("#" + id);
  let hudHeight=0, introBottom=0;
  const panels=new ResizeObserver(entries=>{
    for(const {target} of entries) {
      if(target===labels) hudHeight=target.offsetHeight;
      else introBottom=target.offsetTop+target.offsetHeight;
    }
  });
  panels.observe(labels);
  const status = byId("missionObjective");
  const stage = byId("missionStage");
  const restartDialog=byId("missionRestartDialog");
  const restartCancel=byId("missionRestartCancel");
  const restartConfirm=byId("missionRestartConfirm");
  const restartDetail=byId("missionRestartDetail");
  const progress=byId("missionProgress");
  const steps=byId("missionSteps").children;
  const tools=byId("missionTools");
  const journalButton=tools.querySelector("#missionJournal");
  document.body.appendChild(tools);
  document.body.appendChild(restartDialog);
  const journal=createQuestJournal();
  const introShade=document.createElement("div");
  introShade.id="missionIntroShade";
  introShade.hidden=true;
  introShade.setAttribute("aria-hidden","true");
  document.body.appendChild(introShade);
  const intro=document.createElement("section");
  intro.id="missionIntro";
  intro.hidden=true;
  intro.setAttribute("aria-labelledby","missionIntroTitle");
  intro.innerHTML=`
    <p id="missionIntroStatus"></p>
    <h2 id="missionIntroTitle"></h2>
    <p id="missionIntroDetail"></p>
    <div id="missionIntroRoute"><span>1　桥头取箱</span><span aria-hidden="true">→</span><span>2　过桥交货</span></div>
    <div class="entry-actions">
      <button id="missionBegin" type="button">开始送茶</button>
      <button id="missionIntroReset" type="button" aria-haspopup="dialog"
        aria-controls="missionRestartDialog">重置任务</button>
      <button id="missionIntroExit" type="button">返回画卷</button>
    </div>`;
  document.body.appendChild(intro);
  panels.observe(intro);
  const introStatus=intro.querySelector("#missionIntroStatus");
  const introRoute=intro.querySelector("#missionIntroRoute");
  const introTitle=intro.querySelector("#missionIntroTitle");
  const introDetail=intro.querySelector("#missionIntroDetail");
  const begin=intro.querySelector("#missionBegin");
  const introReset=intro.querySelector("#missionIntroReset");
  introReset.onclick=()=>requestRestart(introReset);
  const notice=document.createElement("div");
  notice.id="missionNotice";
  notice.setAttribute("role","status");
  document.body.appendChild(notice);
  const waypoint=document.createElement("div");
  waypoint.id="missionWaypoint";
  waypoint.hidden=true;
  waypoint.setAttribute("aria-hidden","true");
  document.body.appendChild(waypoint);
  const economy = byId("missionEconomy");
  const hint = byId("missionSpeech");
  const interactButton = byId("missionInteract");
  const hireButton = byId("missionHire");
  const switchButton = byId("missionScroll");
  const teaButton = byId("missionTea");
  const pebbleButton = byId("missionPebble");
  const mooringButton=byId("missionMooring");
  const animalButton=byId("missionAnimal");
  const workshopButton=byId("missionWorkshop");

  let state = loadSave();
  let previous = null;
  let courierLeg = 0;
  let elapsed = 0;
  let deliveryTime = -10;
  let view = "outside";
  let showStart=true;
  const awaitingStart=()=>view==="mission" && showStart && state.phase!=="delivered";
  let introduced=null;
  let restartTrigger;
  let noticeTimer, hasRestarted=false;
  let firstPerson = false;
  let teaShotStart = -Infinity;
  let lastPrepare = 0;
  let pullTime=-Infinity;
  let wading = false;
  let wetLine = 0;
  let dampness = 0;
  const teaEye = stall.position.clone().add(new THREE.Vector3(.49, 1.57, 2.29));
  const teaFocus = stall.position.clone().add(new THREE.Vector3(.61, 1.167, 1.16));
  const teaGrip = new THREE.Vector3();
  const teaRotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(teaEye, teaFocus, camera.up));
  const player={...spawn};
  const workshopVisitor={radius:workerRadius,enabled:true};
  const boardCargo={radius:0,halfX:cargoWidth,halfZ:cargoDepth};
  const gateObstacles=[workshopVisitor,boardCargo,looseCargo,courierSolid,merchantSolid,courierCargo];
  let bodyYaw=player.yaw, heading=player.yaw;
  function syncActors() {
    const hull=bridgeLook.hull;
    const beam=.52*Math.abs(hull.w)+1.21*Math.abs(hull.z);
    const length=1.21*Math.abs(hull.w)+.52*Math.abs(hull.z);
    Object.assign(shipSolid,{minX:hull.x-beam,maxX:hull.x+beam,minZ:hull.y-length,maxZ:hull.y+length});
    for(const [body,solid] of [[helper,courierSolid],[merchant,merchantSolid]]) {
      const p=body.figure.position;
      Object.assign(solid,{x:p.x,z:p.z,bottom:p.y,top:p.y+workerHeight});
    }
    courierCargo.enabled=view==="mission" && state.phase==="courier";
    if(courierCargo.enabled) {
      const {x,y,z}=helper.figure.position, yaw=helper.figure.rotation.y;
      Object.assign(courierCargo,{...cargoPose(x,z,y+harnessHeight,yaw),bottom:y+harnessHeight,top:y+harnessHeight+cargoHeight});
    }
    looseCargo.enabled=view==="mission" && state.phase==="waiting";
    if(looseCargo.enabled) {
      const b=state.crate, y=floor(b.x,b.z);
      Object.assign(looseCargo,{x:b.x,z:b.z,yaw:b.yaw,bottom:y,top:y+cargoHeight});
    }
  }

  function canStep(x,z,radius=workerRadius,ignored=null,height=workerHeight,ignoredCargo=null) {
    return (walkable(x,z) || Number.isFinite(workshop.support(x,z))) &&
      !city.blocking(x,z,floor(x,z),radius,height,ignored,ignoredCargo);
  }
  const gait=createGroundedGait(floor,(x,z)=>canStep(x,z,.17,null,.23),(x,y,z,time,vx,vz)=>{
    const depth=bridgeLook.field.height(x,z,time)-y;
    if(onBridge(x,z) || depth<.032 || depthAt(x,z)<.024 || Math.hypot(vx,vz)<.22) return false;
    const strength=.19+.39*THREE.MathUtils.smoothstep(depth,.032,.55);
    bridgeLook.hit(x,z,time,strength,"step",vx,vz);
    return true;
  });
  const courierGait=createGroundedGait(floor,(x,z)=>canStep(x,z,.17,courierSolid,.23,courierCargo),()=>false);
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const cameraPivot=new THREE.Vector3(), cameraGoal=new THREE.Vector3();
  let boomLength=3.2, cameraObstacle=null, cameraClose=false;
  const peekTarget=new THREE.Vector2();
  const groundMarker=new THREE.Group();
  groundMarker.name="Mission objective ground marker";
  root.add(groundMarker);
  const markerBorder=mesh(new THREE.RingGeometry(.50,.66,48),new THREE.MeshBasicMaterial({
    color:0x61402a,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,
  }),groundMarker,0,0,0);
  const markerGold=mesh(new THREE.RingGeometry(.53,.63,48),new THREE.MeshBasicMaterial({
    color:0xffd47b,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,
  }),groundMarker,0,.002,0);
  markerBorder.rotation.x=markerGold.rotation.x=-Math.PI/2;
  const beacon=new THREE.Group();
  beacon.name="Mission objective beacon";
  root.add(beacon);
  const beaconRim=mesh(new THREE.OctahedronGeometry(.20),new THREE.MeshBasicMaterial({color:0xffd47c,wireframe:true}),beacon,0,0,0);
  beaconRim.scale.y=1.43;
  const beaconInset=mesh(new THREE.OctahedronGeometry(.145),new THREE.MeshBasicMaterial({color:0xba6337}),beacon,0,0,0);
  beaconInset.scale.y=1.43;
  beacon.visible=false;
  const markerPoint=new THREE.Vector3(), projectedMarker=new THREE.Vector3();
  let markerText="";
  function markObjective() {
    const phase=state.phase;
    groundMarker.visible=view==="mission" && phase!=="delivered" && !restartDialog.open;
    beacon.visible=groundMarker.visible;
    waypoint.hidden=!groundMarker.visible;
    if(waypoint.hidden) return;
    const at=phase==="waiting" ? state.crate : counter;
    const x=at.x, z=at.z+(phase==="waiting" ? 0 : .83);
    const y=floor(x,z);
    groundMarker.position.set(x,y+.039,z);
    markerGold.material.color.setHex(state.started ? 0xefd99a : 0xffc863);
    const hover=y+(phase==="waiting" ? 1.06 : 2.1)+.085*Math.sin(elapsed*3.6);
    beacon.position.set(x,hover,z);
    const pending=!state.started && phase==="waiting";
    beacon.rotation.y=elapsed*.92;
    beacon.scale.setScalar(pending ? 1.39 : 1);
    waypoint.dataset.start=String(pending);
    markerPoint.set(x,hover+.35,z);
    camera.updateMatrixWorld();
    projectedMarker.copy(markerPoint).applyMatrix4(camera.matrixWorldInverse);
    const behind=projectedMarker.z>=0;
    const turnRight=projectedMarker.x>=0;
    const {innerWidth:width,innerHeight:height}=window;
    projectedMarker.copy(markerPoint).project(camera);
    const horizontalInset=Math.min(119,width*.35);
    const compact=width<=760 || height<=525;
    const upperInset=Math.max(compact ? 50 : 72,
      intro.hidden ? 0 : introBottom+40);
    const bottomPanel=compact ? hudHeight+24 : 54;
    const lowerInset=Math.min(bottomPanel,height-upperInset-12);
    const px=behind ? (turnRight ? width : 0) : (projectedMarker.x*.5+.5)*width;
    const py=behind ? height*.51 : (.5-projectedMarker.y*.5)*height;
    const clampedX=THREE.MathUtils.clamp(px,horizontalInset,width-horizontalInset);
    const clampedY=THREE.MathUtils.clamp(py,upperInset,height-lowerInset);
    const edge=px!==clampedX || py!==clampedY;
    waypoint.dataset.offscreen=String(edge);
    waypoint.style.left=clampedX+"px";
    waypoint.style.top=clampedY+"px";
    waypoint.style.setProperty("--waypoint-angle",
      Math.atan2(py-clampedY,px-clampedX)+"rad");
    const metres=Math.hypot(x-player.x,z-player.z);
    const target=pending ? "任务起点 · 取茶叶箱" :
      phase==="waiting" ? metres<1.9 ? "茶叶箱 · E 拿取" : "取茶叶箱" : "茶铺 · 交货处";
    const text=target+" · "+(metres<10 ? metres.toFixed(1) : Math.round(metres))+" 米";
    if(text!==markerText) {markerText=text;waypoint.textContent=text;}
    waypoint.hidden=false;
  }
  const shadow = (r, color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(54,42,27,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c),
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const obj = mesh(new THREE.PlaneGeometry(r, r), material, root, 0, 0, 0);
    obj.rotation.x = -Math.PI / 2;
    return obj;
  };
  const footShadow = shadow(1.26, "rgba(54,42,27,0.62)");
  const cargoShadow = shadow(1.18, "rgba(54,42,27,0.62)");

  function remember() {
    previous = JSON.parse(JSON.stringify(state));
  }

  function store() {
    if (state.phase === "waiting" || state.phase === "delivered") {
      try { localStorage.setItem(SAVE, JSON.stringify(state)); } catch (err) {}
    }
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    notice.textContent="";
  }

  function startMission() {
    if(showStart) {
      notice.textContent=state.started ? "已继续送茶" : "任务已开始";
      noticeTimer=setTimeout(clearNotice,6000);
    }
    showStart=false;
    hasRestarted=false;
    state.started=true;
    store();
  }

  function finish(method) {
    state.phase = "delivered";
    state.method = method;
    state.coins += TEA_QUEST.economy.deliveryReward;
    record(state,method==="self" ? "亲手交货，掌柜付货款" : "伙计交货，掌柜付货款",TEA_QUEST.economy.deliveryReward);
    state.crate = { x: counter.x - .54, z: counter.z, yaw: 0 };
    deliveryTime = elapsed;
    hint.textContent = "掌柜递来五文钱。今晚的第一壶茶，可以煮了。";
    positionCrate();
    store();
    ui();
    markObjective();
  }

  function useCargo() {
    if (view !== "mission" || awaitingStart()) return;
    if (state.phase === "waiting" && distance(player, state.crate) < 1.9) {
      if (cargoObstacle(player.x,player.z,bodyYaw,looseCargo)) {
        hint.textContent="这里太窄。挪开半步再背货箱。";
        return;
      }
      remember();
      startMission();
      state.phase = "carrying";
      record(state,"在桥头背起茶叶箱");
      hint.textContent = "茶叶已取。沿桥走到对岸的茶铺。";
    } else if (state.phase === "carrying") {
      if (distance(player, counter) < deliveryReach) {
        finish("self");
      } else {
        const x = player.x - Math.sin(player.yaw) * .74;
        const z = player.z - Math.cos(player.yaw) * .74;
        if (!walkable(x,z) || wadeDepth(x,z)>.046 ||
          city.boxBlocking(x,z,floor(x,z),cargoWidth,cargoDepth,cargoHeight,player.yaw) ||
          circleTouchesBox(player.x,player.z,workerRadius,x,z,cargoWidth,cargoDepth,player.yaw)) {
          hint.textContent = "这儿放不稳。到干地再放下货箱。";
          return;
        }
        state.crate = { x, z, yaw: player.yaw };
        state.phase = "waiting";
        record(state,"中途放下货箱");
        hint.textContent = "货箱已放下。走近可再拿起。";
        store();
      }
    } else if (state.phase === "waiting") {
      hint.textContent = "走近绑着两道深色木条的货箱，再按 E。";
    }
    positionCrate();
    ui();
    markObjective();
  }

  function hire() {
    if (view !== "mission" || awaitingStart() || state.phase !== "waiting" || state.coins < TEA_QUEST.economy.courierFee ||
        distance(player, pickup) > 3 || distance(state.crate, pickup) > .9) return;
    const start=cargoPose(pickup.x,routeZ,floor(pickup.x,routeZ)+harnessHeight,pickup.yaw);
    if(distance(player,pickup)<workerRadius*2 || courierBoxHitsPlayer(start)) {
      hint.textContent="请给伙计让一步，他要在货箱旁起身。";
      return;
    }
    remember();
    startMission();
    state.coins -= TEA_QUEST.economy.courierFee;
    record(state,"付给伙计，委托送货",-TEA_QUEST.economy.courierFee);
    state.phase = "courier";
    courierLeg = 0;
    courierGait.reset();
    helper.figure.position.set(pickup.x, floor(pickup.x, routeZ), routeZ);
    helper.figure.rotation.y=pickup.yaw;
    hint.textContent = "付给伙计三文。他会沿桥把箱子送到茶铺。";
    positionCrate();
    ui();
    markObjective();
  }

  function canAimStone() {
    return view==="mission" && state.phase!=="carrying" && !onBridge(player.x,player.z) &&
      Math.abs(player.z-routeZ)>1.52 && Math.abs(player.x-riverOrigin.x)<12.9;
  }

  function aimStone() {
    if (!canAimStone()) return false;
    const east=-Math.sin(player.yaw), south=-Math.cos(player.yaw);
    let found=false;
    for (let d=1.7; d<=6.2; d+=.26) {
      const x=player.x+east*d, z=player.z+south*d;
      if (Math.abs(z-routeZ)<1.48 || Math.abs(z-riverOrigin.y)>13.7) break;
      if (trees.some(tree=>Math.hypot(x-tree.x,z-tree.z)<.42*tree.scale)) break;
      if (depthAt(x,z)>.24) {
        peekTarget.set(x,z);
        found=true;
        if (depthAt(x,z)>.70 || d>4.8) break;
      }
    }
    return found;
  }

  function tossStone() {
    if (!aimStone()) return;
    if (stones.toss(player.x-Math.cos(player.yaw)*.22,floor(player.x,player.z)+1.03,
        player.z+Math.sin(player.yaw)*.22,peekTarget.x,peekTarget.y,elapsed)) {
      hint.textContent = "石子落水，涟漪顺流散开。";
    }
  }

  function byMooring() {
    return view==="mission" && state.phase!=="carrying" &&
      Math.hypot(player.x-bridgeLook.mooring.x,player.z-bridgeLook.mooring.z)<1.53;
  }

  function pullMooring() {
    if (byMooring() && bridgeLook.tug(elapsed)) {
      pullTime=elapsed;
      hint.textContent="缆绳收紧，小船向岸边靠了靠。";
    }
  }

  function stopTeaShot() {
    teaShotStart = -Infinity;
  }

  function toggleTeaShot() {
    if (Number.isFinite(teaShotStart)) {
      stopTeaShot();
    } else if (view === "mission" && state.phase === "delivered" && distance(player, counter) < 2.75) {
      teaShotStart = elapsed;
      tea.start(elapsed);
    }
    ui();
  }

  function sendCourierHome() {
    courierLeg=0;
    courierGait.reset();
    const x=pickup.x-.5,z=routeZ+1.03;
    helper.figure.position.set(x,floor(x,z),z);
    helper.figure.rotation.y=pickup.yaw;
  }

  function restart() {
    livestock.cancel();
    workshop.reset();
    Object.assign(player,spawn);
    bodyYaw=heading=spawn.yaw;
    state=newMission();
    clearInput();
    journal.toggle(state,false);
    previous=null;
    firstPerson=false;
    deliveryTime=-10;
    pullTime=-Infinity;
    wading=false;
    wetLine=dampness=0;
    boomLength=3.2;
    gait.reset();
    sendCourierHome();
    stopTeaShot();
    tea.reset();
    showStart=true;
    hasRestarted=true;
    store();
    positionCrate();
    if(view!=="mission") setMode("mission");
    else syncActors();
    ui();
    begin.focus({preventScroll:true});
  }

  function undo() {
    if (!previous) return;
    state = previous;
    stopTeaShot();
    tea.reset();
    previous = null;
    sendCourierHome();
    hint.textContent = "已恢复上一个可交互状态。";
    store();
    positionCrate();
    ui();
  }

  function updateBriefing() {
    const kind=state.phase==="delivered" ? "finished" : state.started ? "resume" : "new";
    const briefing=hasRestarted && kind==="new" ? "reset" : kind;
    if(briefing!==introduced) {
      const [status,title,detail,action]={
        new:["任务待开始","桥畔茶铺 · 送茶任务","到桥头的金色标记处取箱。过桥后，把茶叶交给对岸柜台的掌柜。","开始送茶"],
        reset:["任务待开始","任务已重置","已回到桥头，茶叶箱归位，铜钱恢复为六文。","开始送茶"],
        resume:["已有进度","继续送茶","跟随金色目标标记，接着完成送茶。","继续任务"],
        finished:["任务完成","茶已送到","可以重开任务，茶叶箱会回到桥头。","再玩一次"],
      }[briefing];
      introStatus.textContent=status;
      introRoute.hidden=briefing==="finished";
      intro.dataset.state=briefing;
      introTitle.textContent=title;
      introDetail.textContent=detail;
      begin.textContent=action;
      introduced=briefing;
    }
    introShade.hidden=intro.hidden=view!=="mission" || !showStart || restartDialog.open;
    introShade.dataset.pending=String(awaitingStart());
    labels.inert=awaitingStart() && !restartDialog.open;
    // The briefing already has a reset button. Restore the toolbar when play begins.
    tools.hidden=labels.hidden || !intro.hidden;
    journalButton.disabled=awaitingStart();
  }

  function livestockVisitor() {
    return view==="mission" ? {x:player.x,y:floor(player.x,player.z),z:player.z} : null;
  }

  function canGreetAnimal() {
    return view==="mission" && !awaitingStart() && !restartDialog.open && state.phase!=="carrying" && !Number.isFinite(teaShotStart);
  }

  function showAnimalAction() {
    const animal=canGreetAnimal() ? livestock.invitation(livestockVisitor()) : null;
    animalButton.hidden=!animal;
    if(animal) {
      const label=`伸手让${animal}闻 P`;
      if(animalButton.textContent!==label) animalButton.textContent=label;
    }
  }

  function greetAnimal() {
    if(!canGreetAnimal()) return;
    const animal=livestock.greet(livestockVisitor());
    if(!animal) return;
    clearInput();
    hint.textContent=`${animal}低下头来闻你的手。`;
    animalButton.hidden=true;
    canvas.focus({preventScroll:true});
  }

  function canUseWorkshop() {
    return view==="mission" && !showStart && !restartDialog.open && state.phase!=="carrying" &&
      !Number.isFinite(teaShotStart);
  }

  function showWorkshopAction() {
    const label=canUseWorkshop() ? workshop.action(player) : null;
    workshopButton.hidden=!label;
    if(label && workshopButton.textContent!==label) workshopButton.textContent=label;
  }

  function useWorkshop() {
    if(!canUseWorkshop()) return false;
    const text=workshop.use(player);
    if(!text) return false;
    hint.textContent=text;
    canvas.focus({preventScroll:true});
    ui();
    return true;
  }

  function ui() {
    const {objective}=stageOf(state.phase);
    if(status.textContent!==objective) status.textContent=objective;
    const phaseTitle={waiting:!state.started ? "任务待开始" : "任务进行中 · 桥头取箱",carrying:"任务进行中 · 送往茶铺",courier:"任务进行中 · 伙计送货",delivered:"任务完成"}[state.phase];
    if(stage.textContent!==phaseTitle) stage.textContent=phaseTitle;
    const step=state.phase==="delivered" ? 2 : state.phase==="waiting" ? 0 : 1;
    if(progress.value!==step) progress.value=step;
    for(let i=0;i<steps.length;i++) {
      steps[i].dataset.complete=String(i<step);
      if(i===step) steps[i].setAttribute("aria-current","step");
      else steps[i].removeAttribute("aria-current");
    }
    updateBriefing();
    economy.textContent = `铜钱 ${state.coins} 文　·　茶铺库存 ${state.phase === "delivered" ? "1 箱" : "0 箱"}`;
    interactButton.textContent = state.phase === "carrying"
      ? (distance(player, counter) < deliveryReach ? "交给掌柜 E" : "放下茶箱 E") : "拿取茶箱 E";
    interactButton.disabled = view !== "mission" || awaitingStart() || ["delivered", "courier"].includes(state.phase) ||
      (state.phase === "waiting" && distance(player, state.crate) >= 1.9);
    hireButton.disabled = view !== "mission" || awaitingStart() || state.phase !== "waiting" ||
      state.coins < TEA_QUEST.economy.courierFee || distance(player, pickup) > 3 || distance(state.crate, pickup) > .9;
    const teaShot = Number.isFinite(teaShotStart);
    teaButton.hidden = state.phase !== "delivered";
    byId("missionReplay").hidden = state.phase !== "delivered";
    teaButton.disabled = view !== "mission" || (!teaShot && distance(player, counter) >= 2.75);
    teaButton.textContent = teaShot ? "返回街道" : "看掌柜斟茶";
    byId("missionUndo").disabled = !previous;
    byId("missionCamera").disabled = view !== "mission";
    byId("missionCamera").textContent = firstPerson ? "切换第三人称" : "切换第一人称";
    switchButton.textContent = view === "missionScroll" ? "返回桥头" : "查看任务画卷";
    pebbleButton.hidden = !canAimStone();
    pebbleButton.disabled = !aimStone();
    mooringButton.hidden=!byMooring();
    showAnimalAction();
    showWorkshopAction();
    journal.update(state);
    labels.dataset.phase = state.phase;
    labels.dataset.wading = String(wading);
    labels.dataset.view = view;

  }

  function animate(person, phase, walking, carrying, dt) {
    person.straps.visible = carrying;
    person.limbs.legs.forEach((leg, i) => { leg.rotation.x = walking ? Math.sin(phase + i * Math.PI) * .49 : 0; });
    person.walkBody(phase,walking,carrying,dt);
  }

  function cargoPose(x,z,y,yaw) {
    return {x:x+Math.sin(yaw)*harnessBack,y,z:z+Math.cos(yaw)*harnessBack,yaw};
  }

  function courierBoxHitsPlayer(p) {
    const feet=floor(player.x,player.z);
    return feet<p.y+cargoHeight && feet+workerHeight>p.y &&
      circleTouchesBox(player.x,player.z,workerRadius,p.x,p.z,cargoWidth,cargoDepth,p.yaw);
  }

  function cargoObstacle(x,z,yaw,ignored=null,footroom=.135,ignoredCargo=null) {
    const p=cargoPose(x,z,floor(x,z)+harnessHeight,yaw);
    return city.boxBlocking(p.x,p.z,p.y-footroom,cargoWidth,cargoDepth,cargoHeight+footroom+.014,p.yaw,ignored,ignoredCargo);
  }

  function cargoCollision(x,z,yaw){
    return state.phase==="carrying" ? cargoObstacle(x,z,yaw) : null;
  }

  function positionCrate() {
    if (state.phase === "carrying") {
      const y=view==="mission" ? gait.rootHeight(player.x,player.z) : floor(player.x,player.z);
      const p=cargoPose(player.x,player.z,y+harnessHeight,bodyYaw);
      crateMesh.position.set(p.x,p.y,p.z);
      crateMesh.rotation.y=p.yaw;
    } else if (state.phase === "courier") {
      const {x,y,z}=helper.figure.position;
      const p=cargoPose(x,z,y+harnessHeight,helper.figure.rotation.y);
      crateMesh.position.set(p.x,p.y,p.z);
      crateMesh.rotation.y=p.yaw;
    } else {
      crateMesh.position.set(state.crate.x, state.phase === "delivered" ? .89 : floor(state.crate.x, state.crate.z), state.crate.z);
      crateMesh.rotation.y = state.crate.yaw;
    }
    cargoShadow.visible = state.phase === "waiting";
    cargoShadow.position.set(crateMesh.position.x, floor(crateMesh.position.x, crateMesh.position.z) + .012, crateMesh.position.z);
  }

  function setView(mode) {
    view = mode;
    if(mode!=="mission") livestock.cancel();
    clearNotice();
    if (mode !== "mission") stopTeaShot();
    if (!["mission","missionScroll"].includes(mode) && restartDialog.open) restartDialog.close();
    waypoint.hidden=true;
    introShade.hidden=intro.hidden=true;
    const active = mode === "mission" || mode === "missionScroll";
    for(const collider of localColliders) collider.enabled=mode==="mission";
    syncActors();
    root.visible = active;
    foreground.setVisible(mode === "mission");
    bridgeLook.setVisible(mode === "mission");
    counterFill.visible = mode === "mission";
    light(mode === "mission");
    labels.hidden = tools.hidden = !active;
    if(!active) journal.toggle(state,false);
    document.body.classList.toggle("mission-open", active);
    groundMarker.visible = mode === "mission" && state.phase !== "delivered";
    beacon.visible=false;
    if (active) {
      positionCrate();
      ui();
    }
  }

  const noInput=new Set();
  function frame(dt, keys) {
    if (!root.visible) return;
    if(restartDialog.open) {
      waypoint.hidden=introShade.hidden=intro.hidden=true;
      beacon.visible=false;
      return;
    }

    elapsed += dt;
    tea.update(elapsed);
    let walking = false;
    stones.update(elapsed);
    if (view === "mission") {
      const input=awaitingStart() ? noInput : keys;
      const dx = Number(input.has("d") || input.has("arrowright")) -
                 Number(input.has("a") || input.has("arrowleft"));
      const dz = Number(input.has("w") || input.has("arrowup")) -
                 Number(input.has("s") || input.has("arrowdown"));
      if(dx || dz) livestock.cancel();
      fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      side.set(-fwd.z, 0, fwd.x);
      const beforeDepth=wadeDepth(player.x,player.z);
      const drag=1-.69*THREE.MathUtils.smoothstep(beforeDepth,.025,.51);
      const carrying=state.phase==="carrying";
      const backpedaling=dz<0;
      const pace=backpedaling ? (carrying ? 1.03 : 1.21) :
        input.has("shift") ? (carrying ? 2.72 : 3.51) : (carrying ? 1.40 : 1.64);
      const v = pace * dt * drag / (Math.hypot(dx, dz) || 1);
      syncActors();
      const feet=floor(player.x,player.z);
      Object.assign(workshopVisitor,{x:player.x,z:player.z,bottom:feet,top:feet+workerHeight});
      boardCargo.enabled=carrying;
      if(carrying) {
        const pose=cargoPose(player.x,player.z,feet+harnessHeight,bodyYaw);
        Object.assign(boardCargo,pose,{bottom:pose.y,top:pose.y+cargoHeight});
      }
      workshop.update(dt,elapsed,gateObstacles);
      const oldX = player.x;
      const oldZ = player.z;
      sweepHorizontal(player,(fwd.x*dz+side.x*dx)*v,(fwd.z*dz+side.z*dx)*v,
        (x,z)=>canStep(x,z) && !cargoCollision(x,z,bodyYaw));
      const moved=Math.hypot(player.x-oldX,player.z-oldZ);
      walking=moved>.0001;
      const depth=wadeDepth(player.x,player.z);
      wading=depth>.036;
      wetLine=Math.max(depth,wetLine-dt*.013);
      dampness=wading ? Math.min(1,dampness+dt*3.0) : Math.max(0,dampness-dt*.041);
      const vx=(player.x-oldX)/dt, vz=(player.z-oldZ)/dt;
      // Keep looking forward when backing away, and keep the last heading on release.
      if (walking) heading=backpedaling ? player.yaw : Math.atan2(-vx,-vz);
      else {
        const greeting=livestock.gesture(livestockVisitor());
        if(greeting) heading=greeting.yaw;
      }
      const turn=Math.atan2(Math.sin(heading-bodyYaw),Math.cos(heading-bodyYaw));
      const nextYaw=bodyYaw+turn*(1-Math.exp(-(walking ? 17 : 6)*dt));
      if(!cargoCollision(player.x,player.z,nextYaw)) bodyYaw=nextYaw;
      gait.update(dt,elapsed,player.x,player.z,bodyYaw,vx,vz,depth);
      const y = floor(player.x, player.z);
      cameraObstacle=null;
      cameraClose=false;
      if (firstPerson) {
        camera.position.set(player.x, y + 1.57, player.z);
        camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, "YXZ"));
      } else {
        const boom=3.1-.68*THREE.MathUtils.smoothstep(depth,.06,.44);
        cameraPivot.set(player.x,y+1.48,player.z);
        cameraGoal.set(player.x-fwd.x*boom+side.x*.62,y+2.18+player.pitch*-.78,
                       player.z-fwd.z*boom+side.z*.62);
        const length=cameraPivot.distanceTo(cameraGoal);
        const clearance=city.cameraDistance(cameraPivot,cameraGoal);
        cameraObstacle=clearance.obstacle;
        boomLength=Math.min(clearance.distance,THREE.MathUtils.damp(boomLength,clearance.distance,12,dt));
        cameraClose=boomLength<.75;
        camera.position.copy(cameraPivot).lerp(cameraGoal,boomLength/length);
        camera.lookAt(player.x+fwd.x*2.0,y+1.05+player.pitch*2.3,player.z+fwd.z*2.0);
      }
      if (Number.isFinite(teaShotStart)) {
        const t = elapsed - teaShotStart;
        if (dx || dz || t > tea.duration + .45) {
          stopTeaShot();
          ui();
        } else {
          const focus = THREE.MathUtils.smoothstep(t, 0, .56) *
            (1 - THREE.MathUtils.smoothstep(t, tea.duration - .1, tea.duration + .42));
          camera.position.lerp(teaEye, focus);
          camera.quaternion.slerp(teaRotation, focus);
        }
      }
      foreground.update(camera, elapsed);
    }
    if(view==="mission") {
      showAnimalAction();
      showWorkshopAction();
    }
    const animalGesture=livestock.gesture(livestockVisitor());
    showGreetingArms(firstPerson && !!animalGesture);
    playerBody.figure.visible = (view === "mission" && !firstPerson && !cameraClose) ||
      handsOnly || (view === "missionScroll" && state.phase === "carrying");
    const bodyY=view==="mission" ? gait.rootHeight(player.x,player.z) : floor(player.x,player.z);
    playerBody.figure.position.set(player.x,bodyY,player.z);
    playerBody.figure.rotation.y=bodyYaw;
    playerBody.moisture.set(playerBody.figure.position.y,wetLine,dampness);
    footShadow.visible = playerBody.figure.visible && !wading;
    footShadow.position.set(player.x, floor(player.x, player.z) + .013, player.z);
    animate(playerBody,gait.phase()-Math.PI*.5,walking,state.phase==="carrying",dt);
    if(view==="mission") playerBody.poseFeet(gait.feet,floor,player.x,bodyY,player.z,bodyYaw);
    const throwAge=stones.age();
    playerBody.limbs.arms[0].rotation.z=0;
    const pullAge=elapsed-pullTime;
    if (pullAge<.88 && byMooring()) {
      const motion=THREE.MathUtils.smoothstep(pullAge,0,.26)*
        (1-THREE.MathUtils.smoothstep(pullAge,.52,.88));
      playerBody.limbs.arms[0].rotation.x=-1.0*motion;
      playerBody.limbs.arms[1].rotation.x=-.86*motion;
      playerBody.limbs.arms[0].rotation.z=.36*motion;
    }
    if (throwAge<.48) {
      const gesture=Math.sin(Math.PI*throwAge/.48);
      playerBody.limbs.arms[0].rotation.x-=gesture*1.08;
      playerBody.limbs.arms[0].rotation.z=gesture*.32;
    }

    if(animalGesture) playerBody.reachHand(1,animalGesture.target,animalGesture.strength*.97);

    let courierVX=0,courierVZ=0;
    if (state.phase === "courier") {
      const [x, z] = trail[courierLeg];
      const p = helper.figure.position;
      const dist = Math.hypot(x - p.x, z - p.z);
      if (dist < .08) {
        courierLeg++;
        if (courierLeg === trail.length) finish("courier");
      } else {
        const step = Math.min(dist, dt * 1.86);
        const dirX = (x - p.x) / dist, dirZ = (z - p.z) / dist;
        const nx=p.x+dirX*step, nz=p.z+dirZ*step;
        const yaw=Math.atan2(-dirX,-dirZ), ny=floor(nx,nz);
        const cargo=cargoPose(nx,nz,ny+harnessHeight,yaw);
        const playerY=floor(player.x,player.z);
        const separated=ny>=playerY+workerHeight || playerY>=ny+workerHeight ||
          Math.hypot(nx-player.x,nz-player.z)>=2*workerRadius;
        if(separated && !courierBoxHitsPlayer(cargo) &&
           canStep(nx,nz,workerRadius,courierSolid,workerHeight,courierCargo) &&
           !cargoObstacle(nx,nz,yaw,courierSolid,0,courierCargo)){
          courierVX=(nx-p.x)/dt;
          courierVZ=(nz-p.z)/dt;
          p.x=nx;
          p.z=nz;
          helper.figure.rotation.y=yaw;
        }
      }
    }
    const courier=helper.figure.position, courierYaw=helper.figure.rotation.y;
    courierGait.update(dt,elapsed,courier.x,courier.z,courierYaw,courierVX,courierVZ,0);
    courier.y=courierGait.rootHeight(courier.x,courier.z);
    helper.poseFeet(courierGait.feet,floor,courier.x,courier.y,courier.z,courierYaw);
    animate(helper,courierGait.phase()-Math.PI*.5,Math.hypot(courierVX,courierVZ)>.01,state.phase==="courier",dt);
    const nod = THREE.MathUtils.clamp((elapsed - deliveryTime) / 1.18, 0, 1);
    const greeting = state.phase === "delivered" ? Math.sin(Math.PI * nod) : 0;
    merchant.head.rotation.x = .028 * Math.sin(elapsed * 1.7) - .21 * greeting;
    const pourAge = tea.age();
    const reach = THREE.MathUtils.smoothstep(pourAge, -.02, .58) *
      (1 - THREE.MathUtils.smoothstep(pourAge, 3.87, 4.60));
    merchant.figure.position.z = counter.z - .78 + .29*reach;
    merchant.figure.rotation.set(-.14*reach,
      Math.PI*(state.phase === "delivered" ? .88 + .111*reach : 1),0,"YXZ");
    merchant.head.rotation.x += .21*reach;
    merchant.head.rotation.y = .18*reach;
    merchant.limbs.arms[1].rotation.x = .64 * greeting + .26*reach;
    merchant.reachWithRightHand(tea.grip(teaGrip), reach);
    helper.head.rotation.y = state.phase === "waiting" ? .16 * Math.sin(elapsed * .91) : 0;
    for(const [i,person] of [playerBody,helper,merchant].entries()) {
      const blink=(elapsed+i*.87)%4.07;
      person.face?.blink(Math.max(0,1-Math.abs(blink-.15)/.11));
    }
    helper.face?.lookEyes(.35*Math.sin(elapsed*.67),0,dt);
    merchant.face?.lookEyes(.17,-.92*reach,dt);
    positionCrate();
    if(view==="mission") syncActors();
    if (walking) ui();
    markObjective();
  }

  function toggleCamera() {
    if (view !== "mission") return;
    stopTeaShot();
    firstPerson = !firstPerson;
    ui();
  }

  function toggleScroll() { setMode(view === "missionScroll" ? "mission" : "missionScroll"); }
  function beginMission(){
    if(state.phase==="delivered") {
      requestRestart(begin);
      return;
    }
    clearInput();
    startMission();
    hint.textContent=state.phase==="waiting" ? "任务已开始。走到金色「取茶叶箱」标记处，按 E 拿箱。" : "";
    ui();
    canvas.focus({preventScroll:true});
  }
  begin.onclick=beginMission;
  intro.querySelector("#missionIntroExit").onclick=()=>setMode("paint");
  byId("missionReplay").onclick=event=>requestRestart(event.currentTarget);
  interactButton.onclick = useCargo;
  hireButton.onclick = hire;
  byId("missionCamera").onclick = toggleCamera;
  teaButton.onclick = toggleTeaShot;
  pebbleButton.onclick=tossStone;
  mooringButton.onclick=pullMooring;
  animalButton.onclick=greetAnimal;
  workshopButton.onclick=useWorkshop;
  switchButton.onclick = toggleScroll;
  byId("missionUndo").onclick = undo;
  function requestRestart(trigger) {
    if(restartDialog.open) return;
    restartTrigger=trigger;
    restartDetail.textContent=state.phase==="delivered" ?
      "本次送茶已经完成。重置会清除交货记录，让茶箱归位，铜钱恢复为六文。" :
      "重置会清除当前进度。你会回到桥头，茶箱归位，铜钱恢复为六文。";
    clearNotice();
    clearInput();
    if(document.pointerLockElement===canvas) document.exitPointerLock();
    introShade.hidden=intro.hidden=waypoint.hidden=true;
    groundMarker.visible=beacon.visible=false;
    restartDialog.showModal();
  }
  const restartButton=tools.querySelector("#missionRestart");
  restartButton.onclick=event=>requestRestart(event.currentTarget);
  restartDialog.addEventListener("close",()=>{
    const url=new URL(location.href);
    if(url.searchParams.has("restart")) {
      url.searchParams.delete("restart");
      history.replaceState(history.state,"",url);
    }
    clearInput();
    ui();
    const target=restartTrigger?.getClientRects().length ? restartTrigger : view==="mission" && !intro.hidden ? begin : canvas;
    restartTrigger=null;
    target.focus({preventScroll:true});
  });
  restartCancel.onclick=()=>restartDialog.close();
  restartConfirm.onclick=()=>{
    restartTrigger=null;
    restartDialog.close();
    hint.textContent="已回到桥头。点击「开始送茶」重新开始。";
    restart();
  };
  byId("missionExit").onclick = () => setMode("paint");
  journalButton.onclick=()=>{if(!awaitingStart()) journal.toggle(state);};
  window.addEventListener("keydown", e => {
    if (!root.visible || restartDialog.open || e.repeat || e.defaultPrevented) return;
    if (e.code === "Escape" && !journal.panel.hidden) {
      journal.toggle(state,false);
      journalButton.focus({preventScroll:true});
      return;
    }
    if (e.code==="Enter" && document.activeElement===canvas && !intro.hidden) {
      e.preventDefault();
      beginMission();
      return;
    }
    if (e.code === "KeyR" && e.shiftKey) {
      e.preventDefault();
      requestRestart(intro.hidden ? restartButton : introReset);
      return;
    }
    if(awaitingStart()) return;
    if (e.code === "KeyE" && !useWorkshop()) useCargo();
    if (e.code === "KeyP") greetAnimal();
    if (e.code === "KeyV") toggleCamera();
    if (e.code === "KeyJ") journal.toggle(state);
    if (e.code === "KeyF") tossStone();
    if (e.code === "KeyR") pullMooring();
    if (e.code === "Tab" && document.activeElement === canvas) {
      e.preventDefault();
      toggleScroll();
    }
  });

  return {
    anchor: center,
    setView, frame, requestRestart,
    openBriefing() {
      showStart=true;
      ui();
      if(!intro.hidden) begin.focus({preventScroll:true});
    },
    get restartOpen() { return restartDialog.open; },
    livestockVisitor,
    prepare() {
      if (view !== "mission") return;
      bridgeLook.frame(elapsed,Math.min(.07,elapsed-lastPrepare));
      lastPrepare=elapsed;
      bridgeLook.prepare(renderer,scene,camera);
    },
    turn(dx, dy) {
      if (view !== "mission" || restartDialog.open || awaitingStart()) return;
      if (Number.isFinite(teaShotStart)) {
        stopTeaShot();
        ui();
      }
      player.yaw -= dx * .0044;
      if (dx) heading=player.yaw;
      player.pitch = THREE.MathUtils.clamp(player.pitch - dy * .0039, -.60, .46);
      ui();
    },
    sampleWater:bridgeLook.probe,
    inspect: () => ({ phase: state.phase, coins: state.coins, method: state.method, view, firstPerson,
      player: { ...player, y: floor(player.x, player.z) }, crate: [crateMesh.position.x, crateMesh.position.y, crateMesh.position.z],
      wading, waterDepth: wadeDepth(player.x,player.z), dampness, wetLine, stones: stones.inspect(),
      gait:gait.inspect(),
      water: bridgeLook.inspect(elapsed), wind: foreground.inspect(), tea: { ...tea.inspect(), closeUp: Number.isFinite(teaShotStart) },
      collision:{solids:city.inspect(),cameraObstacle,cameraDistance:boomLength,
        carryOverlap:cargoCollision(player.x,player.z,bodyYaw)?.name??null,
        bodyOverlap:city.blocking(player.x,player.z,floor(player.x,player.z),workerRadius,workerHeight)?.name??null},
      workshop:workshop.inspect(),
      walkable: canStep(player.x,player.z), drawn: root.visible }),
  };
}
