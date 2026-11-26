import * as THREE from "three";
import { cropBeds,gardenBounds,vergeEdge } from "./bridge-west-bank.js";

const {lerp,smoothstep}=THREE.MathUtils;
const {west,east,south,north}=gardenBounds;
const tau=Math.PI*2, spiral=2.399963;

function seeded(seed) {
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  };
}

function leafMesh(kind,detail=true) {
  const positions=[],colors=[],uv=[],indices=[];
  const broad=kind===0, onion=kind===1;
  const steps=broad ? (detail ? 19 : 9) : onion ? (detail ? 12 : 6) : 7;
  const sides=detail ? 8 : 5;
  const lanes=broad ? (detail ? [-1,-.78,-.50,-.20,0,.20,.50,.78,1] : [-1,-.48,0,.48,1]) :
    onion ? Array.from({length:sides+1},(_,i)=>i/sides) : [-1,0,1];
  for(let row=0;row<=steps;row++) {
    const t=row/steps, nerve=Math.sin(Math.PI*t);
    const blade=smoothstep(t,.14,.48)*(1-smoothstep(t,.88,1));
    const angle=t*22;
    for(const lane of lanes) {
      let x,y,z,r,g,b;
      if(broad) {
        const side=Math.abs(lane);
        const frill=(.017*Math.sin(angle+lane*.9)+.009*Math.sin(t*34-lane))*side**1.8;
        const width=lerp(.053,.304,blade)*(.72+.28*nerve)+frill*blade;
        x=lane*Math.max(.005,width)*(1-smoothstep(t,.92,1)*.96)+.039*nerve;
        y=.79*t-.29*t*t+.092*nerve+blade*(.096*side**1.7+.012*Math.sin(t*26)*side**2)-
          .031*blade*smoothstep(side,.10,.51);
        z=t*(.94-.030*side*blade);
        const tissue=lerp(.96,.64,smoothstep(t,.22,.46))+.14*nerve+.060*side;
        const rib=(1-smoothstep(side,0,.19))*(1-smoothstep(t,.83,1));
        r=tissue+.23*rib;g=tissue+.17*rib;b=tissue*.83+.18*rib;
      } else if(onion) {
        const a=tau*lane, radius=lerp(.035,.006,smoothstep(t,.61,1))*(.85+.15*nerve);
        x=radius*Math.cos(a)+.026*t*t;
        y=.98*t-.087*t*t;
        z=.38*t*t+radius*Math.sin(a);
        const rind=smoothstep(t,.11,.38), shade=.94-.21*rind+.087*Math.cos(a);
        r=lerp(1.39,shade*.84,rind);g=lerp(1.25,shade,rind);b=lerp(.91,shade*.91,rind);
      } else {
        x=lane*(.032*nerve+.004*(1-t))+.086*t*t;
        y=.93*t-.23*t*t-.024*Math.abs(lane)*nerve;
        z=.44*t*t;
        r=.67+.25*t;g=r*1.035;b=r*.82;
      }
      positions.push(x,y,z);colors.push(r,g,b);uv.push(onion ? lane : (lane+1)*.5,t);
    }
    if(row) for(let j=0;j<lanes.length-1;j++) {
      const a=(row-1)*lanes.length+j,b=a+lanes.length;
      if(onion) indices.push(a,a+1,b,a+1,b+1,b);
      else indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.computeVertexNormals();
  if(onion) {
    // The repeated UV seam shares the surface normal of the closed tube.
    const n=geometry.attributes.normal, v=new THREE.Vector3(), other=new THREE.Vector3();
    for(let row=0;row<=steps;row++) {
      const a=row*lanes.length,b=a+lanes.length-1;
      v.fromBufferAttribute(n,a).add(other.fromBufferAttribute(n,b)).normalize();
      n.setXYZ(a,v.x,v.y,v.z);n.setXYZ(b,v.x,v.y,v.z);
    }
  }
  return geometry;
}

function leafMaterials(kind,time) {
  const leaf=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,
    roughness:kind===0 ? .75 : .83});
  const shadow=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  for(const material of [leaf,shadow]) {
    const isDepth=material===shadow;
    material.customProgramCacheKey=()=>`kitchen-crop-${kind}-${isDepth}`;
    material.onBeforeCompile=shader=>{
      shader.uniforms.cropTime=time;
      shader.vertexShader=shader.vertexShader.replace("#include <common>",
        "#include <common>\nuniform float cropTime; varying vec2 cropUV;")
        .replace("#include <begin_vertex>",`#include <begin_vertex>
          cropUV=uv;
          vec2 seed=instanceMatrix[3].xz;
          float flex=pow(clamp(position.y+.16*position.z,0.,1.),1.65);
          transformed.x+=flex*(.050*sin(cropTime*1.26+dot(seed,vec2(1.28,.91)))+
            .016*sin(cropTime*3.55+seed.y*2.4));
          transformed.z+=flex*.039*sin(cropTime*1.91+seed.x*.793);
        `);
      if(isDepth || kind===2) return;
      shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nvarying vec2 cropUV;")
        .replace("#include <color_fragment>",kind===0 ? `#include <color_fragment>
          float side=abs(cropUV.x-.5)*2., t=cropUV.y;
          float fade=1.-smoothstep(.021,.19,length(fwidth(cropUV)));
          float mainRib=1.-smoothstep(.013,.056,side);
          float branchX=(t-.19*pow(side,.76)+.016*sin(side*5.6))*10.6;
          float branch=1.-smoothstep(.026,.116,abs(fract(branchX)-.5));
          float secondary=1.-smoothstep(.017,.114,abs(fract(19.*(t+side*.114))-.5));
          float nerves=(mainRib*.28+branch*.145*(1.-side*.68)+secondary*.031)*
            smoothstep(.17,.40,t)*(1.-smoothstep(.87,.99,t))*fade;
          float cell=sin(t*106.+sin(side*36.))*sin(side*119.+t*12.)*.025*fade;
          diffuseColor.rgb*=1.+nerves+cell;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.35,.43,.22),nerves*.32);
        ` : `#include <color_fragment>
          float fiber=1.-smoothstep(.035,.16,abs(fract(9.*cropUV.x)-.5));
          diffuseColor.rgb*=1.+.053*fiber*(1.-smoothstep(.025,.14,fwidth(cropUV.x)));
        `);
    };
  }
  return {leaf,shadow};
}

function springLeaves(kind,random) {
  const leaves=[];
  if(kind===0) {
    const phase=random()*tau;
    const tones=[0x627645,0x78914e,0x697d45,0x8b9f5a,0x5b743e,0x849553];
    for(let i=0;i<12;i++) {
      const heart=i>=7, size=(heart ? .125 : .245)+random()*(heart ? .096 : .11);
      leaves.push({yaw:phase+i*spiral+.20*random(),size,depth:heart ? .72 : 1.06,
        tilt:heart ? -.46-.25*random() : .06-.10*random(),
        stretch:heart ? 1.10+.14*random() : .82+.18*random(),color:tones[i%tones.length]});
    }
  } else {
    const tones=[0x638258,0x6d8b66,0x799557,0x8c9d73];
    for(let i=0;i<6;i++) leaves.push({yaw:i*spiral+random()*.9,size:.26+.22*random(),depth:1,
      tilt:.20*random()-.08,stretch:.86+.18*random(),color:tones[i%tones.length]});
  }
  return leaves;
}

export function createKitchenCrops(parent,height) {
  const time={value:0};
  const surfaces=Array.from({length:3},(_,i)=>({...leafMaterials(i,time),geometry:leafMesh(i)}));
  const distantGeometry=[leafMesh(0,false),leafMesh(1,false)];
  const plants=[],batches=[[],[],[]],byId=new Map();
  for(const [bedIndex,bed] of cropBeds.entries()) {
    const across=bed.wide ? 2 : 3, rows=Math.floor(bed.length/(bed.wide ? .31 : .24));
    for(let row=0;row<rows;row++) for(let column=0;column<across;column++) {
      const random=seeded(39484+bedIndex*27177+row*843+column*311);
      // Stable plant identities keep saved harvests tied to the planted positions.
      const id=bedIndex*100+row*10+column;
      const x=bed.x+(column-(across-1)*.5)*(bed.wide ? .28 : .19)+(random()-.5)*.044;
      const z=bed.z+((row+.5)/rows-.5)*bed.length+(random()-.5)*.044;
      const kind=bed.wide ? 0 : 1;
      const plant={id,kind,x,y:height(x,z)+.003,z,leaves:springLeaves(kind,random)};
      plant.first=batches[kind].length;
      for(const leaf of plant.leaves) batches[kind].push({leaf,x,y:plant.y,z});
      plants.push(plant);byId.set(id,plant);
    }
  }
  const random=seeded(33286);
  const edges=[[west-.26,south,west-.63,north+.42],[west,north+.24,east,north+.44],
    [west,south-.35,east-.20,south-.58],[east+.30,north+.22,vergeEdge-.21,north+.51]];
  for(const [x,z,toX,toZ] of edges) {
    const length=Math.hypot(toX-x,toZ-z);
    for(let at=.22;at<length;at+=.11+.42*random()) {
      if(random()<.27) continue;
      const nx=lerp(x,toX,at/length)+(random()-.5)*.33,nz=lerp(z,toZ,at/length)+(random()-.5)*.41;
      const y=height(nx,nz);
      for(let i=0;i<5;i++) batches[2].push({x:nx,y,z:nz,leaf:{
        yaw:i*1.923+random(),size:.063+.168*random()**1.67,depth:1,tilt:0,stretch:.47+.58*random(),
        color:i%3===0 ? 0x9a8a5d : 0x758055}});
    }
  }
  const pose=new THREE.Object3D(), pigment=new THREE.Color();
  function transform(leaf,x,y,z,scale,offsetYaw=0,tilt=0) {
    const size=leaf.size*scale;
    pose.position.set(x,y,z);
    pose.rotation.set(leaf.tilt+tilt,leaf.yaw+offsetYaw,0,"YXZ");
    pose.scale.set(size,size*leaf.stretch,size*leaf.depth);
    pose.updateMatrix();
    return pose.matrix;
  }
  function instanced(kind,capacity,name) {
    const {geometry,leaf,shadow}=surfaces[kind];
    const batch=new THREE.InstancedMesh(geometry,leaf,capacity);
    batch.name=name;
    batch.castShadow=batch.receiveShadow=true;
    batch.customDepthMaterial=shadow;
    return batch;
  }
  const names=["Ruffled greens with branching venation","Round scallion leaves and ivory sheaths","Verge grass"];
  const rows=batches.map((batch,kind)=>{
    const mesh=instanced(kind,batch.length,names[kind]);
    batch.forEach(({leaf,x,y,z},i)=>{
      mesh.setMatrixAt(i,transform(leaf,x,y,z,1));
      mesh.setColorAt(i,pigment.setHex(leaf.color));
    });
    mesh.computeBoundingSphere();parent.add(mesh);
    return mesh;
  });

  const dirtMaterial=new THREE.MeshStandardMaterial({color:0x6c563e,roughness:.98});
  const rootGeometry=new THREE.CylinderGeometry(.024,.033,.031,9);
  const plugs=new THREE.InstancedMesh(rootGeometry,dirtMaterial,plants.length);
  plugs.name="Disturbed earth where greens were lifted";
  plugs.count=0;plugs.receiveShadow=true;plugs.frustumCulled=false;
  parent.add(plugs);

  function adjust(plant,y=0,twist=0,scale=1) {
    const mesh=rows[plant.kind];
    for(const [i,leaf] of plant.leaves.entries())
      mesh.setMatrixAt(plant.first+i,transform(leaf,plant.x,plant.y+y,plant.z,scale,twist,twist*.55));
    mesh.instanceMatrix.needsUpdate=true;
  }
  function restore(taken) {
    plugs.count=0;
    for(const plant of plants) {
      const picked=taken.has(plant.id);
      adjust(plant,0,0,picked ? .0001 : 1);
      if(!picked) continue;
      pose.position.set(plant.x,plant.y-.008,plant.z);
      pose.rotation.set(0,0,0);
      pose.scale.set(1,.82,1);
      pose.updateMatrix();
      plugs.setMatrixAt(plugs.count++,pose.matrix);
    }
    plugs.instanceMatrix.needsUpdate=true;
  }
  const trayLimit=12;
  function createDisplay(holder,limit) {
    const display=[0,1].map(kind=>{
      const mesh=instanced(kind,limit*(kind===0 ? 12 : 6),kind===0 ? "Gathered leaf greens" : "Gathered scallions");
      mesh.count=0;mesh.frustumCulled=false;holder.add(mesh);
      return mesh;
    });
    return function fill(ids,basket=false) {
      for(const mesh of display) mesh.count=0;
      const visible=ids.slice(-limit);
      for(const [i,id] of visible.entries()) {
        const plant=byId.get(id);
        if(!plant) continue;
        const mesh=display[plant.kind];
        const theta=i*spiral, edge=basket ? .052*Math.sqrt(i) : 0;
        for(const leaf of plant.leaves) {
          const index=mesh.count++;
          const scale=basket ? .64+.07*(i%4) : .86;
          mesh.setMatrixAt(index,transform(leaf,Math.cos(theta)*edge,basket ? .086+.012*(i%3) : 0,
            Math.sin(theta)*edge,scale,theta,basket ? .61 : -.30));
          mesh.setColorAt(index,pigment.setHex(leaf.color));
        }
      }
      for(const mesh of display) {
        mesh.instanceMatrix.needsUpdate=true;
        if(mesh.instanceColor) mesh.instanceColor.needsUpdate=true;
      }
    };
  }
  let detail=true;
  return {plants,byId,restore,adjust,
    item:holder=>createDisplay(holder,1), basket:holder=>createDisplay(holder,trayLimit),
    breeze(seconds,observer) {
      time.value=seconds;
      const distance=Math.hypot(observer.x-(west+east)*.5,observer.z-(south+north)*.5);
      const close=distance<(detail ? 10.4 : 9.6);
      if(close===detail) return;
      detail=close;
      for(let i=0;i<2;i++) rows[i].geometry=detail ? surfaces[i].geometry : distantGeometry[i];
    },
  };
}
