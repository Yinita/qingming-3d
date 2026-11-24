import * as THREE from "three";
import { airFromMap, registerWindBuilding } from "./bridge-air.js";
import { canopyCatch } from "./bridge-rain-canopy.js";
import { makeRainRipples } from "./bridge-rain-ripples.js";
import { makeShelterIndex, rasterRainRoof } from "./bridge-rain-roofs.js";
import { collectRainSurfaces, rainWetSurface, roofLevel, wetGroundMaterial, wetMaterial } from "./bridge-rain-surfaces.js";

const capacity=2600;
const AIR=0, EAVE=1, LEAF=2, SPRAY=3;
const {lerp,smoothstep,clamp}=THREE.MathUtils;
const noBead=()=>{};

const streakVertex=`
  attribute vec3 dropHead;
  attribute vec3 dropVelocity;
  attribute vec3 dropShape;
  varying vec2 st;
  varying float brightness;
  void main() {
    vec3 eye=normalize(cameraPosition-dropHead);
    vec3 axis=normalize(dropVelocity+vec3(.0001,.0001,0.));
    vec3 across=normalize(cross(axis,eye)+vec3(.00001,0.,.00001));
    vec3 point=dropHead-axis*(.5-position.y)*dropShape.x+across*position.x*dropShape.y;
    float glare=.57+.43*pow(max(0.,dot(eye,vec3(-.43,.55,.716))),3.);
    brightness=dropShape.z*glare;
    st=uv;
    gl_Position=projectionMatrix*viewMatrix*vec4(point,1.);
  }
`;
const streakFragment=`
  varying vec2 st;
  varying float brightness;
  void main() {
    float core=1.-smoothstep(.11,.5,abs(st.x-.5));
    float ends=smoothstep(.03,.71,st.y)*(1.-smoothstep(.87,1.,st.y));
    gl_FragColor=vec4(vec3(.71,.79,.73),brightness*core*ends);
    #include <colorspace_fragment>
  }
`;

function dropsMesh(group) {
  const base=new THREE.PlaneGeometry(1,1);
  const geo=new THREE.InstancedBufferGeometry().copy(base);
  base.dispose();
  const attrs=["dropHead","dropVelocity","dropShape"].map(name=>{
    const attr=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3);
    geo.setAttribute(name,attr);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
  });
  geo.instanceCount=0;
  const mat=new THREE.ShaderMaterial({vertexShader:streakVertex,fragmentShader:streakFragment,
    transparent:true,depthWrite:false,forceSinglePass:true});
  const mesh=new THREE.Mesh(geo,mat);
  mesh.name="Wind-driven rain and runoff streaks";
  mesh.frustumCulled=false;
  mesh.renderOrder=12;
  group.add(mesh);
  return {
    draw(active,x0,z0,spanX,spanZ) {
      const [head,velocity,shape]=attrs;
      geo.instanceCount=active.length;
      for(const [i,drop] of active.entries()) {
        head.setXYZ(i,drop.x,drop.y,drop.z);
        velocity.setXYZ(i,drop.vx,drop.vy,drop.vz);
        const speed=Math.hypot(drop.vx,drop.vy,drop.vz);
        const mist=drop.kind===SPRAY;
        const width=mist ? .008+drop.mass*.009 : .006+drop.mass*.010;
        const edge=Math.min(drop.x-x0,x0+spanX-drop.x,drop.z-z0,z0+spanZ-drop.z);
        const opacity=(mist ? .67 : drop.kind===AIR ? .64 : .93)*smoothstep(edge,-1.2,2.3);
        shape.setXYZ(i,Math.max(width,speed*(mist ? .021 : .031)),width,opacity);
      }
      if(!active.length) return;
      for(const attr of attrs) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0,active.length*3);
        attr.needsUpdate=true;
      }
    },
  };
}

function beadsMesh(group) {
  const mat=new THREE.MeshPhysicalMaterial({color:0xc5d5c5,roughness:.095,clearcoat:1,clearcoatRoughness:.09,
    transparent:true,opacity:.72,metalness:.18,depthWrite:false});
  const mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,9,6),mat,112);
  mesh.name="Water beads held at willow leaf tips";
  mesh.count=0;
  mesh.frustumCulled=false;
  mesh.renderOrder=13;
  const transform=new THREE.Matrix4();
  let sample=null;
  group.add(mesh);
  return {
    begin() { mesh.count=0; sample=null; },
    append(x,y,z,r) {
      if(mesh.count===112) return;
      transform.makeScale(r,r*1.3,r).setPosition(x,y,z);
      mesh.setMatrixAt(mesh.count++,transform);
      if(!sample || x<sample.x) sample={x,y,z,radius:r};
    },
    commit() { mesh.instanceMatrix.needsUpdate=mesh.count>0; },
    count:()=>mesh.count,
    sample:()=>sample,
  };
}

export function makeCanalRain({root,street,stall,ground,center,water,depthAt,groundAt,bridgeAt,onBridge}) {
  const group=new THREE.Group();
  group.name="Rain over the bridge district";
  root.add(group);
  const width=41,length=31, fixedX=center.x-18,fixedZ=center.z-16;
  let x0=fixedX,z0=fixedZ, highest=9;
  const worldWidth=ground.geometry.parameters.width, worldDepth=ground.geometry.parameters.height;
  const worldBounds=new THREE.Vector4(-worldWidth*.5,-worldDepth,1/worldWidth,1/worldDepth);
  const bounds=new THREE.Vector4(x0,z0,1/width,1/length);
  const {roofs,canopies}=collectRainSurfaces(street.root,root,stall);
  const cityCrowns=street.rainCrowns;
  const crowns=[...canopies,...cityCrowns].map(canopy=>({canopy,catcher:canopyCatch(canopy)}));
  let nearbyCrowns=[];
  const shelter=makeShelterIndex(roofLevel);
  roofs.forEach(roof=>shelter.add(roof));
  const registered=new Set();
  const intensity={value:0};
  const roofClock={value:0};
  const mirror={rainMirror:water.mirror,rainMirrorUV:water.mirrorUV,rainMirrorReady:{value:0},...water.mirrorFilter};
  const wet=rainWetSurface(worldBounds,{
    roofCover:(x,z)=>shelter.cover(x,z),
    foundation:(x,z)=>shelter.at(x,z).some(roof=>roof.enabled() && roof.foundation(x,z)),
    onDeck:onBridge,groundAt,depthAt,
  });
  const ripples=makeRainRipples(bounds);
  const runoffOptics={value:1};
  Object.assign(water.material.uniforms,ripples.uniforms,{rainIntensity:intensity,runoffOptics});
  water.material.defines.RAIN_SURFACE=1;
  water.material.needsUpdate=true;
  const coating={...wet.uniforms,...ripples.uniforms};
  wetGroundMaterial(ground.userData.perspectiveMaterial,coating,mirror);
  root.traverse(mesh=>{
    if(mesh.name==="Wooden bridge deck") wetGroundMaterial(mesh.material,coating,mirror,true);
    if(mesh.name==="Individual worn paving stones") wetGroundMaterial(mesh.material,coating,mirror);
    if(mesh.name==="Recessed canal bed") wetGroundMaterial(mesh.material,coating,mirror);
    if(mesh.name==="Damp shoreline stones") wetMaterial(mesh.material,intensity);
  });
  for(const roof of roofs) wetMaterial(roof.object.material,roof.wet);
  for(const crown of canopies) wetMaterial(crown.leaves.material,crown.wet);
  const streetFoliageWet={value:0};
  wetMaterial(street.rainMaterial,streetFoliageWet);
  const streaks=dropsMesh(group), beads=beadsMesh(group);
  const air=new THREE.Vector2();
  const current=new THREE.Vector2();
  const heading=new THREE.Vector3();
  const available=Array.from({length:capacity},()=>({})), active=[];
  const counts={airborne:0,river:0,land:0,deck:0,roof:0,leaves:0,eaves:0,leafDrips:0,
    dripsToRiver:0,dripsToGround:0,groundUnderRoof:0,poolImpacts:0,fineImpacts:0,spray:0,
    runoffEntryWaves:0,poolSteps:0};
  const history=[];
  let rng=0x234bc1ee, fineSeed=219220431, timer=0, residual=0, fineResidual=0;
  let tick=0, particle=0, deadline=0, peak=0;
  let time=0, canalTime=0, shifts=0, movingWindow=false;
  let lastRiver=null,lastEave=null,lastLeaf=null;
  function random() {
    rng^=rng<<13;
    rng^=rng>>>17;
    rng^=rng<<5;
    return (rng>>>0)/4294967296;
  }

  function inWindow(x,z,margin=0) {
    return x>=x0-margin && z>=z0-margin && x<=x0+width+margin && z<=z0+length+margin;
  }

  function focus(camera,moving) {
    movingWindow=moving;
    let x=fixedX,z=fixedZ;
    if(moving) {
      camera.getWorldDirection(heading);
      x=clamp(Math.round((camera.position.x+heading.x*7-width*.5)/2)*2,-worldWidth*.5-4,worldWidth*.5-width+4);
      z=clamp(Math.round((camera.position.z+heading.z*7-length*.5)/2)*2,-worldDepth-4,4-length);
    }
    if(x!==x0 || z!==z0) {
      x0=x;
      z0=z;
      bounds.x=x;
      bounds.y=z;
      shifts++;
      ripples.invalidate();
      nearbyCrowns=[];
    }
    if(!nearbyCrowns.length) nearbyCrowns=crowns.filter(({canopy})=>inWindow(canopy.x,canopy.z,4));
  }

  function create(x,y,z,vx,vy,vz,kind,mass,terminal) {
    const drop=available.pop();
    if(!drop) return false;
    Object.assign(drop,{x,y,z,vx,vy,vz,kind,mass,terminal,id:particle++,age:0});
    active.push(drop);
    return true;
  }

  function inject() {
    const x=x0+random()*width,z=z0+random()*length;
    let y=8.8+random()*2.7;
    for(const roof of shelter.at(x,z)) {
      if(roof.enabled()) y=Math.max(y,roofLevel(roof,x,z)+1.4);
    }
    const mass=.28+.85*random()**.89,speed=5.9+2.8*Math.sqrt(mass)+.42*random();
    airFromMap(x,z,air,0,y);
    if(create(x,y,z,.63*air.x,-speed,.63*air.y,AIR,mass,speed)) counts.airborne++;
  }

  function rainFine(dt) {
    // The visible airborne tracers carry the bigger drops. Resolve the smaller
    // impacts directly on exposed water, where their optical footprint is visible.
    if(x0>center.x+9 || x0+width<center.x-9 || z0>center.z+15 || z0+length<center.z-17) return;
    fineResidual+=dt*intensity.value*4450;
    for(;fineResidual>=1;fineResidual--) {
      fineSeed=(Math.imul(fineSeed,1664525)+1013904223)>>>0;
      const x=center.x-8.68+17.5*(fineSeed/4294967296);
      fineSeed=(Math.imul(fineSeed,1664525)+1013904223)>>>0;
      const z=center.z-16.8+31.1*(fineSeed/4294967296);
      if(!inWindow(x,z) || onBridge(x,z) || depthAt(x,z)<.065 || shelter.cover(x,z)) continue;
      const size=.24+.24*((fineSeed>>>16)&255)/255;
      const power=.20+.20*((fineSeed>>>24)&255)/255;
      water.velocity(x,z,canalTime,current);
      ripples.enter(x,z,time,power,size,.39+size*.33,current.x,current.y);
      counts.fineImpacts++;
    }
  }

  function note(kind,x,y,z,source) {
    const event={kind,x,y,z,time,source};
    history.push(event);
    if(history.length>48) history.shift();
    return event;
  }

  function roofImpact(roof,x,z,mass) {
    let reservoir,delay;
    if(roof.kind==="mesh") {
      const route=roof.route(x,z);
      if(!route) return;
      [reservoir,delay]=route;
    } else {
      const side=z<roof.z ? -1 : 1;
      const bin=clamp(Math.floor((x-roof.x+roof.half)/(roof.half*2)*9),0,8);
      reservoir=roof.stored[bin+(side<0 ? 0 : 9)];
      delay=.16+Math.max(0,roof.run-Math.abs(z-roof.z))*.27;
    }
    if(reservoir.mass<.001) reservoir.due=time+delay;
    reservoir.mass=Math.min(5.6,reservoir.mass+mass);
    roof.caught++;
    counts.roof++;
    roof.wet.value=Math.min(1,roof.wet.value+.025*mass);
  }

  function release(dt) {
    for(const roof of roofs) {
      if(!roof.enabled()) continue;
      for(const [i,slot] of roof.stored.entries()) {
        if(slot.mass<.28 || slot.due>time) continue;
        // Feed gutters down the tile channels and drop beyond the overhanging lip.
        let x,y,z,vx,vz;
        if(roof.kind==="mesh") {
          ({x,y,z,vx,vz}=slot);
        } else {
          const edge=i<9 ? -1 : 1;
          x=roof.x+roof.half*((i%9+.47+.36*(random()-.5))*2/9-1);
          z=roof.z+edge*(roof.run+.064);
          y=roofLevel(roof,x,roof.z+edge*roof.run)-.016;
          vx=.04*(random()-.5);
          vz=edge*.18;
        }
        const mass=Math.min(1.8,slot.mass);
        if(!inWindow(x,z,1)) wet.deposit(x,z,mass*.08,false,true);
        else if(!create(x,y,z,vx,-.74,vz,EAVE,mass,7.2)) continue;
        slot.mass-=mass;
        slot.due=time+.09+.14*random();
        roof.runoff++;
        counts.eaves++;
        lastEave=note("eave",x,y,z,roof.name);
      }
      roof.wet.value=clamp(roof.wet.value+dt*(.11*intensity.value*(1-roof.wet.value)-.052*roof.wet.value),0,1);
    }
    beads.begin();
    const leafDecay=Math.exp(-dt*.085);
    for(const {canopy,catcher} of crowns) {
      if(catcher.pending()) {
        const near=inWindow(canopy.x,canopy.z,4);
        catcher.drain(time,(x,y,z,mass)=>{
          if(!near) wet.deposit(x,z,mass*.045,false,true);
          else if(!create(x,y,z,.05*(random()-.5),-.41,.05*(random()-.5),LEAF,mass,6.6)) return false;
          counts.leafDrips++;
          lastLeaf=note("leaf tip",x,y,z,canopy.label ?? canopy.tree.name);
          return true;
        },near ? beads.append : noBead);
      }
      canopy.wet.value*=leafDecay;
    }
    beads.commit();
  }

  function spray(x,y,z,mass,vx,vz,wetSurface) {
    for(let i=0;i<(wetSurface ? 3 : 2);i++){
      const bearing=random()*Math.PI*2,speed=.40+random()*.64;
      if(create(x,y+.012,z,Math.cos(bearing)*speed+.09*vx,.58+random()*.78,
        Math.sin(bearing)*speed+.09*vz,SPRAY,mass*(.25+.28*random()),3.1)) counts.spray++;
    }
  }

  function land(drop,x,z,dx,dz,surface,kind) {
    const drip=drop.kind===EAVE || drop.kind===LEAF;
    counts[kind]++;
    if(drip) counts[kind==="river" ? "dripsToRiver" : "dripsToGround"]++;
    if(kind==="river") {
      water.velocity(x,z,canalTime,current);
      ripples.enter(x,z,time,drop.mass*lerp(.33,.61,clamp(-drop.vy/9,0,1))*(drip ? 1.47 : 1),
        .66+drop.mass*.37,.88,current.x,current.y);
      lastRiver={x,z,y:surface,time,source:drop.kind};
    } else {
      const cover=kind!=="deck" && shelter.at(x,z).some(roof=>roof.enabled() && roofLevel(roof,x,z)>surface+.21);
      if(cover && !drip) counts.groundUnderRoof++;
      wet.deposit(x,z,drop.mass*(cover ? .052 : .145),kind==="deck",drip);
      const pool=kind==="land" ? wet.sample(x,z) : null;
      if(pool && pool.puddle>.16) {
        const reach=.32+.39*pool.puddle;
        ripples.enter(x,z,time,drop.mass*.35,reach,.28+.32*pool.puddle);
        counts.poolImpacts++;
      }
    }
    if((drip || random()<(kind==="river" ? .19 : .09)) && drop.mass>.46) {
      spray(x,surface,z,drop.mass,dx,dz,kind==="river");
    }
  }

  function step(dt) {
    tick++;
    residual+=dt*intensity.value*1550;
    for(;residual>=1;residual--) inject();
    rainFine(dt);
    for(const {catcher} of nearbyCrowns) catcher.refresh(time);
    for(let i=active.length-1;i>=0;i--) {
      const drop=active[i];
      drop.age+=dt;
      if(drop.kind!==AIR) drop.vy=Math.max(-drop.terminal,drop.vy-9.81*dt);
      if(((drop.id+tick)&3)===0 || drop.age<=dt) {
        airFromMap(drop.x,drop.z,air,0,drop.y);
        const weight=drop.kind===AIR ? .65 : drop.kind===SPRAY ? .17 : .43;
        drop.vx=lerp(drop.vx,air.x*weight,.23);
        drop.vz=lerp(drop.vz,air.y*weight,.23);
      }
      const x=drop.x+drop.vx*dt, y=drop.y+drop.vy*dt, z=drop.z+drop.vz*dt;
      let lost=drop.age>4 || !inWindow(x,z,2);
      if(drop.kind===SPRAY && drop.age>.30) lost=true;
      if(!lost && y<highest && drop.vy<0) {
        let hit=null, first=1.00001;
        for(const roof of shelter.at(x,z)) {
          if(!roof.enabled()) continue;
          const at=roofLevel(roof,x,z);
          if(y>at || drop.y<at) continue;
          const part=(drop.y-at)/(drop.y-y);
          const px=lerp(drop.x,x,part), pz=lerp(drop.z,z,part);
          if(part<first && roofLevel(roof,px,pz)>0) {
            first=part;
            hit={roof,x:px,z:pz};
          }
        }
        if(drop.kind===AIR) {
          for(const {catcher} of nearbyCrowns) {
            const caught=catcher.intercept(drop,x,y,z,first);
            if(!caught) continue;
            first=caught.f;
            hit={catcher,caught};
          }
        }
        const bridge=bridgeAt(x,z);
        const support=y<1.25 ? groundAt(x,z) : -Infinity;
        let surface=Math.max(bridge,support);
        let kind=bridge>support ? "deck" : "land";
        if(y<.76 && depthAt(x,z)>.028) {
          const level=water.height(x,z,canalTime);
          if(level>surface) {
            surface=level;
            kind="river";
          }
        }
        const part=clamp((drop.y-surface)/(drop.y-y),0,1);
        if(y<=surface && part<first) {
          if(drop.kind!==SPRAY) land(drop,lerp(drop.x,x,part),lerp(drop.z,z,part),drop.vx,drop.vz,surface,kind);
          lost=true;
        } else if(hit) {
          if(drop.kind!==SPRAY) {
            if(hit.roof) roofImpact(hit.roof,hit.x,hit.z,drop.mass);
            else {
              hit.catcher.store(hit.caught,time,drop.mass,.39+random()*.93);
              counts.leaves++;
            }
          }
          lost=true;
        }
      }
      if(lost) {
        active[i]=active.at(-1);
        active.pop();
        available.push(drop);
      } else {
        drop.x=x;
        drop.y=y;
        drop.z=z;
      }
    }
  }

  function update(elapsed,dt,camera,moving) {
    focus(camera,moving);
    time+=dt;
    roofClock.value=time;
    canalTime=elapsed;
    const phase=time%34;
    intensity.value=smoothstep(phase,.45,3.2)*(1-smoothstep(phase,14.5,18.1));
    timer+=dt;
    while(timer>.001) {
      const interval=Math.min(.025,timer);
      step(interval);
      release(interval);
      timer-=interval;
    }
    if(wet.update(dt,intensity.value,time)) {
      let emitted=0;
      wet.shoreline((x,z,amount,volume,vx,vz,tagged,duration)=>{
        const mouth=water.inflow(x,z,volume,vx,vz,tagged,duration);
        if(!mouth || amount<.018 || emitted>=24 || !inWindow(mouth.x,mouth.z,1)) return;
        water.velocity(mouth.x,mouth.z,canalTime,current);
        ripples.enter(mouth.x,mouth.z,time,Math.min(.42,.045+amount*.66),.44,.47,current.x,current.y);
        emitted++;
        counts.runoffEntryWaves++;
      });
    }
    streetFoliageWet.value=clamp(streetFoliageWet.value+dt*(intensity.value*.39*(1-streetFoliageWet.value)
      -.073*streetFoliageWet.value),0,1);
    peak=Math.max(peak,active.length);
    streaks.draw(active,x0,z0,width,length);
  }

  return {
    update,
    touchdown(x,y,z,vx,vz) {
      if(!group.visible || onBridge(x,z)) return false;
      const speed=Math.hypot(vx,vz), pool=wet.sample(x,z);
      if(speed<.36 || !pool || pool.depthMm<1.2) return false;
      const force=clamp(.14+pool.depthMm*.025+speed*.028,.18,.51);
      ripples.enter(x,z,time,force,.49+Math.min(.24,pool.depthMm*.03),.68,vx*.035,vz*.035);
      spray(x,y+pool.depthMm*.001,z,.42+force,vx,vz,false);
      counts.poolSteps++;
      return true;
    },
    registerHouse(model,enabled) {
      if(registered.has(model)) return;
      const roof=rasterRainRoof(model);
      if(!roof) return;
      registered.add(model);
      roof.enabled=enabled;
      roofs.push(roof);
      shelter.add(roof);
      wet.refresh(roof.bounds);
      highest=Math.max(highest,roof.maxY+.5);
      const {minX,maxX,minZ,maxZ}=roof.bounds;
      registerWindBuilding({x:roof.x,z:roof.z,width:maxX-minX,depth:maxZ-minZ,height:roof.maxY,
        enabled:roof.enabled,name:roof.name});
      const film={...roof.film,roofRain:intensity,roofClock};
      for(const mesh of model.userData.finishFaces) {
        if(mesh.name!=="wall") wetMaterial(mesh.userData.nearbyMaterial,roof.wet,film);
      }
    },
    refreshShelter() { wet.refresh(); },
    level:()=>intensity.value,
    visible(on) {
      group.visible=on;
      wet.uniforms.rainWetMix.value=Number(on);
    },
    prepare(renderer,render) {
      ripples.update(renderer,time);
      const shown=group.visible;
      group.visible=false;
      mirror.rainMirrorReady.value=0;
      wet.uniforms.rainPuddleView.value=0;
      try {
        const reflecting=intensity.value>.20 || (time<deadline);
        if(intensity.value>.25) deadline=time+8;
        mirror.rainMirrorReady.value=Number(render(reflecting));
      } finally {
        group.visible=shown;
        wet.uniforms.rainPuddleView.value=1;
      }
    },
    sample:wet.sample,
    inspect() {
      return {time,intensity:intensity.value,counts:{...counts},particles:active.length,peak,
        window:{minX:x0,minZ:z0,width,length,moving:movingWindow,shifts},
        beads:beads.count(),beadSample:beads.sample(),ripples:ripples.inspect(),
        wetness:wet.inspect(),lastRiver,lastEave,lastLeaf,events:history.slice(),
        roofs:roofs.map(r=>({kind:r.kind,x:r.x,z:r.z,run:r.run,bounds:r.bounds,coveredCells:r.coveredCells,
          label:r.name,caught:r.caught,runoff:r.runoff,wet:r.wet.value})),
        canopies:crowns.map(({canopy,catcher})=>({label:canopy.label ?? canopy.tree.name,x:canopy.x,z:canopy.z,
          caught:canopy.caught,runoff:canopy.runoff,
          retained:catcher.pending(),wet:canopy.wet.value}))};
    },
  };
}
