import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";

export const teaChestSize={halfX:.385*.75,halfZ:.351*.75,height:.616*.75};

function paperLabel(width,height,text,seal) {
  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#d5b686";
  ctx.fillRect(0,0,width,height);
  for(let i=0;i<1300;i++) {
    const x=(i*173.19)%width,y=(i*91.11)%height;
    ctx.fillStyle=i%2 ? "#543d2621" : "#fff4cc2b";
    ctx.fillRect(x,y,1+(i%7),1);
  }
  ctx.strokeStyle="#88412c";
  ctx.lineWidth=3;
  ctx.strokeRect(8,8,width-16,height-16);
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  ctx.fillStyle="#503221";
  ctx.font=`bold ${Math.floor(height*.59)}px 'Noto Serif CJK SC', 'Songti SC', serif`;
  ctx.fillText(text,width*.5,height*.51);
  if(seal) {
    const edge=height*.17;
    ctx.fillStyle="#9e3c29";
    ctx.fillRect(width*.76,height*.65,edge,edge);
    ctx.strokeStyle="#d28658";
    ctx.lineWidth=1;
    ctx.strokeRect(width*.76+3,height*.65+3,edge-6,edge-6);
  }
  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  map.anisotropy=8;
  return new THREE.MeshStandardMaterial({map,roughness:.95});
}

export function buildTeaChest(surface) {
  const {halfX,halfZ,height}=teaChestSize;
  const chest=new THREE.Group(), lid=new THREE.Group(), contents=new THREE.Group(), latch=new THREE.Group();
  chest.name="茶叶货箱";
  lid.name="Tea chest hinged lid";
  contents.name="Packed tea cakes";
  latch.name="Tea chest iron hasp";
  const board=[0xe1bc8f,0xcfa97c,0xdfb78c,0xc7a580].map(color=>surface("tea-wood",color,.91,.92));
  const edge=surface("rail-wood",0xc49b71,.85,.89);
  const inside=surface("tea-wood",0xc19f75,.84,.97);
  const iron=new THREE.MeshStandardMaterial({color:0x49443d,roughness:.73,metalness:.58});
  const pin=new THREE.MeshStandardMaterial({color:0x766149,roughness:.64,metalness:.58});
  const paper=[0xceab73,0xc6a173,0xd1b98c].map(color=>new THREE.MeshStandardMaterial({color,roughness:.98,flatShading:true}));
  const cord=new THREE.MeshStandardMaterial({color:0x856740,roughness:.98});
  const label=paperLabel(192,168,"茶",true);
  const band=paperLabel(224,106,"茶餅",false);
  const sideLabel=new THREE.PlaneGeometry(.101,.0884);
  const wrapLabel=new THREE.PlaneGeometry(.092,.0435);
  const nail=new THREE.SphereGeometry(.0061,9,6);
  const barrel=new THREE.CylinderGeometry(.008,.008,.058,10);
  const handle=new THREE.TorusGeometry(.029,.0038,6,20);
  let part=0;
  function mesh(parent,geometry,material,x,y,z) {
    const piece=new THREE.Mesh(geometry,material);
    piece.position.set(x,y,z);
    piece.castShadow=piece.receiveShadow=true;
    parent.add(piece);
    return piece;
  }
  function block(parent,material,w,h,d,x,y,z,bevel=.006) {
    return mesh(parent,detailedBox(w,h,d,material,bevel,++part*.197),material,x,y,z);
  }
  const shoulder=height-.037, wall=.024, sideX=halfX-.015, endZ=halfZ-.016;
  const lidBack=-endZ-.003;
  block(chest,inside,2*sideX,.026,2*endZ,0,.045,0);
  for(const x of [-.187,.187]) block(chest,edge,.055,.039,2*endZ,x,.0195,0);
  for(let i=0;i<3;i++) {
    const low=.049+(shoulder-.049)*i/3, high=.049+(shoulder-.049)*(i+1)/3;
    const y=(low+high)*.5, wood=board[i];
    for(const sign of [-1,1]) {
      block(chest,wood,2*sideX,high-low-.002,wall,0,y,sign*(endZ-wall*.5));
      block(chest,board[i+1],wall,high-low-.002,2*(endZ-wall),sign*(sideX-wall*.5),y,0);
    }
  }
  for(const sign of [-1,1]) {
    block(chest,inside,2*(sideX-wall),.367,.008,0,.244,sign*(endZ-wall-.003));
    block(chest,inside,.008,.367,2*(endZ-wall),sign*(sideX-wall-.003),.244,0);
  }
  for(const y of [.118,.344]) for(const sign of [-1,1]) {
    block(chest,iron,2*halfX-.004,.031,.011,0,y,sign*(endZ+.004),.003);
    block(chest,iron,.012,.031,2*endZ,sign*(sideX+.006),y,0,.003);
    for(const x of [-.229,.229]) mesh(chest,nail,pin,x,y,sign*(endZ+.010)).scale.z=.48;
    for(const z of [-.208,.208]) mesh(chest,nail,pin,sign*(sideX+.013),y,z).scale.x=.48;
  }
  for(const sign of [-1,1]) {
    block(chest,iron,.011,.085,.065,sign*(sideX+.006),.259,0,.003);
    const liftRing=mesh(chest,handle,pin,sign*(sideX+.011),.249,0);
    liftRing.rotation.y=Math.PI*.5;
    mesh(chest,nail,pin,sign*(sideX+.013),.286,0).scale.x=.48;
  }
  const stamp=mesh(chest,sideLabel,label,.104,.235,endZ+.0007);
  stamp.rotation.z=-.044;
  stamp.castShadow=false;

  lid.position.set(0,shoulder,lidBack);
  chest.add(lid);
  const lidDepth=2*endZ+.001;
  for(let i=0;i<4;i++) {
    const length=lidDepth/4;
    block(lid,board[i],2*sideX+.007,.030,length-.0016,0,.017,(i+.5)*length,.0045);
  }
  for(const x of [-.18,.18]) {
    block(lid,edge,.037,.013,lidDepth-.022,x,-.004,lidDepth*.5);
    block(lid,iron,.031,.004,.095,x,.033,.049,.0025);
    block(chest,iron,.031,.058,.006,x,shoulder-.029,lidBack-.006,.003);
    mesh(chest,barrel,iron,x,shoulder,lidBack-.006).rotation.z=Math.PI*.5;
    for(const z of [.027,.071]) mesh(lid,nail,pin,x,.035,z).scale.y=.40;
  }
  block(chest,iron,.044,.051,.008,0,shoulder-.058,endZ+.005,.003);
  const staple=mesh(chest,handle,pin,0,shoulder-.048,endZ+.012);
  staple.scale.set(.35,.34,1);
  latch.position.set(0,.019,lidDepth+.006);
  lid.add(latch);
  block(latch,iron,.025,.072,.006,0,-.028,0,.003);
  mesh(latch,nail,pin,0,-.056,.003).scale.z=.52;

  chest.add(contents);
  for(const x of [-.178,0,.178]) block(contents,edge,.061,.062,.407,x,.090,0);
  block(contents,inside,2*(sideX-wall)-.008,.022,2*(endZ-wall)-.015,0,.129,0);
  const loaf=new THREE.CylinderGeometry(.070,.065,.054,16,3);
  const vertices=loaf.attributes.position;
  for(let i=0;i<vertices.count;i++) {
    const x=vertices.getX(i),z=vertices.getZ(i),y=vertices.getY(i);
    const angle=Math.atan2(z,x);
    const fold=1+.029*Math.cos(angle*5)+.016*Math.sin(angle*9+y*79);
    vertices.setXYZ(i,x*fold,y+.002*Math.cos(angle*6)*Math.min(1,Math.hypot(x,z)/.05),z*fold);
  }
  loaf.computeVertexNormals();
  const stringGeometry=new THREE.TorusGeometry(.0708,.00155,5,32);
  const tie=new THREE.SphereGeometry(.004,9,6);
  for(let row=0;row<2;row++) for(let column=-1;column<=1;column++) {
    const order=row*3+column+1;
    const bundle=new THREE.Group();
    bundle.position.set(column*.154,.058,(row-.5)*.204);
    bundle.rotation.y=.17*Math.sin(order*6);
    contents.add(bundle);
    const layers=order===3 ? 2 : 3;
    for(let layer=0;layer<layers;layer++) {
      const cake=mesh(bundle,loaf,paper[(order+layer)%3],0,.109+layer*.052,0);
      cake.rotation.y=.52*layer;
    }
    const top=.085+layers*.052;
    for(const angle of [.22,1.86]) {
      const loop=mesh(bundle,stringGeometry,cord,0,(.082+top)*.5,0);
      loop.rotation.y=angle;
      loop.scale.y=(top-.082)*.5/.0708;
    }
    mesh(bundle,tie,cord,.008,top+.002,.014).scale.set(1.5,.65,1.05);
    const ticket=mesh(bundle,wrapLabel,band,0,top+.003,.010);
    ticket.rotation.x=-Math.PI*.5;
    ticket.castShadow=false;
  }

  // Keep the four moving assemblies separate and merge their fixed details by material.
  const sources=new Set();
  function mergeAssembly(assembly,children) {
    assembly.updateWorldMatrix(true,true);
    const inverse=assembly.matrixWorld.clone().invert(), matrix=new THREE.Matrix4();
    const byMaterial=new Map();
    for(const child of children) {
      child.traverse(piece=>{
        if(!piece.isMesh) return;
        const material=piece.material;
        if(!byMaterial.has(material)) byMaterial.set(material,[]);
        const local=matrix.multiplyMatrices(inverse,piece.matrixWorld);
        byMaterial.get(material).push(piece.geometry.clone().applyMatrix4(local));
        sources.add(piece.geometry);
      });
      assembly.remove(child);
    }
    for(const [material,parts] of byMaterial) {
      const combined=mesh(assembly,mergeGeometries(parts),material,0,0,0);
      combined.castShadow=material!==label && material!==band;
      for(const part of parts) part.dispose();
    }
  }
  mergeAssembly(chest,chest.children.filter(part=>part.isMesh));
  mergeAssembly(lid,lid.children.filter(part=>part.isMesh));
  mergeAssembly(latch,[...latch.children]);
  mergeAssembly(contents,[...contents.children]);
  for(const geometry of sources) geometry.dispose();

  let time=0, angle=0, unlatch=0;
  const maxAngle=1.86;
  const {smoothstep}=THREE.MathUtils;
  function animate(dt,open) {
    time=THREE.MathUtils.clamp(time+dt*(open ? 1 : -1.5),0,.88);
    unlatch=smoothstep(time,0,.22);
    angle=maxAngle*smoothstep(time,.14,.88);
    lid.rotation.x=-angle;
    latch.rotation.x=-1.52*unlatch;
    contents.visible=angle>.019;
  }
  function lidVolume(sweep=false) {
    const tilt=sweep ? maxAngle : angle;
    const tip=(lidDepth+.006)*Math.cos(tilt);
    const near=lidBack+Math.min(0,tip)-.026, far=lidBack+(sweep ? lidDepth+.020 : Math.max(0,tip)+.024);
    return {halfX:sideX+.007,halfZ:(far-near)*.5,z:(near+far)*.5,bottom:shoulder-.026,
      top:shoulder+(sweep ? lidDepth+.050 : (lidDepth+.006)*Math.sin(tilt)+.04)};
  }
  animate(0,false);
  return {mesh:chest,animate,lidVolume,get closed() { return time===0; },get raised() { return angle>.025; },
    inspect:()=>({angle,unlatch,visible:contents.visible})};
}
