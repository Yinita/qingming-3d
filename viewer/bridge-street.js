import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { riverWorker } from "./bridge-people.js";
import { bridgeDeckHeight, bridgeRailOffset, buildWoodenBridge, createSurfaceLibrary, detailedBox } from "./bridge-look.js";
import { canalDepth, canalOrigin } from "./bridge-canal-bed.js";
import { createStreetCollision, workerHeight, workerRadius } from "./bridge-collision.js";
import { walkwayHeight, willowSites } from "./bridge-foreground.js";
import { tileRoof } from "./bridge-architecture.js";

const robes=[0x7b8777,0xa08a67,0x687c87,0xa78067,0xb2a283,0x758268,0x716570,0x979482];
const houseIds=new Set(["o0260","o0315","o0430","o0291","o0551"]);
const reedsHue=0x6d7551;
const standingY=1.68;

function digits(object) {
  return Number(object.id.slice(1))||1;
}

function batch(root,parts,name,receive=true) {
  for(const [material,geometries] of parts) {
    const geometry=mergeGeometries(geometries);
    for(const mesh of geometries) mesh.dispose();
    if(!geometry) throw new Error("Could not assemble "+name);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;
    mesh.castShadow=true;
    mesh.receiveShadow=receive;
    root.add(mesh);
  }
}

function characterParts(surface,hatted,slope,yaw) {
  const temp=new THREE.Group();
  const worker=riverWorker(temp,surface,"resident",hatted);
  worker.stand(x=>x*slope,0,0,0,yaw);
  worker.head.rotation.y=hatted ? .12 : -.09;
  worker.figure.updateMatrixWorld(true);
  const parts=new Map();
  worker.figure.traverse(node=>{
    if(!node.isMesh || node.parent===worker.straps) return;
    const material=node.material;
    if(!parts.has(material)) parts.set(material,[]);
    parts.get(material).push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    node.geometry.dispose();
  });
  const result=[];
  for(const [material,geometries] of parts) {
    result.push({material,geometry:mergeGeometries(geometries),colored:material.userData.streetCloth===true});
    geometries.forEach(g=>g.dispose());
  }
  return result;
}

function residents(root,entries,surface) {
  const pose=new THREE.Object3D();
  const chunks=new Map(), templates=new Map();
  for(const o of entries) {
    const template=o.bridge ? [o.hatted,o.slope*o.width/o.scale,o.yaw] : [o.hatted,0,0];
    const shape=template.join(":");
    const key=[shape,Math.floor(o.x/15),Math.floor(o.z/12)].join(":");
    if(!templates.has(shape)) templates.set(shape,characterParts(surface,...template));
    if(!chunks.has(key)) chunks.set(key,{shape,entries:[]});
    chunks.get(key).entries.push(o);
  }
  const update=new Set();
  for(const group of chunks.values()) {
    for(const {material,geometry,colored} of templates.get(group.shape)) {
      const mesh=new THREE.InstancedMesh(geometry,material,group.entries.length);
      mesh.name="Volumetric street residents";
      mesh.castShadow=true;
      mesh.receiveShadow=true;
      group.entries.forEach((o,i)=>{
        const place=()=>{
          pose.position.set(o.x,o.y,o.z);
          pose.rotation.y=o.yaw;
          pose.scale.set(o.hidden ? 0 : o.width,o.hidden ? 0 : o.scale,o.hidden ? 0 : o.width);
          pose.updateMatrix();
          mesh.setMatrixAt(i,pose.matrix);
          update.add(mesh);
        };
        o.instances.push(place);
        place();
        if(colored) mesh.setColorAt(i,new THREE.Color(o.robe));
      });
      root.add(mesh);
    }
  }
  function sync() {
    for(const mesh of update) {
      mesh.instanceMatrix.needsUpdate=true;
      mesh.computeBoundingSphere();
    }
    update.clear();
  }
  sync();
  return sync;
}

function placeResidents(entries,collisions,anchor,origin) {
  const landmarks=willowSites(anchor);
  function place(resident) {
    const radius=resident.solid.radius, height=workerHeight*resident.scale;
    for(let attempt=0;attempt<25;attempt++) {
      if(resident.bridge && attempt>0) break;
      const step=attempt ? .44*Math.ceil(attempt/8) : 0;
      const angle=(attempt%8)*Math.PI*.25+resident.yaw;
      const x=resident.source.x+step*Math.cos(angle), z=resident.source.z+step*Math.sin(angle);
      const y=resident.bridge ? resident.source.y : Math.max(resident.source.y,walkwayHeight(anchor,x,z));
      if(!resident.bridge) {
        const along=x-anchor.x, across=Math.abs(z-anchor.z);
        if(along>-15.6 && along<20.1 && across<1.38+radius) continue;
        if(x>-46 && x<-40.2 && z>anchor.z-3.4-radius && z<anchor.z+.7+radius) continue;
        if(canalDepth(origin,x,z)>.056 ||
           landmarks.some(t=>Math.hypot(x-t.x,z-t.z)<radius+.42*t.scale)) continue;
      }
      if(collisions.blocking(x,z,y,radius+.022,height,resident.solid)) continue;
      Object.assign(resident.solid,{x,z,bottom:y,top:y+height,enabled:true});
      Object.assign(resident,{x,y,z,shift:step,hidden:false});
      return;
    }
    resident.solid.enabled=false;
    resident.hidden=true;
  }
  const placed=entries.map(o=>{
    const solid=collisions.cylinder("resident",o.x,o.z,o.y,o.y,workerRadius*o.width);
    const resident={...o,solid,source:o,instances:[]};
    place(resident);
    return resident;
  }).filter(o=>!o.hidden);
  return {placed,place};
}

function timberHouse(root,collisions,surface,x,z,w,d,story,shade) {
  const shell=new THREE.Group();
  shell.name="Brick and timber riverside house";
  shell.position.set(x,0,z);
  root.add(shell);
  const plaster=surface("lime-plaster",shade,.67,.96);
  const timber=surface("tea-wood",0xa88c6e,.82,.85);
  const masonry=surface("worn-stone",0xc6b99c,.75,.91);
  const roof=surface("gray-roof-tile",0xb4ada0,.90,.82);
  const opening=surface("rail-wood",0x6d5941,.56,.92);
  const parts=new Map();
  function put(mat,width,height,depth,x,y,z,tilt=0) {
    const part=detailedBox(width,height,depth,mat,.018,0);
    part.rotateX(tilt);
    part.translate(x,y,z);
    if(!parts.has(mat)) parts.set(mat,[]);
    parts.get(mat).push(part);
  }
  const plinth=.29, eave=story+plinth, slope=.36, run=d*.5+.53;
  const clear=.42, bays=[-w/3,0,w/3], bayWidth=w/3;
  put(masonry,w+.19,.21,d+.16,0,.12,0);
  put(masonry,w+.31,.088,d+.27,0,.242,0);
  for(const side of [-1,1]) {
    const wallZ=side*(d*.5-.09), faceZ=side*d*.5;
    put(timber,w+.25,.22,.23,0,eave-.08,faceZ);
    put(plaster,w,story*.27,.18,0,eave-story*.135,wallZ);
    for(let i=0;i<=3;i++) {
      const x=(i/3-.5)*w;
      put(timber,.15,story,.225,x,plinth+story*.5,faceZ);
      put(masonry,.21,.20,.26,x,plinth+.053,faceZ);
      put(timber,.115,.136,.54,x,eave-.22,side*(d*.5+.112));
    }
    for(const [i,x] of bays.entries()) {
      const door=i===1&&side===1;
      const sill=door ? plinth : plinth+story*.31;
      const lintel=plinth+story*.73;
      const insetWidth=door ? Math.min(1.24,bayWidth*.78) : Math.min(1.12,bayWidth*.74);
      const pierWidth=(bayWidth-insetWidth)*.5;
      if(!door) put(plaster,bayWidth,sill-plinth,.18,x,(sill+plinth)*.5,wallZ);
      for(const edge of [-1,1]) {
        put(plaster,pierWidth,lintel-sill,.18,x+edge*(bayWidth-pierWidth)*.5,(sill+lintel)*.5,wallZ);
        put(timber,.071,lintel-sill,.105,x+edge*insetWidth*.5,(sill+lintel)*.5,faceZ);
      }
      put(opening,insetWidth+.06,lintel-sill+.04,.09,x,(sill+lintel)*.5,faceZ-side*clear);
      for(const h of [sill,lintel]) put(timber,insetWidth+.073,.081,.231,x,h,faceZ);
      if(door) {
        for(const edge of [-1,1]) {
          put(timber,.37,lintel-sill-.09,.067,x+edge*.33,(sill+lintel)*.5,faceZ-side*.17);
          put(masonry,.045,.07,.044,x+edge*.18,sill+.78,faceZ-side*.124);
        }
        put(masonry,insetWidth+.19,.15,.37,x,.095,faceZ+side*.08);
      } else {
        for(let bar=-2;bar<=2;bar++)
          put(timber,.036,lintel-sill,.065,x+insetWidth*bar/6,(sill+lintel)*.5,faceZ-side*.057);
        put(timber,insetWidth,.04,.065,x,(sill+lintel)*.5,faceZ-side*.047);
      }
    }
    const ends=Math.ceil(w/.28);
    for(let i=0;i<ends;i++) {
      const x=(i/(ends-1)-.5)*(w+.31);
      put(timber,.067,.091,.54,x,eave-.016,side*(run-.27),side*.12);
    }
  }
  for(const side of [-1,1]) {
    const wallX=side*(w*.5-.067);
    put(plaster,.14,story,d,wallX,story*.5+plinth,0);
    put(masonry,.17,.48,d-.12,wallX+side*.015,plinth+.24,0);
    for(const z of [-d*.48,0,d*.48]) put(timber,.17,story,.124,wallX+side*.058,story*.5+plinth,z);
    const gabled=new THREE.Shape();
    gabled.moveTo(-run,0);
    gabled.lineTo(run,0);
    gabled.lineTo(0,run*slope+.02);
    gabled.closePath();
    const g=new THREE.ExtrudeGeometry(gabled,{depth:.138,bevelEnabled:false});
    g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
    g.rotateY(Math.PI/2);
    g.translate(wallX-.069,eave-.032,0);
    parts.get(plaster).push(g);
    const angle=Math.atan(slope);
    for(const z of [-1,1]) {
      put(timber,.17,.13,Math.hypot(run,run*slope),wallX+side*.027,
        eave+run*slope*.5,z*run*.5,z*angle);
    }
  }
  put(opening,w+.81,.16,.18,0,eave+run*slope+.057,0);
  for(const x of [-1,1]) put(timber,.18,.25,.21,x*(w+.80)*.5,eave+run*slope+.106,0);
  tileRoof(shell,roof,w+.78,run,eave,0,slope);
  batch(shell,parts,"Textured masonry and glazed tile");
  collisions.box("house",x-w*.5,x+w*.5,z-d*.5,z+d*.5,0,eave+.65);
}

function trees(root,entries,surface,solids) {
  const trunk=surface("willow-bark",0xb4aa8a,.76,.93);
  const green=new THREE.MeshStandardMaterial({color:reedsHue,roughness:.98});
  const crown=new THREE.IcosahedronGeometry(1,3);
  const tips=crown.attributes.position;
  for(let i=0;i<tips.count;i++){
    const x=tips.getX(i), y=tips.getY(i), z=tips.getZ(i);
    const silhouette=1+.086*Math.sin(x*11+z*4)*Math.sin(y*12-z*10)+.06*Math.sin(z*24+y*12);
    tips.setXYZ(i,x*silhouette,y*silhouette,z*silhouette);
  }
  green.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 crownP;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\ncrownP=position;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nvarying vec3 crownP;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float fleck=sin(crownP.x*106.+crownP.z*71.)*sin(crownP.y*93.-crownP.z*93.);
        float detail=1.-smoothstep(.21,.85,length(fwidth(crownP)*95.));
        diffuseColor.rgb*=.93+fleck*.26*detail+.13*sin(crownP.y*17.+crownP.z*9.);`);
  };
  green.customProgramCacheKey=()=>"scattered-leaf-clusters";
  const limb=new THREE.CylinderGeometry(.39,1,1,8);
  const wood=new THREE.InstancedMesh(limb,trunk,entries.length*5);
  const leaves=new THREE.InstancedMesh(crown,green,entries.length*9);
  wood.name="Volumetric tree trunks";
  leaves.name="Volumetric tree crowns";
  wood.castShadow=wood.receiveShadow=true;
  leaves.castShadow=leaves.receiveShadow=true;
  const pose=new THREE.Object3D(), color=new THREE.Color(), direction=new THREE.Vector3(), up=new THREE.Vector3(0,1,0), point=new THREE.Vector3();
  for(const [i,o] of entries.entries()) {
    const h=Math.max(2.4,Math.min(8.6,o.h)), w=Math.max(1.4,Math.min(5.2,o.w))*.50;
    const spin=digits(o)*1.872;
    const y=o.y||0;
    pose.position.set(o.x,y+h*.30,o.z);
    const trunkWidth=Math.max(.11,w*.12);
    pose.scale.set(trunkWidth,h*.61,trunkWidth);
    pose.quaternion.identity();
    pose.updateMatrix();
    wood.setMatrixAt(i*5,pose.matrix);
    solids.cylinder("tree",o.x,o.z,y,y+h*.75,trunkWidth);
    for(let j=0;j<9;j++) {
      const phi=spin+j*2.399963, extent=j===0 ? 0 : w*(.54+.17*Math.sin(j*7.8));
      point.set(o.x+extent*Math.cos(phi),y+h*(.64+j*.033),o.z+extent*Math.sin(phi));
      if(j>0 && j<5) {
        pose.position.set(o.x,y+h*.38,o.z);
        direction.copy(point).sub(pose.position);
        pose.position.addScaledVector(direction,.5);
        pose.quaternion.setFromUnitVectors(up,direction.clone().normalize());
        pose.scale.set(trunkWidth*.43,direction.length(),trunkWidth*.43);
        pose.updateMatrix();
        wood.setMatrixAt(i*5+j,pose.matrix);
      }
      pose.position.copy(point);
      pose.rotation.set(j*.38,phi,j*.24);
      const size=w*(.34+.18*(.5+.5*Math.sin(1.3*j+spin)));
      pose.scale.set(size,size*(1.08+.23*Math.cos(j*9)),size*.90);
      pose.updateMatrix();
      leaves.setMatrixAt(i*9+j,pose.matrix);
      leaves.setColorAt(i*9+j,color.setScalar(.62+.36*(.5+.5*Math.sin(spin*7+j*8.4))));
    }
  }
  root.add(wood,leaves);
}

function marketProps(root,entries,surface,solids,anchor,origin) {
  const wood=surface("tea-wood",0xb4a082,.68,.84);
  const shade=surface("indigo-linen",0xc0af83,.31,.95);
  const iron=new THREE.MeshStandardMaterial({color:0x5e574c,roughness:.76,metalness:.32});
  const hide=new THREE.MeshStandardMaterial({color:0x837052,roughness:.77});
  const mane=new THREE.MeshStandardMaterial({color:0x45382d,roughness:.88});
  const buckets=new Map();
  const placement=new THREE.Object3D(), local=new THREE.Object3D();
  const closedNames=new Set(["cart","horse","donkey","ox","sedan chair","umbrella"]);
  let count=0;
  for(const o of entries) {
    if(!closedNames.has(o.label)) continue;
    const x=o.x;
    const yaw=digits(o)*1.38, size=THREE.MathUtils.clamp(o.h/1.57,.65,1.31);
    const parts=[], envelope=new THREE.Box3();
    function set(g,mat,lx,ly,lz,sx=1,sy=1,sz=1,angle=0) {
      local.position.set(lx,ly,lz);
      local.scale.set(sx,sy,sz);
      local.rotation.set(angle,0,0);
      local.updateMatrix();
      g.applyMatrix4(local.matrix);
      g.computeBoundingBox();
      envelope.union(g.boundingBox);
      parts.push([mat,g]);
    }
    const sphere=()=>new THREE.SphereGeometry(1,14,10);
    function plank(w,h,d,x,y,z,mat=wood) { set(detailedBox(w,h,d,mat),mat,x,y,z); }
    if(o.label==="cart") {
      plank(1.12,.16,1.55,0,.57,0);
      for(const side of [-1,1]) {
        plank(.11,.30,1.51,side*.51,.73,0);
        plank(.055,.064,1.85,side*.28,.62,-1.04);
        set(new THREE.TorusGeometry(.435,.046,7,30).rotateY(Math.PI/2),iron,side*.62,.46,0);
        for(let i=0;i<7;i++){
          const theta=i/7*Math.PI*2;
          set(new THREE.BoxGeometry(.055,.42,.045),wood,side*.620,
            .46+Math.cos(theta)*.20,Math.sin(theta)*.20,1,1,1,theta);
        }
      }
    } else if(o.label==="umbrella") {
      const points=[[0,1.23],[.22,1.18],[.63,1.02],[.96,.83],[1,.79],[.99,.765]]
        .map(([r,h])=>new THREE.Vector2(r,h+.6));
      set(new THREE.LatheGeometry(points,18),shade,0,0,0,.76,1,.76);
      plank(.04,1.91,.04,0,.96,0);
      plank(.30,.09,.30,0,.052,0,iron);
    } else if(o.label==="sedan chair") {
      plank(1.12,1.07,.73,0,.83,0,shade);
      plank(1.22,.13,.88,0,1.43,0);
      for(const x of [-.62,.62]) for(const z of [-.42,.42])
        plank(.06,1.29,.06,x,.77,z);
      for(const z of [-.42,.42]) plank(3.1,.09,.068,0,.69,z);
    } else {
      set(sphere(),hide,0,.88,.03,.35,.37,.68);
      set(sphere(),hide,0,1.17,-.47,.23,.46,.29,-.32);
      set(sphere(),hide,0,1.45,-.70,.18,.253,.24,-.48);
      set(sphere(),hide,0,1.28,-.91,.159,.15,.25,-.32);
      set(sphere(),mane,0,1.26,-.32,.133,.39,.18,-.42);
      set(sphere(),mane,0,.73,.72,.102,.39,.103,-.25);
      for(const side of [-1,1]) {
        set(sphere(),hide,side*.119,1.66,-.64,.050,.13,.041,.23);
        set(sphere(),mane,side*.143,1.46,-.833,.045,.047,.054);
        for(const z of [-.44,.47]){
          set(sphere(),hide,side*.19,.54,z,.13,.31,.10,.05);
          set(new THREE.CylinderGeometry(.057,.072,.45,10),hide,side*.217,.266,z-.028);
          set(sphere(),mane,side*.217,.053,z-.055,.088,.058,.13);
        }
      }
    }
    const extents=envelope.getSize(new THREE.Vector3()).multiplyScalar(size*.5);
    const offset=envelope.getCenter(new THREE.Vector3()).multiplyScalar(size)
      .applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw);
    const across=Math.abs(Math.sin(yaw))*extents.x+Math.abs(Math.cos(yaw))*extents.z;
    const z=x>-77 && x<-39 && Math.abs(o.z+offset.z-anchor.z)<1.26+across ?
      anchor.z+Math.sign(o.z-anchor.z||1)*(1.26+across)-offset.z : o.z;
    if(Math.abs(z-origin.y)<15 && canalDepth(origin,x,z)>.082) {
      for(const [,geometry] of parts) geometry.dispose();
      continue;
    }
    const y=Math.max(o.y||0,walkwayHeight(anchor,x,z));
    placement.position.set(x,y,z);
    placement.rotation.y=yaw;
    placement.scale.setScalar(size);
    placement.updateMatrix();
    const cell=Math.floor(x/18)+":"+Math.floor(z/14);
    if(!buckets.has(cell)) buckets.set(cell,new Map());
    const batchParts=buckets.get(cell);
    for(const [material,geometry] of parts) {
      if(!batchParts.has(material)) batchParts.set(material,[]);
      batchParts.get(material).push(geometry.applyMatrix4(placement.matrix));
    }
    if(o.label==="umbrella"){
      solids.cylinder("umbrella pole",x,z,y,y+1.91*size,.10*size);
      solids.cylinder("umbrella canopy",x,z,y+1.36*size,y+1.85*size,.76*size);
    } else {
      const collider=solids.orientedBox(o.label,extents.x,extents.z,extents.y*2);
      Object.assign(collider,{x:x+offset.x,z:z+offset.z,yaw,bottom:y+envelope.min.y*size,top:y+envelope.max.y*size});
    }
    count++;
  }
  for(const parts of buckets.values()) batch(root,parts,"Volumetric market props");
  return count;
}

export function createStreetScene(scene,objects,anchor) {
  const surface=createSurfaceLibrary();
  const root=new THREE.Group(), collisions=createStreetCollision();
  root.name="Volumetric perspective streets";
  root.visible=false;
  scene.add(root);
  const bridge=new THREE.Group();
  bridge.name="Timber bridge for perspective exploration";
  root.add(bridge);
  buildWoodenBridge(bridge,anchor,surface);
  const origin=canalOrigin(anchor);
  const replacements=new Set();
  const people=[], treeObjects=[];
  const curb=bridgeRailOffset-.365;
  const rail=[[-66.3,curb],[-63.7,-curb],[-60.1,curb],[-57.8,-curb],[-54.3,curb],[-50.7,-curb]];
  const closeBridge=(x,z)=>Math.abs(x-anchor.x)<10.7 && Math.abs(z-anchor.z)<1.75;
  objects.forEach(o=>{
    if(o.label==="person"){
      replacements.add(o.id);
      if(closeBridge(o.x,o.z)) return;
      if(o.x>-76 && o.x<-65 && o.z<anchor.z-.2 && o.z>anchor.z-8.5) return;
      if(o.x>-49.0 && o.x<-39.8 && Math.abs(o.z-anchor.z)<2.3) return;
      if(Math.abs(o.z-origin.y)<15 && canalDepth(origin,o.x,o.z)>.056) return;
      const n=digits(o), scale=THREE.MathUtils.clamp(o.h/standingY,.61,1.16);
      people.push({x:o.x,z:o.z,y:o.y||0,yaw:Math.PI+Math.sin(n*1.9)*1.85,scale,
        width:scale*(.81+.24*(.5+.5*Math.sin(n))),robe:robes[n%robes.length],hatted:n%5===0});
    } else if(o.label==="tree"){
      replacements.add(o.id);
      if(o.id==="o0288" || o.id==="o0400") return;
      if(Math.abs(o.z-origin.y)<15 && canalDepth(origin,o.x,o.z)>.08) return;
      treeObjects.push(o);
    } else if(houseIds.has(o.id) || ["cart","horse","donkey","ox","sedan chair","umbrella"].includes(o.label)) {
      replacements.add(o.id);
    }
  });
  for(const [i,[x,z]] of rail.entries()){
    const slope=(bridgeDeckHeight(anchor,x+.05)-bridgeDeckHeight(anchor,x-.05))/.1;
    people.push({x,z:z+anchor.z,y:bridgeDeckHeight(anchor,x),yaw:i%2===0 ? -.16 : Math.PI+.15,scale:.98,slope,
      width:.82,robe:robes[i],hatted:i%3===0,bridge:true});
  }
  const bank=[[-74.28,1.52],[-69.75,2.18],[-47.35,2.0],[-44.95,2.56],[-40.20,2.05]];
  for(const [i,[x,z]] of bank.entries())
    people.push({x,z:z+anchor.z,y:0,yaw:1.26+i*.44,scale:.99,width:.88,robe:robes[(i+3)%robes.length],hatted:i%2===0});
  trees(root,treeObjects,surface,collisions);
  const props=marketProps(root,objects,surface,collisions,anchor,origin);
  const buildings=[
    [-71.73,-51.41,5.81,3.42,2.86,0xe4cfaa],[-69.32,-62.85,5.24,3.08,2.62,0xdac5a4],
    [-47.15,-55.44,5.75,3.79,2.97,0xead6b8],[-41.74,-56.44,5.15,3.62,2.82,0xe3caaa],
    [-50.54,-28.78,5.12,3.86,2.70,0xd9c5a0],[-44.16,-29.86,6.06,4.10,3.01,0xd5bb9d],
    [-37.08,-28.31,5.44,3.30,2.75,0xe0cfad],
    [71.79,-57.14,5.87,3.21,2.49,0xe1cbaa],
  ];
  for(const spec of buildings) timberHouse(root,collisions,surface,...spec);
  const {placed,place}=placeResidents(people,collisions,anchor,origin);
  const syncResidents=residents(root,placed,surface);
  function registerHouse(object) {
    const house=collisions.meshBox("existing house",object);
    for(const p of placed) {
      if(p.hidden || p.y+.045>=house.top || p.solid.top<=house.bottom) continue;
      const dx=Math.max(house.minX-p.x,0,p.x-house.maxX), dz=Math.max(house.minZ-p.z,0,p.z-house.maxZ);
      if(dx*dx+dz*dz>=p.solid.radius**2) continue;
      place(p);
      for(const placeInstance of p.instances) placeInstance();
    }
    syncResidents();
  }
  return {root,bridge,replacements,collisions,registerHouse,inspect:()=>({people:placed.filter(p=>!p.hidden).length,
    relocated:placed.filter(p=>!p.hidden&&p.shift>0).length,bridgePeople:placed.filter(p=>!p.hidden&&p.bridge).length,
    trees:treeObjects.length,houses:buildings.length,props,colliders:collisions.inspect()})};
}
