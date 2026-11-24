import * as THREE from "three";
import { bladeGeometry, lightLeaf } from "./bridge-leaf-light.js";
import { airUniforms, registerWindCanopy } from "./bridge-air.js";
import { bindCanopyWind } from "./bridge-wind.js";

function randomFor(id) {
  let state=(Number(id.slice(1))||15)*299993;
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
}

export function buildStreetTrees(root,entries,surface,solids,center) {
  const bark=surface("willow-bark",0xb8a689,.84,.97);
  const leaf=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.77,side:THREE.DoubleSide});
  const depthWood=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  const depthLeaf=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  const woodWind={instanced:true,flexibility:.85};
  const leavesWind={...woodWind,blade:true};
  for(const material of [bark,depthWood]) bindCanopyWind(material,woodWind);
  for(const material of [leaf,depthLeaf]) bindCanopyWind(material,leavesWind);
  lightLeaf(leaf,.49);
  const leafGeometry=bladeGeometry(.252,4);
  const branchGeometry=new THREE.CylinderGeometry(.44,1,1,7);
  const groups=new Map();
  const pose=new THREE.Object3D(), direction=new THREE.Vector3(), up=new THREE.Vector3(0,1,0);
  const aim=new THREE.Vector3(), side=new THREE.Vector3();
  const hues=[0x647353,0x78805c,0x8b8c61,0x544f39,0x818665,0xa49a64].map(c=>new THREE.Color(c));
  const rainCrowns=[];
  let leavesTotal=0, branchesTotal=0;

  for(const o of entries){
    const rng=randomFor(o.id);
    const h=THREE.MathUtils.clamp(o.h,2.7,8.5);
    const nearBridge=Math.hypot(o.x-center.x,o.z-center.z)<32;
    const blades=nearBridge ? 14 : 9;
    const radius=THREE.MathUtils.clamp(o.w,.95,5.35)*.37;
    const trunk=Math.max(.105,.10*radius);
    const ground=o.y||0;
    registerWindCanopy({x:o.x,z:o.z,radius:radius*1.13,bottom:ground+h*.49,
      top:ground+h,density:.57,name:o.id});
    const base=new THREE.Vector3(o.x,ground,o.z);
    const windRoot=new THREE.Vector4(o.x,ground,o.z,h);
    const weatherLeaves=[];
    const key=Math.floor(o.x/20)+":"+Math.floor(o.z/18);
    if(!groups.has(key)) groups.set(key,{wood:[],woodRoots:[],leaves:[],leafRoots:[],colors:[]});
    const records=groups.get(key);
    const point=(x,y,z)=>new THREE.Vector3(o.x+x,ground+y,o.z+z);
    function branch(a,b,r){
      pose.position.copy(a).lerp(b,.5);
      direction.subVectors(b,a);
      const length=direction.length();
      pose.quaternion.setFromUnitVectors(up,direction.multiplyScalar(1/length));
      pose.scale.set(r,length,r);
      pose.updateMatrix();
      records.wood.push(pose.matrix.clone());
      records.woodRoots.push(windRoot);
      branchesTotal++;
    }
    const yaw=rng()*2*Math.PI, swayX=.34*Math.cos(yaw), swayZ=.34*Math.sin(yaw);
    const trunk1=point(swayX*.35,h*.32,swayZ*.35);
    const trunk2=point(swayX*.71,h*.63,swayZ*.71);
    const trunk3=point(swayX,h*.92,swayZ);
    branch(base,trunk1,trunk);
    branch(trunk1,trunk2,trunk*.69);
    branch(trunk2,trunk3,trunk*.43);
    const limbs=12;
    for(let arm=0;arm<limbs;arm++){
      const bearing=yaw+arm*2.399963+rng()*.33;
      const reach=radius*(.46+.60*rng());
      const top=point(Math.cos(bearing)*reach+swayX*.8,h*(.65+.30*rng()),
        Math.sin(bearing)*reach+swayZ*.6);
      const from=trunk1.clone().lerp(trunk2,.22+.76*rng());
      const elbow=from.clone().lerp(top,.54).add(new THREE.Vector3(0,h*.072,0));
      branch(from,elbow,trunk*(.20+.16*rng()));
      branch(elbow,top,trunk*.15);
      for(let cluster=0;cluster<5;cluster++){
        const t=.30+cluster*.158;
        const spread=radius*(.22+.32*rng());
        const phi=bearing+cluster*1.84;
        const twigStart=elbow.clone().lerp(top,t);
        const tip=twigStart.clone().add(new THREE.Vector3(Math.cos(phi)*spread,
          (.055+.072*rng())*h,Math.sin(phi)*spread));
        branch(twigStart,tip,Math.max(.006,trunk*.064));
        const shoots=[{base:twigStart,tip,bearing:phi}];
        for(const [index,sign] of [-1,1].entries()) {
          const node=twigStart.clone().lerp(tip,.36+.29*index);
          const bearing=phi+sign*(.89+.38*rng());
          const span=(.14+.25*rng())*(.79+.14*radius);
          const end=node.clone().add(new THREE.Vector3(Math.cos(bearing)*span,(rng()-.41)*.20,Math.sin(bearing)*span));
          branch(node,end,Math.max(.0038,trunk*.044));
          shoots.push({base:node,tip:end,bearing});
        }
        for(let k=0;k<blades;k++){
          const twig=shoots[k%shoots.length];
          const along=.15+.84*(Math.floor(k/shoots.length)+.45*rng())/Math.ceil(blades/shoots.length);
          pose.position.copy(twig.base).lerp(twig.tip,along);
          const spin=twig.bearing+(k%2===0 ? -1 : 1)*(1.13+.63*rng());
          side.set(Math.cos(spin),0,Math.sin(spin));
          aim.copy(side).setY(.35-rng()*.94).normalize();
          pose.quaternion.setFromUnitVectors(up,aim);
          pose.rotateY(rng()*6.283);
          const size=(.210+.196*rng())*(.86+.21*radius)*(.97-.20*along);
          pose.scale.set(size*(.84+.24*rng()),size,size);
          pose.updateMatrix();
          records.leaves.push(pose.matrix.clone());
          if((cluster+arm)%2===0 && (k===0 || k===3)) weatherLeaves.push(records.leaves.at(-1));
          records.leafRoots.push(windRoot);
          records.colors.push(hues[(Math.floor(rng()*hues.length)+arm)%hues.length]);
          leavesTotal++;
        }
      }
    }
    solids.cylinder("tree",o.x,o.z,ground,ground+h*.72,trunk);
    rainCrowns.push({x:o.x,z:o.z,windRoot,transforms:weatherLeaves,
      label:o.id,wet:{value:0},caught:0,runoff:0});
  }

  function instances(geometry,material,transforms,roots,depth,name,colors) {
    const drawGeometry=geometry.clone();
    const packed=new Float32Array(roots.length*4);
    for(const [i,root] of roots.entries()) root.toArray(packed,i*4);
    drawGeometry.setAttribute("windRoot",new THREE.InstancedBufferAttribute(packed,4));
    const mesh=new THREE.InstancedMesh(drawGeometry,material,transforms.length);
    mesh.name=name;
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    mesh.customDepthMaterial=depth;
    for(let i=0;i<transforms.length;i++){
      mesh.setMatrixAt(i,transforms[i]);
      if(colors) mesh.setColorAt(i,colors[i]);
    }
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius+=1.92;
    root.add(mesh);
  }
  for(const {wood,woodRoots,leaves,leafRoots,colors} of groups.values()){
    instances(branchGeometry,bark,wood,woodRoots,depthWood,"Street trunks and branching twigs");
    instances(leafGeometry,leaf,leaves,leafRoots,depthLeaf,"Street crown individual blades",colors);
  }
  return {rainCrowns,rainMaterial:leaf,inspect:()=>({leaves:leavesTotal,branches:branchesTotal,treeCount:entries.length,
    windTime:airUniforms.windTime.value})};
}
