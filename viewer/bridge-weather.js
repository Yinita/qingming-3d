import * as THREE from "three";
import { createGroundPuddles } from "./bridge-puddles.js";
import { roadsideHollows } from "./bridge-street-ground.js";

const {clamp,damp,smoothstep}=THREE.MathUtils;
const area={x:-111,z:-55,width:77,depth:35};
const cell=.25, columns=area.width/cell, rows=area.depth/cell;
const roofLevel=(profile,z)=>profile.eave+(profile.run-z)*profile.slope+.129*(z/profile.run)**4+.05;

function collectRoofs(groups) {
  const roofs=[];
  for(const group of groups) {
    group.updateWorldMatrix(true,true);
    group.traverse(mesh=>{
      const profile=mesh.userData.roofProfile;
      if(!profile) return;
      const matrix=mesh.matrixWorld.clone();
      const e=matrix.elements;
      const a=e[0],b=e[8],c=e[2],k=e[10],up=e[5];
      const wx=e[12],wy=e[13],wz=e[14],det=a*k-b*c;
      if(Math.abs(det)<.00001) return;
      roofs.push({
        mesh,profile,matrix,remaining:0,
        height(x,z) {
          const dx=x-wx,dz=z-wz;
          const lx=(k*dx-b*dz)/det,lz=(a*dz-c*dx)/det;
          const distance=Math.abs(lz-profile.centreZ);
          if(distance>profile.run || Math.abs(lx)>profile.width*.5) return -Infinity;
          return wy+up*roofLevel(profile,distance);
        },
      });
    });
  }
  return roofs;
}

function batch(parent,name,capacity,vertex,fragment,layout) {
  const plane=new THREE.PlaneGeometry(1,1);
  const geometry=new THREE.InstancedBufferGeometry().copy(plane);
  plane.dispose();
  const attributes=layout.map(([name,size])=>{
    const attribute=new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name,attribute);
    return attribute;
  });
  geometry.instanceCount=0;
  const material=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;
  mesh.name=name;
  mesh.renderOrder=12;
  parent.add(mesh);
  return {attributes,draw(count) {
    geometry.instanceCount=count;
    if(!count) return;
    for(const attr of attributes) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0,count*attr.itemSize);
      attr.needsUpdate=true;
    }
  }};
}

const streakVertex=`
  attribute vec3 dropHead,dropVelocity,dropShape;
  varying vec2 st;
  varying float opacity;
  void main() {
    vec3 view=normalize(cameraPosition-dropHead);
    vec3 axis=normalize(dropVelocity);
    vec3 across=normalize(cross(axis,view)+vec3(.00001,0.,.00001));
    vec3 world=dropHead-axis*(.5-position.y)*dropShape.x+across*position.x*dropShape.y;
    gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
    st=uv;
    opacity=dropShape.z;
  }
`;
const streakFragment=`
  varying vec2 st;
  varying float opacity;
  void main() {
    float core=1.-smoothstep(.06,.5,abs(st.x-.5));
    float ends=smoothstep(.03,.62,st.y)*(1.-smoothstep(.86,1.,st.y));
    gl_FragColor=vec4(.59,.70,.65,opacity*core*ends);
    #include <colorspace_fragment>
  }
`;
const ringVertex=`
  attribute vec3 impact;
  attribute vec2 rippleShape;
  varying vec2 disk;
  varying float alpha;
  void main() {
    vec3 point=impact+vec3(position.x,0.,position.y)*rippleShape.x;
    disk=position.xy*2.;
    alpha=rippleShape.y;
    gl_Position=projectionMatrix*viewMatrix*vec4(point,1.);
  }
`;
const ringFragment=`
  varying vec2 disk;
  varying float alpha;
  void main() {
    float r=length(disk);
    float rim=1.-smoothstep(.014,.17,abs(r-.75));
    float echo=1.-smoothstep(.018,.13,abs(r-.47));
    gl_FragColor=vec4(.57,.68,.65,alpha*(rim+.26*echo));
    #include <colorspace_fragment>
  }
`;

function weatherMaterial(material,coat,kind) {
  const before=material.onBeforeCompile, cache=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer) {
    before.call(this,shader,renderer);
    Object.assign(shader.uniforms,coat);
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec2 dampPosition;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\ndampPosition=(modelMatrix*vec4(position,1.)).xz;");
    const blend=kind==="roof" ? "1." : "1.-.98*smoothstep(.10,.75,moisture.g)";
    const puddles=kind==="ground" ? "moisture.r" : "0.";
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        varying vec2 dampPosition;
        uniform sampler2D rainTerrain;
        uniform vec4 rainBounds;
        uniform float rainFilm;`)
      .replace("#include <alphamap_fragment>",`#include <alphamap_fragment>
        float film=0., pooled=0.;
        if(rainFilm>.001) {
          vec2 rainUV=(dampPosition-rainBounds.xy)*rainBounds.zw;
          vec2 moisture=texture2D(rainTerrain,rainUV).rg;
          float inDistrict=step(0.,min(rainUV.x,rainUV.y))*step(max(rainUV.x,rainUV.y),1.);
          film=rainFilm*(${blend})*inDistrict;
          pooled=${puddles}*smoothstep(.17,.74,film);
          diffuseColor.rgb*=mix(vec3(1.),vec3(.49,.55,.55),film*.80);
          diffuseColor.rgb*=mix(vec3(1.),vec3(.69,.73,.70),pooled*.38);
        }`)
      .replace("#include <metalnessmap_fragment>",`#include <metalnessmap_fragment>
        roughnessFactor=mix(roughnessFactor,.35,film*.81);
        roughnessFactor=mix(roughnessFactor,.28,pooled*.45);`);
  };
  material.customProgramCacheKey=()=>cache+"-district-rain-"+kind;
  material.needsUpdate=true;
}

const groundNames=new Set(["West bridge approach","East bridge approach","Stone threshold","Sediment at paving joints",
  "Inset street paving and gravel","Kitchen garden stone path","Grain-store flagstone landing",
  "Grain-store threshold step","Tea stall flagstones","Warehouse loading flagstones","North lane receiving flagstones",
  "Pointed flagstone bedding"]);

export function createBridgeWeather({root,street,ground,surface,depthAt,onBridge,water}) {
  const group=new THREE.Group();
  group.name="Bridge district weather";
  group.visible=false;
  root.add(group);
  const roofs=collectRoofs([root,street]);
  function roofAt(x,z) {
    let y=-Infinity;
    for(const roof of roofs) y=Math.max(y,roof.height(x,z));
    return y;
  }
  const field=new Uint8Array(columns*rows*4);
  const top=new Float32Array(columns*rows).fill(-Infinity);
  const land=new Float32Array(columns*rows), canalCells=new Uint8Array(columns*rows);
  const depressions=[...roadsideHollows,[-72.15,-43.11,.74,.41],[-44.62,-40.87,.91,.43],
    [-45.31,-40.50,.62,.35],[-41.73,-39.42,.77,.48],[-70.24,-44.73,.70,.32]];
  const puddles=createGroundPuddles(group,depressions,surface,(x,z)=>
    !Number.isFinite(roofAt(x,z)) && !onBridge(x,z) && depthAt(x,z)<=.013);
  for(let j=0;j<rows;j++) for(let i=0;i<columns;i++) {
    const x=area.x+(i+.5)*cell,z=area.z+(j+.5)*cell,index=j*columns+i;
    const roof=roofAt(x,z);
    top[index]=roof;
    canalCells[index]=Number(depthAt(x,z)>.013 && !onBridge(x,z));
    land[index]=canalCells[index] ? .016 : surface(x,z);
    field[index*4+1]=Number(Number.isFinite(roof))*255;
    if(Number.isFinite(roof) || onBridge(x,z) || depthAt(x,z)) continue;
    let pool=0;
    for(const [px,pz,rx,rz] of depressions) {
      const radial=Math.hypot((x-px)/rx,(z-pz)/rz)+.19*Math.sin(x*13+z*8)*Math.sin(z*10-x*3);
      pool=Math.max(pool,1-smoothstep(radial,.42,1.12));
    }
    field[index*4]=Math.round(pool*255);
  }
  const texture=new THREE.DataTexture(field,columns,rows,THREE.RGBAFormat);
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate=true;
  const coat={rainTerrain:{value:texture},rainBounds:{value:new THREE.Vector4(area.x,area.z,1/area.width,1/area.depth)},
    rainFilm:{value:0}};
  const materials=new Map([[ground.userData.perspectiveMaterial,"ground"]]);
  for(const roof of roofs) materials.set(roof.mesh.material,"roof");
  for(const model of [root,street]) model.traverse(mesh=>{
    if(groundNames.has(mesh.name)) materials.set(mesh.material,"ground");
    if(mesh.name==="Wooden bridge deck" || mesh.name==="Wooden field footbridge deck") materials.set(mesh.material,"deck");
  });
  for(const [material,type] of materials) weatherMaterial(material,coat,type);

  const capacity=2000, ripples=300;
  const rain=batch(group,"Rain streaks and eave drips",capacity,streakVertex,streakFragment,
    [["dropHead",3],["dropVelocity",3],["dropShape",3]]);
  const rings=batch(group,"Rain impacts in canal and puddles",ripples,ringVertex,ringFragment,
    [["impact",3],["rippleShape",2]]);
  const drops=[],impacts=[];
  const freeDrops=[],freeImpacts=[];
  const counts={roof:0,river:0,ground:0,puddle:0,eaves:0,eaveLandings:0,shelteredGround:0,wetSteps:0,npcWetSteps:0};
  const dripPosition=new THREE.Vector3();
  let seed=764819,carry=0,intensity=0,film=0,dampClothes=0,storm=false,sheltered=false;
  function random() {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  }
  function fieldIndex(x,z) {
    const i=Math.floor((x-area.x)/cell),j=Math.floor((z-area.z)/cell);
    return i>=0 && i<columns && j>=0 && j<rows ? j*columns+i : -1;
  }
  function spawn(x,y,z,vy,drip) {
    if(drops.length>=capacity) return;
    const drop=freeDrops.pop()??{};
    Object.assign(drop,{x,y,z,vx:drip ? .08 : .87,vy,vz:drip ? .09 : .36,drip,variation:random()});
    drops.push(drop);
  }
  function splash(x,z,time,river) {
    if(impacts.length>=ripples) return;
    const event=freeImpacts.pop()??{};
    Object.assign(event,{x,z,time,river,scale:.6+.66*random()});
    impacts.push(event);
  }
  function advance(dt,time,player) {
    intensity=damp(intensity,Number(storm),storm ? 1.2 : 2.1,dt);
    if(!storm && intensity<.001) intensity=0;
    film=damp(film,intensity,storm ? .24 : .045,dt);
    coat.rainFilm.value=film;
    sheltered=Number.isFinite(roofAt(player.x,player.z));
    dampClothes=damp(dampClothes,sheltered ? 0 : intensity,sheltered ? .16 : .42,dt);
    const level=intensity;
    carry+=dt*1620*level;
    for(let n=Math.floor(carry);n>0;n--,carry--) {
      const near=random()<.46;
      const x=player.x+(random()-.5)*(near ? 13 : 32),z=player.z+(random()-.5)*(near ? 11 : 24);
      spawn(x,8.9+random()*2.7,z,-7.8-random()*4.9,false);
    }
    for(const roof of roofs) {
      const {profile,matrix}=roof;
      const x=matrix.elements[12],z=matrix.elements[14];
      if(Math.abs(x-player.x)>16 || Math.abs(z-player.z)>12) continue;
      roof.remaining+=dt*level*film*profile.width*.89;
      while(roof.remaining>=1) {
        roof.remaining--;
        dripPosition.set((random()-.5)*profile.width,roofLevel(profile,profile.run)-.066,
          profile.centreZ+(random()<.5 ? -1 : 1)*(profile.run+.18)).applyMatrix4(matrix);
        spawn(dripPosition.x,dripPosition.y,dripPosition.z,-2.4,true);
        counts.eaves++;
      }
    }
    for(let i=drops.length-1;i>=0;i--) {
      const drop=drops[i];
      drop.x+=drop.vx*dt; drop.z+=drop.vz*dt; drop.y+=drop.vy*dt;
      if(drop.drip) drop.vy-=8.4*dt;
      const {x,y,z,drip}=drop;
      const index=fieldIndex(x,z);
      const approximate=top[index]??-Infinity;
      const outside=Math.abs(x-player.x)>19 || Math.abs(z-player.z)>15;
      if(!outside && y>Math.max(approximate+.5,4.6)) continue;
      const roof=drip || outside ? -Infinity : roofAt(x,z);
      const covered=!drip && y<=roof;
      if(!outside && !covered && y>(land[index]??0)+.20) continue;
      const canal=!covered && !outside && depthAt(x,z)>.013 && !onBridge(x,z);
      const ground=outside || covered || canal ? 0 : surface(x,z);
      const pool=outside || covered || canal ? -Infinity : puddles.heightAt(x,z,ground);
      const bottom=canal ? water(x,z,time) : Math.max(ground,pool);
      if(!covered && y>bottom && !outside) continue;
      if(covered) counts.roof++;
      else if(!outside) {
        if(drip) counts.eaveLandings++;
        if(canal) {
          counts.river++;
          if(random()<.28) splash(x,z,time,true);
        } else {
          counts.ground++;
          if(!drip && Number.isFinite(roof)) counts.shelteredGround++;
          if(Number.isFinite(pool)) {
            counts.puddle++;
            splash(x,z,time,false);
          }
        }
      }
      freeDrops.push(drop);
      drops[i]=drops[drops.length-1];
      drops.pop();
    }
    for(let i=impacts.length-1;i>=0;i--) if(time-impacts[i].time>.52) {
      freeImpacts.push(impacts[i]);
      impacts[i]=impacts[impacts.length-1];
      impacts.pop();
    }
  }
  function draw(time) {
    const [head,velocity,shape]=rain.attributes;
    for(const [i,d] of drops.entries()) {
      head.setXYZ(i,d.x,d.y,d.z);
      velocity.setXYZ(i,d.vx,d.vy,d.vz);
      shape.setXYZ(i,Math.abs(d.vy)*(d.drip ? .024 : .043),.008+d.variation*.011,d.drip ? .76 : .51);
    }
    rain.draw(drops.length);
    const [contact,ring]=rings.attributes;
    let count=0;
    for(const event of impacts) {
      if(!event.river) continue;
      const t=clamp((time-event.time)/.52,0,1);
      const y=water(event.x,event.z,time);
      contact.setXYZ(count,event.x,y+.008,event.z);
      ring.setXY(count++,Math.max(.014,(.032+t*.26)*event.scale),(.26+.12*event.scale)*(1-t)**1.6);
    }
    rings.draw(count);
  }
  return {
    get active() { return storm; },
    get intensity() { return intensity; },
    get film() { return film; },
    get clothing() { return dampClothes; },
    get sheltered() { return sheltered; },
    toggle() { storm=!storm; },
    traction(x,z) {
      if(film<.001) return 1;
      if(Number.isFinite(roofAt(x,z))) return 1-film*.02;
      return 1-film*(Number.isFinite(puddles.heightAt(x,z,surface(x,z))) ? .18 : .09);
    },
    groundMoisture(x,y,z) {
      if(film<.001 || fieldIndex(x,z)<0) return {wet:0,pool:false};
      const wet=Number.isFinite(roofAt(x,z)) ? film*.02 : film;
      return {wet,pool:wet>.10 && puddles.heightAt(x,z,y)-y>.0041};
    },
    footstep(x,y,z,time,source) {
      const pool=puddles.heightAt(x,z,y);
      if(!Number.isFinite(pool)) return false;
      splash(x,z,time,false);
      counts[source==="player" ? "wetSteps" : "npcWetSteps"]++;
      return true;
    },
    frame(dt,time,player) {
      if(!storm && intensity<.001 && film<.001 && !drops.length && !impacts.length) return;
      advance(dt,time,player);
      puddles.frame(film,time,impacts,player);
      draw(time);
    },
    prepare:puddles.prepare,
    show(active) {
      group.visible=active;
      coat.rainFilm.value=active ? film : 0;
    },
    reset() {
      storm=sheltered=false;
      intensity=film=dampClothes=carry=coat.rainFilm.value=0;
      freeDrops.push(...drops.splice(0));
      freeImpacts.push(...impacts.splice(0));
      for(const key of Object.keys(counts)) counts[key]=0;
      for(const roof of roofs) roof.remaining=0;
      puddles.reset();
      draw(0);
    },
    inspect:()=>({storm,intensity,film,dampClothes,sheltered,roofs:roofs.length,
      droplets:drops.length,ripples:impacts.length,counts:{...counts},puddles:puddles.inspect()}),
  };
}
