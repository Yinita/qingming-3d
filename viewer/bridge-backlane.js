import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { tileRoof } from "./bridge-architecture.js";
import { buildStreetTrees } from "./bridge-street-trees.js";
import { woodEndGrain } from "./bridge-workyard.js";
import { bladeGeometry, lightLeaf } from "./bridge-leaf-light.js";
import { createCourtSaw } from "./bridge-court-saw.js";
import { createTimberGate, timberGateZ } from "./bridge-timber-gate.js";
import { buildFlagstoneWalk } from "./bridge-streetworks.js";

const saveKey="qingming-west-drain-v1";
const {smoothstep}=THREE.MathUtils;
const ditch={x:-77.60,minZ:-52.00,maxZ:-39.46};
const crossing={x:ditch.x,z:-41.422,y:.127,halfWidth:.625};
const yard={left:-82.92,right:-75.62,back:-51.32,front:-39.78};
const deckEnd=.50, deckLength=.92;
const turnTime=.56, seatTime=.53, landTime=seatTime+.66;
const eastSillX=crossing.x+deckEnd;
const westHingeX=eastSillX-deckLength;
const boardAt=new THREE.Vector3(eastSillX+.114,crossing.y-.060,crossing.z);
const upright=new THREE.Euler(Math.PI*.5,.08,-.14,"ZYX");
export const drainBridgeApproach={x:eastSillX+.48,z:crossing.z};

export function backlaneRelief(x,z) {
  const cut=(1-smoothstep(Math.abs(x-ditch.x),.28,.48))*
    smoothstep(z,ditch.minZ-.38,ditch.minZ+.12)*(1-smoothstep(z,ditch.maxZ-.10,ditch.maxZ+.37));
  return -.345*cut;
}

export function cutDrainApron(material) {
  // The cream apron lies above the water in this ditch. Keep the terrain
  // visible below its opening while leaving the original scroll view intact.
  const cut={value:0};
  material.onBeforeCompile=shader=>{
    shader.uniforms.apronDrainCut=cut;
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec2 apronPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\napronPoint=(modelMatrix*vec4(position,1.)).xz;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>",
      "#include <common>\nvarying vec2 apronPoint; uniform float apronDrainCut;")
      .replace("#include <clipping_planes_fragment>",`#include <clipping_planes_fragment>
        if(apronDrainCut>.5 && abs(apronPoint.x-(${ditch.x.toFixed(3)}))<.485 &&
          apronPoint.y>${(ditch.minZ-.4).toFixed(3)} && apronPoint.y<${(ditch.maxZ+.4).toFixed(3)}) discard;
      `);
  };
  return active=>{cut.value=Number(active);};
}

export function createBacklane(parent,city,surface,joinery,sound,registerPavedSurface) {
  const root=new THREE.Group();
  root.name="West bank timber court";
  parent.add(root);
  const fixed=new THREE.Group();
  root.add(fixed);
  const solids=[];
  const wood=surface("rail-wood",0x967755,.67,.87);
  const darkWood=surface("tea-wood",0x74533a,.57,.93);
  const fresh=surface("tea-wood",0xc8a276,.51,.86);
  const stone=surface("worn-stone",0x9e9782,.75,.91);
  const paving=surface("stone-paving",0x999983,.66,.88);
  const plaster=surface("lime-plaster",0xc3ae83,.47,.93);
  const tiles=surface("gray-roof-tile",0x5d665b,.78,.84);
  const iron=new THREE.MeshStandardMaterial({color:0x49433b,metalness:.51,roughness:.56});
  const earth=new THREE.MeshStandardMaterial({color:0x69543c,roughness:.98});
  const bark=surface("willow-bark",0x8c6d4e,.8,.93);
  const endGrain=woodEndGrain();
  function mesh(group,geometry,material,x,y,z) {
    const result=new THREE.Mesh(geometry,material);
    result.position.set(x,y,z);
    result.castShadow=result.receiveShadow=true;
    result.layers.enable(1);
    group.add(result);
    return result;
  }
  function box(group,material,w,h,d,x,y,z,bevel=.014) {
    return mesh(group,detailedBox(w,h,d,material,bevel,2*x+z),material,x,y,z);
  }
  function block(name,x,z,w,d,bottom,top) {
    solids.push(city.box(name,x-w/2,x+w/2,z-d/2,z+d/2,bottom,top));
  }

  // Stones cover the cut sides and flare outward where the timber bears on them.
  const channelLength=ditch.maxZ-ditch.minZ, centreZ=(ditch.minZ+ditch.maxZ)/2;
  for(const side of [-1,1]) {
    for(let i=0;i<29;i++) {
      const z=ditch.minZ+(i+.5)*channelLength/29;
      const top=.013+.019*Math.sin(i*2.77+side);
      const x=ditch.x+side*(.385+.018*Math.sin(i*2.21));
      box(fixed,stone,.185,.28+top,channelLength/29-.012,x,-.14+top/2,z,.028).rotation.y=.054*Math.sin(i*7+side);
      box(fixed,paving,.208,.075,channelLength/29-.019,x,.019+top*.45,z,.019).rotation.y=.047*Math.cos(i*4.92+side);
    }
  }
  const streamMat=new THREE.MeshStandardMaterial({color:0x515b43,roughness:.34,metalness:.16});
  const flow={value:0};
  streamMat.onBeforeCompile=shader=>{
    shader.uniforms.drainTime=flow;
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec2 drainCoord;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\ndrainCoord=position.xy;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>",
      "#include <common>\nuniform float drainTime; varying vec2 drainCoord;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float bank=1.-smoothstep(.18,.36,abs(drainCoord.x));
        float wave=drainCoord.y*32.+drainTime*2.6+1.7*sin(drainCoord.x*12.+drainCoord.y*3.4);
        float curl=drainCoord.y*19.+drainTime*1.7+drainCoord.x*32.;
        float streak=smoothstep(.55,.90,sin(curl+sin(wave*1.12)));
        diffuseColor.rgb*=.59+.43*bank+.095*smoothstep(.76,1.,sin(wave))*streak*bank;`)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        vec3 drainWaves=vec3(.11*cos(curl),0.,.08*cos(wave+.31*sin(curl)))*bank;
        normal=normalize(normal+mat3(viewMatrix)*drainWaves);`);
  };
  const stream=mesh(root,new THREE.PlaneGeometry(.70,channelLength-.08),streamMat,ditch.x,-.209,centreZ);
  stream.name="Water in the west bank drain";
  stream.rotation.x=-Math.PI*.5;
  stream.castShadow=false;
  for(const [start,end] of [[yard.back,timberGateZ-.678],[timberGateZ+.678,crossing.z-.625],
    [crossing.z+.625,yard.front]]) {
    block("West drain bank",ditch.x,(start+end)/2,.68,end-start,-.20,.52);
    solids.at(-1).camera=false;
  }
  const reedsMat=new THREE.MeshStandardMaterial({roughness:.91,side:THREE.DoubleSide});
  lightLeaf(reedsMat,.42);
  const reeds=new THREE.InstancedMesh(bladeGeometry(.33,4),reedsMat,9*11);
  reeds.name="Sedges at drain stone joints";
  reeds.receiveShadow=true;
  root.add(reeds);
  const blade=new THREE.Object3D(), leafColor=new THREE.Color();
  for(let clump=0;clump<9;clump++) {
    const side=clump%2 ? -1 : 1;
    const x=ditch.x+side*(.342+.025*Math.cos(clump*8.7));
    const z=-43.08-clump*1.04+.26*Math.cos(clump*3.77);
    for(let i=0;i<11;i++) {
      const height=.15+.17*Math.sin(i*2.55+clump)**2;
      blade.position.set(x+.028*Math.cos(i*4.1),-.115,z+.071*Math.sin(i*4.67));
      blade.rotation.set(.28+.26*Math.sin(i*1.67),i*2.399+.71*clump,-.31*Math.cos(i*3.7));
      blade.scale.set(.050,height,height);
      blade.updateMatrix();
      reeds.setMatrixAt(clump*11+i,blade.matrix);
      reeds.setColorAt(clump*11+i,leafColor.setHSL(.17+.053*Math.sin(i*3.7+clump),.26,.25+.085*Math.cos(i+clump)));
    }
  }

  function enclosure(x,z,length,northSouth) {
    const local=new THREE.Group();
    local.position.set(x,0,z);
    if(northSouth) local.rotation.y=Math.PI*.5;
    fixed.add(local);
    box(local,stone,length,.23,.28,0,.111,0,.029);
    box(local,plaster,length,.98,.203,0,.69,0,.018);
    box(local,darkWood,length+.13,.085,.29,0,1.218,0,.017);
    const panels=Math.ceil(length/1.62);
    for(let i=0;i<=panels;i++) {
      const u=(i/panels-.5)*length;
      box(local,wood,.126,1.25,.248,u,.65,0,.014);
      box(local,stone,.191,.28,.322,u,.14,0,.025);
    }
    block("Timber court wall",x,z,northSouth?.27:length,northSouth?length:.27,0,1.27);
  }
  const depth=yard.front-yard.back;
  const westWidth=ditch.x-.50-yard.left;
  enclosure(yard.left,(yard.front+yard.back)/2,depth,true);
  enclosure(yard.left+westWidth/2,yard.back,westWidth,false);
  enclosure(yard.left+westWidth/2,yard.front,westWidth,false);
  enclosure(ditch.x+.93,yard.front,.91,false);

  // Two ramp stones establish the same incline that foot placement samples.
  for(const side of [-1,1]) {
    const inner=side===1 ? eastSillX+.227 : westHingeX;
    const length=.49;
    const high=box(fixed,stone,length,.14,1.32,inner+side*length*.49,.027,crossing.z,.021);
    high.rotation.z=-side*.212;
    box(fixed,stone,.235,.184,1.31,side===1 ? eastSillX+.112 : westHingeX-.066,-.052,crossing.z,.021);
    const z=crossing.z+side*.712;
    for(const x of [westHingeX-.17,westHingeX+.56,eastSillX+.32]) {
      box(fixed,stone,.186,.098,.183,x,.061,z,.018);
      box(fixed,wood,.093,.708,.095,x,.446,z,.010);
      box(fixed,darkWood,.128,.053,.127,x,.816,z,.010);
    }
    box(fixed,wood,1.56,.075,.079,ditch.x+.072,.689,z,.010);
    box(fixed,wood,1.56,.054,.066,ditch.x+.072,.367,z,.008);
    block("Drain footbridge rail",ditch.x+.072,z,1.56,.088,.09,.84);
  }
  const openGap=city.box("Open drain crossing",westHingeX-.005,eastSillX+.189,
    crossing.z-.622,crossing.z+.622,-.11,.61);
  openGap.camera=false;

  const deck=new THREE.Group();
  deck.name="Hinged drain footbridge";
  deck.position.set(westHingeX,crossing.y,crossing.z);
  root.add(deck);
  for(let i=0;i<4;i++) {
    const x=(i+.5)*deckLength/4;
    box(deck,i===2 ? darkWood : wood,deckLength/4-.009,.057,1.235,x,-.030,0,.011);
    for(const z of [-.418,.418])
      mesh(deck,new THREE.CylinderGeometry(.013,.012,.008,8),iron,x,-.0009,z);
  }
  for(const z of [-.406,.406]) {
    box(deck,darkWood,.969,.082,.098,.455,-.087,z,.012);
    const hinge=mesh(fixed,new THREE.CylinderGeometry(.049,.049,.174,14),iron,westHingeX,.086,crossing.z+z);
    hinge.rotation.x=Math.PI*.5;
    box(fixed,iron,.187,.023,.093,eastSillX+.111,.073,crossing.z+z,.006);
  }
  for(const z of [-.555,.555])
    box(fixed,darkWood,.229,.060,.171,eastSillX+.114,crossing.y-.032,crossing.z+z,.008);
  // The gap between these cheeks accepts the planed sill. The collapsed deck
  // hangs into the drain until the east end has a bearing surface again.
  for(const z of [-.489,.489]) {
    box(fixed,iron,.23,.014,.034,eastSillX+.114,.096,crossing.z+z,.005);
  }

  const store=new THREE.Group();
  store.name="Covered timber racks";
  store.position.set(-80.49,0,-49.54);
  fixed.add(store);
  const floorLength=3.47, floorDepth=2.32;
  box(store,stone,floorLength,.145,floorDepth,0,.072,0,.025);
  box(store,plaster,3.33,2.20,.191,0,1.195,-.965,.016);
  for(const x of [-1.54,0,1.54]) {
    for(const z of [-.92,.91]) {
      box(store,stone,.296,.185,.285,x,.185,z,.018);
      box(store,wood,.143,2.095,.148,x,1.287,z,.020);
    }
    box(store,darkWood,.112,.129,2.224,x,2.252,-.006,.013);
  }
  for(const z of [-.97,.93]) {
    box(store,darkWood,3.45,.151,.148,0,2.297,z,.017);
    for(let i=0;i<17;i++) {
      box(store,wood,.049,.067,.43,(i-8)*.194,2.34,z*1.065,.007);
    }
  }
  const roof=tileRoof(store,tiles,3.91,1.27,2.34,0,.39,{courseWidth:.198,courseLength:.277});
  roof.layers.enable(1);
  const rafterHeight=z=>2.34+(1.27-z)*.39+.129*(z/1.27)**4-.086;
  for(const side of [-1,1]) {
    box(store,darkWood,3.62,.113,.137,0,2.405,side*.95,.015);
    for(let i=0;i<17;i++) {
      for(const [inside,outside] of [[0,.66],[.66,1.28]]) {
        const rise=rafterHeight(inside)-rafterHeight(outside), run=outside-inside;
        const rafter=box(store,wood,.063,.095,Math.hypot(run,rise)+.022,(i-8)*.219,
          (rafterHeight(inside)+rafterHeight(outside))/2,side*(inside+outside)/2,.011);
        rafter.rotation.x=Math.atan2(rise,run)*side;
      }
    }
  }
  box(store,darkWood,3.86,.142,.169,0,2.917,0,.020);
  const plaque=document.createElement("canvas");
  plaque.width=256;
  plaque.height=80;
  const ink=plaque.getContext("2d");
  ink.fillStyle="#9c7951";
  ink.fillRect(0,0,256,80);
  ink.strokeStyle="#684b38";
  ink.lineWidth=4;
  ink.strokeRect(7,7,242,66);
  ink.fillStyle="#3e3227";
  ink.textAlign="center";
  ink.textBaseline="middle";
  ink.font='39px "Noto Serif CJK SC", "Songti SC", serif';
  ink.fillText("木料後院",128,41);
  const sign=new THREE.CanvasTexture(plaque);
  sign.colorSpace=THREE.SRGBColorSpace;
  box(store,darkWood,1.24,.39,.041,0,2.168,1.019,.012);
  mesh(store,new THREE.PlaneGeometry(1.18,.347),new THREE.MeshStandardMaterial({map:sign,roughness:.94}),
    0,2.168,1.041).castShadow=false;
  for(const side of [-1,1]) {
    const rack=side*.82;
    for(const u of [-.66,.66]) {
      box(store,darkWood,.078,1.50,.116,rack+u,.89,-.326,.010);
      box(store,wood,.077,.087,.66,rack+u,.61,-.24,.010);
      box(store,wood,.077,.087,.66,rack+u,1.06,-.24,.010);
    }
    for(let row=0;row<3;row++) for(let i=0;i<4;i++) {
      const length=1.16+.24*Math.sin(row*6.37+i*5.4+side);
      box(store,(i+row)%3===0 ? fresh : wood,length,.067,.146,rack+.088*Math.sin(i*3.1+row+side),
        .221+row*.445+(i%2)*.077,-.37+Math.floor(i/2)*.174,.008);
    }
    for(let i=0;i<4;i++) {
      const timber=box(store,i%3===0 ? fresh : wood,.090,1.04+.13*i,.037,rack-.24+i*.155,.876,-.61,.008);
      timber.rotation.x=.24;
      timber.rotation.z=.05*((i%3)-1);
    }
  }
  block("Covered timber store",store.position.x,store.position.z,3.39,2.17,0,2.6);

  const flagstones=[];
  for(let i=0;i<23;i++) {
    const z=-41.43-i*.315;
    const x=-79.56-.44*smoothstep(i,1,11)+.09*Math.sin(i*1.65);
    for(const side of [-1,1]) {
      flagstones.push({x:x+side*.247,z:z+.035*Math.sin(i*4.9+side),w:.468+.071*Math.sin(i*3.46+side),
        d:.290+.032*Math.cos(i*5.1),y:.027+.008*Math.sin(i*2.7+side)});
      if(i%3!==0) {
        const size=.045+.037*Math.sin(i*2.73+side)**2;
        flagstones.push({x:x+side*(.49+.14*Math.sin(i*1.9)**2),z:z+.081*Math.cos(i+side),
          w:size*1.29,d:size,y:.009,chip:true});
      }
    }
  }
  for(let i=0;i<4;i++) {
    flagstones.push({x:westHingeX-.64-i*.311,z:crossing.z+.023*Math.sin(i*2.4),
      w:.304,d:.548+.072*Math.cos(i*7.7),y:.025+.008*Math.sin(i*5)});
  }
  for(let i=0;i<14;i++) {
    const z=timberGateZ+i*.338;
    flagstones.push({x:-76.49+.26*smoothstep(i,8,13)+.046*Math.cos(i*3.7),z,w:.57+.084*Math.sin(i*4.6),
      d:.304+.030*Math.sin(i*1.7),y:.031+.013*Math.cos(i*5.3)});
  }
  buildFlagstoneWalk(root,surface,flagstones,registerPavedSurface);

  // The sawing station leaves a loop around the centre of the yard.
  const horse=new THREE.Group();
  horse.name="Timber court sawbench";
  horse.position.set(-81.22,0,-44.78);
  horse.rotation.y=-.18;
  fixed.add(horse);
  for(const x of [-.52,.52]) for(const side of [-1,1]) {
    const leg=box(horse,wood,.111,.82,.097,x,.415,side*.256,.009);
    leg.rotation.x=-side*.35;
  }
  box(horse,darkWood,.834,.123,.322,-.328,.752,0,.014);
  box(horse,darkWood,.590,.123,.322,.450,.752,0,.014);
  box(horse,wood,1.18,.095,.078,0,.425,0,.014);
  const saw=createCourtSaw(root,horse,{wood,darkWood,fresh,iron,endGrain},sound);
  const timberGate=createTimberGate(root,fixed,city,surface,saw,sound);
  solids.push(city.orientedBox("Timber court sawbench",.76,.37,.86));
  Object.assign(solids.at(-1),{x:horse.position.x,z:horse.position.z,yaw:horse.rotation.y});
  for(const x of [-82.38,-81.57])
    box(fixed,darkWood,.113,.043,.772,x,.024,-47.07,.010);
  for(const [row,count] of [4,3,2].entries()) for(let i=0;i<count;i++) {
    const x=-82.00+.118*Math.sin(row*3.54+i*3.18);
    const z=-47.07+(i-(count-1)/2)*.173;
    const log=mesh(fixed,new THREE.CylinderGeometry(.083,.093,.96+.19*Math.cos(i*2.3+row),20),
      [bark,endGrain,endGrain],x,.134+row*.147,z);
    log.rotation.set(0,.041*Math.cos(i*2.36),Math.PI*.5);
  }
  block("Firewood stack",-82.0,-47.07,1.25,.75,0,.48);
  for(const [x,z] of [[-82.34,-42.6],[-79.12,-50.33],[-75.89,-40.02]]) {
    const pot=mesh(fixed,new THREE.LatheGeometry([
      [0,0],[.174,0],[.22,.075],[.27,.27],[.265,.41],[.21,.55],[.158,.582],
      [.161,.644],[.192,.647],[.197,.680],[.154,.680],[.143,.641],[.141,.58],
    ].map(([r,y])=>new THREE.Vector2(r,y)),36),earth,x,0,z);
    pot.name="Earthen storage jar";
    const lid=mesh(fixed,new THREE.CylinderGeometry(.18,.184,.04,24),darkWood,x,.69,z);
    lid.rotation.z=.025;
    block("Earthen storage jar",x,z,.51,.51,0,.70);
  }

  fixed.updateMatrixWorld(true);
  const byMaterial=new Map();
  fixed.traverse(object=>{
    if(!object.isMesh || Array.isArray(object.material)) return;
    const shape=object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    // The already-batched tile roof has per-tile vertex colours.
    if(shape.hasAttribute("color")) {
      shape.dispose();
      return;
    }
    shape.applyMatrix4(object.matrixWorld);
    if(!byMaterial.has(object.material)) byMaterial.set(object.material,[]);
    byMaterial.get(object.material).push([object,shape]);
  });
  for(const [material,parts] of byMaterial) {
    const combined=mergeGeometries(parts.map(([,shape])=>shape));
    if(combined) mesh(root,combined,material,0,0,0);
    for(const [object,shape] of parts) {
      shape.dispose();
      if(combined) {
        object.removeFromParent();
        object.geometry.dispose();
      }
    }
  }
  const trees=buildStreetTrees(root,[
    {id:"o6401",x:-83.41,z:-44.21,w:2.57,h:4.62},
    {id:"o6402",x:-80.04,z:-51.96,w:3.22,h:4.91},
  ],surface,{cylinder(...args){solids.push(city.cylinder(...args));}},crossing);

  const fittedBoard=new THREE.Group();
  fittedBoard.name="Drain sill socket";
  root.add(fittedBoard);
  const from=new THREE.Vector3(), fromRotation=new THREE.Quaternion();
  const palm=new THREE.Vector3(), orientation=new THREE.Quaternion();
  const receive=new THREE.Quaternion();
  const carryRotation=new THREE.Quaternion().setFromEuler(upright);
  const socketRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.PI,0));
  const handAngle=[new THREE.Euler(.15,Math.PI*.51,-.15,"YXZ"),new THREE.Euler(.15,-Math.PI*.51,.15,"YXZ")];
  let stage="bench", age=0, offered=false, active=false, startYaw=0, turnYaw=0, placingAt=Infinity;
  let board=null;

  function save(value) {
    try {
      if(value==="bench") localStorage.removeItem(saveKey);
      else localStorage.setItem(saveKey,value);
    } catch {}
  }
  function syncDeck() {
    deck.rotation.z=stage==="open" ? 0 : stage==="fitting" ?
      -.56*(1-smoothstep(age-placingAt,seatTime-.03,landTime-.02)) : -.56;
    openGap.enabled=active && stage!=="open";
  }
  function settle() {
    board.position.copy(boardAt);
    board.quaternion.copy(socketRotation);
  }
  try {
    const saved=localStorage.getItem(saveKey);
    if(joinery.planed() && (saved==="carried" || saved==="open")) stage=saved;
  } catch {}
  if(stage!=="bench") {
    board=joinery.moveBoard(fittedBoard);
    if(stage==="open") settle();
  }
  syncDeck();

  function contains(x,z) {
    return x>yard.left+.12 && x<=yard.right && z>yard.back+.12 && z<yard.front-.12 &&
      (x<westHingeX || x>eastSillX || timberGate.nearDeck(x,z) ||
        (Math.abs(z-crossing.z)<crossing.halfWidth && stage==="open"));
  }
  function support(x,z) {
    if(Math.abs(z-crossing.z)>.622) return timberGate.support(x,z);
    const east=eastSillX+.227, west=westHingeX;
    if(x>east+.48 || x<west-.48) return -Infinity;
    if(x>=east) return THREE.MathUtils.lerp(.022,crossing.y,1-(x-east)/.48);
    if(x<=west) return THREE.MathUtils.lerp(.022,crossing.y,1-(west-x)/.48);
    return stage==="open" ? crossing.y : -Infinity;
  }
  function approach(player) {
    return player.x>eastSillX+.263 && player.x<eastSillX+.914 &&
      Math.abs(player.z-crossing.z)<.54;
  }
  function action(player) {
    if(stage==="open") return timberGate.action(player)??saw.action(player);
    if(stage==="bench" && offered && joinery.near(player)) return "拿起刨好的木板 E";
    if(stage==="carried" && approach(player)) return "嵌上木板修桥 E";
    if(stage==="carried" && joinery.near(player)) return "把木板放回工案 E";
    return null;
  }
  function use(player) {
    if(!action(player)) return null;
    if(stage==="open") return timberGate.action(player) ? timberGate.use(player) :
      saw.use(player) ? "扶稳木料，沿锯口拉锯。" : null;
    if(stage==="bench") {
      board=joinery.moveBoard(fittedBoard);
      stage="carried";
      save("carried");
      return "沿栅栏南侧走到排水沟，把木板嵌在断桥这一端。";
    }
    if(approach(player)) {
      startYaw=player.yaw;
      const goalYaw=Math.atan2(player.x-crossing.x,player.z-crossing.z);
      turnYaw=Math.atan2(Math.sin(goalYaw-startYaw),Math.cos(goalYaw-startYaw));
      stage="fitting";
      age=0;
      placingAt=Infinity;
      return "木板正在落入桥槽。";
    }
    joinery.returnBoard();
    stage="bench";
    save("bench");
    return "木板放回工案了。";
  }
  function update(dt,camera,bodyYaw,player) {
    flow.value+=dt;
    trees.update(camera,flow.value);
    if(stage==="open") return timberGate.update(dt,player,bodyYaw)??saw.update(dt,player,bodyYaw);
    if(stage!=="fitting") return null;
    const previous=age-placingAt;
    age+=dt;
    if(placingAt===Infinity) {
      const delta=startYaw+turnYaw-bodyYaw;
      if(age<turnTime || (Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))>.15 && age<2.2)) return null;
      from.copy(board.position);
      fromRotation.copy(board.quaternion);
      placingAt=age;
    }
    const fittingAge=age-placingAt;
    const progress=smoothstep(fittingAge,0,seatTime);
    board.position.lerpVectors(from,boardAt,progress);
    board.position.y+=.19*Math.sin(progress*Math.PI);
    board.quaternion.copy(fromRotation).slerp(socketRotation,progress);
    syncDeck();
    if(previous<seatTime && fittingAge>=seatTime) sound("impact",boardAt.x,boardAt.z,.46);
    if(fittingAge<landTime) return null;
    settle();
    stage="open";
    save("open");
    syncDeck();
    sound("impact",crossing.x,crossing.z,.68);
    return "repaired";
  }
  function pose(playerBody) {
    if(stage==="open") {
      saw.pose(playerBody);
      timberGate.pose(playerBody);
      return;
    }
    const holding=stage==="carried" || stage==="fitting" && placingAt===Infinity;
    if(holding) {
      const person=playerBody.figure;
      palm.set(0,1.014,-.331);
      person.localToWorld(palm);
      board.position.copy(palm);
      person.getWorldQuaternion(orientation);
      board.quaternion.copy(orientation).multiply(carryRotation);
    }
    const weight=holding ? 1 : stage==="fitting" ? 1-smoothstep(age-placingAt,.08,.34) : 0;
    if(!weight) return;
    for(const [i,angle] of handAngle.entries()) {
      const side=i===0 ? -1 : 1;
      palm.set(side*.126,.026,side*.065-.077);
      board.localToWorld(palm);
      receive.setFromEuler(angle);
      if(stage==="fitting") playerBody.figure.getWorldQuaternion(orientation);
      receive.premultiply(orientation);
      playerBody.graspProp(i,palm,receive,weight);
    }
  }
  return {
    contains,support,action,use,update,pose,
    offer() { if(stage==="bench") offered=true; },
    open:()=>stage==="open",
    carrying:()=>stage==="carried",
    loaded:()=>stage==="carried" || timberGate.carrying(),
    playerClearance:radius=>timberGate.carrying() ? .506 : radius,
    locked:()=>stage==="fitting" || saw.active() || timberGate.locked(),
    facing:()=>timberGate.locked() ? timberGate.facing() :
      saw.active() ? saw.facing() : startYaw+turnYaw*smoothstep(age,0,turnTime),
    sawing:saw.active,
    frameSaw:player=>stage==="open" && (saw.active() || saw.viewAligned(player)),
    courtGuide(player) {
      if(stage!=="open") return null;
      if(timberGate.carrying()) return timberGate.guide(player);
      if(player.x>=-78.70 || !contains(player.x,player.z)) return null;
      return timberGate.guide(player)??(saw.unfinished() && !saw.near(player) ?
        {...saw.approach,label:"锯台"} : null);
    },
    workStation:()=>saw.active() ? saw.station() : timberGate.station(),
    busy:()=>stage==="carried" || stage==="fitting" || saw.active() || timberGate.carrying() || timberGate.locked(),
    materialAt(x,y,z) {
      if(support(x,z)<y-.012) return null;
      return Math.abs(z-crossing.z)<.622 && stage==="open" && x>westHingeX && x<eastSillX+.227 ? "wood" : "stone";
    },
    show(on) {
      root.visible=active=on;
      for(const solid of solids) solid.enabled=on;
      timberGate.show(on);
      syncDeck();
    },
    reset() {
      joinery.returnBoard();
      board=null;
      stage="bench"; offered=false; age=0;
      save("bench");
      syncDeck();
      timberGate.reset();
      saw.reset();
    },
    inspect:()=>({stage,offered,age,angle:deck.rotation.z,support:stage==="open" ? crossing.y : null,
      walkTo:drainBridgeApproach,board:board?.position.toArray()??null,saw:saw.inspect(),gate:timberGate.inspect()}),
  };
}
