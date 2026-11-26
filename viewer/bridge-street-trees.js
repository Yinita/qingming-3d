import * as THREE from "three";
import { leafFlexGLSL, bladeGeometry, lightLeaf } from "./bridge-leaf-light.js";

const {clamp,lerp,smoothstep}=THREE.MathUtils;
const up=new THREE.Vector3(0,1,0);
const tau=Math.PI*2;
const crownTypes=[
  {name:"spreading",limbs:14,reach:1.09,tip:[.58,.90],spread:1.14,width:1.12,density:48},
  {name:"upright",limbs:12,reach:.84,tip:[.56,1.02],spread:.87,width:.78,density:42},
  {name:"open",limbs:11,reach:1.04,tip:[.54,.94],spread:1.03,width:.96,density:39},
];
const pigments=[0x666c44,0x7f8453,0x8d9059,0x4e5d41,0x747d51,0xa19a61].map(c=>new THREE.Color(c));

function randomFor(id) {
  let state=(Number(id.slice(1))||15)*299993;
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
}

function lightBreeze(clock) {
  return (material,{instanced=false,blade=false,flexibility=1}={})=>{
    const previous=material.onBeforeCompile, key=material.customProgramCacheKey();
    material.onBeforeCompile=shader=>{
      previous.call(material,shader);
      shader.uniforms.streetTreeTime=clock;
      shader.uniforms.streetTreeFlex={value:flexibility};
      shader.vertexShader=shader.vertexShader.replace("#include <common>",`#include <common>
        uniform float streetTreeTime, streetTreeFlex;
        attribute vec4 windRoot;
        ${blade ? leafFlexGLSL : ""}
        vec3 treeWind(vec3 anchor) {
          float t=streetTreeTime;
          float phase=dot(windRoot.xz,vec2(.109,.079));
          float rise=clamp((anchor.y-windRoot.y)/windRoot.w,0.,1.2);
          float gust=.51+.28*sin(t*.74-phase)+.14*sin(t*1.61-phase*1.26);
          vec2 bend=windRoot.w*.022*streetTreeFlex*rise*rise*
            vec2(gust,.63*gust+.19*sin(t*1.27+phase));
          return vec3(bend.x,-dot(bend,bend)*.39/max(.36,anchor.y-windRoot.y),bend.y);
        }`).replace("#include <begin_vertex>",`#include <begin_vertex>
        vec3 point=${blade ? "instanceMatrix[3].xyz" : instanced ? "(instanceMatrix*vec4(position,1.)).xyz" : "position"};
        vec3 bend=treeWind(point);
        ${instanced ? `mat3 axes=mat3(instanceMatrix);
          vec3 square=vec3(dot(axes[0],axes[0]),dot(axes[1],axes[1]),dot(axes[2],axes[2]));
          transformed+=vec3(dot(axes[0],bend),dot(axes[1],bend),dot(axes[2],bend))/square;` : "transformed+=bend;"}
        ${blade ? `float phase=streetTreeTime*4.6+dot(point,vec3(1.7,3.2,.78));
          vec3 flutter=.18*vec3(sin(phase),.68*cos(phase*1.13),.43*sin(phase*.81));
          transformed+=bladeBend(position,position.y,flutter);` : ""}`);
    };
    material.customProgramCacheKey=()=>key+`-street-breeze-${instanced}-${blade}-${flexibility}`;
  };
}

function tube(data,curve,base,tip,windRoot,seed,{rings=18,sides=10,flare=0}={}) {
  const frames=curve.computeFrenetFrames(rings,false);
  const length=curve.getLength(), unit=1.7, start=data.position.length/3;
  const stride=sides+1;
  const n=new THREE.Vector3(), point=new THREE.Vector3();
  for(let row=0;row<=rings;row++) {
    const t=row/rings;
    const foot=flare*Math.exp(-t*17);
    const ridge=.026*Math.sin(t*18+seed)+.023*Math.sin(t*53+seed*.6);
    const center=curve.getPointAt(t);
    for(let col=0;col<=sides;col++) {
      const angle=col/sides*tau;
      const ridges=.081*Math.sin(angle*5+t*1.74+seed)+.033*Math.sin(angle*11-t*6.1+seed);
      const edge=ridges+foot*(.51+.48*Math.cos(angle*5+seed)**2);
      const radius=lerp(base,tip,t**.87)*(1+edge+ridge);
      n.copy(frames.normals[row]).multiplyScalar(Math.cos(angle))
        .addScaledVector(frames.binormals[row],Math.sin(angle));
      point.copy(center).addScaledVector(n,radius);
      data.position.push(point.x,point.y,point.z);
      data.uv.push(col/sides*tau*base/unit,t*length/unit);
      data.roots.push(windRoot.x,windRoot.y,windRoot.z,windRoot.w);
      const contact=(1-smoothstep(point.y-windRoot.y,.04,.74));
      const moss=contact*(.08+.07*(.5+.5*Math.sin(angle*5.2)*Math.sin(t*49.6)));
      const pigment=.91+.055*Math.sin(angle*3+seed)+.037*Math.cos(angle*7-t*12+seed);
      data.colors.push(pigment-moss*.92,pigment-moss*.54,pigment-moss*1.36);
      if(row<rings && col<sides) {
        const a=start+row*stride+col,b=a+stride;
        data.index.push(a,a+1,b,a+1,b+1,b);
      }
    }
  }
  // Match the bark normals across the texture's duplicated seam.
  data.seams.push({start,rings,stride});
}

function woodMesh(data,material,depth) {
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(data.position,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(data.uv,2));
  g.setAttribute("windRoot",new THREE.Float32BufferAttribute(data.roots,4));
  g.setAttribute("color",new THREE.Float32BufferAttribute(data.colors,3));
  g.setIndex(data.index);
  g.computeVertexNormals();
  const normal=g.attributes.normal, blend=new THREE.Vector3(), other=new THREE.Vector3();
  for(const {start,rings,stride} of data.seams) for(let row=0;row<=rings;row++) {
    const a=start+row*stride,b=a+stride-1;
    blend.fromBufferAttribute(normal,a).add(other.fromBufferAttribute(normal,b)).normalize();
    normal.setXYZ(a,blend.x,blend.y,blend.z);
    normal.setXYZ(b,blend.x,blend.y,blend.z);
  }
  g.computeBoundingSphere();
  g.boundingSphere.radius+=1.65;
  const mesh=new THREE.Mesh(g,material);
  mesh.name="Curved street trunks, boughs and roots";
  mesh.castShadow=mesh.receiveShadow=true;
  mesh.customDepthMaterial=depth;
  return mesh;
}

function scatter(group,geometry,material,transforms,roots,depth,name,colors) {
  const g=geometry.clone();
  if(roots) {
    const packed=new Float32Array(roots.length*4);
    roots.forEach((v,i)=>v.toArray(packed,i*4));
    g.setAttribute("windRoot",new THREE.InstancedBufferAttribute(packed,4));
  }
  const mesh=new THREE.InstancedMesh(g,material,transforms.length);
  mesh.name=name;
  mesh.castShadow=Boolean(depth);
  mesh.receiveShadow=true;
  mesh.customDepthMaterial=depth;
  transforms.forEach((matrix,i)=>{
    mesh.setMatrixAt(i,matrix);
    if(colors) mesh.setColorAt(i,colors[i]);
  });
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius+=1.65;
  group.add(mesh);
  return mesh;
}

export function buildStreetTrees(root,entries,surface,solids,center,options={}) {
  const {groundAt=()=>0,registerCanopy,sharedTime,registerRoot}=options;
  const clock={value:0};
  const bindWind=options.bindWind??lightBreeze(clock);
  const bark=surface("willow-bark",0xc0ac8c,1.11,.96);
  bark.vertexColors=true;
  const twig=new THREE.MeshStandardMaterial({color:0x584a33,roughness:.97});
  const leaf=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.79,side:THREE.DoubleSide});
  const litterColor=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.96,side:THREE.DoubleSide});
  const depth=()=>new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  const barkDepth=depth(), twigDepth=depth(), leafDepth=depth();
  for(const material of [bark,barkDepth]) bindWind(material,{flexibility:.85});
  for(const material of [twig,twigDepth]) bindWind(material,{instanced:true,flexibility:.85});
  for(const material of [leaf,leafDepth]) bindWind(material,{instanced:true,flexibility:.85,blade:true});
  lightLeaf(leaf,.54);
  const leafShape=bladeGeometry(.247,4), farShape=bladeGeometry(.251,2,1);
  const twigShape=new THREE.CylinderGeometry(.44,1,1,6);
  const chunks=new Map(), bands=[], rainCrowns=[], trees=[];
  const pose=new THREE.Object3D(), direction=new THREE.Vector3(), aim=new THREE.Vector3();
  const sizeUp=new THREE.Vector3(1.65,1.51,1.35), eye=new THREE.Vector3();
  const litterTone=new THREE.Color();
  let leavesTotal=0, farTotal=0, branchesTotal=0, barkVertices=0, litterTotal=0;

  for(const o of entries) {
    const rng=randomFor(o.id), h=clamp(o.h*.91,2.7,10.65);
    const detail=o.detail??1;
    const ratio=o.w/o.h;
    const form=crownTypes[ratio<.65 ? 1 : ratio>.96 || rng()>.68 ? 0 : 2];
    const nearCenter=Math.hypot(o.x-center.x,o.z-center.z)<36;
    const radius=clamp(o.w*.37,.80,3.68);
    const trunk=Math.max(.107,radius*(form.name==="upright" ? .093 : .107));
    const y=Math.max(o.y||0,groundAt(o.x,o.z));
    const base=new THREE.Vector3(o.x,y,o.z), windRoot=new THREE.Vector4(o.x,y,o.z,h);
    const key=Math.floor(o.x/19)+":"+Math.floor(o.z/17);
    if(!chunks.has(key)) chunks.set(key,{
      bark:{position:[],uv:[],roots:[],colors:[],index:[],seams:[]},
      fine:[],fineRoots:[],leaves:[],leafRoots:[],colors:[],far:[],farRoots:[],farColors:[],
      litter:[],litterColors:[],bounds:new THREE.Box3(),
    });
    const data=chunks.get(key);
    const point=(x,level,z)=>new THREE.Vector3(o.x+x,y+level,o.z+z);
    const curve=(...pts)=>new THREE.CatmullRomCurve3(pts,false,"centripetal");
    const yaw=rng()*tau, sway=clamp(h*.08,.17,.64)*(.62+.53*rng());
    const leanX=sway*Math.cos(yaw), leanZ=sway*Math.sin(yaw);
    const firstFork=point(leanX*.18,h*.37,leanZ*.30);
    const trunk2=point(leanX*.64,h*.63,leanZ*.68);
    const bole=curve(point(0,-.14,0),point(leanX*.058,h*.17,leanZ*.09),firstFork,trunk2,
      point(leanX,h*.96,leanZ));
    tube(data.bark,bole,trunk,.012,windRoot,yaw,{rings:nearCenter ? 26 : 18,sides:nearCenter ? 14 : 11,flare:.43});
    branchesTotal++;
    data.bounds.expandByPoint(base);
    const grounds=[];
    const rootStart=data.bark.index.length;
    for(let i=0;i<5;i++) {
      const a=yaw+i*tau/5+(rng()-.5)*.33;
      const distance=trunk*(1.75+1.51*rng()), dx=Math.cos(a)*distance,dz=Math.sin(a)*distance;
      const end=point(dx,-.018,dz);
      end.y=groundAt(end.x,end.z)-.035;
      const middle=point(dx*.51,trunk*.34,dz*.51);
      middle.y=Math.max(middle.y,groundAt(middle.x,middle.z)+trunk*.19);
      const rootCurve=curve(point(dx*.09,trunk*.48,dz*.09),middle,end);
      tube(data.bark,rootCurve,trunk*(.33+.19*rng()),.007,windRoot,a,{rings:8,sides:7});
      branchesTotal++;
      grounds.push(a);
    }
    if(registerRoot) {
      const {position,index}=data.bark;
      for(let i=rootStart;i<index.length;i+=3)
        registerRoot(position,index[i]*3,index[i+1]*3,index[i+2]*3);
    }
    const footRadius=trunk*1.08;
    solids.cylinder("tree trunk",o.x,o.z,y-.045,y+h*.63,footRadius);
    registerCanopy?.({x:o.x,z:o.z,radius:radius*1.22,bottom:y+h*.49,top:y+h*1.08,density:.57,name:o.id});
    trees.push({id:o.id,x:o.x,y,z:o.z,height:h,radius:footRadius,form:form.name});
    const weatherLeaves=[];

    function twigSegment(a,b,r) {
      pose.position.copy(a).lerp(b,.5);
      direction.subVectors(b,a);
      const span=direction.length();
      pose.quaternion.setFromUnitVectors(up,direction.multiplyScalar(1/span));
      pose.scale.set(r,span,r);
      pose.updateMatrix();
      data.fine.push(pose.matrix.clone());
      data.fineRoots.push(windRoot);
      branchesTotal++;
    }
    const limbs=Math.round(form.limbs*(.69+.31*detail));
    const clusters=detail<.55 ? 4 : 6;
    for(let limb=0;limb<limbs;limb++) {
      const a=yaw+limb*2.399963+rng()*.25;
      const reach=radius*form.reach*(.61+.40*rng());
      const fork=firstFork.clone().lerp(trunk2,.03+.86*rng());
      const high=h*lerp(form.tip[0],form.tip[1],rng());
      const tip=point(Math.cos(a)*reach+leanX*.75,high,Math.sin(a)*reach+leanZ*.79);
      const joint=fork.clone().lerp(tip,.54).add(new THREE.Vector3(Math.cos(a)*reach*.10,h*.054,Math.sin(a)*reach*.10));
      const bough=curve(fork,joint,tip);
      tube(data.bark,bough,trunk*(.20+.22*rng()),.009,windRoot,a,{rings:nearCenter ? 13 : 9,sides:7});
      branchesTotal++;
      for(let cluster=0;cluster<clusters;cluster++) {
        const at=.31+cluster*.134*(5/(clusters-1));
        const origin=bough.getPointAt(at);
        const bearing=a+cluster*1.54;
        const span=radius*(.24+.26*rng())*form.spread;
        const twigEnd=origin.clone().add(new THREE.Vector3(Math.cos(bearing)*span,
          h*(-.026+.145*rng()),Math.sin(bearing)*span));
        twigSegment(origin,twigEnd,Math.max(.0058,trunk*.064));
        const shoots=[{start:origin,end:twigEnd,bearing}];
        for(let fork=0;fork<5;fork++) {
          const side=fork%2===0 ? -1 : 1;
          const from=origin.clone().lerp(twigEnd,.21+fork*.147);
          const phi=bearing+side*(.75+.62*rng());
          const step=(.21+.38*rng())*(.84+radius*.16);
          const rise=step*(rng()-.36)*1.11;
          const end=from.clone().add(new THREE.Vector3(Math.cos(phi)*step,rise,Math.sin(phi)*step));
          twigSegment(from,end,Math.max(.0033,trunk*.039));
          shoots.push({start:from,end,bearing:phi});
        }
        const blades=Math.max(9,Math.floor(form.density*(nearCenter ? 1 : .84)*detail));
        for(let i=0;i<blades;i++) {
          const shoot=shoots[i%shoots.length];
          const along=.10+.89*(Math.floor(i/shoots.length)+.72*rng())/Math.ceil(blades/shoots.length);
          pose.position.copy(shoot.start).lerp(shoot.end,along);
          const spin=shoot.bearing+(i%2 ? -1 : 1)*(1.08+.60*rng());
          aim.set(Math.cos(spin),.48-.96*rng(),Math.sin(spin)).normalize();
          pose.quaternion.setFromUnitVectors(up,aim);
          pose.rotateY(rng()*tau);
          const size=(.185+.208*rng())*(.86+.17*radius)*(1.02-.15*along)*(1+.25*(1-detail));
          pose.scale.set(size*form.width*(.86+.21*rng()),size,size);
          pose.updateMatrix();
          const leafMatrix=pose.matrix.clone();
          const palette=pigments[(Math.floor(rng()*pigments.length)+limb)%pigments.length];
          data.leaves.push(leafMatrix);
          data.leafRoots.push(windRoot);
          data.colors.push(palette);
          if(i%4===0) {
            data.far.push(leafMatrix.clone().scale(sizeUp));
            data.farRoots.push(windRoot);
            data.farColors.push(palette);
          }
          if((cluster+limb)%2===0 && (i===6 || i===15 || i===23)) weatherLeaves.push(leafMatrix);
        }
      }
    }
    rainCrowns.push({x:o.x,z:o.z,windRoot,transforms:weatherLeaves,label:o.id,
      wet:{value:0},caught:0,runoff:0});

    for(let i=0;i<30;i++) {
      const a=grounds[i%grounds.length]+(rng()-.5)*1.22;
      const distance=trunk*(1.38+5.4*rng()**1.6);
      const x=o.x+distance*Math.cos(a), z=o.z+distance*Math.sin(a);
      const size=.044+rng()*.077;
      pose.position.set(x,groundAt(x,z)+.015,z);
      pose.rotation.set(-Math.PI*.5+(rng()-.5)*.40,0,rng()*tau,"YXZ");
      pose.scale.set(size*1.36,size,size*.19);
      pose.updateMatrix();
      data.litter.push(pose.matrix.clone());
      data.litterColors.push(litterTone.setHex(i%3===0 ? 0x8c754d : i%3===1 ? 0x797952 : 0x666344).clone());
    }
  }

  for(const data of chunks.values()) {
    const trunk=woodMesh(data.bark,bark,barkDepth);
    root.add(trunk);
    const fine=scatter(root,twigShape,twig,data.fine,data.fineRoots,twigDepth,"Street trunks and branching twigs");
    const near=scatter(root,leafShape,leaf,data.leaves,data.leafRoots,leafDepth,"Street crown individual blades",data.colors);
    const far=scatter(root,farShape,leaf,data.far,data.farRoots,leafDepth,"Simplified street crown blades",data.farColors);
    far.visible=false;
    scatter(root,farShape,litterColor,data.litter,null,undefined,"Fallen street leaves",data.litterColors);
    const mid=data.bounds.getCenter(new THREE.Vector3());
    const range=29+data.bounds.getSize(new THREE.Vector3()).length()*.5;
    bands.push({near,far,fine,mid,range,detailed:true});
    leavesTotal+=data.leaves.length;
    farTotal+=data.far.length;
    barkVertices+=trunk.geometry.attributes.position.count;
    litterTotal+=data.litter.length;
  }
  return {
    rainCrowns,rainMaterial:leaf,
    update(camera,seconds) {
      clock.value=seconds;
      camera.getWorldPosition(eye);
      for(const band of bands) {
        const near=eye.distanceTo(band.mid)<band.range+(band.detailed ? 2 : -2);
        band.near.visible=band.fine.visible=band.detailed=near;
        band.far.visible=!near;
      }
    },
    inspect:()=>({trees,treeCount:trees.length,leaves:leavesTotal,farLeaves:farTotal,branches:branchesTotal,
      barkVertices,litter:litterTotal,nearChunks:bands.filter(b=>b.detailed).length,
      totalChunks:bands.length,windTime:sharedTime?.value??clock.value}),
  };
}
