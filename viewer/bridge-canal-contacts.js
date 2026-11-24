import * as THREE from "three";
import { splashMaterial } from "./bridge-splash-material.js";
import { createSplashSheet, splashProfiles } from "./bridge-splash-sheet.js";

const sprayCapacity=240;
const gravity=9.81;
const ageLimit=.76;
const fraction=value=>value-Math.floor(value);

export function buildWaterContacts(parent,water,field,depthAt,rejoin) {
  const spray=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),splashMaterial(water,true),sprayCapacity);
  spray.name="Ballistic canal droplets";
  spray.frustumCulled=false;
  spray.renderOrder=5;
  spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  spray.count=0;
  const group=new THREE.Group();
  group.name="Water contact effects";
  group.add(spray);
  parent.add(group);
  const film=splashMaterial(water);
  const sheets=Array.from({length:6},()=>createSplashSheet(film));
  for(const sheet of sheets) group.add(sheet.mesh);
  const particles=Array.from({length:sprayCapacity},()=>({ active:false }));
  const events=Array.from({length:12},()=>({time:-10}));
  const totals={step:0,stone:0,leaf:0,boat:0};
  const lastByKind={step:null,stone:null,leaf:null,boat:null};
  let last=null, lastReturn=null, peakSpray=0, nextEvent=0, nextSpray=0, nextSheet=0;
  let detached=0, returning=0, sheetReturns=0, secondaryImpacts=0;
  const dummy=new THREE.Object3D(), up=new THREE.Vector3(0,1,0), velocity=new THREE.Vector3();
  const position=new THREE.Vector3();
  const returns=[];

  function emit(time,x,y,z,vx,vy,vz,radius,torn) {
    const p=particles[nextSpray];
    nextSpray=(nextSpray+1)%particles.length;
    p.active=true;
    p.began=time;
    p.x=x; p.y=y; p.z=z;
    p.vx=vx; p.vy=vy; p.vz=vz;
    p.radius=radius;
    p.lastAbove=-1;
    p.torn=torn;
    detached+=Number(torn);
  }

  function hit(x,z,time,strength,kind,vx=0,vz=0) {
    const event={x,z,time,strength,kind,vx,vz};
    events[nextEvent]=event;
    nextEvent=(nextEvent+1)%events.length;
    totals[kind]++;
    last=lastByKind[kind]=event;
    const profile=splashProfiles[kind];
    if(!profile) return;
    const sheet=sheets[nextSheet];
    nextSheet=(nextSheet+1)%sheets.length;
    sheet.begin(event);
    const centre=field.height(x,z,time);
    const heading=Math.atan2(vz,vx);
    for(let i=0;i<profile.jets;i++) {
      const ray=fraction(i*.61803399+time*.582);
      const angle=heading+(ray-.5)*profile.arc;
      const scatter=fraction(i*.72197+time*.297);
      const outward=(.25+1.21*scatter)*strength;
      const lead=.012+fraction(i*.27013)*.051;
      const dx=Math.cos(angle), dz=Math.sin(angle);
      const radial=.030+.030*scatter;
      emit(time+lead,x+dx*radial,centre+.011+.022*scatter,z+dz*radial,
        dx*outward+vx*.17,(.46+1.68*scatter)*strength+.25,dz*outward+vz*.17,
        (.0031+.0099*ray)*(.55+.52*strength),false);
    }
  }

  function trajectory(p,t) {
    const drift=t*(1-.40*t);
    return position.set(p.x+p.vx*drift,p.y+p.vy*t-.5*gravity*t*t,p.z+p.vz*drift);
  }

  function land(p,t) {
    let above=p.lastAbove, below=t;
    if(above<0) return;
    // Locate the moving surface crossing between the two frame samples.
    for(let i=0;i<5;i++) {
      const middle=(above+below)*.5;
      trajectory(p,middle);
      if(position.y>field.height(position.x,position.z,p.began+middle)) above=middle;
      else below=middle;
    }
    const time=p.began+below;
    const {x,y,z}=trajectory(p,below);
    if(depthAt(x,z)<.036) return;
    const surface=field.height(x,z,time);
    const strength=p.radius*Math.abs(p.vy-gravity*below)*1.4;
    returning++;
    sheetReturns+=Number(p.torn);
    lastReturn={x,y,z,time,surface,torn:p.torn,error:Math.abs(y-surface)};
    let bin=returns.find(b=>Math.abs(b.x-x)<.17 && Math.abs(b.z-z)<.17);
    if(!bin) {
      bin={x,z,strength:0,vx:0,vz:0};
      returns.push(bin);
    }
    bin.strength+=strength;
    bin.vx+=p.vx*strength;
    bin.vz+=p.vz*strength;
  }

  function frame(time) {
    for(const sheet of sheets) sheet.frame(time,field.height,emit);
    spray.count=0;
    returns.length=0;
    for(const p of particles) {
      if(!p.active) continue;
      const age=time-p.began;
      if(age<0) continue;
      if(age>ageLimit) { p.active=false; continue; }
      const vertical=p.vy-gravity*age;
      const {x,y,z}=trajectory(p,age);
      if(y<field.height(x,z,time)) {
        if(age>.039 && vertical<0) {
          land(p,age);
          p.active=false;
        }
        continue;
      }
      p.lastAbove=age;
      dummy.position.set(x,y,z);
      const stretch=1.04+.62*Math.abs(vertical);
      const lateral=p.radius/Math.sqrt(stretch);
      dummy.scale.set(lateral,p.radius*stretch,lateral);
      velocity.set(p.vx,vertical,p.vz).normalize();
      dummy.quaternion.setFromUnitVectors(up,velocity);
      dummy.updateMatrix();
      spray.setMatrixAt(spray.count++,dummy.matrix);
    }
    if(spray.count) spray.instanceMatrix.needsUpdate=true;
    peakSpray=Math.max(peakSpray,spray.count);
    returns.sort((a,b)=>b.strength-a.strength);
    for(const bin of returns.slice(0,6)) {
      rejoin(bin.x,bin.z,Math.min(.16,bin.strength),bin.vx/bin.strength,bin.vz/bin.strength);
      secondaryImpacts++;
    }
  }

  function inspect(time) {
    const active=sheets.filter(s=>s.mesh.visible).map(s=>s.inspect());
    return {totals:{...totals},last,lastByKind:{...lastByKind},spray:spray.count,peakSpray,
      activeRipples:events.filter(e=>time>=e.time && time-e.time<2.4).length,
      crowns:active.length,sheets:active,detached,returning,sheetReturns,secondaryImpacts,lastReturn};
  }
  return {group,hit,frame,inspect,
    emitAtCrest(time,x,y,z,vx,vy,vz,radius) { emit(time,x,y,z,vx,vy,vz,radius,true); },
  };
}
