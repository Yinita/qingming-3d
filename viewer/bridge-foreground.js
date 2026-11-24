import * as THREE from "three";
import { bindWillowPose, leafFlutter } from "./bridge-wind.js";
import { willowBranchRig } from "./bridge-willow-dynamics.js";
import { airFromMap, airUniforms, airGLSL, registerWindCanopy } from "./bridge-air.js";
import { bladeGeometry, lightLeaf } from "./bridge-leaf-light.js";
import { canalDepth, canalOrigin, canalShoreRadius, canalTerrainHeight } from "./bridge-canal-bed.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox, walkPath } from "./bridge-look.js";

function seeded(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function combine(parts, material, cast = true) {
  const geo = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

function tint(geometry, color) {
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let k = 0; k < colors.length; k += 3) {
    colors[k] = color.r;
    colors[k + 1] = color.g;
    colors[k + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function flagstones(parent, x, z, width, depth, surface, seed) {
  const random = seeded(seed);
  const mortar = surface("stone-paving", 0xaf9f84, .64);
  const rock = surface("worn-stone", 0xf5eddf, .79);
  rock.vertexColors = true;
  const base = walkPath(width + .14, depth + .47, mortar);
  base.position.set(x, .006, z);
  parent.add(base);
  const stones = [];
  let left = x - width / 2;
  let row = 0;
  while (left < x + width / 2 - .22) {
    const w = Math.min(.47 + random() * .31, x + width / 2 - left);
    const offset = depth / 2 + Math.sin(row++ * 1.41) * .15;
    let bottom = z - offset;
    while (bottom < z + offset - .18) {
      const d = Math.min(.34 + random() * .35, z + offset - bottom);
      const h = .035 + random() * .025;
      const block = detailedBox(w - .017, h, d - .017, rock, .017, random() * 11);
      block.rotateY((random() - .5) * .033);
      block.rotateX((random() - .5) * .040);
      block.translate(left + w / 2, h / 2 + .003, bottom + d / 2);
      const shade = .71 + random() * .23;
      tint(block, new THREE.Color(shade, shade * (1 - random() * .07), shade * (.91 + random() * .07)));
      stones.push(block);
      bottom += d;
    }
    left += w;
  }
  const masonry = combine(stones, rock);
  masonry.name = "Individual worn paving stones";
  parent.add(masonry);
}

function limb(curve,base,tip,random,metres,binding) {
  const ring=base>.10 ? 14 : base>.026 ? 11 : 7;
  const sections=base>.10 ? 25 : base>.026 ? 14 : 11;
  const frames = curve.computeFrenetFrames(sections, false);
  const along = curve.getLengths(sections);
  const vertices=[],uv=[],indices=[],branchLink=[],joint=[];
  const variation = Array.from({ length: ring }, () => .84 + .26 * random());
  for (let k = 0; k <= sections; k++) {
    const t = k / sections;
    const c=curve.getPointAt(t);
    binding(t,joint);
    const neck=1+.08*Math.sin(t*18+base*43)*Math.sin(t*Math.PI);
    const radius=THREE.MathUtils.lerp(base,tip,Math.pow(t,.78))*neck;
    for (let i = 0; i <= ring; i++) {
      const a = i / ring * Math.PI * 2;
      const thick = radius * variation[i % ring];
      const p = c.clone().addScaledVector(frames.normals[k], Math.cos(a) * thick)
        .addScaledVector(frames.binormals[k], Math.sin(a) * thick);
      vertices.push(...p);
      branchLink.push(...joint);
      uv.push(i / ring * 2 * Math.PI * base / metres, along[k] / metres);
      if (k < sections && i < ring) {
        const j = k * (ring + 1) + i;
        indices.push(j, j + 1, j + ring + 1, j + 1, j + ring + 2, j + ring + 1);
      }
    }
  }
  // Close the exposed end grain of each taper.
  const cap=vertices.length/3;
  vertices.push(...curve.points.at(-1));
  binding(1,joint);
  branchLink.push(...joint);
  uv.push(.5,along[sections]/metres);
  for(let i=0;i<ring;i++) indices.push(cap,sections*(ring+1)+i,sections*(ring+1)+i+1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("branchLink",new THREE.Float32BufferAttribute(branchLink,3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function willow(parent, x, z, scale, surface, seed, origin) {
  const random = seeded(seed);
  const tree = new THREE.Group();
  tree.name = "Volumetric riverside willow";
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  parent.add(tree);
  const bark = surface("willow-bark", 0xe7e0c9, .90);
  bark.vertexColors = true;
  const green = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .84, side: THREE.DoubleSide });
  const root=new THREE.Vector4(x,0,z,4.8*scale);
  const rig=willowBranchRig(root,scale);
  const previousAnchor=new THREE.Vector3(), currentAir=new THREE.Vector2();
  const longitudinal=new THREE.Vector3(), bent=new THREE.Vector3(), flutter=new THREE.Vector3();
  const angular=new THREE.Quaternion();
  const parts = [], bunches = [];
  const v = (a, b, c) => new THREE.Vector3(a, b, c);
  const shade = new THREE.Color(.89, .84, .78);
  const fixed=[-1,-1,0];
  const add = (points,base,tip,color=shade,joint=null,bearing=0,moving=true) => {
    const curve=new THREE.CatmullRomCurve3(points);
    const segments=base>.18 ? 10 : base>.055 ? 6 : 6;
    const branch=moving ? rig.branch(curve,base,tip,segments,joint,bearing) : null;
    const binding=branch ? (t,out)=>rig.at(branch,t,out) :
      (_,out)=>{out[0]=(joint??fixed)[0];out[1]=(joint??fixed)[1];out[2]=(joint??fixed)[2];};
    const g=limb(curve,base,tip,random,bark.userData.tileMetres,binding);
    tint(g,color);
    parts.push(g);
    return {curve,bind:t=>branch ? rig.atCurve(branch,t) : joint??fixed};
  };
  const trunk = [v(0, 0, 0), v(.11, 1.45, .06), v(-.17, 2.89, .14), v(-.55, 3.92, .02), v(-.61, 4.68, -.24)];
  const stem=add(trunk,.41,.052);
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4;
    add([v(.02, .34, .04), v(Math.cos(a) * .35, .18, Math.sin(a) * .32),
         v(Math.cos(a) * .72, .04, Math.sin(a) * .68)],.18,.018,shade,null,0,false);
  }
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996 + random() * .42;
    const root = trunk[2 + i % 2].clone();
    const distance = 1.25 + random() * 1.76;
    const to = v(Math.cos(a) * distance - .34, 3.95 + .74 * random(), Math.sin(a) * distance);
    const arm = [root, root.clone().lerp(to, .48).add(v(0, .52, 0)), to];
    const main=add(arm,.091+random()*.064,.018,shade,stem.bind((2+i%2)/4),a);
    const armCurve=main.curve;
    for (let j = 0; j < 4; j++) {
      const q = a + (j - 1.5) * .48;
      const hangingT=.64+.115*j;
      const attach=armCurve.getPoint(hangingT);
      const fork = to.clone().add(v(Math.cos(q) * (.30 + random() * .58), .08 + random() * .35,
                                   Math.sin(q) * (.3 + random() * .61)));
      const end = fork.clone().add(v(.03 * j, -.58 - random() * 1.22, .08));
      const arch = fork.clone().add(v(Math.cos(q) * .14, -.10, Math.sin(q) * .14));
      const branch = [attach, attach.clone().lerp(fork, .43), fork, arch, end];
      const hanging=add(branch,.035,.0028,shade,main.bind(hangingT),q);
      const backbone={
        getPoint:(t,target)=>hanging.curve.getPoint(.52+.48*t,target),
        bind:t=>hanging.bind(.52+.48*t),
      };
      const shoots=[{curve:backbone,bind:backbone.bind,q}];
      for(let b=0;b<6;b++){
        const originT=.16+b*.129;
        const attach=backbone.getPoint(originT);
        const bearing=q+(b%2 ? 1.21 : -1.21)+.33*Math.sin(b*3+j);
        const span=.23+.21*(.5+.5*Math.sin(i*2+b*3.7));
        const tender=attach.clone().add(v(Math.cos(bearing)*span,-.34+.044*b,Math.sin(bearing)*span));
        const arc=[attach,attach.clone().lerp(tender,.48).add(v(.016,.077,0)),tender];
        const twig=add(arc,.0039,.0012,new THREE.Color(.77,.74,.62),backbone.bind(originT),bearing,false);
        shoots.push({curve:twig.curve,bind:twig.bind,q:bearing});
      }
      bunches.push(shoots);
    }
  }
  const poseTexture=rig.prepare();
  registerWindCanopy({x:x-.34*scale,z,radius:2.22*scale,bottom:2.25*scale,top:5.12*scale,density:.96,
    pose:rig.windCenter,enabled:()=>parent.visible,name:seed===271 ? "West willow" : "East willow"});
  const pose={texture:{value:poseTexture},nodes:{value:poseTexture.image.width},amount:{value:1}};
  tree.userData.branchMotion={inspect:rig.inspect,controls:rig.opts,pose,point:rig.sample,probePair:rig.probePair};
  bindWillowPose(bark,pose,{root,scale});
  bindWillowPose(green,pose,{root,scale,blade:true});
  lightLeaf(green,.61,true);
  const branches = combine(parts, bark);
  branches.name = "Willow trunk and branches";
  branches.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  bindWillowPose(branches.customDepthMaterial,pose,{root,scale});
  branches.geometry.computeBoundingSphere();
  branches.geometry.boundingSphere.radius+=1.52;
  tree.add(branches);
  const highDetail = 66;
  const leaves = new THREE.InstancedMesh(bladeGeometry(.148,13,4), green, bunches.length * highDetail);
  leaves.name = "Willow canopy leaf instances";
  leaves.userData.minimumVisible=26*bunches.length;
  leaves.receiveShadow = true;
  leaves.castShadow = true;
  leaves.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  bindWillowPose(leaves.customDepthMaterial,pose,{root,scale,blade:true});
  const leaf = new THREE.Object3D();
  const tones = [0x68715a, 0x838866, 0x9a9170, 0x75805d, 0x52684e, 0xb2a681].map(c => new THREE.Color(c));
  let index = 0;
  const candidates=[],leafLinks=new Float32Array(leaves.count*3);
  for (let i = 0; i < highDetail; i++) {
    for (const shoots of bunches) {
      const shoot=shoots[(i*3)%shoots.length];
      const t=.125+.852*random();
      const angle=shoot.q+(i%2 ? 1.24 : -1.24)+.77*(random()-.5);
      shoot.curve.getPoint(t,leaf.position);
      const s = .105 + random() * .14;
      leaf.scale.set(s * (.54 + random()*.25), s, s*.81);
      leaf.quaternion.setFromUnitVectors(v(0,1,0),v(Math.cos(angle),-.48-.8*random(),
        Math.sin(angle)).normalize());
      leaf.rotateY(random()*Math.PI*2);
      leaf.updateMatrix();
      leaves.setMatrixAt(index,leaf.matrix);
      const bind=shoot.bind(t);
      leafLinks.set(bind,index*3);
      if (i<26 && index%7===0 && leaf.position.y>2.5) {
        const projectedX=x+leaf.position.x*scale+.48;
        const projectedZ=z+leaf.position.z*scale+.74;
        if (canalDepth(origin,projectedX,projectedZ)>.09) {
          candidates.push({index,matrix:leaf.matrix.clone(),anchor:leaf.position.clone(),bind});
        }
      }
      leaves.setColorAt(index++, tones[Math.floor(random() * tones.length)]);
    }
  }
  leaves.geometry.setAttribute("branchLink",new THREE.InstancedBufferAttribute(leafLinks,3));
  leaves.computeBoundingSphere();
  leaves.boundingSphere.radius += 1.68;
  tree.add(leaves);
  const hidden=new Map(), vanished=new THREE.Matrix4().makeScale(.00001,.00001,.00001);
  return {tree,leaves,highDetail,twigCount:bunches.length,rig,
    release(time,sequence,sample,threshold) {
      if (!candidates.length) return false;
      const first=(sequence*11+3)%candidates.length;
      const item=candidates.slice(first).find(candidate=>!hidden.has(candidate))
        ?? candidates.find(candidate=>!hidden.has(candidate));
      if (!item) return false;
      const dt=rig.handoff(item.anchor,item.bind,sample.anchor,previousAnchor,angular);
      sample.velocity.copy(sample.anchor).sub(previousAnchor).multiplyScalar(scale/dt);
      const target=tree.localToWorld(sample.anchor);
      const speed=airFromMap(target.x,target.z,currentAir,0,target.y).length();
      const earlier=airFromMap(target.x,target.z,currentAir,.09,target.y).length();
      const strain=speed+.7*Math.max(0,speed-earlier)+.14*sample.velocity.length();
      if(strain<threshold) return false;
      item.matrix.decompose(bent,sample.orientation,sample.scale);
      sample.orientation.premultiply(angular);
      sample.scale.multiplyScalar(scale);
      leafFlutter(target,airUniforms.windTime.value,airUniforms.windOrigin.value,flutter);
      longitudinal.set(0,1,0).applyQuaternion(sample.orientation);
      bent.set(flutter.z*sample.scale.x,sample.scale.y,flutter.x*sample.scale.z)
        .applyQuaternion(sample.orientation).normalize();
      angular.setFromUnitVectors(longitudinal,bent);
      sample.orientation.premultiply(angular);
      leaves.getColorAt(item.index,sample.color);
      sample.strain=strain;
      sample.id=item.index;
      leaves.setMatrixAt(item.index,vanished);
      leaves.instanceMatrix.needsUpdate=true;
      hidden.set(item,time+24);
      return true;
    },
    recover(time) {
      for (const [item,after] of hidden) {
        if (time<after) continue;
        leaves.setMatrixAt(item.index,item.matrix);
        leaves.instanceMatrix.needsUpdate=true;
        hidden.delete(item);
      }
    },
  };
}

function bank(parent, center, surface) {
  const random = seeded(3791);
  const damp = surface("worn-stone", 0xb4b097, .78);
  const origin=canalOrigin(center);
  damp.vertexColors = true;
  const bed = [];
  const rockCells=new Map();
  const reedPositions = [], reedColors = [], reedWeights = [], reedIndices = [], reedUV=[];
  const lengths=12, ribs=4, stride=ribs+1;

  function smoothRock(sx,sy,sz,grain) {
    const stone=new THREE.SphereGeometry(1,18,13);
    const pos=stone.attributes.position;
    for(let i=0;i<pos.count;i++) {
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const domains=.083*Math.sin(x*3.9-y*4.1+z*7.7+grain)+.045*Math.cos(y*11.2-z*8.4+x*3.2);
      const profile=1+domains;
      pos.setXYZ(i,sx*x*profile,sy*y*(profile-.17*Math.max(0,-y)),sz*z*profile);
    }
    stone.computeVertexNormals();
    const unindexed=stone.toNonIndexed();
    stone.dispose();
    return unindexed;
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 52; i++) {
      const z = center.z - 8.6 + i * .37 + (random() - .5) * .46;
      if (Math.abs(z - center.z) < 1.55) continue;
      const clustered = .40 + .39 * Math.sin(z * .87) + .17 * Math.sin(z * 2.3);
      if (random() > clustered) continue;
      const shoreX = center.x + .25 + side * canalShoreRadius(z - center.z + 1.75,side);
      const x = shoreX + side * (-.46 + random() * 1.08);
      const sx=.09+random()*.28, sy=.066+random()*.16, sz=.11+random()*.21;
      const stone=smoothRock(sx,sy,sz,z*2.1+side*.7);
      const yaw=random()*5, y=canalTerrainHeight(origin,x,z)+.027;
      stone.rotateY(yaw);
      stone.translate(x,y,z);
      const cell=Math.floor(z), rock={x,y,z,sx,sy,sz,c:Math.cos(yaw),s:Math.sin(yaw)};
      if(!rockCells.has(cell)) rockCells.set(cell,[]);
      rockCells.get(cell).push(rock);
      tint(stone, new THREE.Color().setScalar(.54 + random() * .31));
      bed.push(stone);
      for (let j=0; j<7; j++) {
        const pz=z+(random()-.5)*.7;
        const px=shoreX+side*(.55-random()*1.85);
        const pebble=new THREE.IcosahedronGeometry(1,1);
        const size=.028+random()*.09;
        pebble.scale(size*(.75+random()),size*.57,size);
        pebble.rotateY(random()*6.28);
        pebble.translate(px,canalTerrainHeight(origin,px,pz)+size*.12,pz);
        tint(pebble,new THREE.Color().setScalar(.46+random()*.43));
        bed.push(pebble);
      }
      if (random() > .64) {
        const offsets = 4 + Math.floor(random()*6);
        for (let j=0; j<offsets; j++) {
          const rootX = shoreX + side*(.01+random()*.29);
          const rootZ = z + (random()-.5)*.58;
          const rootY=canalTerrainHeight(origin,rootX,rootZ);
          const height = .16 + random()*.69;
          const bearing = random()*Math.PI*2;
          const along = .12+random()*.33;
          const width = .013+random()*.022;
          const leaf = new THREE.Color().setRGB(.27,.28,.12).multiplyScalar(.71+random()*.78);
          const first=reedPositions.length/3;
          const leanX=Math.cos(bearing), leanZ=Math.sin(bearing);
          for(let k=0;k<=lengths;k++) {
            const t=k/lengths;
            const curve=along*t*t*(.73+.41*t);
            const twist=Math.sin(bearing*1.7+t*3.71)*.69*t+.14*t;
            const outline=Math.max(.025,Math.pow(Math.sin(Math.PI*(.105+.895*t)),.78));
            const vertical=.012+height*t*(1.09-.24*t*t);
            for(let j=0;j<=ribs;j++) {
              const edge=j/ribs*2-1, w=edge*width*outline;
              const cup=(.29*edge*edge-.07)*width*outline;
              const lift=w*Math.sin(twist)+cup*Math.cos(twist);
              const spread=w*Math.cos(twist)-cup*Math.sin(twist);
              reedPositions.push(rootX+curve*leanX+spread*leanZ,rootY+vertical+lift,
                                 rootZ+curve*leanZ-spread*leanX);
              const ridge=.12*(1-Math.abs(edge)), dried=THREE.MathUtils.smoothstep(t,.85,.99);
              reedColors.push(leaf.r*(.64+t*.5+ridge+dried*.22),
                leaf.g*(.66+t*.46+ridge-dried*.18),leaf.b*(.67+t*.51)+dried*.028);
              reedUV.push(j/ribs,t);
              reedWeights.push(t*t*height);
              const a=first+k*stride+j;
              if(k<lengths && j<ribs) reedIndices.push(a,a+1,a+stride,a+1,a+stride+1,a+stride);
            }
          }
        }
      }
    }
  }
  const stones = combine(bed, damp);
  stones.name = "Damp shoreline stones";
  stones.receiveShadow=true;
  stones.castShadow=true;
  stones.layers.enable(1);
  parent.add(stones);
  const reeds = new THREE.BufferGeometry();
  reeds.setAttribute("position", new THREE.Float32BufferAttribute(reedPositions,3));
  reeds.setAttribute("color", new THREE.Float32BufferAttribute(reedColors,3));
  reeds.setAttribute("uv",new THREE.Float32BufferAttribute(reedUV,2));
  reeds.setAttribute("bendWeight", new THREE.Float32BufferAttribute(reedWeights,1));
  reeds.setIndex(reedIndices);
  reeds.computeVertexNormals();
  const reedMaterial=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.91});
  const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  for(const material of [reedMaterial,depthMaterial]) {
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,airUniforms);
      shader.vertexShader=shader.vertexShader
        .replace("#include <common>",`#include <common>\n${airGLSL}\nattribute float bendWeight;`)
        .replace("#include <begin_vertex>",`#include <begin_vertex>
          vec2 localWind=canalAirAt(position.xz,windTime-.08,position.y);
          float lean=.104*length(localWind)*bendWeight;
          transformed.xz+=localWind*.104*bendWeight;
          transformed.y-=.46*lean*lean/max(.21,bendWeight);
          float flutter=sin(windTime*8.8+position.z*17.4+position.x*7.02);
          transformed.xz+=flutter*vec2(-localWind.y,localWind.x)*bendWeight*.0087;`);
    };
    material.customProgramCacheKey=()=>"canal-bank-reeds-v3";
  }
  lightLeaf(reedMaterial,.59,true);
  const marsh = new THREE.Mesh(reeds,reedMaterial);
  marsh.name = "Slow-bending shallow-water reeds";
  marsh.receiveShadow = true;
  marsh.castShadow=true;
  marsh.customDepthMaterial=depthMaterial;
  marsh.geometry.computeBoundingSphere();
  marsh.geometry.boundingSphere.radius+=1.0;
  parent.add(marsh);
  function rockTop(x,z) {
    if(Math.abs(x-origin.x)<7.18 || Math.abs(x-origin.x)>10.2) return -Infinity;
    const cell=Math.floor(z);
    let top=-Infinity;
    for(let i=cell-1;i<=cell+1;i++) {
      const list=rockCells.get(i);
      if(!list) continue;
      for(const rock of list) {
        const u=x-rock.x,v=z-rock.z;
        if(Math.abs(u)>.43 || Math.abs(v)>.43) continue;
        const room=1-((u*rock.c-v*rock.s)/rock.sx)**2-((u*rock.s+v*rock.c)/rock.sz)**2;
        if(room>0) top=Math.max(top,rock.y+rock.sy*Math.sqrt(room));
      }
    }
    return top;
  }
  return {rockTop,material:damp};
}

export function willowSites(center) {
  return [
    {x:-67.20,z:center.z-5.22,scale:1.13,seed:271},
    {x:-38.74,z:center.z-4.17,scale:1.02,seed:112},
  ];
}

const bridgeWalkways=[
  [-72.64,0,6.24,2.84,1457],
  [-43.68,-.29,9.58,3.29,835],
];

export function walkwayHeight(center,x,z) {
  let height=0;
  for(const [px,offset,width,depth] of bridgeWalkways) {
    const edge=Math.min(width*.5-Math.abs(x-px),depth*.5-Math.abs(z-center.z-offset));
    height=Math.max(height,.048*THREE.MathUtils.smoothstep(edge,0,.2));
  }
  return height;
}

export function buildForeground(parent, center, surface) {
  const foreground = new THREE.Group();
  foreground.name = "Bridge-head near field";
  parent.add(foreground);
  for (const [x, offset, width, depth, seed] of bridgeWalkways) {
    flagstones(foreground, x, center.z+offset, width, depth, surface, seed);
  }
  const shore=bank(foreground,center,surface);
  const origin=canalOrigin(center);
  const canopies=willowSites(center).map(({x,z,scale,seed})=>
    willow(foreground,x,z,scale,surface,seed,origin));
  return {
    setVisible(visible) { foreground.visible = visible; },
    shedLeaf:canopies[0].release,
    inspect() { return { time:airUniforms.windTime.value,leafCounts:canopies.map(({leaves})=>leaves.count),
      branchMotion:canopies.map(({rig})=>rig.inspect()) }; },
    floor:(x,z)=>walkwayHeight(center,x,z),
    shore,
    update(camera,time,dt) {
      for(const {tree,leaves,highDetail,twigCount,recover,rig} of canopies) {
        rig.frame(dt);
        recover(time);
        const distance = camera.position.distanceTo(tree.position);
        const level = 1 - THREE.MathUtils.smoothstep(distance, 8, 25);
        leaves.count = twigCount * Math.round(26 + (highDetail - 26) * level);
      }
    },
  };
}
