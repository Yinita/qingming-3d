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

function loadSave() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE));
    const crate = saved?.crate;
    if (crate && [crate.x, crate.z, crate.yaw].every(Number.isFinite) &&
        Number.isInteger(saved.coins) && saved.coins >= 0 && saved.coins <= 11 &&
        ["waiting", "delivered"].includes(saved.phase) &&
        (saved.phase === "delivered" || walkable(crate.x, crate.z))) return saved;
  } catch (err) {
    // The mission can run without storage.
  }
  return { phase: "waiting", crate: { ...pickup }, coins: 6, method: null };
}

export function createBridgeMission({ scene, camera, renderer, ambient, sun, ground, apron, street, setMode }) {
  const canvas = renderer.domElement;
  const root = new THREE.Group();
  root.name = "Bridge delivery";
  root.visible = false;
  scene.add(root);
  const city=street.collisions;
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
    const ground=foreground.floor(x,z);
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
  labels.hidden = true;
  labels.innerHTML = `
    <div class="mission-kicker">清院本 · 桥头</div>
    <h1>桥畔茶铺</h1>
    <p id="missionObjective"></p>
    <p class="mission-metrics" id="missionEconomy"></p>
    <div class="mission-actions">
      <button id="missionInteract">拿取</button>
      <button id="missionHire">委托伙计</button>
      <button id="missionCamera">切换第一人称</button>
      <button id="missionTea" hidden>看掌柜斟茶</button>
      <button id="missionPebble" hidden title="朝向河面投掷小石子">投石 F</button>
      <button id="missionMooring" hidden>拉缆绳 R</button>
    </div>
    <div class="mission-actions">
      <button id="missionScroll">查看任务画卷</button>
      <button id="missionUndo">撤销</button>
      <button id="missionExit">回到全卷</button>
    </div>
    <p id="missionSpeech" aria-live="polite"></p>
    <p class="mission-controls">WASD 移动 · 拖动转向 · E 拿取 / 放下 · V 切视角 · Tab 看画卷</p>`;
  document.body.appendChild(labels);
  const byId = id => labels.querySelector("#" + id);
  const status = byId("missionObjective");
  const economy = byId("missionEconomy");
  const hint = byId("missionSpeech");
  const interactButton = byId("missionInteract");
  const hireButton = byId("missionHire");
  const switchButton = byId("missionScroll");
  const teaButton = byId("missionTea");
  const pebbleButton = byId("missionPebble");
  const mooringButton=byId("missionMooring");

  let state = loadSave();
  let previous = null;
  let courierLeg = 0;
  let elapsed = 0;
  let deliveryTime = -10;
  let view = "outside";
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
  const player = { x: -73.18, z: routeZ, yaw: -Math.PI / 2, pitch: 0 };
  let bodyYaw=player.yaw;
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
    return walkable(x,z) && !city.blocking(x,z,floor(x,z),radius,height,ignored,ignoredCargo);
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
  const groundMarker = mesh(new THREE.RingGeometry(.38, .47, 32), new THREE.MeshBasicMaterial({
    color: 0xad703e, side: THREE.DoubleSide, transparent: true, opacity: .76,
  }), root, counter.x - 1.0, .028, counter.z + .78);
  groundMarker.rotation.x = -Math.PI / 2;
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

  function finish(method) {
    state.phase = "delivered";
    state.method = method;
    state.coins += 5;
    state.crate = { x: counter.x - .54, z: counter.z, yaw: 0 };
    deliveryTime = elapsed;
    hint.textContent = "掌柜递来五文钱。今晚的第一壶茶，可以煮了。";
    positionCrate();
    store();
    ui();
  }

  function useCargo() {
    if (view !== "mission") return;
    if (state.phase === "waiting" && distance(player, state.crate) < 1.9) {
      if (cargoObstacle(player.x,player.z,bodyYaw,looseCargo)) {
        hint.textContent="这里太窄。挪开半步再背货箱。";
        return;
      }
      remember();
      state.phase = "carrying";
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
        hint.textContent = "货箱已放下。走近可再拿起。";
        store();
      }
    } else if (state.phase === "waiting") {
      hint.textContent = "走近绑着两道深色木条的货箱，再按 E。";
    }
    positionCrate();
    ui();
  }

  function hire() {
    if (view !== "mission" || state.phase !== "waiting" || state.coins < 3 ||
        distance(player, pickup) > 3 || distance(state.crate, pickup) > .9) return;
    const start=cargoPose(pickup.x,routeZ,floor(pickup.x,routeZ)+harnessHeight,pickup.yaw);
    if(distance(player,pickup)<workerRadius*2 || courierBoxHitsPlayer(start)) {
      hint.textContent="请给伙计让一步，他要在货箱旁起身。";
      return;
    }
    remember();
    state.coins -= 3;
    state.phase = "courier";
    courierLeg = 0;
    courierGait.reset();
    helper.figure.position.set(pickup.x, floor(pickup.x, routeZ), routeZ);
    helper.figure.rotation.y=pickup.yaw;
    hint.textContent = "付给伙计三文。他会沿桥把箱子送到茶铺。";
    positionCrate();
    ui();
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

  function undo() {
    if (!previous) return;
    state = previous;
    stopTeaShot();
    tea.reset();
    previous = null;
    courierGait.reset();
    helper.figure.position.set(pickup.x - .5, floor(pickup.x - .5, routeZ + 1.03), routeZ + 1.03);
    hint.textContent = "已恢复上一个可交互状态。";
    store();
    positionCrate();
    ui();
  }

  function ui() {
    const objective = {
      waiting: "把桥头的茶叶箱送到对岸茶铺。",
      carrying: "已拿到茶叶。过桥，到茶铺柜台交货。",
      courier: "伙计正在送货。可以跟过去，也可以切到任务画卷。",
      delivered: "茶已送到，茶铺开张。",
    };
    status.textContent = objective[state.phase];
    economy.textContent = `铜钱 ${state.coins} 文　·　茶铺库存 ${state.phase === "delivered" ? "1 箱" : "0 箱"}`;
    interactButton.textContent = state.phase === "carrying"
      ? (distance(player, counter) < deliveryReach ? "交货 E" : "放下 E") : "拿取 E";
    interactButton.disabled = view !== "mission" || ["delivered", "courier"].includes(state.phase) ||
      (state.phase === "waiting" && distance(player, state.crate) >= 1.9);
    hireButton.disabled = view !== "mission" || state.phase !== "waiting" ||
      state.coins < 3 || distance(player, pickup) > 3 || distance(state.crate, pickup) > .9;
    const teaShot = Number.isFinite(teaShotStart);
    teaButton.hidden = state.phase !== "delivered";
    teaButton.disabled = view !== "mission" || (!teaShot && distance(player, counter) >= 2.75);
    teaButton.textContent = teaShot ? "返回街道" : "看掌柜斟茶";
    byId("missionUndo").disabled = !previous;
    byId("missionCamera").disabled = view !== "mission";
    byId("missionCamera").textContent = firstPerson ? "切换第三人称" : "切换第一人称";
    switchButton.textContent = view === "missionScroll" ? "返回桥头" : "查看任务画卷";
    pebbleButton.hidden = !canAimStone();
    pebbleButton.disabled = !aimStone();
    mooringButton.hidden=!byMooring();
    labels.dataset.phase = state.phase;
    labels.dataset.wading = String(wading);
    labels.dataset.view = view;
    groundMarker.visible = view === "mission" && state.phase !== "delivered";
  }

  function animate(person, phase, walking, carrying, dt) {
    person.straps.visible = carrying;
    person.limbs.legs.forEach((leg, i) => { leg.rotation.x = walking ? Math.sin(phase + i * Math.PI) * .49 : 0; });
    person.limbs.arms.forEach((arm, i) => { arm.rotation.x = carrying ? .88 :
      (walking ? Math.sin(phase + (i + 1) * Math.PI) * .25 : 0); });
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
    if (mode !== "mission") stopTeaShot();
    const active = mode === "mission" || mode === "missionScroll";
    for(const collider of localColliders) collider.enabled=mode==="mission";
    syncActors();
    root.visible = active;
    foreground.setVisible(mode === "mission");
    bridgeLook.setVisible(mode === "mission");
    counterFill.visible = mode === "mission";
    light(mode === "mission");
    labels.hidden = !active;
    document.body.classList.toggle("mission-open", active);
    groundMarker.visible = mode === "mission" && state.phase !== "delivered";
    if (active) {
      positionCrate();
      ui();
    }
  }

  function frame(dt, keys) {
    if (!root.visible) return;
    elapsed += dt;
    tea.update(elapsed);
    let walking = false;
    stones.update(elapsed);
    if (view === "mission") {
      const dx = Number(keys.has("d") || keys.has("arrowright")) -
                 Number(keys.has("a") || keys.has("arrowleft"));
      const dz = Number(keys.has("w") || keys.has("arrowup")) -
                 Number(keys.has("s") || keys.has("arrowdown"));
      fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      side.set(-fwd.z, 0, fwd.x);
      const beforeDepth=wadeDepth(player.x,player.z);
      const drag=1-.69*THREE.MathUtils.smoothstep(beforeDepth,.025,.51);
      const carrying=state.phase==="carrying";
      const pace=keys.has("shift") ? (carrying ? 2.72 : 3.51) : (carrying ? 1.40 : 1.64);
      const v = pace * dt * drag / (Math.hypot(dx, dz) || 1);
      syncActors();
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
      // In exploration the body follows the walk vector while the player's view can stay on the river.
      const heading=walking ? Math.atan2(-vx,-vz) : player.yaw;
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
    playerBody.figure.visible = (view === "mission" && !firstPerson && !cameraClose) ||
      (view === "missionScroll" && state.phase === "carrying");
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
    positionCrate();
    if(view==="mission") syncActors();
    if (walking) ui();
  }

  function toggleCamera() {
    if (view !== "mission") return;
    stopTeaShot();
    firstPerson = !firstPerson;
    ui();
  }

  function toggleScroll() { setMode(view === "missionScroll" ? "mission" : "missionScroll"); }
  interactButton.onclick = useCargo;
  hireButton.onclick = hire;
  byId("missionCamera").onclick = toggleCamera;
  teaButton.onclick = toggleTeaShot;
  pebbleButton.onclick=tossStone;
  mooringButton.onclick=pullMooring;
  switchButton.onclick = toggleScroll;
  byId("missionUndo").onclick = undo;
  byId("missionExit").onclick = () => setMode("paint");
  window.addEventListener("keydown", e => {
    if (!root.visible || e.repeat) return;
    if (e.code === "KeyE") useCargo();
    if (e.code === "KeyV") toggleCamera();
    if (e.code === "KeyF") tossStone();
    if (e.code === "KeyR") pullMooring();
    if (e.code === "Tab" && document.activeElement === canvas) {
      e.preventDefault();
      toggleScroll();
    }
  });

  return {
    anchor: center,
    setView, frame,
    prepare() {
      if (view !== "mission") return;
      bridgeLook.frame(elapsed,Math.min(.07,elapsed-lastPrepare));
      lastPrepare=elapsed;
      bridgeLook.prepare(renderer,scene,camera);
    },
    turn(dx, dy) {
      if (view !== "mission") return;
      if (Number.isFinite(teaShotStart)) {
        stopTeaShot();
        ui();
      }
      player.yaw -= dx * .0044;
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
      walkable: canStep(player.x,player.z), drawn: root.visible }),
  };
}
