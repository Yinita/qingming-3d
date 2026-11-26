import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { buildFieldShed } from "./bridge-field-shed.js";
import { channelFade,channelX,drainage,fieldBounds,fieldBridges,fieldOpening,fieldPlots,fieldRoadZ,fieldShed } from "./bridge-field-layout.js";

const {lerp,smoothstep}=THREE.MathUtils;
const tau=Math.PI*2;

function seeded(seed) {
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  };
}

function drawChannel(parent,height) {
  const positions=[],uv=[],index=[];
  const segments=Math.ceil((drainage.north-drainage.south)/.14);
  for(let i=0;i<=segments;i++) {
    const t=i/segments,z=lerp(drainage.south,drainage.north,t);
    const middle=channelX(z), strength=channelFade(z);
    const y=height(middle,z)+.116*strength;
    for(let s=0;s<5;s++) {
      const u=s/2-1;
      const edge=.449*strength;
      positions.push(middle+u*edge,y-.0025*u*u,z);
      uv.push((u+1)*.5,z);
      if(i && s) {
        const k=i*5+s;
        index.push(k-6,k-1,k-5,k-5,k-1,k);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(index);geometry.computeVertexNormals();
  const clock={value:0};
  const water=new THREE.MeshStandardMaterial({color:0x838b67,roughness:.24,metalness:.12,
    transparent:true,opacity:.82,depthWrite:false,side:THREE.DoubleSide});
  water.customProgramCacheKey=()=>"narrow-west-drainage-water";
  water.onBeforeCompile=shader=>{
    shader.uniforms.ditchTime=clock;
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec2 ditchUV;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nditchUV=uv;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>",
      "#include <common>\nvarying vec2 ditchUV; uniform float ditchTime;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float u=ditchUV.x-.5, v=ditchUV.y;
        float across=sin(v*12.8+u*3.7+ditchTime*1.31+.38*sin(v*2.2));
        float longWave=sin(39.*v-9.2*u+ditchTime*2.3);
        float edge=smoothstep(.28,.51,abs(u));
        float glint=pow(max(0.,.52+.34*across+.16*longWave),4.);
        diffuseColor.rgb=mix(diffuseColor.rgb*vec3(.78,.78,.69),vec3(.103,.119,.101),edge*.78);
        diffuseColor.rgb+=vec3(.081,.088,.072)*glint*(1.-edge);
        diffuseColor.a*=1.-edge*.26;
      `)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        normal=normalize(normal+mat3(viewMatrix)*vec3(.051*across,0.,.041*longWave));
      `);
  };
  const channel=new THREE.Mesh(geometry,water);
  channel.name="West bank drainage water";channel.receiveShadow=true;parent.add(channel);
  return seconds=>{clock.value=seconds;};
}

function plantedFields(parent,height) {
  const rng=seeded(96721), stemRows=[],leafRows=[],heads=[];
  const grassGeometry=new THREE.BufferGeometry();
  grassGeometry.setAttribute("position",new THREE.Float32BufferAttribute([
    -.009,0,0,.012,0,0,-.025,.36,-.045,.027,.34,-.059,-.014,.76,-.33,.013,.70,-.36,0,.94,-.60,
  ],3));
  grassGeometry.setIndex([0,2,1,1,2,3,2,4,3,3,4,5,4,6,5]);grassGeometry.computeVertexNormals();
  for(const plot of fieldPlots) {
    const random=seeded(plot.seed);
    const straw=plot.type==="stubble";
    for(let x=Math.ceil((plot.x-plot.halfX+.16)/plot.row)*plot.row;x<plot.x+plot.halfX-.12;x+=plot.row)
      for(let z=plot.z-plot.halfZ+.21;z<plot.z+plot.halfZ-.14;z+=.30+.16*random()) {
        const px=x-.029+.069*random(),pz=z-.068+.127*random();
        if(Math.abs(pz-fieldRoadZ(px))<1.24 || Math.abs(px-channelX(pz))<.92 || random()<.085) continue;
        if(plot.type==="grass" && Math.sin(px*2+pz*1.39)<-.53) continue;
        const kind=plot.type==="millet" ? 0 : plot.type==="buckwheat" ? 1 : straw ? 2 : 3;
        const size=(straw ? .10 : [.44,.27,.1,.26][kind])*(.82+.55*random());
        const at=height(px,pz)+.004,yaw=random()*tau;
        const tints=[0x7d8357,0x80935f,0xaa9461,0x87905a,0x788a67];
        stemRows.push([px,at+size*.50,pz,yaw,.83+.33*random(),size,tints[kind]]);
        for(let i=0;i<(straw ? 1 : kind===3 ? 3 : 2);i++)
          leafRows.push([px,at+(i%2)*size*.29,pz,yaw+1.92*i,size*(.73+.23*random()),size,tints[(kind+i)%tints.length]]);
        if(kind<2 && random()>.12)
          heads.push([px+.012,at+size*.93,pz,yaw,.68+.39*random(),size,kind===0 ? 0xb3a16a : 0xc4bc94]);
      }
  }
  for(let z=drainage.south+.25;z<drainage.north-.16;z+=.13+.27*rng()) {
    if(fieldBridges.some(b=>Math.abs(z-b.z)<b.width*.5+.26)) continue;
    const middle=channelX(z);
    for(const side of [-1,1]) {
      if(rng()<.16) continue;
      const x=middle+side*(.56+.22*rng());
      for(let blade=0;blade<4;blade++) {
        const px=x+(rng()-.5)*.17, pz=z+(rng()-.5)*.20;
        const size=.18+.32*rng();
        leafRows.push([px,height(px,pz)+.004,pz,rng()*tau,size,size,blade%3 ? 0x818c60 : 0xaa9c65]);
      }
    }
  }
  // Irregular edges and west-facing slope stay broken up at street height.
  for(let i=0;i<280;i++) {
    const x=lerp(fieldBounds.west+.16,fieldBounds.east-.31,rng()),z=lerp(fieldBounds.south+.15,fieldBounds.north-.14,rng());
    if(Math.abs(z-fieldRoadZ(x))<1.25 || Math.abs(x-channelX(z))<.60 ||
      fieldPlots.some(p=>Math.abs(x-p.x)<p.halfX && Math.abs(z-p.z)<p.halfZ) ||
      x<-100.6 && z>-34.50 && z<-28.88) continue;
    const size=.088+.15*rng()**1.4;
    leafRows.push([x,height(x,z),z,rng()*tau,size,size,rng()<.28 ? 0xa2986b : 0x83845c]);
  }
  const pose=new THREE.Object3D(), pigment=new THREE.Color();
  const plants=new THREE.MeshStandardMaterial({color:0xffffff,side:THREE.DoubleSide,roughness:.92});
  const seedMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.86});
  function batch(shape,rows,material,name,defaultScale) {
    const mesh=new THREE.InstancedMesh(shape,material,rows.length);
    mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;
    rows.forEach(([x,y,z,yaw,scale,h,tone],i)=>{
      pose.position.set(x,y,z);pose.rotation.set(0,yaw,0);
      pose.scale.set(...defaultScale.map((n,k)=>n*(k===1 ? h : scale)));
      pose.updateMatrix();mesh.setMatrixAt(i,pose.matrix);mesh.setColorAt(i,pigment.setHex(tone));
    });
    mesh.computeBoundingSphere();parent.add(mesh);
  }
  batch(new THREE.CylinderGeometry(.005,.008,1,5),stemRows,seedMaterial,"Millet and buckwheat stems", [1,1,1]);
  batch(grassGeometry,leafRows,plants,"Curved millet and bank sedge blades",[1,1,1]);
  batch(new THREE.IcosahedronGeometry(1,1),heads,seedMaterial,"Millet heads and buckwheat blossom clusters",[.029,.158,.039]);
}

export function buildWestFields(parent,city,surface,height) {
  const root=new THREE.Group();
  root.name="West bank farm lanes and drainage";
  parent.add(root);
  const elm=surface("rail-wood",0xb19a79,.89,.89);
  const planks=surface("tea-wood",0xac8b63,.78,.91);
  const stone=surface("worn-stone",0xb9ae96,.94,.91);
  const straw=surface("rough-linen",0xb8a273,.51,.98);
  const knot=new THREE.MeshStandardMaterial({color:0x675f4d,roughness:.95});
  const parts=new Map();
  const random=seeded(32166);
  function add(mat,geo) {
    if(!parts.has(mat)) parts.set(mat,[]);
    parts.get(mat).push(geo);
  }
  function block(mat,w,h,d,x,y,z,bevel=.015,rotateY=0,rotateZ=0) {
    const geo=detailedBox(w,h,d,mat,bevel,random()*12);
    if(rotateZ) geo.rotateZ(rotateZ);
    if(rotateY) geo.rotateY(rotateY);
    add(mat,geo.translate(x,y,z));
  }
  const time=drawChannel(root,height);
  for(const spec of fieldBridges) {
    const {x,z,width,length,stone:flag}=spec;
    const half=length*.5;
    const low=height(x-half,z)+.038,high=height(x+half,z)+.038;
    const slope=(high-low)/length;
    const surfaceAt=px=>low+(px-x+half)*slope;
    const rot=Math.atan(slope);
    const pieces=flag ? 5 : 15;
    for(let i=0;i<pieces;i++) {
      const step=length/pieces,xx=x-half+(i+.5)*step,hh=flag ? .166 : .081;
      block(flag ? stone : planks,step-(flag ? .009 : .006),hh,width+.023*random()-.014,
        xx,surfaceAt(xx)-hh*.5,z+(random()-.5)*.014,flag ? .024 : .011,0,rot);
      if(!flag && i%2===1) for(const side of [-1,1])
        add(knot,new THREE.CylinderGeometry(.006,.008,.008,6).translate(xx,surfaceAt(xx)+.003,z+side*width*.41));
    }
    const support=[x-half,low,z-width*.5,x+half,high,z-width*.5,
      x-half,low,z+width*.5,x+half,high,z+width*.5];
    const register=flag ? height.registerPavedSurface : height.addRootSurface;
    register(support,0,3,6);
    register(support,3,9,6);
    for(const side of [-1,1]) {
      const zz=z+side*(width*.5+.012);
      block(flag ? stone : elm,length-.043,flag ? .13 : .17,.135,x,surfaceAt(x)-.158,zz,.016,0,rot);
      for(const end of [-.91,.91]) {
        const xx=x+end, foot=height(xx,zz);
        block(stone,.30,Math.max(.08,surfaceAt(xx)-foot+.154),.29,xx,(surfaceAt(xx)+foot-.11)*.5,zz,.039);
        if(!flag) block(elm,.086,.724,.099,xx,surfaceAt(xx)+.363,zz,.014,side*.020);
      }
      if(!flag) {
        block(elm,length-.48,.077,.099,x,surfaceAt(x)+.629,zz,.014,0,rot);
        city.box("Wooden field footbridge rail",x-half+.19,x+half-.19,zz-.052,zz+.052,
          Math.min(low,high)-.05,Math.max(low,high)+.74);
      }
    }
    if(flag) for(const side of [-1,1]) for(const end of [-.74,.74]) {
      const xx=x+end,zz=z+side*(width*.5+.09);
      block(stone,.29,.225,.21,xx,surfaceAt(xx)+.047,zz,.039,random()*.41);
      city.box("Stone crossing edge",xx-.145,xx+.145,zz-.105,zz+.105,surfaceAt(xx)-.06,surfaceAt(xx)+.18);
    }
  }
  // Irregular stones reinforce the banks where cart wheels leave the planks.
  for(let z=drainage.south+.28;z<drainage.north-.19;z+=.20+.36*random()) {
    if(random()<.22 || fieldBridges.some(b=>Math.abs(z-b.z)<b.width*.5+.21)) continue;
    for(const side of [-1,1]) {
      const px=channelX(z)+side*(.51+.23*random());
      const hh=.08+.09*random(), w=.14+.15*random(),d=.12+.19*random();
      block(stone,w,hh,d,px,height(px,z)+hh*.16,z,.035,random()*tau);
    }
  }
  // The outer retaining wall gives the last terrace a visible, solid edge.
  const wallX=fieldBounds.west+.21,from=-41.78,to=-24.62;
  for(let z=from;z<to;z+=.53) {
    const x=wallX+.063*Math.sin(z*.8), y=height(x,z);
    for(let level=0;level<2;level++)
      block(stone,.34+random()*.083,.141+.038*random(),.52-.052*random(),x+(random()-.5)*.032,
        y+.088+level*.134,z+(level ? .21 : 0),.037,(random()-.5)*.24);
    city.box("Fieldstone terrace wall",x-.19,x+.19,z-.264,z+.269,y-.08,y+.269);
  }
  for(const side of [-1,1]) {
    const px=fieldOpening.x-.31,pz=fieldOpening.z+side*(fieldOpening.width*.5-.027);
    block(stone,.271,.118,.261,px,height(px,pz)+.027,pz,.034);
    block(elm,.112,.729,.126,px,height(px,pz)+.394,pz,.022,-side*.12);
    city.cylinder("Field path post",px,pz,height(px,pz),height(px,pz)+.76,.073);
  }
  // A line of rounded verge stones makes the bend to the grain store legible.
  for(let i=0;i<17;i++) {
    const x=-106.95+i*.382,z=-33.72+.092*Math.sin(i*.55);
    if(Math.abs(x-fieldShed.x)<1.84) continue;
    block(stone,.18+random()*.06,.059+random()*.05,.125+random()*.054,x,height(x,z)+.021,z,.020,random()*.44);
  }
  for(const [x,z,size] of [[-94.04,-39.05,.82],[-95.42,-40.02,.72],[-100.31,-39.76,.76]]) {
    const y=height(x,z), axis=new THREE.Vector3(0,1,0);
    const pose=new THREE.Quaternion(),direction=new THREE.Vector3();
    add(straw,new THREE.CylinderGeometry(.069,.232,.59,17).scale(1,size,1).translate(x,y+.295*size,z));
    for(let i=0;i<22;i++) {
      const a=i*tau/22,bottom=.211+.031*random(),top=.043+.034*random();
      const dx=Math.cos(a)*(top-bottom),dz=Math.sin(a)*(top-bottom),dy=size*(.56+.075*random());
      pose.setFromUnitVectors(axis,direction.set(dx,dy,dz).normalize());
      add(straw,new THREE.CylinderGeometry(.007,.012,Math.hypot(dx,dy,dz),5)
        .applyQuaternion(pose).translate(x+Math.cos(a)*bottom+dx*.5,y+dy*.5,z+Math.sin(a)*bottom+dz*.5));
    }
    add(knot,new THREE.TorusGeometry(.081,.006,5,20).rotateX(-Math.PI/2).translate(x,y+.532*size,z));
    city.cylinder("Bound straw sheaf",x,z,y,y+.70*size,.236);
  }
  for(const [material,geometries] of parts) {
    const shape=mergeGeometries(geometries);
    for(const geometry of geometries) geometry.dispose();
    const mesh=new THREE.Mesh(shape,material);
    mesh.name="Field crossings, terraces and ditch edging";
    mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
  }
  plantedFields(root,height);
  const shed=buildFieldShed(root,city,surface,height);
  return {shed,flow:time,inspect:()=>({bounds:{...fieldBounds},bridges:fieldBridges.map(b=>({...b})),shed:shed.inspect()})};
}
