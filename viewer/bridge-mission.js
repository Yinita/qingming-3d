import { createMissionDialogue } from "./bridge-dialogue.js";
import { createStreetAudio } from "./bridge-audio.js";
import { createBridgeWeather } from "./bridge-weather.js";
import { buildFerryLanding, createFerry, ferryDeckHeight, ferryLandingMaterial } from "./bridge-ferry.js";
import { createMissionTouchPad } from "./bridge-touch.js";
import * as THREE from "three";
import { bridgeDeckHeight, bridgeRailOffset, buildBridgeLook, createPlayLighting, createSurfaceLibrary, detailedBox } from "./bridge-look.js";
import { buildForeground, willowSites } from "./bridge-foreground.js";
import { counterCeramics, riverWorker } from "./bridge-people.js";
import { buildTea } from "./bridge-tea.js";
import { buildTeaRoom } from "./bridge-tearoom.js";
import { buildConsignment, parcelSize } from "./bridge-consignment.js";
import { createWorkyard, workyardEntry } from "./bridge-workyard.js";
import { createJoinery } from "./bridge-joinery.js";
import { createBacklane, drainBridgeApproach } from "./bridge-backlane.js";
import { createTimberPorter } from "./bridge-timber-porter.js";
import { canalDepth, canalHalfLength, canalOrigin, canalShoreRadius, waterHeight } from "./bridge-canal-bed.js";
import { buildPebbleToss } from "./bridge-pebbles.js";
import { advanceStreetVelocity, createGroundedGait } from "./bridge-gait.js";
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
// A back-carried tea chest about 53 x 49 x 45 cm: three quarters of the earlier crate, so it
// reads as a load one person can shoulder.
const crateScale=.75;
const cargoWidth=.385*crateScale, cargoDepth=.351*crateScale, cargoHeight=.616*crateScale;
const mainCargoSize={halfX:cargoWidth,halfZ:cargoDepth,height:cargoHeight};
// The back board sits against the robe; the crate rides directly behind it.
const harnessBack=.190+cargoDepth, harnessHeight=.79;
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
  if (x<-76 || x>-37 || z<routeZ-10.19 || z>routeZ+10.08) return false;
  if (onBridge(x,z)) return Math.abs(z-routeZ)<=laneHalf;
  if (Math.abs(x-center.x)<10.62 && Math.abs(z-routeZ)<bridgeRailOffset+.21) return false;
  if(Number.isFinite(ferryDeckHeight(x,z))) return true;
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
      const freightStage=saved.phase==="delivered" && ["loaded","delivered"].includes(saved.freightStage)
        ? saved.freightStage : "ready";
      const teaServed=saved.phase==="delivered" && saved.teaServed===true;
      return {...saved,freightStage,teaServed,teaDrunk:teaServed && saved.teaDrunk===true,
        started:saved.started===true || saved.phase==="delivered" || distance(crate,pickup)>=.04};
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
  const {livestock,market,freight}=street;
  const workshop=street.housing.workshop;
  const localColliders=[];
  const plain = color => new THREE.MeshStandardMaterial({ color, roughness: .81 });
  const material = createSurfaceLibrary();
  const audio=createStreetAudio(()=>player);
  const bridgeLook = buildBridgeLook(root,center,material,ground,apron,(x,z,strength)=>{
    audio.play("water",x,z,.13+.38*strength,"oar");
  });
  const stones = buildPebbleToss(root,depthAt,(x,z,time,strength,kind,vx,vz)=>{
    bridgeLook.hit(x,z,time,strength,kind,vx,vz);
    audio.play("water",x,z,.12+.34*strength,"pebble");
  },bridgeLook.field.height);
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
  crateMesh.scale.setScalar(crateScale);
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
  const teaRoom=buildTeaRoom(stall,city,material,(x,z)=>audio.play("wood",x,z,.29,"teaRoomDoor"));
  teaRoom.show(false);
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
  const ferryLanding=buildFerryLanding(root,city,material);
  ferryLanding.show(false);
  const ferry=createFerry(ferryLanding,bridgeLook.ferry,floor);
  const passengerCarrier=()=>ferry.active() ? ferry : freight.active() ? freight : null;
  const cargoAttitude=new THREE.Quaternion(),oarGrip=new THREE.Vector3();
  const stallFloor=new THREE.Box3().setFromObject(stonePlatform);
  const onStall=(x,z)=>x>=stallFloor.min.x && x<=stallFloor.max.x && z>=stallFloor.min.z && z<=stallFloor.max.z;
  let backlane, timberPorter;
  function floor(x,z) {
    if (onBridge(x,z)) return deck(x);
    if(onStall(x,z)) return stallFloor.max.y;
    const depth=depthAt(x,z);
    const ground=Math.max(teaRoom.support(x,z),ferryDeckHeight(x,z),workshop.support(x,z),
      backlane?.support(x,z)??-Infinity,
      depth===0 ? street.streetHeight(x,z) : 0);
    return ground>0 || depth===0 ? ground : waterHeight-depth;
  }
  const weather=createBridgeWeather({root,street:street.root,ground,surface:floor,depthAt,onBridge,
    water:bridgeLook.field.height});
  const consignment=buildConsignment(root,city,material,freight);
  const yard=createWorkyard(root,city,material,floor,(x,z)=>walkable(x,z) && depthAt(x,z)===0);
  const joinery=createJoinery(root,city,material,floor,workshop.worktop,yard.timberReady,audio.scrape);
  backlane=createBacklane(root,city,material,joinery,audio.scrape,street.streetHeight.registerPavedSurface,
    ()=>timberPorter?.crossing()??false);
  const yardGrip=new THREE.Vector3(),yardFrame=new THREE.Quaternion();
  const standByYard=(x,z,solid)=>canStep(x,z,workerRadius,solid);
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
  const wrappedCake=market.receipt(playerBody.figure);
  wrappedCake.position.set(-.280,.93,.166);
  wrappedCake.rotation.set(-.19,-.31,.24);
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
  merchant.figure.position.set(counter.x+1.16,.09,counter.z-.62);
  merchant.figure.rotation.y=Math.PI;
  merchant.stand(()=>.09,merchant.figure.position.x,.09,merchant.figure.position.z,Math.PI);
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
        <button id="missionSound" type="button" aria-label="场景音效" aria-pressed="true">声音开</button>
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
    <p class="mission-metrics" id="missionFreightStatus" hidden></p>
    <p class="mission-metrics" id="missionRainStatus" hidden></p>
    <p class="mission-metrics" id="missionYardStatus" hidden></p>
    <p class="mission-metrics" id="missionJoinerStatus" hidden></p>
    <div class="mission-actions">
      <button id="missionInteract">拿取</button>
      <button id="missionHire">委托伙计</button>
      <button id="missionAskCourier" type="button" hidden>问伙计</button>
      <button id="missionCamera">切换第一人称</button>
      <button id="missionWeather" type="button" aria-keyshortcuts="T" aria-pressed="false">等一场雨 T</button>
      <button id="missionYardGuide" type="button" hidden aria-pressed="false">指路到西岸料场</button>
      <button id="missionYardAction" type="button" hidden aria-keyshortcuts="E"></button>
      <button id="missionFerryGuide" type="button" hidden aria-pressed="false">指路到渡口</button>
      <button id="missionFreightGuide" type="button" hidden aria-pressed="false">瓷器货运</button>
      <button id="missionConsignment" type="button" hidden aria-keyshortcuts="E"></button>
      <button id="missionFreight" type="button" hidden aria-keyshortcuts="E X">从后踏板上车 E</button>
      <button id="missionFerry" type="button" hidden aria-keyshortcuts="E G">叫渡船 E</button>
      <button id="missionTea" hidden>看掌柜斟茶</button>
      <button id="missionRoomGuide" hidden type="button" aria-pressed="false">指路到茶间</button>
      <button id="missionDoor" hidden type="button" aria-keyshortcuts="E">推开茶间门 E</button>
      <button id="missionSeat" hidden type="button" aria-keyshortcuts="E">坐下 E</button>
      <button id="missionRoomTea" hidden type="button" aria-keyshortcuts="E">点一盏茶 · 一文 E</button>
      <button id="missionDrinkTea" hidden type="button" aria-keyshortcuts="E">捧碗饮茶 E</button>
      <button id="missionMarketGuide" type="button" hidden aria-pressed="false">指路到蒸糕摊</button>
      <button id="missionSteamer" type="button" hidden aria-keyshortcuts="E I">看竹笼 I</button>
      <button id="missionCake" type="button" hidden aria-keyshortcuts="B">买蒸糕 B</button>
      <button id="missionShareCake" type="button" hidden aria-keyshortcuts="H">分给采买客 H</button>
      <button id="missionReplay" type="button" hidden aria-haspopup="dialog"
        aria-controls="missionRestartDialog">再玩一次</button>
      <button id="missionPebble" hidden title="朝向河面投掷小石子">投石 F</button>
      <button id="missionMooring" hidden>拉缆绳 R</button>
      <button id="missionAnimal" hidden type="button" aria-keyshortcuts="P">伸手 P</button>
      <button id="missionWorkshop" hidden type="button" aria-keyshortcuts="E">拉开木格门 E</button>
      <button id="missionJoiner" hidden type="button" aria-keyshortcuts="E">问木匠 E</button>
      <button id="missionRepair" hidden type="button" aria-keyshortcuts="E"></button>
      <button id="missionTimberPorter" hidden type="button" aria-keyshortcuts="E"></button>
    </div>
    <div class="mission-actions">
      <button id="missionScroll">查看任务画卷</button>
      <button id="missionUndo">撤销上一步</button>
      <button id="missionExit">回到全卷</button>
    </div>
    <p id="missionSpeech" aria-live="polite"></p>
    <p class="mission-controls">WASD 移动 · 拖动转向 · E 交互 · V 视角 · J 任务簿 · Tab 画卷</p>
    <dialog id="missionRestartDialog" aria-labelledby="missionRestartTitle" aria-describedby="missionRestartDetail">
      <h2 id="missionRestartTitle">重置桥畔茶铺任务？</h2>
      <p id="missionRestartDetail"></p>
      <div class="mission-actions">
        <button id="missionRestartCancel" type="button" autofocus>取消</button>
        <button id="missionRestartConfirm" type="button">确认重开</button>
      </div>
    </dialog>`;
  document.body.appendChild(labels);
  const touchPad=createMissionTouchPad();
  const byId = id => labels.querySelector("#" + id);
  let hudHeight=0, introBottom=0;
  const panels=new ResizeObserver(entries=>{
    for(const {target} of entries) {
      if(target===labels) {
        hudHeight=target.offsetHeight;
        touchPad.size(hudHeight);
      }
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
  const soundButton=tools.querySelector("#missionSound");
  const weatherButton=byId("missionWeather"),weatherStatus=byId("missionRainStatus");
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
      <button id="missionBegin" type="button" aria-keyshortcuts="E"><kbd class="mission-key" aria-hidden="true">E</kbd><span>开始送茶</span></button>
      <button id="missionContinue" type="button" aria-keyshortcuts="E" hidden><kbd class="mission-key" aria-hidden="true">E</kbd>继续逛街</button>
      <button id="missionIntroExit" type="button">返回画卷</button>
    </div>`;
  document.body.appendChild(intro);
  panels.observe(intro);
  const introStatus=intro.querySelector("#missionIntroStatus");
  const introRoute=intro.querySelector("#missionIntroRoute");
  const introTitle=intro.querySelector("#missionIntroTitle");
  const introDetail=intro.querySelector("#missionIntroDetail");
  const begin=intro.querySelector("#missionBegin");
  const beginLabel=begin.querySelector("span"), beginKey=begin.querySelector("kbd");
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
  const dialogue=createMissionDialogue(contextAction);
  const interactButton = byId("missionInteract");
  const hireButton = byId("missionHire");
  const talkButton=byId("missionAskCourier");
  const switchButton = byId("missionScroll");
  const freightButton=byId("missionFreight"), freightGuideButton=byId("missionFreightGuide");
  const consignmentButton=byId("missionConsignment"), freightStatus=byId("missionFreightStatus");
  const teaButton=byId("missionTea"), roomGuideButton=byId("missionRoomGuide");
  const doorButton=byId("missionDoor"), seatButton=byId("missionSeat"), roomTeaButton=byId("missionRoomTea");
  const drinkButton=byId("missionDrinkTea");
  const pebbleButton = byId("missionPebble");
  const mooringButton=byId("missionMooring");
  const animalButton=byId("missionAnimal");
  const workshopButton=byId("missionWorkshop");
  const repairButton=byId("missionRepair");
  const timberPorterButton=byId("missionTimberPorter");
  const joinerButton=byId("missionJoiner"),joinerStatus=byId("missionJoinerStatus");
  const yardButton=byId("missionYardAction"),yardGuideButton=byId("missionYardGuide"),yardStatus=byId("missionYardStatus");
  const marketGuideButton=byId("missionMarketGuide");
  const ferryButton=byId("missionFerry"), ferryGuideButton=byId("missionFerryGuide");
  const cakeButton=byId("missionCake"), steamerButton=byId("missionSteamer");
  const shareCakeButton=byId("missionShareCake");
  const continueButton=intro.querySelector("#missionContinue");

  let state = loadSave();
  let guideMarket=false, guideFerry=false, guideRoom=false, guideFreight=false, guideYard=false;
  let freightHeld=null, freightTransfer=null, freightGuideStep=0;
  const backstreetGuide=[
    {x:-38.42,z:routeZ,label:"沿街向东 · 瓷器货栈"},
    {x:-38.42,z:-33.83,label:"绕过摊位 · 东巷"},
    {x:-44.90,z:-33.83,label:"沿后巷往西"},
    {x:-44.90,z:-36.21,label:"瓷器货栈"},
  ];
  const freightTarget=new THREE.Vector3(), freightRotation=new THREE.Quaternion(), cargoUp=new THREE.Vector3(0,1,0);
  const freightStage=()=>state.freightStage??"ready";
  const hasCargo=()=>state.phase==="carrying" || Boolean(freightHeld);
  const hasParcel=()=>state.cakeBought===true && state.cakeClaimed===true && state.cakeGifted!==true;
  function restoreMarket(reset=false) {
    market.restore(state.cakeBought===true,state.cakeClaimed===true,reset,state.cakeGifted===true);
    wrappedCake.visible=hasParcel();
  }
  restoreMarket();
  let previous = null;
  let courierLeg = 0;
  let elapsed = 0;
  teaRoom.restore(state.teaServed===true,elapsed,{alreadyDrunk:state.teaDrunk===true});
  let ferryViewPausedAt=null, freightViewPausedAt=null;
  let deliveryTime = -10;
  let view = "outside";
  let showStart=true;
  const awaitingStart=()=>view==="mission" && showStart && state.phase!=="delivered";
  let introduced=null, guideCourt=false;
  let restartTrigger;
  let noticeTimer, hasRestarted=false;
  let firstPerson = false;
  let activeLens=58, sawFraming=0, entryCameraHeight=null;
  let teaShotStart = -Infinity;
  let lastPrepare = 0;
  let pullTime=-Infinity;
  let wading = false;
  let wetLine = 0;
  let dampness = 0;
  const teaEye=stall.position.clone().add(new THREE.Vector3(.64,1.39,2.61));
  const teaPortrait=stall.position.clone().add(new THREE.Vector3(1.09,1.48,.79));
  const teaFocus=stall.position.clone().add(new THREE.Vector3(.78,1.25,1.08));
  const teaGrip=new THREE.Vector3(), teaHandFrame=new THREE.Quaternion();
  const shotEye=new THREE.Vector3(), shotTarget=new THREE.Vector3(), shotBasis=new THREE.Matrix4();
  const teaRotation=new THREE.Quaternion();
  const player={...spawn};
  const workshopVisitor={radius:workerRadius,enabled:true};
  const boardCargo={radius:0,halfX:cargoWidth,halfZ:cargoDepth};
  const gateObstacles=[workshopVisitor,boardCargo,looseCargo,courierSolid,merchantSolid,courierCargo];
  let bodyYaw=player.yaw, heading=player.yaw;
  function syncActors() {
    const hull=bridgeLook.hull;
    const beam=.52*Math.abs(hull.w)+1.21*Math.abs(hull.z);
    const length=1.21*Math.abs(hull.w)+.52*Math.abs(hull.z);
    shipSolid.enabled=view==="mission" && !ferry.active();
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
    return (walkable(x,z) || backlane.contains(x,z) || Number.isFinite(workshop.support(x,z)) || Number.isFinite(teaRoom.support(x,z))) &&
      !city.blocking(x,z,floor(x,z),radius,height,ignored,ignoredCargo);
  }
  function footSurface(x,y,z) {
    if(onBridge(x,z)) return "wood";
    if(onStall(x,z)) return "stone";
    const roomHeight=teaRoom.support(x,z);
    if(roomHeight>=y-.009) return roomHeight>.12 ? "wood" : "stone";
    return backlane.materialAt(x,y,z)??ferryLandingMaterial(x,z,y)??workshop.materialAt(x,z,y)??street.streetHeight.materialAt(x,z);
  }
  function footfall(x,y,z,vx,vz,emitter,wet=false,loaded) {
    const speed=Math.hypot(vx,vz);
    if(speed<.20) return;
    const family=wet ? "water" : footSurface(x,y,z);
    const laden=loaded??(emitter==="player" ? hasCargo() : emitter==="courier" || emitter==="porter");
    const force=THREE.MathUtils.smoothstep(speed,.2,3.1);
    const volume=(emitter==="player" ? .22+.17*force : .20+.12*force)*(laden ? 1.18 : 1);
    audio.play(family,x,z,volume,emitter,speed,laden);
  }
  timberPorter=createTimberPorter(root,city,material,floor,canStep,backlane.shortcutOpen,
    (x,y,z,vx,vz,laden)=>footfall(x,y,z,vx,vz,"timberPorter",false,laden));
  const gait=createGroundedGait(floor,(x,z)=>canStep(x,z,.17,null,.23),(x,y,z,time,vx,vz)=>{
    const depth=bridgeLook.field.height(x,z,time)-y;
    const wet=!onBridge(x,z) && depth>=.032 && depthAt(x,z)>=.024 && Math.hypot(vx,vz)>=.22;
    if(wet) {
      const strength=.19+.39*THREE.MathUtils.smoothstep(depth,.032,.55);
      bridgeLook.hit(x,z,time,strength,"step",vx,vz);
    }
    footfall(x,y,z,vx,vz,"player",wet || (Math.hypot(vx,vz)>.24 && weather.footstep(x,y,z,time)));
    return wet;
  });
  const courierGait=createGroundedGait(floor,(x,z)=>canStep(x,z,.17,courierSolid,.23,courierCargo),(x,y,z,t,vx,vz)=>{
    footfall(x,y,z,vx,vz,"courier");
    return false;
  });
  market.setGroundContact((role,foot,vx,vz)=>footfall(foot.x,foot.y,foot.z,vx,vz,role));
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const streetVelocity=new THREE.Vector2();
  const weightShift={side:0,forward:0,plant:0,twist:0};
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
  const startPillar=mesh(new THREE.CylinderGeometry(.019,.027,1,8),
    new THREE.MeshBasicMaterial({color:0xffcd72,transparent:true,opacity:.78,depthWrite:false}),
    root,0,0,0);
  startPillar.name="Tea delivery start pillar";
  startPillar.visible=false;
  startPillar.castShadow=startPillar.receiveShadow=false;
  const markerPoint=new THREE.Vector3(), projectedMarker=new THREE.Vector3();
  let markerText="";
  function markObjective() {
    const phase=state.phase;
    const toDrain=view==="mission" && !showStart && !restartDialog.open && backlane.carrying();
    if(guideCourt && player.x<-78.70) guideCourt=false;
    const toCourt=view==="mission" && guideCourt && !restartDialog.open;
    const courtGoal=view==="mission" && !showStart ? backlane.courtGuide(player) : null;
    if(guideYard && yard.near(player)) guideYard=false;
    const toYard=view==="mission" && !showStart && !restartDialog.open && guideYard && !hasCargo();
    const atMarket=view==="mission" && !showStart && !restartDialog.open && phase==="delivered" &&
      guideMarket && state.cakeClaimed!==true && !market.atCounter(player);
    const shopper=view==="mission" && !showStart && !restartDialog.open && hasParcel() &&
      !market.sharing() && distance(player,market.shopperPosition)<9;
    const toFreight=view==="mission" && !showStart && !restartDialog.open && phase==="delivered" &&
      guideFreight && freightStage()!=="delivered";
    const atRoom=view==="mission" && !showStart && !restartDialog.open && phase==="delivered" &&
      guideRoom && !teaRoom.atDoor(player) && !teaRoom.contains(player.x,player.z);
    if(passengerCarrier() || teaRoom.chairActive()) {
      groundMarker.visible=beacon.visible=startPillar.visible=false;
      waypoint.hidden=true;
      return;
    }
    const toDock=phase==="carrying" && guideFerry;
    const stop=ferry.stands[0];
    const atDock=toDock && ferry.nearby(player)>=0;
    groundMarker.visible=view==="mission" && !restartDialog.open && !yard.active() && !atDock &&
      !backlane.locked() && (toDrain || toCourt || courtGoal || phase!=="delivered" || atMarket || atRoom || toFreight || toYard);
    beacon.visible=groundMarker.visible;
    const pending=phase==="waiting" && !state.started;
    startPillar.visible=beacon.visible && pending;
    waypoint.hidden=!groundMarker.visible && !shopper;
    if(waypoint.hidden) return;
    if(toFreight && freightGuideStep<backstreetGuide.length &&
        distance(player,backstreetGuide[freightGuideStep])<.74) freightGuideStep++;
    const freightAim=toFreight ? freightGoal() : null;
    const aroundFence=toDrain && player.x>-75.39 && player.z<-42.1;
    const at=toDrain ? (aroundFence ? {x:-74.42,z:drainBridgeApproach.z} : drainBridgeApproach) :
      toCourt ? {x:-79.2,z:drainBridgeApproach.z} : courtGoal ??
      (toYard ? workyardEntry : freightAim?.point??(atRoom ? teaRoom.entrance : atMarket ? market.visitorPoint : shopper ? market.shopperPosition : toDock ? stop :
      phase==="waiting" ? state.crate : counter));
    const x=at.x, z=at.z+(toDrain || toCourt || courtGoal || toYard || phase==="waiting" || atMarket || shopper || toDock || toFreight ? 0 : .83);
    const y=floor(x,z);
    groundMarker.position.set(x,y+.039,z);
    markerGold.material.color.setHex(atMarket ? 0xcbd49b : state.started ? 0xefd99a : 0xffc863);
    const hover=y+(phase==="waiting" || courtGoal ? 1.06 : atMarket || shopper ? 1.50 : 2.1)+.085*Math.sin(elapsed*3.6);
    beacon.position.set(x,hover,z);
    if(startPillar.visible) {
      const bottom=y+.26, top=hover-.23;
      startPillar.position.set(x,(bottom+top)*.5,z);
      startPillar.scale.y=top-bottom;
    }
    beacon.rotation.y=elapsed*.92;
    beacon.scale.setScalar(pending ? 1.39 : atMarket ? .72 : 1);
    waypoint.dataset.start=String(pending);
    waypoint.classList.toggle("market-waypoint",atMarket || shopper);
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
    const target=toDrain ? (aroundFence ? "绕至栅栏南端" : "排水沟小桥") : toCourt ? "木料后院" : courtGoal ? courtGoal.label :
      toYard ? "西岸料场" : freightAim?.label??(atRoom ? "河边茶间" : atMarket ? "蒸糕摊" : shopper ? "采买客" : toDock ? "西岸渡口" : pending ? "任务起点 · 取茶叶箱" :
      phase==="waiting" ? "取茶叶箱" : "茶铺 · 交货处");
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
    consignment.visible(view==="mission");
    state.method = method;
    state.coins += TEA_QUEST.economy.deliveryReward;
    record(state,method==="self" ? "亲手交货，掌柜付货款" : "伙计交货，掌柜付货款",TEA_QUEST.economy.deliveryReward);
    state.crate = { x: counter.x - .54, z: counter.z, yaw: 0 };
    deliveryTime = elapsed;
    dialogue.speak("delivery");
    hint.textContent = "掌柜付了五文。可去对街的蒸糕摊逛逛。";
    positionCrate();
    store();
    ui();
    markObjective();
  }

  function useCargo() {
    if (view !== "mission" || awaitingStart() || passengerCarrier() || backlane.busy()) return;
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
    if (view !== "mission" || awaitingStart() || ferry.active() || state.phase !== "waiting" || state.coins < TEA_QUEST.economy.courierFee ||
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
    return view==="mission" && !teaRoom.contains(player.x,player.z) && !passengerCarrier() && state.phase!=="carrying" && !onBridge(player.x,player.z) &&
      !backlane.busy() && Math.abs(player.z-routeZ)>1.52 && Math.abs(player.x-riverOrigin.x)<12.9;
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
    return view==="mission" && state.phase!=="carrying" && !backlane.busy() &&
      Math.hypot(player.x-bridgeLook.mooring.x,player.z-bridgeLook.mooring.z)<1.53;
  }

  function pullMooring() {
    if (byMooring() && bridgeLook.tug(elapsed)) {
      pullTime=elapsed;
      hint.textContent="缆绳收紧，小船向岸边靠了靠。";
    }
  }

  function stopTeaShot() {
    teaShotStart=-Infinity;
    document.body.classList.remove("tea-closeup");
  }

  function toggleTeaShot() {
    if (Number.isFinite(teaShotStart)) {
      stopTeaShot();
    } else if (view === "mission" && state.phase === "delivered" && distance(player, counter) < 2.75) {
      teaShotStart=elapsed;
      document.body.classList.add("tea-closeup");
      clearPlayerControl();
      tea.start(elapsed);
      dialogue.speak("pour");
    }
    ui();
    canvas.focus({preventScroll:true});
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
    yard.reset();
    timberPorter.reset();
    backlane.reset();
    joinery.reset();
    Object.assign(player,spawn);
    bodyYaw=heading=spawn.yaw;
    state=newMission();
    guideMarket=guideFerry=guideRoom=guideFreight=guideYard=false;
    guideCourt=false;
    freightHeld=freightTransfer=null;
    freightGuideStep=0;
    consignment.visible(false);
    ferry.reset();
    freight.reset();
    ferryViewPausedAt=freightViewPausedAt=null;
    restoreMarket(true);
    clearPlayerControl();
    journal.toggle(state,false);
    previous=null;
    firstPerson=false;
    sawFraming=0;
    deliveryTime=-10;
    pullTime=-Infinity;
    wading=false;
    wetLine=dampness=0;
    boomLength=3.2;
    gait.reset();
    weather.reset();
    sendCourierHome();
    stopTeaShot();
    tea.reset();
    teaRoom.restore(false,elapsed,{resetDoor:true});
    dialogue.clear();
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
    if(!previous || market.sharing() || passengerCarrier() || freightTransfer || teaRoom.drinking()) return;
    yard.release();
    state = previous;
    freightHeld=freightTransfer=null;
    consignment.visible(view==="mission" && state.phase==="delivered");
    restoreMarket();
    stopTeaShot();
    tea.reset();
    teaRoom.restore(state.teaServed===true,elapsed,{alreadyDrunk:state.teaDrunk===true});
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
    const briefingKey=briefing==="finished" ? [briefing,state.cakeGifted,hasParcel(),state.cakeBought].join(":") : briefing;
    if(briefingKey!==introduced) {
      const afterDelivery=state.cakeGifted ? "你已把蒸糕分给采买客。可以继续逛街，或回桥头重开。" :
        hasParcel() ? "蒸糕还在腰间。继续逛街，可把糕分给采买客。" :
        state.cakeBought ? "你买的蒸糕还在东岸摊位。可以继续逛街去领取。" :
        "可以继续逛街，到蒸糕摊花一文买糕，也可以从桥头重开。";
      const [status,title,detail,action]={
        new:["新任务","桥畔茶铺 · 送茶任务","到桥头的金色标记处取箱，再把茶叶送到对岸柜台。","开始送茶"],
        reset:["任务待开始","任务已重置","已回到桥头，茶叶箱归位，铜钱恢复为六文。","开始送茶"],
        resume:["已有进度","继续送茶","跟随金色目标标记，接着完成送茶。","继续任务"],
        finished:["任务完成","茶已送到",afterDelivery,"再玩一次"],
      }[briefing];
      introStatus.textContent=status;
      introRoute.hidden=briefing==="finished";
      continueButton.hidden=briefing!=="finished";
      intro.dataset.state=briefing;
      introTitle.textContent=title;
      introDetail.textContent=detail;
      beginLabel.textContent=action;
      beginKey.hidden=briefing==="finished";
      if(beginKey.hidden) begin.removeAttribute("aria-keyshortcuts");
      else begin.setAttribute("aria-keyshortcuts","E");
      introduced=briefingKey;
    }
    introShade.hidden=intro.hidden=view!=="mission" || !showStart || restartDialog.open;
    introShade.dataset.pending=String(awaitingStart());
    labels.inert=awaitingStart() && !restartDialog.open;
    touchPad.visible(view==="mission" && intro.hidden && !restartDialog.open && !freight.active() && !teaRoom.chairActive() && !Number.isFinite(teaShotStart));
    touchPad.mode(ferry.active() ? "row" : yard.active() ? "haul" : "walk");
    const inStreet=view==="mission" && intro.hidden && !restartDialog.open;
    dialogue.activate(inStreet);
    audio.setActive(inStreet);
    tools.hidden=labels.hidden;
    journalButton.hidden=awaitingStart();
  }

  function livestockVisitor() {
    return view==="mission" ? {x:player.x,y:floor(player.x,player.z),z:player.z} : null;
  }

  function canGreetAnimal() {
    return view==="mission" && !awaitingStart() && !passengerCarrier() && !restartDialog.open && state.phase!=="carrying" &&
      !backlane.busy() && !market.sharing() && !Number.isFinite(teaShotStart);
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
    clearPlayerControl();
    hint.textContent=`${animal}低下头来闻你的手。`;
    animalButton.hidden=true;
    canvas.focus({preventScroll:true});
  }

  function canUseWorkshop() {
    return view==="mission" && !showStart && !passengerCarrier() && !restartDialog.open && state.phase!=="carrying" &&
      !Number.isFinite(teaShotStart);
  }

  function canUseYard() {
    return canUseWorkshop() && !hasCargo() && !backlane.busy() && !teaRoom.chairActive() && !market.sharing() && !freightTransfer;
  }
  function showYardActions() {
    const available=canUseYard(), near=available && yard.near(player);
    document.body.classList.toggle("yard-hauling",available && yard.active());
    const label=available ? yard.action(player) : null;
    yardButton.hidden=!label;
    if(label && yardButton.textContent!==label) yardButton.textContent=label;
    yardGuideButton.hidden=!available || near;
    yardGuideButton.setAttribute("aria-pressed",String(guideYard && !near));
    yardStatus.hidden=!near && !yard.active();
    if(!yardStatus.hidden) {
      const count=yard.parked();
      const text=yard.active() ? "料场 "+count+" / 2 · "+(yard.blocked() ? "有阻挡，可后拉或转向" : "前后推拉，左右转向") :
        count===2 ? "料场 2 / 2 · 货物已归位" : "料场 "+count+" / 2 · 从推杆一侧靠近货物";
      if(yardStatus.textContent!==text) yardStatus.textContent=text;
    }
  }
  function useYard() {
    if(!canUseYard()) return;
    if(yard.active()) {
      const name=yard.release();
      hint.textContent=yard.parked()===2 ? "木料和陶罐都已归位。" : name+"留在原处，随时可再推。";
    } else {
      const name=yard.grab(player,standByYard);
      if(!name) return;
      heading=player.yaw;
      guideYard=false;
      hint.textContent="W / S 推拉"+name+"，A / D 转向，E 放手。";
    }
    clearPlayerControl();
    ui();
    canvas.focus({preventScroll:true});
  }

  function showWorkshopAction() {
    const label=canUseWorkshop() ? workshop.action(player) : null;
    workshopButton.hidden=!label;
    if(label && workshopButton.textContent!==label) workshopButton.textContent=label;
    const canRepair=canUseWorkshop() && !hasCargo() && !yard.active();
    const repair=canRepair ? backlane.action(player) : null;
    repairButton.hidden=!repair;
    if(repair && repairButton.textContent!==repair) repairButton.textContent=repair;
    const porter=canRepair && backlane.open() && !backlane.busy() ? timberPorter.action(player) : null;
    timberPorterButton.hidden=!porter;
    if(porter && timberPorterButton.textContent!==porter) timberPorterButton.textContent=porter;
    const nearby=canUseWorkshop() && !yard.active() && !backlane.busy() && joinery.near(player);
    const action=nearby ? joinery.action() : null, status=nearby ? joinery.status() : null;
    joinerButton.hidden=!action;
    joinerStatus.hidden=!status;
    if(action && joinerButton.textContent!==action) joinerButton.textContent=action;
    if(status && joinerStatus.textContent!==status) joinerStatus.textContent=status;
  }

  function speakToJoiner() {
    if(!canUseWorkshop() || yard.active()) return;
    const line=joinery.use(player);
    if(!line) return;
    dialogue.speak(line);
    if(line==="joinerWaiting") hint.textContent="松手后，木料位标记变绿就算归位。";
    if(line==="joinerWork") hint.textContent="看木匠在工案上刨板。";
    if(line==="joinerDone") {
      backlane.offer();
      hint.textContent=backlane.open() ? "木板已装在排水沟的小桥上。" : "可以拿上木板，修栅栏外的小桥。";
    }
    clearPlayerControl();
    canvas.focus({preventScroll:true});
    ui();
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

  function repairDrain() {
    if(repairButton.hidden || !canUseWorkshop() || hasCargo() || yard.active()) return;
    const message=backlane.use(player);
    if(!message) return;
    clearPlayerControl();
    hint.textContent=message;
    canvas.focus({preventScroll:true});
    ui();
  }

  function talkToTimberPorter() {
    if(timberPorterButton.hidden || !canUseWorkshop() || backlane.busy()) return;
    const line=timberPorter.talk(player);
    if(!line) return;
    dialogue.speak(line);
    if(line!=="timberFinished") hint.textContent="伙计会搬料去桥头。窄道里遇到人，他会先让开。";
    clearPlayerControl();
    canvas.focus({preventScroll:true});
    ui();
  }

  function byCakeStall() {
    return view==="mission" && !showStart && !passengerCarrier() && !restartDialog.open &&
      market.atCounter(player);
  }

  function showCakeAction() {
    const atStall=byCakeStall();
    steamerButton.hidden=!atStall || state.phase==="carrying" || state.phase==="courier";
    steamerButton.disabled=market.previewBusy();
    cakeButton.hidden=!atStall || state.phase!=="delivered" || state.cakeClaimed===true;
    if(cakeButton.hidden) return;
    const ready=market.ready();
    cakeButton.disabled=state.cakeBought ? !ready : state.coins<1 || market.previewBusy();
    const label=!state.cakeBought ? "买蒸糕（一文）B" : ready ? "取走蒸糕 B" :
      market.serving() ? "摊主正在开笼取糕" : "摊主正在包糕";
    if(cakeButton.textContent!==label) cakeButton.textContent=label;
  }

  function showSteamer() {
    if(!byCakeStall() || state.phase==="carrying" || state.phase==="courier" || !market.preview()) return;
    hint.textContent="摊主揭开竹盖。蒸糕就在竹箅上。";
    ui();
    canvas.focus({preventScroll:true});
  }

  function buyOrClaimCake() {
    if(!byCakeStall() || state.phase!=="delivered" || state.cakeClaimed) return;
    if(!state.cakeBought && state.coins>=1 && !market.previewBusy()) {
      remember();
      state.coins--;
      state.cakeBought=true;
      record(state,"向摊主买了一份蒸糕",-1);
      market.buy();
      dialogue.speak("cake");
      hint.textContent="收了一文。摊主正在开笼夹糕，包好后就能拿走。";
    } else if(market.ready()) {
      remember();
      state.cakeClaimed=true;
      guideMarket=false;
      record(state,"从摊主处取走蒸糕");
      market.claim();
      wrappedCake.visible=true;
      hint.textContent="纸包已系在腰间。走近街上的采买客，可把糕分给他。";
    } else return;
    store();
    ui();
    canvas.focus({preventScroll:true});
  }

  function canShareCake() {
    return hasParcel() && view==="mission" && !showStart && !restartDialog.open && !backlane.busy() &&
      !Number.isFinite(teaShotStart) && market.nearShopper(player);
  }

  function showShareAction() {
    const sharing=market.sharing();
    shareCakeButton.hidden=!sharing && !canShareCake();
    shareCakeButton.disabled=sharing;
    byId("missionUndo").disabled=!previous || sharing || passengerCarrier() || freightTransfer || teaRoom.drinking();
    const label=sharing ? "正在递蒸糕" : "分给采买客 H";
    if(shareCakeButton.textContent!==label) shareCakeButton.textContent=label;
  }

  function shareCake() {
    if(!canShareCake() || market.sharing()) return;
    if(market.beginShare(player)) {
      clearPlayerControl();
      stopTeaShot();
      hint.textContent="采买客正走过来接糕。移动可取消递送。";
    } else {
      hint.textContent="这里隔着东西。到采买客身边的空处再递给他。";
    }
    ui();
    canvas.focus({preventScroll:true});
  }

  function cancelShare() {
    if(!market.sharing()) return;
    market.stopShare();
    wrappedCake.visible=hasParcel();
    if(hasParcel()) hint.textContent="收回了蒸糕，纸包仍在腰间。";
    ui();
  }

  function settleShare() {
    const event=market.shareEvent();
    if(event==="accepted") {
      remember();
      state.cakeGifted=true;
      record(state,"把蒸糕分给了采买客");
      hint.textContent="采买客接过了蒸糕。";
      dialogue.speak("shopper");
      store();
      ui();
    } else if(event==="blocked") {
      hint.textContent="采买客没能走到你身边，蒸糕仍在腰间。";
      ui();
    }
    wrappedCake.visible=hasParcel() && !market.liftedParcel();
  }

  function canUseRoom() {
    return view==="mission" && !showStart && !restartDialog.open && !passengerCarrier() &&
      !Number.isFinite(teaShotStart) && !market.sharing() && !teaRoom.drinking();
  }
  function canOrderTea() {
    return canUseRoom() && state.phase==="delivered" && !state.teaServed && state.coins>=TEA_QUEST.economy.teaPrice
      && teaRoom.atTable(player);
  }
  function showRoomActions() {
    const active=canUseRoom();
    const door=teaRoom.doorLabel();
    doorButton.hidden=!active || !teaRoom.atDoor(player);
    doorButton.disabled=teaRoom.pushing();
    if(doorButton.textContent!==door) doorButton.textContent=door;
    seatButton.hidden=!active || backlane.busy() || teaRoom.pushing() || state.phase!=="delivered" ||
      !(teaRoom.seated() || (!teaRoom.chairActive() && teaRoom.atChair(player)));
    const seatAction=teaRoom.seated() ? "从凳上起身 E" : "坐到桌边 E";
    if(seatButton.textContent!==seatAction) seatButton.textContent=seatAction;
    roomTeaButton.hidden=!canOrderTea();
    drinkButton.hidden=!active || !teaRoom.canDrink();
  }
  function useRoomDoor() {
    if(!canUseRoom() || !teaRoom.atDoor(player)) return;
    const freeHands=!hasCargo() && !teaRoom.chairActive() && !backlane.busy();
    const action=teaRoom.toggleDoor(player,freeHands);
    if(action==="busy") return;
    if(action==="closer") {
      hint.textContent="走到门板前，再按 E 推门。";
      canvas.focus({preventScroll:true});
      return;
    }
    if(action==="push") {
      clearStreetMotion();
      hint.textContent="推开门后，可以进茶间坐下。";
    }
    guideRoom=false;
    ui();
    canvas.focus({preventScroll:true});
  }
  function useChair() {
    if(!canUseRoom() || backlane.busy() || state.phase!=="delivered") return;
    if(teaRoom.seated()) {
      if(!teaRoom.standUp()) {
        hint.textContent="门扇挡住了桌边，待门停稳再起身。";
        return;
      }
    } else if(!teaRoom.beginChair(player,bodyYaw)) return;
    clearPlayerControl();
    livestock.cancel();
    guideRoom=false;
    ui();
    canvas.focus({preventScroll:true});
  }
  function orderTea() {
    if(!canOrderTea()) return;
    remember();
    const cost=TEA_QUEST.economy.teaPrice;
    state.coins-=cost;
    state.teaServed=true;
    record(state,"在河边茶间点了一盏茶",-cost);
    teaRoom.serve(elapsed);
    dialogue.speak("roomTea");
    hint.textContent="已付一文。茶博士正提壶斟茶。";
    guideRoom=false;
    store();
    ui();
    canvas.focus({preventScroll:true});
  }
  function drinkTea() {
    if(!canUseRoom() || !teaRoom.beginDrink()) return;
    clearPlayerControl();
    hint.textContent="捧起青瓷碗，小口饮茶。";
    ui();
    canvas.focus({preventScroll:true});
  }
  function contextAction() {
    if(view!=="mission" || awaitingStart() || restartDialog.open || !journal.panel.hidden ||
      teaRoom.pushing() || teaRoom.drinking()) return null;
    if(Number.isFinite(teaShotStart)) return teaButton;
    if(yard.active()) return yardButton;
    if(freightTransfer || backlane.locked()) return null;
    if(freight.active()) return !freightButton.hidden ? freightButton : null;
    if(teaRoom.chairActive()) {
      return [drinkButton,roomTeaButton,seatButton].find(button=>!button.hidden)??null;
    }
    const visibleCrate=!interactButton.disabled && (state.phase==="waiting" || distance(player,counter)<deliveryReach);
    let crate=visibleCrate ? interactButton : null;
    if(crate && state.phase==="waiting" && !talkButton.hidden) {
      const forwardX=-Math.sin(player.yaw), forwardZ=-Math.cos(player.yaw);
      const facing=point=>((point.x-player.x)*forwardX+(point.z-player.z)*forwardZ)/Math.max(.01,distance(player,point));
      const courierFacing=facing(helper.figure.position);
      if(courierFacing>.78 && courierFacing>facing(state.crate)+.12) crate=talkButton;
    }
    const workshopPriority=workshopButton.textContent.includes("油灯") ? distance(player,workshop.lampAt)<.63 : true;
    return [repairButton,timberPorterButton,consignmentButton,ferryButton,freightButton,crate,seatButton,roomTeaButton,doorButton,yardButton,
      workshopPriority ? workshopButton : null,joinerButton,workshopButton,
      cakeButton,shareCakeButton,teaButton,talkButton,animalButton,steamerButton,interactButton,mooringButton,pebbleButton]
      .find(control=>control && !control.hidden && !control.disabled)??null;
  }

  function askCourier() {
    if(talkButton.hidden) return;
    dialogue.speak("courier");
    canvas.focus({preventScroll:true});
  }

  function freightGoal() {
    if(guideFreight && !freightHeld && freightStage()!=="delivered" && freightGuideStep<backstreetGuide.length) {
      if(!(freightStage()==="loaded" && freightGuideStep>=2)) {
        const next=backstreetGuide[freightGuideStep];
        return {point:next,label:next.label};
      }
    }
    if(freightHeld==="unloaded") return {point:consignment.destination.approach,label:"北巷收货台"};
    if(freightHeld==="picked") return {point:freight.depot()===0 ? freight.latchPoint(freightTarget) :
      freight.stopPoint(0,freightTarget),label:"车尾 · 装瓷器"};
    if(freightStage()==="loaded") return {point:freight.depot()===1 ? freight.latchPoint(freightTarget) :
      freight.stopPoint(1,freightTarget),label:"北巷 · 卸瓷器"};
    return {point:consignment.origin.approach,label:"瓷器货栈"};
  }

  function canUseConsignment() {
    return view==="mission" && !showStart && !restartDialog.open && state.phase==="delivered" &&
      !passengerCarrier() && !teaRoom.chairActive() && !freightTransfer && !market.sharing() && !backlane.busy();
  }

  function consignmentAction() {
    if(!canUseConsignment()) return null;
    if(freightHeld==="unloaded") return distance(player,consignment.destination.foot)<.85 ? "handIn" : null;
    if(freightHeld==="picked") return freight.depot()===0 &&
      distance(player,freight.latchPoint(freightTarget))<.79 ? "load" : null;
    if(freightStage()==="loaded") return freight.depot()===1 &&
      distance(player,freight.latchPoint(freightTarget))<.79 ? "unload" : null;
    return freightStage()==="ready" && distance(player,consignment.origin.foot)<.86 ? "pick" : null;
  }

  const consignmentLabels={pick:"取瓷器箱 E",load:"把瓷器装上车 E",unload:"卸下瓷器箱 E",handIn:"交付瓷器 E"};
  function showConsignmentAction() {
    const action=consignmentAction();
    consignmentButton.hidden=!action;
    if(action && consignmentButton.textContent!==consignmentLabels[action]) consignmentButton.textContent=consignmentLabels[action];
  }

  function toggleFreightGuide() {
    guideFreight=!guideFreight;
    if(guideFreight) {
      guideRoom=guideMarket=guideYard=false;
      if(freightStage()==="ready" && distance(player,consignment.origin.foot)<2.5) freightGuideStep=4;
      else if(player.z>-34.2) freightGuideStep=2;
      else freightGuideStep=player.x>-39 ? 1 : 0;
      hint.textContent=freightStage()==="loaded" ? "到北巷卸瓷器，运到旁边的收货台。" :
        "到蒸糕摊后街取瓷器。装车后可以随车去北巷。";
    }
    ui();
    markObjective();
    canvas.focus({preventScroll:true});
  }

  function useConsignment() {
    const action=consignmentAction();
    if(!action) return;
    if((action==="pick" || action==="unload") &&
      cargoObstacle(player.x,player.z,bodyYaw,null,.135,null,parcelSize)) {
      hint.textContent="身后太窄。挪开半步再背箱。";
      return;
    }
    const {parcel}=consignment;
    freightTransfer={start:elapsed,from:parcel.position.clone(),attitude:parcel.quaternion.clone()};
    if(action==="pick") {
      freightHeld="picked";
      hint.textContent="把瓷器送到车尾，按 E 装车。";
    } else if(action==="load") {
      remember();
      freightHeld=null;
      state.freightStage="loaded";
      record(state,"将瓷器箱装上北巷货车");
      dialogue.speak("freightDriver");
      hint.textContent="瓷器已装好。从后踏板上车，或步行去北巷收货。";
      store();
    } else if(action==="unload") {
      freightHeld="unloaded";
      hint.textContent="把瓷器交到北巷收货台。";
    } else {
      remember();
      freightHeld=null;
      state.freightStage="delivered";
      state.coins+=TEA_QUEST.economy.freightReward;
      record(state,"在北巷交付瓷器",TEA_QUEST.economy.freightReward);
      hint.textContent="北巷收下了瓷器。工钱两文。";
      store();
    }
    clearPlayerControl();
    guideRoom=guideMarket=false;
    guideFreight=action!=="handIn";
    freightGuideStep=4;
    ui();
    canvas.focus({preventScroll:true});
  }

  function positionConsignment() {
    if(state.phase!=="delivered") return;
    const {parcel,origin,destination}=consignment;
    const target=freightTarget;
    if(freightHeld) {
      const carried=cargoPose(player.x,player.z,gait.rootHeight(player.x,player.z)+harnessHeight,bodyYaw,parcelSize);
      target.set(carried.x,carried.y,carried.z);
      freightRotation.setFromAxisAngle(cargoUp,bodyYaw);
    } else if(freightStage()==="loaded") {
      freight.loadingPoint(target);
      freight.cargoAttitude(freightRotation);
    } else {
      const at=freightStage()==="delivered" ? destination.foot : origin.foot;
      target.set(at.x,at.y,at.z);
      freightRotation.identity();
    }
    const progress=freightTransfer ? THREE.MathUtils.smoothstep(elapsed-freightTransfer.start,0,.58) : 1;
    if(progress<1) {
      parcel.position.copy(freightTransfer.from).lerp(target,progress);
      parcel.position.y+=.26*Math.sin(Math.PI*progress);
      parcel.quaternion.copy(freightTransfer.attitude).slerp(freightRotation,progress);
    } else {
      const finished=Boolean(freightTransfer);
      freightTransfer=null;
      parcel.position.copy(target);
      parcel.quaternion.copy(freightRotation);
      if(finished) ui();
    }
  }

  function inspectConsignment() {
    return {stage:freightStage(),held:freightHeld,transfer:Boolean(freightTransfer),goal:freightGoal(),
      origin:consignment.origin.foot,destination:consignment.destination.foot,
      position:consignment.parcel.position.toArray()};
  }

  function showFreightAction() {
    const label=view==="mission" && !awaitingStart() && !showStart && !ferry.active() &&
      !teaRoom.chairActive() && !freightTransfer && !restartDialog.open ? freight.action(player,walkable,hasCargo()) : null;
    freightButton.hidden=!label;
    freightButton.disabled=hasCargo() || backlane.busy();
    freightStatus.hidden=view!=="mission" || !freight.active();
    if(!freightStatus.hidden) {
      const status=freight.status();
      if(freightStatus.textContent!==status) freightStatus.textContent=status;
    }
    if(label) {
      const text=label.replace(/ X$/," E");
      if(freightButton.textContent!==text) freightButton.textContent=text;
    }
  }

  function useFreight() {
    if(view!=="mission" || showStart || restartDialog.open || ferry.active() || freightTransfer || teaRoom.chairActive() || backlane.busy()) return;
    const wasAboard=freight.active();
    const message=freight.use(player,walkable,hasCargo(),elapsed);
    if(!message) return;
    cancelShare();
    stopTeaShot();
    if(!wasAboard) clearPlayerControl();
    hint.textContent=message.replace("按 X","按 E");
    ui();
    canvas.focus({preventScroll:true});
  }

  function showFerryAction() {
    const label=view==="mission" && !showStart && !restartDialog.open && !freight.active() && !freightHeld && !backlane.busy() ? ferry.action(player) : null;
    ferryButton.hidden=!label;
    if(label) {
      const withKey=label.replace(/ G$/," E");
      if(ferryButton.textContent!==withKey) ferryButton.textContent=withKey;
    }
    ferryGuideButton.hidden=view!=="mission" || state.phase!=="carrying" || ferry.active() ||
      player.x>=center.x || ferry.nearby(player)>=0;
    ferryGuideButton.setAttribute("aria-pressed",String(guideFerry));
  }

  function useFerry() {
    if(view!=="mission" || showStart || restartDialog.open || freight.active() || freightHeld || market.sharing() || backlane.busy()) return;
    const message=ferry.use(player,elapsed);
    if(!message) return;
    clearPlayerControl();
    livestock.cancel();
    stopTeaShot();
    hint.textContent=message;
    ui();
    canvas.focus({preventScroll:true});
  }

  function toggleFerryGuide() {
    guideFerry=!guideFerry;
    if(guideFerry) hint.textContent="沿河岸往南走。到西岸渡口按 E 叫船。";
    ui();
    markObjective();
    canvas.focus({preventScroll:true});
  }

  function toggleRoomGuide() {
    guideRoom=!guideRoom;
    if(guideRoom) {
      guideMarket=guideFreight=guideYard=false;
      hint.textContent="茶间在柜台旁。走到「茶間」木牌下，按 E 推门。";
    }
    ui();
    markObjective();
    canvas.focus({preventScroll:true});
  }

  function toggleMarketGuide() {
    guideMarket=!guideMarket;
    if(guideMarket) guideRoom=guideFreight=guideYard=false;
    if(guideMarket) hint.textContent="沿茶铺前的街道往对侧走，跟着「蒸糕摊」标记。";
    ui();
    markObjective();
    canvas.focus({preventScroll:true});
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
    economy.textContent = `铜钱 ${state.coins} 文　·　茶铺库存 ${state.phase === "delivered" ? "1 箱" : "0 箱"}`+
      (state.cakeGifted ? "　·　蒸糕已送出" : hasParcel() ? "　·　蒸糕 1 份" : "");
    marketGuideButton.hidden=view!=="mission" || teaRoom.contains(player.x,player.z) || showStart || state.phase!=="delivered" ||
      state.cakeClaimed===true || market.atCounter(player);
    marketGuideButton.setAttribute("aria-pressed",String(guideMarket));
    interactButton.textContent = state.phase === "carrying"
      ? (distance(player, counter) < deliveryReach ? "交给掌柜" : "放下茶箱") : "拿取茶箱";
    interactButton.disabled = view !== "mission" || passengerCarrier() || awaitingStart() || backlane.busy() ||
      ["delivered", "courier"].includes(state.phase) ||
      (state.phase === "waiting" && distance(player, state.crate) >= 1.9);
    hireButton.disabled = view !== "mission" || ferry.active() || awaitingStart() || state.phase !== "waiting" ||
      state.coins < TEA_QUEST.economy.courierFee || distance(player, pickup) > 3 || distance(state.crate, pickup) > .9;
    const indoors=view==="mission" && teaRoom.contains(player.x,player.z);
    document.body.classList.toggle("tea-room-open",indoors);
    document.body.classList.toggle("tea-seated",indoors && teaRoom.chairActive());
    const teaShot=Number.isFinite(teaShotStart);
    teaButton.hidden=state.phase!=="delivered" || teaRoom.contains(player.x,player.z);
    roomGuideButton.hidden=view!=="mission" || showStart || state.phase!=="delivered" ||
      teaRoom.contains(player.x,player.z);
    roomGuideButton.setAttribute("aria-pressed",String(guideRoom));
    freightGuideButton.hidden=view!=="mission" || showStart || state.phase!=="delivered" ||
      freightStage()==="delivered" || indoors;
    freightGuideButton.setAttribute("aria-pressed",String(guideFreight));
    showRoomActions();
    byId("missionReplay").hidden = state.phase !== "delivered";
    teaButton.disabled = view !== "mission" || (!teaShot && distance(player, counter) >= 2.75);
    teaButton.textContent = teaShot ? "返回街道 E" : "请掌柜斟茶 E";
    byId("missionCamera").disabled = view !== "mission";
    byId("missionCamera").textContent = firstPerson ? "切换第三人称" : "切换第一人称";
    switchButton.textContent = view === "missionScroll" ? "返回桥头" : "查看任务画卷";
    pebbleButton.hidden = !canAimStone();
    pebbleButton.disabled = !aimStone();
    mooringButton.hidden=!byMooring();
    showAnimalAction();
    showFerryAction();
    showFreightAction();
    showConsignmentAction();
    showWorkshopAction();
    showYardActions();
    talkButton.hidden=view!=="mission" || showStart || ferry.active() || state.phase!=="waiting" ||
      distance(player,helper.figure.position)>2.45;
    showCakeAction();
    showShareAction();
    dialogue.update();
    journal.update(state);
    labels.dataset.phase = state.phase;
    labels.dataset.wading = String(wading);
    labels.dataset.view = view;

  }

  function animate(person, phase, walking, carrying, dt, shift) {
    person.straps.visible = carrying;
    person.limbs.legs.forEach((leg, i) => { leg.rotation.x = walking ? Math.sin(phase + i * Math.PI) * .49 : 0; });
    person.walkBody(phase,walking,carrying,dt,shift);
  }

  function cargoPose(x,z,y,yaw,size=mainCargoSize) {
    const behind=harnessBack-cargoDepth+size.halfZ;
    return {x:x+Math.sin(yaw)*behind,y,z:z+Math.cos(yaw)*behind,yaw};
  }

  function courierBoxHitsPlayer(p) {
    const feet=floor(player.x,player.z);
    return feet<p.y+cargoHeight && feet+workerHeight>p.y &&
      circleTouchesBox(player.x,player.z,workerRadius,p.x,p.z,cargoWidth,cargoDepth,p.yaw);
  }

  function cargoObstacle(x,z,yaw,ignored=null,footroom=.135,ignoredCargo=null,size=null) {
    const p=cargoPose(x,z,floor(x,z)+harnessHeight,yaw,size??mainCargoSize);
    return city.boxBlocking(p.x,p.z,p.y-footroom,size?.halfX??cargoWidth,size?.halfZ??cargoDepth,
      (size?.height??cargoHeight)+footroom+.014,p.yaw,ignored,ignoredCargo);
  }

  function cargoCollision(x,z,yaw){
    return hasCargo() && !passengerCarrier() ? cargoObstacle(x,z,yaw,null,.135,null,freightHeld ? parcelSize : null) : null;
  }

  function positionCrate() {
    if (state.phase === "carrying") {
      const y=view==="mission" ? gait.rootHeight(player.x,player.z) : floor(player.x,player.z);
      const aboard=ferry.active();
      const carried=cargoPose(player.x,player.z,(aboard ? ferry.rider.y : y)+harnessHeight,bodyYaw);
      const p=aboard ? ferry.cargo(carried) : carried;
      crateMesh.position.set(p.x,p.y,p.z);
      crateMesh.rotation.set(0,carried.yaw,0);
      if(aboard) crateMesh.quaternion.slerp(ferry.cargoAttitude(cargoAttitude),ferry.rider.seated);
    } else if (state.phase === "courier") {
      const {x,y,z}=helper.figure.position;
      const p=cargoPose(x,z,y+harnessHeight,helper.figure.rotation.y);
      crateMesh.position.set(p.x,p.y,p.z);
      crateMesh.rotation.set(0,p.yaw,0);
    } else {
      crateMesh.position.set(state.crate.x, state.phase === "delivered" ? .89 : floor(state.crate.x, state.crate.z), state.crate.z);
      crateMesh.rotation.set(0,state.crate.yaw,0);
    }
    positionConsignment();
    cargoShadow.visible=state.phase==="waiting";
    cargoShadow.position.set(crateMesh.position.x, floor(crateMesh.position.x, crateMesh.position.z) + .012, crateMesh.position.z);
  }

  function setView(mode) {
    view = mode;
    weather.show(mode==="mission");
    light.storm(mode==="mission" ? weather.intensity : 0);
    if(mode!=="mission") {
      yard.release();
      teaRoom.cancelPush();
      teaRoom.cancelDrink();
      entryCameraHeight=null;
      document.body.classList.remove("yard-hauling");
      if(teaRoom.leaveChair(player)) gait.reset();
      document.body.classList.remove("tea-room-open","tea-seated");
      dialogue.activate(false);
      audio.setActive(false);
      teaRoom.speech(null,1);
      market.speech(dialogue.speech(0),1);
      merchant.face.speak(null,1);
      helper.face.speak(null,1);
      activeLens=58;
      clearStreetMotion();
    }
    if(mode!=="mission") {
      touchPad.visible(false);
      livestock.cancel();
      market.stopShare();
      wrappedCake.visible=hasParcel();
    }
    clearNotice();
    if (mode !== "mission") stopTeaShot();
    if (!["mission","missionScroll"].includes(mode) && restartDialog.open) restartDialog.close();
    waypoint.hidden=true;
    introShade.hidden=intro.hidden=true;
    const active = mode === "mission" || mode === "missionScroll";
    for(const collider of localColliders) collider.enabled=mode==="mission";
    syncActors();
    root.visible = active;
    ferryLanding.show(mode==="mission");
    teaRoom.show(mode==="mission");
    consignment.visible(mode==="mission" && state.phase==="delivered");
    yard.show(mode==="mission");
    joinery.show(mode==="mission");
    backlane.show(mode==="mission");
    timberPorter.show(mode==="mission");
    foreground.setVisible(mode === "mission");
    bridgeLook.setVisible(mode==="mission",mode==="missionScroll" && ferry.active());
    if(view==="mission" && ferryViewPausedAt!==null) {
      ferry.deferTransfer(elapsed-ferryViewPausedAt);
      ferryViewPausedAt=null;
    } else if(view==="missionScroll" && ferry.active()) ferryViewPausedAt=elapsed;
    if(view==="mission" && freightViewPausedAt!==null) {
      freight.deferTransfer(elapsed-freightViewPausedAt);
      freightViewPausedAt=null;
    } else if(view!=="mission" && freight.active() && freightViewPausedAt===null) freightViewPausedAt=elapsed;
    counterFill.visible = mode === "mission";
    light(mode === "mission");
    labels.hidden = tools.hidden = !active;
    if(!active) journal.toggle(state,false);
    document.body.classList.toggle("mission-open", active);
    groundMarker.visible = mode === "mission" && state.phase !== "delivered";
    beacon.visible=startPillar.visible=false;
    if (active) {
      positionCrate();
      ui();
    }
  }

  function clearStreetMotion() {
    streetVelocity.set(0,0);
    weightShift.side=weightShift.forward=weightShift.plant=weightShift.twist=0;
  }

  function clearPlayerControl() {
    clearInput();
    clearStreetMotion();
  }

  const gaze=new THREE.Vector3();
  function settleGaze(person,yaw,pitch,dt) {
    const {damp}=THREE.MathUtils;
    person.head.rotation.y=damp(person.head.rotation.y,yaw,8,dt);
    person.head.rotation.x=damp(person.head.rotation.x,pitch,7,dt);
    person.face.lookEyes(yaw*.34,pitch*.7,dt);
  }
  function attend(person,x,y,z,dt,nod) {
    const {head}=person;
    head.parent.worldToLocal(gaze.set(x,y,z)).sub(head.position);
    const yaw=-Math.atan2(gaze.x,-gaze.z);
    const pitch=Math.atan2(gaze.y,Math.hypot(gaze.x,gaze.z));
    const {clamp,damp}=THREE.MathUtils;
    head.rotation.y=damp(head.rotation.y,clamp(yaw*.81,-.61,.61),9,dt);
    head.rotation.x=damp(head.rotation.x,clamp(pitch*.81-nod,-.37,.26),9,dt);
    person.face.lookEyes(clamp((yaw-head.rotation.y)*3,-1,1),
      clamp((pitch-head.rotation.x)*3,-1,1),dt);
  }

  const noInput=new Set();
  function updateRainStatus() {
    const label=weather.active ? "等雨停 T" : "等一场雨 T";
    if(weatherButton.textContent!==label) {
      weatherButton.textContent=label;
      weatherButton.setAttribute("aria-pressed",String(weather.active));
    }
    weatherStatus.hidden=!weather.active && weather.intensity<.04 && weather.clothing<.03;
    if(weatherStatus.hidden) return;
    const location=weather.sheltered ? "屋檐下" : "露天";
    const damp=Math.round(weather.clothing*10)*10;
    const text=location+" · 衣衫湿度 "+damp+"%";
    if(weatherStatus.textContent!==text) weatherStatus.textContent=text;
  }
  function frame(dt, keys) {
    if (!root.visible || dt<=0) return;
    if(restartDialog.open) {
      clearStreetMotion();
      waypoint.hidden=introShade.hidden=intro.hidden=true;
      beacon.visible=startPillar.visible=false;
      return;
    }

    elapsed += dt;
    tea.update(elapsed);
    let walking = false;
    stones.update(elapsed);
    if (view === "mission") {
      const courtEvent=backlane.update(dt,camera,bodyYaw,player);
      if(courtEvent) {
        if(courtEvent==="repaired") guideCourt=true;
        hint.textContent={
          repaired:"小桥已修好。过桥可进西岸木料后院。",
          sawStroke:"锯口深了一层。再按 E 继续，也可以晚些回来。",
          sawDone:"木板锯成了两段。短木料可以给后院横闸做配重。",
          sawRetry:"站到锯台正面，再拉锯。",
          timberOffcutHeld:"沿石板路把短木料送到横闸的铁箍旁。",
          timberTakeRetry:"站在锯台前的空地上，再拿短木料。",
          timberGateRetry:"站到铁箍旁的西侧石沿，再装配重。",
          timberGateRepaired:"配重装好了。横闸升起，从石过道能绕回作坊外。",
          timberGateOpen:"横闸已升起。",
          timberGateClosed:"横闸已放下。",
        }[courtEvent];
        ui();
      }
      weather.frame(dt,elapsed,player);
      light.storm(weather.intensity);
      updateRainStatus();
      const courtLocked=backlane.locked(), workStation=backlane.workStation();
      const pushingDoor=teaRoom.pushing();
      const input=awaitingStart() || courtLocked || pushingDoor || teaRoom.drinking() ? noInput : keys;
      if(pushingDoor) {
        const turn=Math.atan2(-Math.sin(player.yaw),Math.cos(player.yaw));
        player.yaw+=turn*(1-Math.exp(-9*dt));
        player.pitch=THREE.MathUtils.damp(player.pitch,-.19,8,dt);
      }
      if(teaRoom.drinking()) {
        const turn=teaRoom.chair.yaw-player.yaw;
        player.yaw+=Math.atan2(Math.sin(turn),Math.cos(turn))*(1-Math.exp(-8*dt));
        player.pitch=THREE.MathUtils.damp(player.pitch,-.16,8,dt);
      }
      if(courtLocked) heading=player.yaw=backlane.facing();
      if(backlane.sawing()) player.pitch=THREE.MathUtils.damp(player.pitch,firstPerson ? -.575 : -.13,8,dt);
      const dx = Number(input.has("d") || input.has("arrowright") || input!==noInput && touchPad.move("d")) -
                 Number(input.has("a") || input.has("arrowleft") || input!==noInput && touchPad.move("a"));
      const dz = Number(input.has("w") || input.has("arrowup") || input!==noInput && touchPad.move("w")) -
                 Number(input.has("s") || input.has("arrowdown") || input!==noInput && touchPad.move("s"));
      if(dx || dz) {
        livestock.cancel();
        cancelShare();
      }
      const shareYaw=market.shareFacing(player);
      if(shareYaw!==null) {
        const angle=Math.atan2(Math.sin(shareYaw-player.yaw),Math.cos(shareYaw-player.yaw));
        player.yaw+=angle*(1-Math.exp(-6*dt));
        player.pitch=THREE.MathUtils.damp(player.pitch,firstPerson ? -.42 : -.13,6,dt);
      }
      fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      side.set(-fwd.z, 0, fwd.x);
      const beforeDepth=passengerCarrier() ? 0 : wadeDepth(player.x,player.z);
      const drag=1-.69*THREE.MathUtils.smoothstep(beforeDepth,.025,.51);
      const carrying=hasCargo(), handsLoaded=carrying || backlane.loaded();
      const backpedaling=dz<0;
      const pace=backpedaling ? (handsLoaded ? 1.03 : 1.21) :
        input.has("shift") ? (handsLoaded ? 2.72 : 3.51) : (handsLoaded ? 1.40 : 1.64);
      const movementScale=pace*drag*weather.traction(player.x,player.z)/(Math.hypot(dx,dz)||1);
      let targetX=(fwd.x*dz+side.x*dx)*movementScale;
      let targetZ=(fwd.z*dz+side.z*dx)*movementScale;
      if(workStation) {
        const approachX=workStation.x-player.x, approachZ=workStation.z-player.z;
        const speed=Math.min(7,1.06/Math.max(.01,Math.hypot(approachX,approachZ)));
        targetX=approachX*speed;
        targetZ=approachZ*speed;
      }
      syncActors();
      const feet=floor(player.x,player.z);
      Object.assign(workshopVisitor,{x:player.x,z:player.z,bottom:feet,top:feet+workerHeight});
      boardCargo.enabled=carrying;
      if(carrying) {
        const size=freightHeld ? parcelSize : mainCargoSize;
        const pose=cargoPose(player.x,player.z,feet+harnessHeight,bodyYaw,size);
        Object.assign(boardCargo,pose,size,{bottom:pose.y,top:pose.y+size.height});
      }
      workshop.update(dt,elapsed,gateObstacles);
      const driftScale=1/(Math.hypot(dx,dz)||1);
      const visitor={x:player.x,y:feet,z:player.z,radius:workerRadius,
        moveX:(fwd.x*dz+side.x*dx)*driftScale,moveZ:(fwd.z*dz+side.z*dx)*driftScale,
        cargo:carrying ? boardCargo : null};
      market.frame(dt,visitor);
      const porterLine=timberPorter.frame(dt,{...visitor,radius:backlane.playerClearance(workerRadius)},attend);
      if(porterLine) dialogue.speak(porterLine);
      const chairBefore=teaRoom.chairActive(), sitting=teaRoom.chair.phase==="sitting";
      if(teaRoom.seated() && (dx || dz)) teaRoom.standUp();
      const transferred=teaRoom.seatFrame(dt,player);
      if(sitting) {
        player.yaw=teaRoom.chair.yaw;
        player.pitch=THREE.MathUtils.damp(player.pitch,-.13,9,dt);
        fwd.set(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
        side.set(-fwd.z,0,fwd.x);
      }
      if(transferred) {
        gait.reset();
        heading=bodyYaw=teaRoom.chair.yaw;
        clearStreetMotion();
        ui();
      }
      if(teaRoom.advanceDrink(dt)) {
        remember();
        state.teaDrunk=true;
        record(state,"在茶间喝完一盏茶",0);
        store();
        hint.textContent="茶喝完了，空碗已放回碟中。";
        ui();
      }
      const served=teaRoom.update(dt,elapsed,gateObstacles,player);
      if(served && hint.textContent==="已付一文。茶博士正提壶斟茶。") {
        hint.textContent="茶已经斟好了。坐到桌边，可以捧碗饮茶。";
      }
      const ferryLanded=ferry.update(dt,elapsed,player,dz)==="landed";
      const reserve=freightTransfer ? freight.depot() :
        freightHeld==="picked" || (guideFreight && freightStage()==="ready") ? 0 :
        !freightHeld && freightStage()==="loaded" ? 1 : null;
      const cartLanded=freight.update(dt,elapsed,player,visitor,reserve)==="landed";
      const landed=ferryLanded || cartLanded;
      const carrier=passengerCarrier();
      const aboard=Boolean(carrier);
      if(landed) {
        gait.reset();
        if(ferryLanded && state.phase==="carrying" && player.x>center.x && ferry.arrivedAcross()) {
          if(!state.ferryCrossing) record(state,"从南侧渡口运茶过河");
          state.ferryCrossing=true;
        }
        guideFerry=false;
        if(cartLanded) heading=bodyYaw=player.yaw;
        hint.textContent=cartLanded ? "已下货车。" : "已上岸。沿石板路可回到街上。";
        ui();
      }
      const oldX=player.x, oldZ=player.z;
      const previousVX=streetVelocity.x, previousVZ=streetVelocity.y;
      if(aboard || landed || freightTransfer || chairBefore || pushingDoor || awaitingStart() || courtLocked && !workStation) clearStreetMotion();
      else if(yard.active()) {
        yard.frame(dt,player,bodyYaw,dx,dz,weather.traction(player.x,player.z),standByYard,audio.scrape);
        streetVelocity.set((player.x-oldX)/dt,(player.z-oldZ)/dt);
      }
      else {
        advanceStreetVelocity(streetVelocity,targetX,targetZ,dt,handsLoaded);
        const clearance=backlane.playerClearance(workerRadius);
        sweepHorizontal(player,streetVelocity.x*dt,streetVelocity.y*dt,
          (x,z)=>canStep(x,z,clearance) && !cargoCollision(x,z,bodyYaw));
        streetVelocity.set((player.x-oldX)/dt,(player.z-oldZ)/dt);
      }
      const vx=streetVelocity.x,vz=streetVelocity.y;
      walking=Math.hypot(vx,vz)>.085;
      const depth=aboard ? 0 : wadeDepth(player.x,player.z);
      wading=depth>.036;
      wetLine=Math.max(depth,wetLine-dt*.013);
      dampness=wading ? Math.min(1,dampness+dt*3.0) : Math.max(0,dampness-dt*.041);
      // In a brake the body holds its heading while the feet finish the step.
      if(yard.active()) heading=yard.yaw();
      else if(walking && (dx || dz)) {
        if(backpedaling) heading=player.yaw;
        else if(vx*targetX+vz*targetZ>0) heading=Math.atan2(-vx,-vz);
      } else if(!walking) {
        const greeting=livestock.gesture(livestockVisitor());
        if(greeting) heading=greeting.yaw;
      }
      if(!aboard && !landed) {
        const ax=(vx-previousVX)/dt, az=(vz-previousVZ)/dt;
        const sin=Math.sin(bodyYaw),cos=Math.cos(bodyYaw);
        const {clamp,damp}=THREE.MathUtils;
        weightShift.side=damp(weightShift.side,clamp((ax*cos-az*sin)*.012,-.09,.09),12,dt);
        weightShift.forward=damp(weightShift.forward,clamp((-ax*sin-az*cos)*.010,-.095,.095),12,dt);
      }
      if(shareYaw!==null) heading=shareYaw;
      if(pushingDoor) heading=0;
      if(aboard) bodyYaw=carrier.rider.facing;
      else if(chairBefore) bodyYaw=teaRoom.chair.yaw;
      else {
        const {clamp,damp}=THREE.MathUtils;
        const turn=Math.atan2(Math.sin(heading-bodyYaw),Math.cos(heading-bodyYaw));
        const target=!carrying || !cargoCollision(player.x,player.z,bodyYaw+clamp(turn,-.14,.14)) ? heading : bodyYaw;
        const previousYaw=bodyYaw;
        const nextYaw=gait.steer(dt,bodyYaw,target,Math.hypot(vx,vz),carrying);
        if(!carrying || !cargoCollision(player.x,player.z,nextYaw)) bodyYaw=nextYaw;
        gait.update(dt,elapsed,player.x,player.z,bodyYaw,vx,vz,depth,target);
        weightShift.plant=damp(weightShift.plant,gait.pivotLean(),16,dt);
        const lead=clamp(turn*.11,-.17,.17);
        const counter=clamp((bodyYaw-previousYaw)/dt*.022,-.11,.11);
        weightShift.twist=damp(weightShift.twist,(lead-counter)*(carrying ? .44 : .88),13,dt);
      }
      const y=aboard ? carrier.rider.y : chairBefore ? teaRoom.chair.y : floor(player.x,player.z);
      const indoors=teaRoom.contains(player.x,player.z);
      const along=THREE.MathUtils.clamp(player.z-riverOrigin.y,-canalHalfLength,canalHalfLength);
      const across=player.x-riverOrigin.x;
      const shore=canalShoreRadius(along,Math.sign(across)||1);
      const audibleX=riverOrigin.x+THREE.MathUtils.clamp(across,-shore,shore)*.91;
      const audibleZ=riverOrigin.y+along;
      const riverDistance=Math.hypot(player.x-audibleX,player.z-audibleZ);
      audio.ambience(audibleX,audibleZ,(indoors ? .032 : .185)*Math.exp(-riverDistance/4.9),indoors);
      audio.weather(weather.intensity,weather.sheltered);
      cameraObstacle=null;
      cameraClose=false;
      const {clamp,damp,lerp}=THREE.MathUtils;
      entryCameraHeight=!aboard && !chairBefore && teaRoom.atDoor(player) ?
        damp(entryCameraHeight??y,y,18,dt) : null;
      const cameraY=entryCameraHeight??y;
      sawFraming=damp(sawFraming,Number(backlane.frameSaw(player)),7,dt);
      const seatFov=2*THREE.MathUtils.radToDeg(Math.atan(Math.tan(Math.PI*27/180)/camera.aspect));
      const lens=firstPerson && yard.active() ? clamp(seatFov,70,96) :
        firstPerson && aboard ? 70 : firstPerson && chairBefore ?
        clamp(seatFov,58,100) : firstPerson ? lerp(58,clamp(seatFov,71,91),sawFraming) : 58;
      if(Math.abs(activeLens-lens)>.07) {
        activeLens=lens;
        camera.fov=lens;
        camera.updateProjectionMatrix();
      }
      if (firstPerson) {
        const seat=carrier===ferry ? ferry.rider.seated : carrier===freight ? freight.rider.seat : 0;
        const doorLook=teaRoom.pushLook();
        const yaw=carrier===ferry ? ferry.viewYaw(player.yaw) : player.yaw+(doorLook?.yaw??0);
        const haul=yard.gripWeight();
        const pitch=player.pitch-.048*seat-.60*haul+(doorLook?.pitch??0)+teaRoom.drinkLook();
        const eyeOffset=.083*seat+.082*haul-.025*sawFraming-(doorLook?.forward??0)+
          (chairBefore && camera.aspect<.70 ? .093*teaRoom.chair.weight : 0);
        const lateral=carrier===freight ? .28*seat : -.064*sawFraming;
        camera.position.set(player.x+eyeOffset*Math.sin(yaw)+lateral*Math.cos(yaw),cameraY+1.57-.020*sawFraming,
          player.z+eyeOffset*Math.cos(yaw)-lateral*Math.sin(yaw));
        camera.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,"YXZ"));
      } else {
        const roomFraming=teaRoom.cameraBlend(player);
        const streetBoom=lerp(3.1-.68*THREE.MathUtils.smoothstep(depth,.06,.44),1.92,sawFraming);
        const boom=lerp(streetBoom,1.26,roomFraming);
        cameraPivot.set(player.x,cameraY+1.48,player.z);
        const offset=lerp(lerp(.62,1.30,sawFraming),.24,roomFraming);
        cameraGoal.set(player.x-fwd.x*boom+side.x*offset,cameraY+lerp(2.18,1.69,roomFraming)+player.pitch*-.78,
                       player.z-fwd.z*boom+side.z*offset);
        const seatFraming=chairBefore ? teaRoom.chair.weight : 0;
        if(seatFraming>0) {
          // Orbit from the open side of the seat, away from the close right wall.
          const delta=player.yaw-teaRoom.chair.yaw;
          const turn=clamp(Math.atan2(Math.sin(delta),Math.cos(delta)),-.37,.37);
          const x=player.x-.93*Math.cos(turn)+.21*Math.sin(turn);
          const z=player.z+.93*Math.sin(turn)+.21*Math.cos(turn);
          cameraGoal.x=lerp(cameraGoal.x,x,seatFraming);
          cameraGoal.y=lerp(cameraGoal.y,cameraY+1.66-player.pitch*.39,seatFraming);
          cameraGoal.z=lerp(cameraGoal.z,z,seatFraming);
        }
        const length=cameraPivot.distanceTo(cameraGoal);
        const clearance=city.cameraDistance(cameraPivot,cameraGoal);
        cameraObstacle=clearance.obstacle;
        boomLength=Math.min(clearance.distance,THREE.MathUtils.damp(boomLength,clearance.distance,12,dt));
        cameraClose=boomLength<(indoors ? .53 : .75);
        camera.position.copy(cameraPivot).lerp(cameraGoal,boomLength/length);
        const lookAhead=lerp(2,.83,sawFraming);
        camera.lookAt(lerp(player.x+fwd.x*lookAhead,player.x-.23,seatFraming),
          cameraY+lerp(1.05+player.pitch*2.3,1.19,seatFraming),
          lerp(player.z+fwd.z*lookAhead,player.z-.16,seatFraming));
      }
      if (Number.isFinite(teaShotStart)) {
        const t = elapsed - teaShotStart;
        if (dx || dz || t > tea.duration + .45) {
          stopTeaShot();
          ui();
        } else {
          const focus = THREE.MathUtils.smoothstep(t, 0, .56) *
            (1 - THREE.MathUtils.smoothstep(t, tea.duration - .1, tea.duration + .42));
          const tilt=THREE.MathUtils.smoothstep(t,.57,1.63);
          shotTarget.copy(teaPortrait).lerp(teaFocus,tilt);
          shotEye.copy(teaEye);
          shotEye.z+=THREE.MathUtils.clamp((.86-camera.aspect)*2.47,0,1.08);
          teaRotation.setFromRotationMatrix(shotBasis.lookAt(shotEye,shotTarget,camera.up));
          camera.position.lerp(shotEye,focus);
          camera.quaternion.slerp(teaRotation,focus);
        }
      }
      foreground.update(camera, elapsed);
    }
    if(view==="mission") {
      showAnimalAction();
      showFerryAction();
    showFreightAction();
    showConsignmentAction();
      showWorkshopAction();
      showYardActions();
      showRoomActions();
      showCakeAction();
      showShareAction();
    }
    const animalGesture=livestock.gesture(livestockVisitor());
    const carrier=view==="mission" ? passengerCarrier() : view==="missionScroll" && ferry.active() ? ferry : null;
    const riding=Boolean(carrier);
    const pushingHand=view==="mission" && firstPerson ? teaRoom.pushHand() : undefined;
    for(let i=0;i<2;i++) playerBody.limbs.arms[i].visible=pushingHand===undefined || i===pushingHand;
    showGreetingArms(view==="mission" && firstPerson && (!!animalGesture || market.sharing() || riding ||
      yard.active() || backlane.busy() || teaRoom.pushing() || teaRoom.drinking()));
    playerBody.figure.visible = (view === "mission" && !firstPerson && !cameraClose) ||
      handsOnly || (view==="missionScroll" && (riding || state.phase==="carrying"));
    const seated=view==="mission" && teaRoom.chairActive();
    const bodyY=riding ? carrier.rider.y : seated ? teaRoom.chair.y :
      view==="mission" ? gait.rootHeight(player.x,player.z) : floor(player.x,player.z);
    playerBody.figure.position.set(player.x,bodyY,player.z);
    playerBody.figure.rotation.y=bodyYaw;
    playerBody.moisture.set(playerBody.figure.position.y,wetLine,dampness);
    playerBody.rainWear.value=view==="mission" ? weather.clothing : 0;
    footShadow.visible = playerBody.figure.visible && !wading && !riding;
    footShadow.position.set(player.x, floor(player.x, player.z) + .013, player.z);
    const carrying=hasCargo() && !riding && !freightTransfer;
    animate(playerBody,gait.phase()-Math.PI*.5,walking,carrying,dt,weightShift);
    const haulWeight=view==="mission" && yard.active() ? yard.gripWeight() : 0;
    playerBody.torsoPivot.position.z=-.050*haulWeight;
    playerBody.torsoPivot.rotation.x-=.22*haulWeight;
    if(view==="mission" && !riding) {
      if(seated) {
        const weight=teaRoom.chair.weight;
        playerBody.torsoPivot.rotation.x-=.11*weight;
        for(let i=0;i<2;i++) {
          playerBody.limbs.arms[i].rotation.x=.48*weight;
          playerBody.limbs.elbows[i].rotation.x=.32*weight;
        }
      }
      playerBody.poseFeet(seated ? teaRoom.chairFeet : gait.feet,floor,player.x,bodyY,player.z,bodyYaw);
    }
    if(view==="missionScroll" && carrier===ferry) poseFerryRider();
    if(view==="mission" && carrier===freight) {
      playerBody.poseFeet(freight.feet(),freight.grounding,player.x,bodyY,player.z,bodyYaw);
      for(let hand=0;hand<2;hand++) playerBody.reachHand(hand,freight.grip(hand),.86*freight.rider.seat);
    }
    const throwAge=stones.age();
    if(!carrying) playerBody.limbs.arms[0].rotation.z=0;
    const pullAge=elapsed-pullTime;
    if (!carrying && pullAge<.88 && byMooring()) {
      const motion=THREE.MathUtils.smoothstep(pullAge,0,.26)*
        (1-THREE.MathUtils.smoothstep(pullAge,.52,.88));
      playerBody.limbs.arms[0].rotation.x=-1.0*motion;
      playerBody.limbs.arms[1].rotation.x=-.86*motion;
      playerBody.limbs.arms[0].rotation.z=.36*motion;
    }
    if (!carrying && throwAge<.48) {
      const gesture=Math.sin(Math.PI*throwAge/.48);
      playerBody.limbs.arms[0].rotation.x-=gesture*1.08;
      playerBody.limbs.arms[0].rotation.z=gesture*.32;
    }

    if(animalGesture) playerBody.reachHand(1,animalGesture.target,animalGesture.strength*.97);
    if(view==="mission") {
      if(market.sharing()) market.poseShare(playerBody,wrappedCake,dt);
      settleShare();
    }
    if(haulWeight>0) {
      for(let i=0;i<2;i++) playerBody.graspProp(i,yard.grip(i,yardGrip,yardFrame),yardFrame,haulWeight);
    }
    if(view==="mission") backlane.pose(playerBody);
    if(view==="mission") {
      teaRoom.poseDoor(playerBody);
      teaRoom.poseDrink(playerBody);
    }

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
    animate(helper,courierGait.phase()-Math.PI*.5,Math.hypot(courierVX,courierVZ)>.01,state.phase==="courier",dt);
    helper.poseFeet(courierGait.feet,floor,courier.x,courier.y,courier.z,courierYaw);
    const speech=dialogue.speech(dt);
    if(view==="mission") joinery.frame(dt,player,speech,attend);
    const nod=THREE.MathUtils.clamp((elapsed-deliveryTime)/1.18,0,1);
    const greeting=state.phase==="delivered" ? Math.sin(Math.PI*nod) : 0;
    const pourAge=tea.age();
    const lean=THREE.MathUtils.smoothstep(pourAge,-.52,-.12)*
      (1-THREE.MathUtils.smoothstep(pourAge,4.28,4.58));
    const grasp=THREE.MathUtils.smoothstep(pourAge,-.44,-.025)*
      (1-THREE.MathUtils.smoothstep(pourAge,4.27,4.58));
    merchant.torsoPivot.position.z=-.221*lean;
    merchant.torsoPivot.rotation.x=-.31*lean;
    merchant.torsoPivot.rotation.y=.14*greeting*(1-lean);
    merchant.limbs.arms[1].rotation.x=.31*greeting+.14*lean;
    merchant.holdKettle(tea.grip(teaGrip,teaHandFrame),teaHandFrame,grasp);
    const merchantSpeaking=speech.id==="delivery" || speech.id==="pour";
    const sightY=floor(player.x,player.z)+1.52;
    const lookAtKettle=lean>.26;
    const merchantNear=Math.hypot(player.x-merchant.figure.position.x,player.z-merchant.figure.position.z)<2.95;
    if(lookAtKettle) {
      attend(merchant,teaGrip.x-.27,teaGrip.y+.15,teaGrip.z+.12,dt,.014*speech.emphasis);
    } else if(merchantNear || merchantSpeaking) {
      attend(merchant,player.x,sightY,player.z,dt,.077*greeting+.033*speech.emphasis);
    } else settleGaze(merchant,.087*Math.sin(elapsed*.69),-.027,dt);
    if(speech.id==="courier") attend(helper,player.x,sightY,player.z,dt,.023*speech.emphasis);
    else settleGaze(helper,state.phase==="waiting" ? .16*Math.sin(elapsed*.91) : 0,.025,dt);
    for(const [i,person] of [playerBody,helper,merchant].entries()) {
      const blink=(elapsed+i*.87)%4.07;
      person.face?.blink(Math.max(0,1-Math.abs(blink-.15)/.11));
      person.poseSleeves();
    }
    merchant.face.speak(merchantSpeaking ? speech.shape : null,dt);
    helper.face.speak(speech.id==="courier" ? speech.shape : null,dt);
    market.speech(speech,dt);
    timberPorter.speech(speech,dt);
    freight.speech(speech.id==="freightDriver" ? speech.shape : null,dt);
    teaRoom.speech(speech.id==="roomTea" ? speech.shape : null,dt);
    positionCrate();
    if(view==="mission") syncActors();
    if (walking) ui();
    dialogue.update();
    markObjective();
  }

  function toggleCamera() {
    if (view !== "mission") return;
    stopTeaShot();
    firstPerson = !firstPerson;
    ui();
  }

  function renderPassenger() {
    const previous=playerBody.figure.position;
    const {x,y,z}=previous;
    ferry.sync(elapsed,player);
    camera.position.x+=player.x-x;
    camera.position.z+=player.z-z;
    camera.position.y+=ferry.rider.y-y;
    previous.set(player.x,ferry.rider.y,player.z);
    poseFerryRider();
    positionCrate();
  }

  function poseFerryRider() {
    playerBody.poseFeet(ferry.feet(player),ferry.grounding,player.x,ferry.rider.y,player.z,bodyYaw);
    const effort=ferry.rowing();
    if(effort>.003) for(let hand=0;hand<2;hand++) {
      playerBody.reachHand(hand,ferry.grip(hand,oarGrip),effort);
    }
    playerBody.poseSleeves();
  }

  function toggleScroll() { setMode(view === "missionScroll" ? "mission" : "missionScroll"); }
  function beginMission(){
    if(state.phase==="delivered") {
      requestRestart(restartButton);
      return;
    }
    audio.unlock();
    clearPlayerControl();
    startMission();
    hint.textContent=state.phase==="waiting" ? "任务已开始。走到金色「取茶叶箱」标记处，按 E 拿箱。" : "";
    ui();
    markObjective();
    canvas.focus({preventScroll:true});
  }
  begin.onclick=beginMission;
  continueButton.onclick=()=>{
    audio.unlock();
    showStart=false;
    ui();
    canvas.focus({preventScroll:true});
  };
  marketGuideButton.onclick=toggleMarketGuide;
  ferryButton.onclick=useFerry;
  freightButton.onclick=useFreight;
  freightGuideButton.onclick=toggleFreightGuide;
  consignmentButton.onclick=useConsignment;
  ferryGuideButton.onclick=toggleFerryGuide;
  cakeButton.onclick=buyOrClaimCake;
  steamerButton.onclick=showSteamer;
  shareCakeButton.onclick=shareCake;
  intro.querySelector("#missionIntroExit").onclick=()=>setMode("paint");
  byId("missionReplay").onclick=event=>requestRestart(event.currentTarget);
  interactButton.onclick = useCargo;
  hireButton.onclick = hire;
  talkButton.onclick=askCourier;
  byId("missionCamera").onclick = toggleCamera;
  teaButton.onclick=toggleTeaShot;
  roomGuideButton.onclick=toggleRoomGuide;
  doorButton.onclick=useRoomDoor;
  seatButton.onclick=useChair;
  roomTeaButton.onclick=orderTea;
  drinkButton.onclick=drinkTea;
  pebbleButton.onclick=tossStone;
  mooringButton.onclick=pullMooring;
  animalButton.onclick=greetAnimal;
  workshopButton.onclick=useWorkshop;
  joinerButton.onclick=speakToJoiner;
  repairButton.onclick=repairDrain;
  timberPorterButton.onclick=talkToTimberPorter;
  yardButton.onclick=useYard;
  yardGuideButton.onclick=()=>{
    guideYard=!guideYard;
    if(guideYard) {
      guideMarket=guideRoom=guideFreight=false;
      hint.textContent="西岸料场在作坊门前。把木料和陶罐推到对应的货位。";
    }
    ui();
    markObjective();
    canvas.focus({preventScroll:true});
  };
  switchButton.onclick = toggleScroll;
  byId("missionUndo").onclick = undo;
  function requestRestart(trigger) {
    if(restartDialog.open) return;
    yard.release();
    document.body.classList.remove("yard-hauling");
    restartTrigger=trigger;
    restartDetail.textContent=(state.phase==="delivered" ?
      "本次送茶已经完成。重置会清除交货记录，让茶箱归位，铜钱恢复为六文。" :
      "重置会清除当前进度。你会回到桥头，茶箱归位，铜钱恢复为六文。")+"西岸料场、作坊、排水沟小桥、锯台、横闸和搬料也会恢复初始状态。";
    clearNotice();
    clearPlayerControl();
    if(document.pointerLockElement===canvas) document.exitPointerLock();
    introShade.hidden=intro.hidden=waypoint.hidden=true;
    groundMarker.visible=beacon.visible=startPillar.visible=false;
    touchPad.visible(false);
    dialogue.activate(false);
    audio.setActive(false);
    restartDialog.showModal();
  }
  function soundLabel() {
    soundButton.setAttribute("aria-pressed",String(audio.enabled));
    soundButton.textContent=audio.enabled ? "声音开" : "声音关";
  }
  soundButton.hidden=!audio.supported;
  soundButton.onclick=event=>{
    audio.toggle();
    soundLabel();
    if(event.detail) canvas.focus({preventScroll:true});
  };
  soundLabel();
  weatherButton.onclick=()=>{
    if(view!=="mission" || awaitingStart() || restartDialog.open) return;
    weather.toggle();
    updateRainStatus();
    canvas.focus({preventScroll:true});
  };
  const restartButton=tools.querySelector("#missionRestart");
  restartButton.onclick=event=>requestRestart(event.currentTarget);
  restartDialog.addEventListener("close",()=>{
    const url=new URL(location.href);
    if(url.searchParams.has("restart")) {
      url.searchParams.delete("restart");
      history.replaceState(history.state,"",url);
    }
    clearPlayerControl();
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
    if (!root.visible || restartDialog.open || document.body.classList.contains("scene-loading") ||
      e.repeat || e.isComposing || e.defaultPrevented) return;
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
      requestRestart(restartButton);
      return;
    }
    if(view==="mission" && e.code==="KeyE" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
      !e.target.closest?.("input, textarea, select, [contenteditable]")) {
      e.preventDefault();
      if(!intro.hidden) (continueButton.hidden ? begin : continueButton).click();
      else if(dialogue.dispatch()) canvas.focus({preventScroll:true});
      return;
    }
    if(awaitingStart()) return;
    if(yard.active() && e.code==="Escape") {useYard();return;}
    if(yard.active() && !["KeyT","KeyV","Tab"].includes(e.code)) return;
    if(e.code==="KeyT" && !e.ctrlKey && !e.metaKey && !e.altKey) weatherButton.click();
    if(e.code==="KeyG") useFerry();
    if(e.code==="KeyB") buyOrClaimCake();
    if(e.code==="KeyI") showSteamer();
    if(e.code==="KeyH") shareCake();
    if(e.code==="Escape") cancelShare();
    if (e.code === "KeyP") greetAnimal();
    if (e.code === "KeyV") toggleCamera();
    if (e.code === "KeyJ") journal.toggle(state);
    if (e.code === "KeyF") tossStone();
    if (e.code === "KeyR") pullMooring();
    if (e.code === "KeyX") useFreight();
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
      if(ferry.active()) renderPassenger();
      bridgeLook.prepare(renderer,scene,camera);
    },
    turn(dx, dy) {
      if (view !== "mission" || restartDialog.open || awaitingStart() || backlane.locked()) return;
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
      player: { ...player, y: ferry.active() ? ferry.rider.y : teaRoom.chairActive() ? teaRoom.chair.y : floor(player.x,player.z) }, crate: [crateMesh.position.x, crateMesh.position.y, crateMesh.position.z],
      wading, waterDepth: wadeDepth(player.x,player.z), dampness, wetLine, stones: stones.inspect(),
      gait:gait.inspect(),audio:audio.inspect(),weather:weather.inspect(),velocity:{x:streetVelocity.x,z:streetVelocity.y},ferry:ferry.inspect(player),ferryDelivery:state.ferryCrossing===true,
      water: bridgeLook.inspect(elapsed), wind: foreground.inspect(), tea: { ...tea.inspect(), closeUp: Number.isFinite(teaShotStart) },
      collision:{solids:city.inspect(),cameraObstacle,cameraDistance:boomLength,
        carryOverlap:cargoCollision(player.x,player.z,bodyYaw)?.name??null,
        bodyOverlap:passengerCarrier() || teaRoom.chairActive() ? null : city.blocking(player.x,player.z,floor(player.x,player.z),workerRadius,workerHeight)?.name??null},
      freight:freight.inspect(player,walkable),consignment:inspectConsignment(),teaRoom:teaRoom.inspect(player),workshop:workshop.inspect(),yard:yard.inspect(),joinery:joinery.inspect(),backlane:backlane.inspect(),timberPorter:timberPorter.inspect(),market:market.inspect(),cake:{owned:hasParcel(),gifted:state.cakeGifted===true},
      walkable: canStep(player.x,player.z), drawn: root.visible }),
  };
}
