import * as THREE from "three";
import { willowPosition, willowWind } from "./bridge-wind.js";
import { canalDepth, canalOrigin, canalShoreRadius, waterHeight } from "./bridge-canal-bed.js";
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

export function flagstones(parent, x, z, width, depth, surface, seed, relief=1) {
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
      const h = (.035 + random() * .025)*relief;
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

function limb(points, base, tip, random, metres) {
  const curve = new THREE.CatmullRomCurve3(points);
  const ring = 9;
  const sections = points.length === 3 ? 6 : 11;
  const frames = curve.computeFrenetFrames(sections, false);
  const along = curve.getLengths(sections);
  const vertices = [], uv = [], indices = [];
  const variation = Array.from({ length: ring }, () => .84 + .26 * random());
  for (let k = 0; k <= sections; k++) {
    const t = k / sections;
    const c = curve.getPoint(t);
    const radius = THREE.MathUtils.lerp(base, tip, Math.pow(t, .75));
    for (let i = 0; i <= ring; i++) {
      const a = i / ring * Math.PI * 2;
      const thick = radius * variation[i % ring];
      const p = c.clone().addScaledVector(frames.normals[k], Math.cos(a) * thick)
        .addScaledVector(frames.binormals[k], Math.sin(a) * thick);
      vertices.push(...p);
      uv.push(i / ring * 2 * Math.PI * base / metres, along[k] / metres);
      if (k < sections && i < ring) {
        const j = k * (ring + 1) + i;
        indices.push(j, j + 1, j + ring + 1, j + 1, j + ring + 2, j + ring + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function leafShape() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    0, .0, 0, -.095, .21, .006, -.132, .44, .016, -.077, .72, .020, 0, 1, -.036,
    .079, .72, .019, .134, .44, .018, .10, .21, .006, 0, .53, .068,
  ], 3));
  g.setIndex(Array.from({ length: 8 }, (_, i) => [i, (i + 1) % 8, 8]).flat());
  g.computeVertexNormals();
  return g;
}

function willow(parent, x, z, scale, surface, seed, windTime, origin) {
  const random = seeded(seed);
  const tree = new THREE.Group();
  tree.name = "Volumetric riverside willow";
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  parent.add(tree);
  const bark = surface("willow-bark", 0xe7e0c9, .90);
  bark.vertexColors = true;
  const green = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .84, side: THREE.DoubleSide });
  const phase = .018 * seed;
  willowWind(bark, windTime, phase);
  willowWind(green, windTime, phase, true);
  const parts = [], bunches = [];
  const v = (a, b, c) => new THREE.Vector3(a, b, c);
  const shade = new THREE.Color(.89, .84, .78);
  const add = (points, base, tip, color = shade) => {
    const g = limb(points, base, tip, random, bark.userData.tileMetres);
    tint(g, color);
    parts.push(g);
  };
  const trunk = [v(0, 0, 0), v(.11, 1.45, .06), v(-.17, 2.89, .14), v(-.55, 3.92, .02), v(-.61, 4.68, -.24)];
  add(trunk, .41, .052);
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4;
    add([v(.02, .34, .04), v(Math.cos(a) * .35, .18, Math.sin(a) * .32),
         v(Math.cos(a) * .72, .04, Math.sin(a) * .68)], .18, .018);
  }
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996 + random() * .42;
    const root = trunk[2 + i % 2].clone();
    const distance = 1.25 + random() * 1.76;
    const to = v(Math.cos(a) * distance - .34, 3.95 + .74 * random(), Math.sin(a) * distance);
    const arm = [root, root.clone().lerp(to, .48).add(v(0, .52, 0)), to];
    add(arm, .091 + random() * .064, .018);
    for (let j = 0; j < 4; j++) {
      const q = a + (j - 1.5) * .48;
      const fork = to.clone().add(v(Math.cos(q) * (.30 + random() * .58), .15 + random() * .86,
                                   Math.sin(q) * (.3 + random() * .61)));
      add([arm[1].clone().lerp(to, .48 + .12 * j), to.clone().lerp(fork, .3), fork], .035, .006);
      const end = fork.clone().add(v(.03 * j, -.58 - random() * 1.22, .08));
      const droop = [fork, fork.clone().lerp(end, .35).add(v(.18, .035, .05)), end];
      add(droop, .010, .0028);
      bunches.push(new THREE.CatmullRomCurve3(droop));
    }
  }
  const branches = combine(parts, bark);
  branches.name = "Willow trunk and branches";
  branches.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  willowWind(branches.customDepthMaterial, windTime, phase);
  tree.add(branches);
  const highDetail = 66;
  const leaves = new THREE.InstancedMesh(leafShape(), green, bunches.length * highDetail);
  leaves.name = "Willow canopy leaf instances";
  leaves.receiveShadow = true;
  leaves.castShadow = true;
  leaves.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  willowWind(leaves.customDepthMaterial, windTime, phase, true);
  const leaf = new THREE.Object3D();
  const tones = [0x68715a, 0x838866, 0x9a9170, 0x75805d, 0x52684e, 0xb2a681].map(c => new THREE.Color(c));
  let index = 0;
  const candidates=[];
  for (let i = 0; i < highDetail; i++) {
    for (const branch of bunches) {
      const t = random();
      const angle = random() * Math.PI * 2;
      const spread = (.13 + .22 * Math.sin(Math.PI * t)) * Math.sqrt(random());
      branch.getPoint(t, leaf.position);
      leaf.position.add(v(Math.cos(angle) * spread, random() * .24 - .08, Math.sin(angle) * spread));
      const s = .105 + random() * .14;
      leaf.scale.set(s * (.54 + random()*.25), s, s*.81);
      leaf.rotation.set(2 + random() * 1.4, angle, (random() - .5) * 1.7);
      leaf.updateMatrix();
      leaves.setMatrixAt(index, leaf.matrix);
      if (i<26 && index%7===0 && leaf.position.y>2.5) {
        const projectedX=x+leaf.position.x*scale+.48;
        const projectedZ=z+leaf.position.z*scale+.74;
        if (canalDepth(origin,projectedX,projectedZ)>.09) {
          candidates.push({ index, matrix:leaf.matrix.clone(), anchor:leaf.position.clone() });
        }
      }
      leaves.setColorAt(index++, tones[Math.floor(random() * tones.length)]);
    }
  }
  leaves.computeBoundingSphere();
  leaves.boundingSphere.radius += .33;
  tree.add(leaves);
  const hidden=new Map(), vanished=new THREE.Matrix4().makeScale(.00001,.00001,.00001);
  return { tree, leaves, highDetail, twigCount:bunches.length,
    release(time,sequence,target) {
      if (!candidates.length) return false;
      const first=(sequence*11+3)%candidates.length;
      const item=candidates.slice(first).find(candidate=>!hidden.has(candidate))
        ?? candidates.find(candidate=>!hidden.has(candidate));
      if (!item) return false;
      willowPosition(item.anchor,time,phase,target);
      tree.localToWorld(target);
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

function bank(parent, center, surface, windTime) {
  const random = seeded(3791);
  const damp = surface("worn-stone", 0xb4b097, .78);
  const origin=canalOrigin(center);
  damp.vertexColors = true;
  const bed = [];
  const reedPositions = [], reedColors = [], reedWeights = [], reedIndices = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 52; i++) {
      const z = center.z - 8.6 + i * .37 + (random() - .5) * .46;
      if (Math.abs(z - center.z) < 1.55) continue;
      const clustered = .40 + .39 * Math.sin(z * .87) + .17 * Math.sin(z * 2.3);
      if (random() > clustered) continue;
      const shoreX = center.x + .25 + side * canalShoreRadius(z - center.z + 1.75,side);
      const x = shoreX + side * (-.46 + random() * 1.08);
      const stone = new THREE.IcosahedronGeometry(1, 1);
      stone.scale(.09 + random() * .28, .066 + random() * .16, .11 + random() * .21);
      stone.rotateY(random() * 5);
      stone.translate(x,Math.min(0,waterHeight-canalDepth(origin,x,z))+.049,z);
      tint(stone, new THREE.Color().setScalar(.54 + random() * .31));
      bed.push(stone);
      for (let j=0; j<7; j++) {
        const pz=z+(random()-.5)*.7;
        const px=shoreX+side*(.55-random()*1.85);
        const pebble=new THREE.IcosahedronGeometry(1,0);
        const size=.028+random()*.09;
        pebble.scale(size*(.75+random()),size*.57,size);
        pebble.rotateY(random()*6.28);
        pebble.translate(px,Math.min(0,waterHeight-canalDepth(origin,px,pz))+size*.16,pz);
        tint(pebble,new THREE.Color().setScalar(.46+random()*.43));
        bed.push(pebble);
      }
      if (random() > .64) {
        const offsets = 4 + Math.floor(random()*6);
        for (let j=0; j<offsets; j++) {
          const rootX = shoreX + side*(.01+random()*.29);
          const rootZ = z + (random()-.5)*.58;
          const height = .16 + random()*.69;
          const bearing = random()*Math.PI*2;
          const along = .12+random()*.33;
          const width = .013+random()*.022;
          const leaf = new THREE.Color().setRGB(.27,.28,.12).multiplyScalar(.71+random()*.78);
          const first = reedPositions.length/3;
          for (let k=0; k<5; k++) {
            const t = k/4;
            const curve = along*t*t;
            for (const edge of [-1,1]) {
              const w = edge*width*Math.max(.02,1-t);
              reedPositions.push(rootX+curve*Math.cos(bearing)+w*Math.sin(bearing),
                                  .012+height*t,rootZ+curve*Math.sin(bearing)-w*Math.cos(bearing));
              reedColors.push(leaf.r*(.64+t*.5),leaf.g*(.66+t*.46),leaf.b*(.67+t*.51));
              reedWeights.push(t*t*height);
            }
            const a = first+k*2;
            if (k<4) reedIndices.push(a,a+1,a+2,a+1,a+3,a+2);
          }
        }
      }
    }
  }
  const stones = combine(bed, damp);
  stones.name = "Damp shoreline stones";
  stones.layers.enable(1);
  parent.add(stones);
  const reeds = new THREE.BufferGeometry();
  reeds.setAttribute("position", new THREE.Float32BufferAttribute(reedPositions,3));
  reeds.setAttribute("color", new THREE.Float32BufferAttribute(reedColors,3));
  reeds.setAttribute("bendWeight", new THREE.Float32BufferAttribute(reedWeights,1));
  reeds.setIndex(reedIndices);
  reeds.computeVertexNormals();
  const reedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .91 });
  reedMaterial.onBeforeCompile = shader => {
    shader.uniforms.windTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime; attribute float bendWeight;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float localGust = .12*sin(windTime*1.7+position.z*.72)+.084*sin(windTime*2.7+position.x*.8);
        transformed.xz += vec2(localGust,localGust*.72)*bendWeight;`);
  };
  reedMaterial.customProgramCacheKey = () => "canal-bank-reeds";
  const marsh = new THREE.Mesh(reeds,reedMaterial);
  marsh.name = "Slow-bending shallow-water reeds";
  marsh.receiveShadow = true;
  parent.add(marsh);
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
  const windTime = { value: 0 };
  bank(foreground, center, surface, windTime);
  const origin=canalOrigin(center);
  const canopies=willowSites(center).map(({x,z,scale,seed})=>
    willow(foreground,x,z,scale,surface,seed,windTime,origin));
  return {
    setVisible(visible) { foreground.visible = visible; },
    shedLeaf:canopies[0].release,
    inspect() { return { time: windTime.value, leafCounts: canopies.map(({ leaves }) => leaves.count) }; },
    floor:(x,z)=>walkwayHeight(center,x,z),
    update(camera, time) {
      windTime.value = time;
      for (const { tree, leaves, highDetail, twigCount, recover } of canopies) {
        recover(time);
        const distance = camera.position.distanceTo(tree.position);
        const level = 1 - THREE.MathUtils.smoothstep(distance, 8, 25);
        leaves.count = twigCount * Math.round(26 + (highDetail - 26) * level);
      }
    },
  };
}
