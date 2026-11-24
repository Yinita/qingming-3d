import * as THREE from "three";
import { canalDepth, canalHalfLength, canalShoreRadius, waterHeight } from "./bridge-canal-bed.js";
import { bladeGeometry, lightLeaf } from "./bridge-leaf-light.js";
import { airFromMap, waterWindDelay, waterWindDrift } from "./bridge-air.js";
import { advanceAirborneLeaf } from "./bridge-leaf-dynamics.js";

const seededLeaves=45, end=canalHalfLength, pivot=.47;
export const canalLeafCapacity=gust=>seededLeaves+(gust ? 34 : 12);
const { clamp, damp, lerp, smoothstep:smooth }=THREE.MathUtils;

export function buildCanalLeaves(parent,origin,hitWater,hull,piers,field,groundAt,swash,gust,waterContact) {
  const capacity=canalLeafCapacity(gust);
  const shape=bladeGeometry(.148,13,4).translate(0,-pivot,0);
  const moisture=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);
  moisture.setUsage(THREE.DynamicDrawUsage);
  shape.setAttribute("bladeMoisture",moisture);
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.77,side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nattribute float bladeMoisture; varying float leafWet;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nleafWet=bladeMoisture;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nvarying float leafWet;")
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        diffuseColor.rgb*=mix(vec3(1.),vec3(.57,.67,.59),leafWet*.76);
        roughnessFactor=mix(roughnessFactor,.31,leafWet*.91);`);
  };
  material.customProgramCacheKey=()=>"canal-leaf-moisture";
  lightLeaf(material,.49,true);
  const leaves=new THREE.InstancedMesh(shape,material,capacity);
  leaves.name="Floating and falling willow leaves";
  leaves.frustumCulled=false;
  leaves.receiveShadow=true;
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const palette=[0x756335,0x888b49,0x9e804e,0x647445,0xb19a61].map(hue=>new THREE.Color(hue));
  for(let i=0;i<capacity;i++) leaves.setColorAt(i,palette[i%palette.length]);
  leaves.instanceColor.setUsage(THREE.DynamicDrawUsage);
  parent.add(leaves);

  const dummy=new THREE.Object3D();
  const flow=new THREE.Vector2(), air=new THREE.Vector2(), bowFlow=new THREE.Vector2(), sternFlow=new THREE.Vector2();
  const disturbance={};
  const oldPosition=new THREE.Vector3(), releaseOffset=new THREE.Vector3();
  const terrainNormal=new THREE.Vector3(), up=new THREE.Vector3(0,1,0), projected=new THREE.Vector3();
  const heading=new THREE.Quaternion(), contactPose=new THREE.Quaternion();
  const horizontal=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  const film={}, earlier={};
  const sample={anchor:new THREE.Vector3(),velocity:new THREE.Vector3(),orientation:new THREE.Quaternion(),
    scale:new THREE.Vector3(),color:new THREE.Color(),strain:0,id:0};
  const events=[];
  const stats={releases:0,wetLandings:0,flying:0,floating:0,settled:0,pushed:0,maximumImpulse:0,stranded:0,
    refloated:0,filmTransport:0,dryLandings:0,broadsideTurns:0,maximumFloatTravel:0,peakDrift:0,
    maximumSettledWetness:0,underBridgeFrames:0,maximumUnderBridgeY:-1,
    runoffContacts:0,distanceThroughRunoff:0,peakRunoffExposure:0,peakSlip:0,peakSpin:0,events};
  let source=null, nextFall=.8;
  const data=Array.from({length:capacity},(_,i)=>{
    const seed=(i*.61803398875)%1;
    const bank=i%3===0 ? 1 : -1;
    const z=origin.y+((i*7.9241)%(2*end))-end;
    const scale=.11+.12*seed;
    return { index:i, seed, position:new THREE.Vector3(origin.x+bank*(2.2+5.90*seed),waterHeight,z),
      scale:new THREE.Vector3(.73*scale,scale,.82*scale), velocity:new THREE.Vector3(),
      spin:new THREE.Vector3(), orientation:horizontal.clone(), yaw:i*2.39996,
      mode:i<seededLeaves ? "water" : "dormant", wet:i<seededLeaves ? 1:0,
      disturbed:false,onFilm:false,onDeck:false,inRunoff:false,broadside:null,began:0,id:null,touchedX:0,touchedZ:0,
      yawSpeed:0,wakeAt:-1,pulseAt:-1,
    };
  });
  if(swash) {
    for(let i=0;i<12;i++) {
      const leaf=data[i], z=origin.y-8.93+i*.73;
      const shore=origin.x-canalShoreRadius(z-origin.y,-1);
      leaf.position.set(shore+.16-(i%3)*.125,.023,z);
      leaf.mode=i%3===0 ? "water" : "land";
      leaf.id=-1-i;
      leaf.touchedX=leaf.position.x;
      leaf.touchedZ=z;
    }
  }

  function event(leaf,kind,time,details={}) {
    if(leaf.id===null) return;
    if(events.length===240) events.shift();
    events.push({ id:leaf.id, index:leaf.index, kind, time, position:leaf.position.toArray(),
      speed:leaf.velocity.toArray(), quaternion:leaf.orientation.toArray(), ...details });
  }

  function release(time) {
    if(!source || time<nextFall) return;
    const leaf=data.find(item=>item.mode==="dormant");
    if(!leaf) return;
    const n=stats.releases;
    const threshold=gust ? 1.44+.58*leaf.seed : .53+.29*leaf.seed;
    if(!source(time,n,sample,threshold)) {
      nextFall=time+.17;
      return;
    }
    nextFall=time+(gust ? .24+.37*leaf.seed : 2.46+1.08*leaf.seed);
    leaf.mode="air";
    leaf.began=time;
    leaf.wet=0;
    leaf.onFilm=false;
    leaf.onDeck=false;
    leaf.inRunoff=false;
    leaf.disturbed=false;
    leaf.broadside=null;
    leaf.yawSpeed=0;
    leaf.wakeAt=leaf.pulseAt=-1;
    leaf.id=n;
    leaf.scale.copy(sample.scale);
    leaf.orientation.copy(sample.orientation);
    leaf.velocity.copy(sample.velocity);
    leaf.spin.set(.26+.88*(leaf.seed-.5),.18,.72*(leaf.seed-.5));
    releaseOffset.set(0,leaf.scale.y*pivot,0).applyQuaternion(leaf.orientation);
    leaf.position.copy(sample.anchor).add(releaseOffset);
    leaves.setColorAt(leaf.index,sample.color);
    leaves.instanceColor.needsUpdate=true;
    stats.releases++;
    event(leaf,"release",time,{canopyIndex:sample.id,anchor:sample.anchor.toArray(),scale:leaf.scale.toArray(),
      pivot,strain:sample.strain,threshold});
  }

  function surface(x,z,time,out,aboveBridge=false) {
    const support=groundAt(x,z,aboveBridge);
    out.ground=support;
    out.height=support;
    out.depth=out.u=out.v=0;
    if(Math.abs(z-origin.y)<end && canalDepth(origin,x,z)>.020) {
      const y=field.height(x,z,time);
      out.height=Math.max(support,y);
      out.depth=out.height-support;
    }
    out.film=support<.12 && (swash?.(x,z,out) ?? false);
    if(out.film && out.height<support+.001) {
      out.film=false;
      out.depth=0;
    }
    return out;
  }

  function pad(leaf) {
    projected.set(0,1,0).applyQuaternion(leaf.orientation);
    return .003+leaf.scale.y*.405*Math.abs(projected.y);
  }

  function touch(leaf,time,water,out) {
    const { position:p, velocity:v }=leaf;
    const approach=-v.y;
    projected.set(0,1,0).applyQuaternion(leaf.orientation);
    if(Math.hypot(projected.x,projected.z)>.13) leaf.yaw=Math.atan2(-projected.x,-projected.z);
    leaf.velocity.multiplyScalar(water ? .34 : .078);
    leaf.began=time;
    leaf.mode=water ? "water" : "land";
    leaf.onDeck=!water && out.ground>.12;
    leaf.touchedX=p.x;
    leaf.touchedZ=p.z;
    p.y=Math.max(out.ground+.006,(water ? out.height : out.ground)+pad(leaf));
    if(water) {
      if(!out.film || out.depth>.018) {
        hitWater(p.x,p.z,time,clamp(.045+approach*.040,.07,.145),"leaf",v.x,v.z);
      }
      if(out.film && out.depth<.018) flow.set(out.u,out.v);
      else field.velocity(p.x,p.z,time,flow);
      const slipX=v.x-flow.x,slipZ=v.z-flow.y;
      const slip=Math.max(.025,Math.hypot(slipX,slipZ));
      const dirX=slip>.025 ? slipX/slip : 0,dirZ=slip>.025 ? slipZ/slip : 1;
      waterContact.emit("impact",leaf.index,p.x,p.z,time,flow.x,flow.y,dirX,dirZ,clamp(.056+approach*.031,.067,.145));
      leaf.pulseAt=time;
      stats.wetLandings++;
      leaf.wet=.37;
    } else {
      stats.dryLandings++;
    }
    event(leaf,water ? "wet-impact" : "dry-impact",time,{approach,depth:out.depth,film:out.film});
  }

  function falling(leaf,time,dt) {
    const { position:p,orientation }=leaf;
    oldPosition.copy(p);
    const previousPad=pad(leaf);
    airFromMap(p.x,p.z,air,0,p.y);
    stats.peakDrift=Math.max(stats.peakDrift,Math.hypot(leaf.velocity.x,leaf.velocity.z));
    const steps=Math.ceil(dt/.016);
    for(let i=0;i<steps;i++) advanceAirborneLeaf(leaf,air,dt/steps);
    const normalY=projected.set(0,0,1).applyQuaternion(orientation).y;
    if(Math.abs(normalY)>.36) {
      const now=normalY>0;
      if(leaf.broadside!==null && now!==leaf.broadside) stats.broadsideTurns++;
      leaf.broadside=now;
    }
    const aboveBridge=oldPosition.y>groundAt(p.x,p.z,true)-.075;
    surface(p.x,p.z,time,film,aboveBridge);
    const firstContact=p.y-pad(leaf)-film.height;
    if(firstContact>0) return;
    surface(oldPosition.x,oldPosition.z,time-dt,earlier,aboveBridge);
    const oldGap=oldPosition.y-previousPad-earlier.height;
    const part=clamp(oldGap/Math.max(1e-6,oldGap-firstContact),0,1);
    p.lerp(oldPosition,1-part);
    surface(p.x,p.z,time,film,aboveBridge);
    touch(leaf,time,film.depth>(film.film ? .0025 : .0038),film);
  }

  function avoidSolid(leaf,horizontalTarget) {
    const {position:p,velocity:v,scale}=leaf;
    const boatX=p.x-hull.x, boatZ=p.z-hull.y;
    const bow=boatX*hull.z+boatZ*hull.w;
    const beam=boatX*hull.w-boatZ*hull.z;
    const reachAtBeam=.68-.42*smooth(Math.abs(bow),.41,1.64);
    if(Math.abs(bow)<1.78 && Math.abs(beam)<reachAtBeam) {
      const force=(beam>=0 ? 1 : -1)*(.37+.92*(reachAtBeam-Math.abs(beam)));
      horizontalTarget.x+=force*hull.w;
      horizontalTarget.y-=force*hull.z;
    }
    const buffer=.105+scale.y*.37;
    for(const pier of piers) {
      const x=p.x-pier.x, z=p.z-pier.y;
      if(Math.abs(x)>=buffer || Math.abs(z)>=buffer) continue;
      if(Math.abs(x)>Math.abs(z)) {
        p.x=pier.x+Math.sign(x||1)*buffer;
        if(v.x*x<0) v.x=0;
      } else {
        p.z=pier.y+Math.sign(z||1)*buffer;
        if(v.z*z<0) v.z=0;
      }
    }
  }

  function settle(leaf,time,dt) {
    const { position:p,orientation,velocity:v }=leaf;
    let washed=false, stranded=false,refloated=false;
    let waterX=0,waterZ=0;
    surface(p.x,p.z,time,film,leaf.onDeck);
    if(leaf.mode==="land" && film.depth>(film.film ? .0027 : .006)) {
      leaf.mode="water";
      leaf.began=time;
      leaf.wet=Math.max(leaf.wet,.27);
      stats.refloated++;
      refloated=true;
      event(leaf,"refloat",time,{film:film.film,depth:film.depth});
    }
    if(leaf.mode==="water") {
      if(film.film && film.depth<.018) flow.set(film.u,film.v);
      else field.velocity(p.x,p.z,time,flow);
      waterX=flow.x;
      waterZ=flow.y;
      airFromMap(p.x,p.z,air,waterWindDelay);
      flow.addScaledVector(air,waterWindDrift);
      field.disturbance(p.x,p.z,disturbance);
      const shove=Math.hypot(disturbance.u,disturbance.v);
      stats.maximumImpulse=Math.max(stats.maximumImpulse,shove);
      if(shove>.052 && !leaf.disturbed) {
        leaf.disturbed=true;
        stats.pushed++;
      } else if(shove<.025) leaf.disturbed=false;
      avoidSolid(leaf,flow);
      v.x=damp(v.x,flow.x,8.7,dt);
      v.z=damp(v.z,flow.y,8.7,dt);
      p.x+=v.x*dt;
      p.z+=v.z*dt;
      const inRunoff=!film.film && disturbance.runoff>.025;
      if(inRunoff) {
        if(!leaf.inRunoff) stats.runoffContacts++;
        stats.distanceThroughRunoff+=Math.hypot(v.x,v.z)*dt;
        stats.peakRunoffExposure=Math.max(stats.peakRunoffExposure,disturbance.runoff);
      }
      leaf.inRunoff=inRunoff;
      leaf.wet=damp(leaf.wet,1,2.65,dt);
      const forwardX=-Math.sin(leaf.yaw),forwardZ=-Math.cos(leaf.yaw);
      const half=leaf.scale.y*.39;
      let torque=0;
      if(!film.film || film.depth>=.018) {
        field.velocity(p.x+forwardX*half,p.z+forwardZ*half,time,bowFlow);
        field.velocity(p.x-forwardX*half,p.z-forwardZ*half,time,sternFlow);
        torque=(forwardZ*(bowFlow.x-sternFlow.x)-forwardX*(bowFlow.y-sternFlow.y))/Math.max(.08,half*2);
      }
      const slipX=v.x-waterX,slipZ=v.z-waterZ;
      const across=slipX*forwardZ-slipZ*forwardX,along=slipX*forwardX+slipZ*forwardZ;
      leaf.yawSpeed=damp(leaf.yawSpeed,clamp(torque*.63+along*across*8.7,-3.2,3.2),6.8,dt);
      leaf.yaw+=dt*leaf.yawSpeed;
      if(leaf.id!==null && leaf.id>=0) stats.maximumFloatTravel=Math.max(stats.maximumFloatTravel,
        Math.hypot(p.x-leaf.touchedX,p.z-leaf.touchedZ));
      surface(p.x,p.z,time,film);
      if(film.film && !leaf.onFilm && leaf.id!==null) {
        stats.filmTransport++;
        washed=true;
      }
      leaf.onFilm=film.film;
      if(film.depth<(film.film ? .0017 : .0023)) {
        stats.stranded++;
        leaf.mode="land";
        leaf.began=time;
        v.x*=.25;
        v.z*=.25;
        stranded=true;
      }
      const deck=groundAt(p.x,p.z,true);
      if(deck>.32 && p.y<deck-.20) {
        stats.underBridgeFrames++;
        stats.maximumUnderBridgeY=Math.max(stats.maximumUnderBridgeY,p.y);
      }
    } else {
      p.x+=v.x*dt;
      p.z+=v.z*dt;
      v.multiplyScalar(Math.exp(-8.1*dt));
      leaf.wet*=Math.exp(-.068*dt);
      stats.maximumSettledWetness=Math.max(stats.maximumSettledWetness,leaf.wet);
    }
    const wet=leaf.mode==="water";
    const d=leaf.scale.y*.40+.018;
    const heightAt=wet && !film.film ? (x,z)=>field.height(x,z,time) : (x,z)=>groundAt(x,z,leaf.onDeck);
    terrainNormal.set(heightAt(p.x-d,p.z)-heightAt(p.x+d,p.z),2*d,
      heightAt(p.x,p.z-d)-heightAt(p.x,p.z+d)).normalize();
    contactPose.setFromUnitVectors(up,terrainNormal)
      .multiply(heading.setFromAxisAngle(up,leaf.yaw)).multiply(horizontal);
    orientation.slerp(contactPose,1-Math.exp(-dt*(wet ? 15 : 11)));
    const bottom=wet ? film.height : film.ground;
    const clearance=.005+.013*(1-Math.min(1,Math.abs(projected.set(0,0,1).applyQuaternion(orientation).y)));
    p.y=Math.max(bottom+clearance,damp(p.y,bottom+clearance,21,dt));
    if(wet) {
      projected.set(0,1,0).applyQuaternion(orientation);
      const tangent=Math.hypot(projected.x,projected.z);
      const dx=tangent>.24 ? projected.x/tangent : -Math.sin(leaf.yaw);
      const dz=tangent>.24 ? projected.z/tangent : -Math.cos(leaf.yaw);
      const size=leaf.scale.y,x=p.x+dx*size*.08,z=p.z+dz*size*.08;
      const fade=smooth(end-Math.abs(p.z-origin.y),1.12,2.22);
      const contact=fade*smooth(film.depth,.0017,.0084);
      if(contact>.004) {
        waterContact.attach(leaf.index,x,z,size*.87+.017,size*.29+.022,dx,dz,contact*(.094+leaf.wet*.044));
      }
      if((refloated || washed) && time-leaf.pulseAt>.19) {
        waterContact.emit(refloated ? "refloat" : "wash",leaf.index,x,z,time,waterX,waterZ,dx,dz,.078*fade);
        leaf.pulseAt=time;
      }
      const slipX=v.x-waterX,slipZ=v.z-waterZ;
      const slip=Math.hypot(slipX,slipZ), spin=Math.abs(leaf.yawSpeed);
      stats.peakSlip=Math.max(stats.peakSlip,slip);
      stats.peakSpin=Math.max(stats.peakSpin,spin);
      const pressure=slip+.045*spin;
      if(contact>.12 && pressure>.052 && time>=leaf.wakeAt) {
        leaf.wakeAt=time+.13+.17*(1-smooth(pressure,.05,.30));
        waterContact.emit("drift",leaf.index,x,z,time,waterX,waterZ,
          slip>.028 ? slipX/slip : dx,slip>.028 ? slipZ/slip : dz,
          contact*(.048+.16*smooth(pressure,.045,.52)));
      }
    }
    if(washed) event(leaf,"wash",time,{depth:film.depth});
    if(stranded) event(leaf,"strand",time,{wetness:leaf.wet});
  }

  function frame(time,dt) {
    if(dt>0) {
      waterContact.begin(time);
      release(time);
    }
    stats.flying=stats.floating=stats.settled=0;
    for(const leaf of data) {
      const {position:p,index:i}=leaf;
      if(dt>0) {
        if(leaf.mode==="air" && leaf.began<time) falling(leaf,time,dt);
        else if(leaf.mode==="water" || leaf.mode==="land") settle(leaf,time,dt);
      }
      if(leaf.mode==="water" && p.z>origin.y+end-1.12) {
        if(i<seededLeaves) {
          p.z=origin.y-end+1.30+.27*leaf.seed;
          p.x=origin.x+Math.sign(p.x-origin.x)*Math.min(7.44,Math.abs(p.x-origin.x));
        } else leaf.mode="dormant";
      }
      if(leaf.mode==="land" && time-leaf.began>32) {
        if(i<seededLeaves) {
          leaf.mode="water";
          p.z=origin.y-end+1.30+.27*leaf.seed;
          p.x=origin.x+Math.sign(p.x-origin.x)*(2.6+4.21*leaf.seed);
          leaf.velocity.set(0,0,0);
          leaf.wet=1;
        } else leaf.mode="dormant";
      }
      const edge=smooth(end-Math.abs(p.z-origin.y),1.12,2.22);
      let scale=edge;
      if(leaf.mode==="air") { stats.flying++; scale=1; }
      if(leaf.mode==="water") stats.floating++;
      if(leaf.mode==="land") { stats.settled++; scale*=1-smooth(time-leaf.began,26,32); }
      if(leaf.mode==="dormant") scale=0;
      dummy.quaternion.copy(leaf.orientation);
      dummy.position.copy(p);
      dummy.scale.copy(leaf.scale).multiplyScalar(Math.max(.0001,scale));
      dummy.updateMatrix();
      leaves.setMatrixAt(i,dummy.matrix);
      moisture.setX(i,leaf.wet);
    }
    leaves.instanceMatrix.needsUpdate=moisture.needsUpdate=true;
  }

  return { mesh:leaves, frame, source(fn) { source=fn; }, inspect:()=>stats, seededLeaves };
}
