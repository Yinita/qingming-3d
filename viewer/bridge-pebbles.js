import * as THREE from "three";
import { waterHeight } from "./bridge-canal-bed.js";

const gravity = 9.81;
const capacity = 6;

export function buildPebbleToss(parent, depthAt, hitWater, surface, submerged) {
  const material = new THREE.MeshPhysicalMaterial({
    color:0x8b7f60, roughness:.68, clearcoat:.20, clearcoatRoughness:.43,
  });
  const stoneGeometry = new THREE.DodecahedronGeometry(.080,1);
  stoneGeometry.scale(.89,.61,1.19);
  const stones = Array.from({length:capacity},() => {
    const mesh = new THREE.Mesh(stoneGeometry,material);
    mesh.name = "Tossed river pebble";
    mesh.visible = false;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.layers.enable(1);
    parent.add(mesh);
    return { mesh, began:-Infinity, flight:0,sinkTime:0, struck:false,
      sx:0,sy:0,sz:0,vx:0,vy:0,vz:0,dx:0,dz:0,drop:0 };
  });
  let next = 0, last = null, tossCount = 0;
  let throwAge = Infinity;

  function toss(x,y,z,tx,tz,time) {
    if (last && time-last.began<.67) return false;
    const pebble=stones[next];
    next=(next+1)%capacity;
    last=pebble;
    tossCount++;
    const metres=Math.hypot(tx-x,tz-z);
    pebble.began=time;
    pebble.flight=.48+.074*metres;
    pebble.sinkTime=0;
    pebble.struck=false;
    pebble.bottomed=false;
    pebble.sx=x;
    pebble.sy=y;
    pebble.sz=z;
    pebble.dx=tx;
    pebble.dz=tz;
    pebble.vx=(tx-x)/pebble.flight;
    pebble.vz=(tz-z)/pebble.flight;
    pebble.entry=surface(tx,tz,time+pebble.flight)+.035;
    pebble.vy=(pebble.entry-y)/pebble.flight+.5*gravity*pebble.flight;
    pebble.drop=Math.max(0,depthAt(tx,tz)-.038);
    throwAge=0;
    pebble.mesh.visible=true;
    pebble.mesh.position.set(x,y,z);
    return true;
  }

  function update(time) {
    throwAge=last ? time-last.began : Infinity;
    for (const p of stones) {
      if (!p.mesh.visible) continue;
      const age=time-p.began;
      if (!p.struck && age>=p.flight) {
        p.struck=true;
        p.sinkTime=THREE.MathUtils.clamp(.12+p.drop*.59,.17,1.15);
        const fallSpeed=gravity*p.flight-p.vy;
        const strength=THREE.MathUtils.clamp(fallSpeed/4.5,.64,1.12);
        p.bottomStrength=strength;
        p.trailAt=time;
        hitWater(p.dx,p.dz,p.began+p.flight,strength,"stone",p.vx,p.vz);
      }
      if (!p.struck) {
        p.mesh.position.set(p.sx+p.vx*age,p.sy+p.vy*age-.5*gravity*age*age,p.sz+p.vz*age);
        p.mesh.rotation.set(age*11.7,age*7.4,age*5.1);
      } else if (age<p.flight+p.sinkTime+.06) {
        const sink=Math.min(1,(age-p.flight)/p.sinkTime);
        const drift=(1-Math.exp(-sink*4.6))*.070;
        const x=p.dx+p.vx*drift, z=p.dz+p.vz*drift;
        const bottom=waterHeight-depthAt(x,z)+.034;
        p.mesh.position.set(x,THREE.MathUtils.lerp(p.entry,bottom,1-Math.pow(1-sink,2.1)),z);
        if(p.mesh.position.y<surface(x,z,time)-.032 && sink<.80 && time>=p.trailAt) {
          const drag=Math.exp(-sink*4.6)*.39/p.sinkTime;
          submerged.trail(x,p.mesh.position.y,z,time,p.vx*drag,p.vz*drag);
          p.trailAt=time+.032;
        }
        if(!p.bottomed && sink>=.96) {
          p.bottomed=true;
          submerged.bedStrike(x,z,time,p.bottomStrength);
        }
        p.mesh.rotation.set(age*8.8,age*6.4,age*4.9);
      }
    }
  }

  return {
    toss, update,
    age: () => throwAge,
    inspect: () => ({ tossCount, inFlight: stones.filter(s=>s.mesh.visible&&!s.struck).length,
      lastPosition:last?.mesh.position.toArray()??null, settled:stones.filter(s=>s.struck).length }),
  };
}
