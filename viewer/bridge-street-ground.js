import * as THREE from "three";
import { canalDepth, waterHeight } from "./bridge-canal-bed.js";

// Shallow stonework set into the dirt at the market and bridge approaches.
const lanes=[
  {x:25.06,z:-26.6,angle:.08,length:15.8,width:2.12,seed:245},
  {x:30.0,z:-28.5,angle:1.44,length:7.8,width:1.46,seed:703},
  {x:-71.8,z:-44.23,angle:1.53,length:7.2,width:1.13,seed:134},
  {x:-42.86,z:-39.12,angle:1.61,length:8.55,width:1.36,seed:428},
];

function paving(lane,origin,material) {
  let seed=lane.seed;
  const random=()=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  };
  const position=[],uv=[],color=[],indices=[];
  const pigment=new THREE.Color();
  const palette=[0xc4b798,0xc3b899,0xbab19a,0xd0c3a7,0xadad99,0xb4a58a];
  const c=Math.cos(lane.angle),s=Math.sin(lane.angle);
  const point=(u,v)=>[lane.x+c*u+s*v,lane.z-s*u+c*v];

  function stone(u,v,width,length,height,gravel=false) {
    const [x,z]=point(u,v);
    if(canalDepth(origin,x,z)>waterHeight+.015) return;
    const cut=.07+random()*.10;
    const rim=[[-.5+cut,-.5],[.5-cut,-.5],[.5,-.5+cut],[.5,.5-cut],
      [.5-cut,.5],[-.5+cut,.5],[-.5,.5-cut],[-.5,-.5+cut]]
      .map(([u,v])=>[(u+(random()-.5)*.09)*width,(v+(random()-.5)*.12)*length]);
    pigment.setHex(palette[Math.floor(random()*palette.length)]);
    const tiltU=(random()-.5)*.016,tiltV=(random()-.5)*.014;
    const offset=position.length/3;
    const mapU=random(),mapV=random();
    function vertex(du,dv,y,shade) {
      const [px,pz]=point(u+du,v+dv);
      position.push(px,y,pz);
      color.push(pigment.r*shade,pigment.g*shade,pigment.b*shade);
      uv.push(mapU+du/1.25,mapV+dv/1.25);
    }
    for(const [du,dv] of rim) vertex(du,dv,-.009,.60);
    const inset=gravel ? .61 : .94;
    for(const [du,dv] of rim) {
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV,.83+random()*.16);
    }
    vertex(0,0,height+(gravel ? .003 : .001),1.03);
    for(let i=0;i<8;i++) {
      const a=offset+i,b=offset+(i+1)%8;
      indices.push(a,a+8,b,b,a+8,b+8,offset+16,b+8,a+8);
    }
  }

  for(let row=-lane.width*.5;row<lane.width*.5-.19;) {
    const width=Math.min(.35+random()*.18,lane.width*.5-row);
    for(let column=-lane.length*.5+random()*.65;column<lane.length*.5-.24;) {
      const length=Math.min(.37+random()*.33,lane.length*.5-column);
      const v=column+length*.5;
      const u=row+width*.5+Math.sin(v*.58)*.23;
      const exposedEdge=Math.abs(row+width*.5)>.29*lane.width;
      const fadingEnd=Math.abs(v)>.39*lane.length;
      const chance=exposedEdge && fadingEnd ? .38 : exposedEdge || fadingEnd ? .76 : .97;
      if(random()<chance) stone(u,v,width-.019,length-.021,.011+random()*.008);
      column+=length;
    }
    row+=width;
  }
  for(let i=0;i<lane.length*15;i++) {
    const v=(random()-.5)*lane.length*1.11;
    const edge=(lane.width*.5+random()**2*.81)*(random()<.5 ? -1 : 1);
    const size=.018+random()**2*.069;
    stone(edge+Math.sin(v*.58)*.23,v,size,size*(.67+random()*.63),size*.20,true);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(color,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name="Inset street paving and gravel";
  mesh.receiveShadow=true;
  return mesh;
}

export function buildStreetGround(root,origin,surface) {
  const stone=surface("worn-stone",0xfaf5ec,.79,.97);
  stone.vertexColors=true;
  for(const lane of lanes) root.add(paving(lane,origin,stone));
}
