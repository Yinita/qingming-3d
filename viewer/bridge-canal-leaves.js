import * as THREE from "three";
import { canalDepth, canalHalfLength, canalShoreRadius, canalSpeed, waterHeight } from "./bridge-canal-bed.js";

const seededLeaves=45;
const fallCapacity=10;
const end=canalHalfLength;
const smooth=THREE.MathUtils.smoothstep;

export function buildCanalLeaves(parent,origin,events,hitWater,hull,field) {
  const shape=new THREE.BufferGeometry();
  shape.setAttribute("position",new THREE.Float32BufferAttribute([
    0,0,-.5,-.142,.020,-.17,-.107,.058,.22,0,0,.5,
    .108,.048,.22,.142,-.022,-.17,0,.102,0,
  ],3));
  shape.setIndex([0,1,6,1,2,6,2,3,6,3,4,6,4,5,6,5,0,6]);
  shape.computeVertexNormals();
  const leaves=new THREE.InstancedMesh(shape,new THREE.MeshStandardMaterial({
    color:0xffffff,roughness:.59,side:THREE.DoubleSide,
  }),seededLeaves+fallCapacity);
  leaves.name="Floating and falling willow leaves";
  leaves.frustumCulled=false;
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const palette=[0x756335,0x888b49,0x9e804e,0x647445,0xb19a61].map(hue=>new THREE.Color(hue));
  for (let i=0;i<leaves.count;i++) leaves.setColorAt(i,palette[i%palette.length]);
  parent.add(leaves);

  const dummy=new THREE.Object3D();
  const point=new THREE.Vector3();
  const flow=new THREE.Vector2();
  const terrainNormal=new THREE.Vector3(), up=new THREE.Vector3(0,1,0);
  const heading=new THREE.Quaternion();
  let source=null;
  let nextFall=.8;
  let fallIndex=0;
  let releases=0, wetLandings=0, pushed=0, maximumImpulse=0;
  const data=Array.from({length:leaves.count},(_,i)=>{
    const noise=(i*.61803398875)%1;
    const bank=i%3===0 ? 1 : -1;
    const z=origin.y+((i*7.9241)%(2*end))-end;
    return { x:origin.x+bank*(2.2+5.90*noise), z, y:waterHeight, side:bank,
      seed:noise, size:.11+.12*noise, previousHit:-10, began:-Infinity,
      mode:i<seededLeaves ? "water" : "dormant", startX:0,startY:0,startZ:0,
    };
  });

  function release(time) {
    if (!source || time<nextFall) return;
    const i=seededLeaves+fallIndex;
    const leaf=data[i];
    nextFall=time+2.6+1.25*leaf.seed;
    if (!source(time,releases,point)) return;
    releases++;
    fallIndex=(fallIndex+1)%fallCapacity;
    leaf.mode="air";
    leaf.startX=leaf.x=point.x;
    leaf.startY=leaf.y=point.y;
    leaf.startZ=leaf.z=point.z;
    leaf.began=time;
    leaf.previousHit=-10;
  }

  function falling(leaf,time,i) {
    const age=time-leaf.began;
    const t=age-(1-Math.exp(-age*4.4))/4.4;
    leaf.x=leaf.startX+.19*t + .10*Math.sin(age*5.5+i)*smooth(age,0,.61);
    leaf.z=leaf.startZ+.34*t + .14*Math.sin(age*3.7+i*.8)*smooth(age,0,.65);
    leaf.y=leaf.startY-(1.01+leaf.seed*.51)*t;
    const surface=field.height(leaf.x,leaf.z,time);
    if (leaf.y>surface) return;
    leaf.y=surface;
    leaf.side=Math.sign(leaf.x-origin.x);
    if (canalDepth(origin,leaf.x,leaf.z)>.038) {
      leaf.mode="water";
      leaf.began=time;
      hitWater(leaf.x,leaf.z,time,.105,"leaf");
      wetLandings++;
    } else {
      leaf.mode="land";
      leaf.began=time;
    }
  }

  function afloat(leaf,time,dt) {
    field.velocity(leaf.x,leaf.z,time,flow);
    const current=flow.y*(.88+.22*leaf.seed);
    const wake=.061*Math.sin(2.47*leaf.z+.93*time+leaf.seed*10.);
    let across=flow.x+wake*.7, along=current;
    for (const impulse of events) {
      const age=time-impulse.z;
      if (impulse.w<.14 || age<=0 || age>2.4) continue;
      const dx=leaf.x-impulse.x, dz=leaf.z-impulse.y-age*canalSpeed*.26;
      const distance=Math.hypot(dx,dz);
      const ring=.07+age*(.93+.35*impulse.w);
      if (Math.abs(distance-ring)>.35 || distance<.01) continue;
      const energy=Math.exp(-Math.pow((distance-ring)/(.10+.095*age),2))*Math.exp(-1.12*age)*impulse.w;
      const force=.84*energy;
      across+=force*dx/distance;
      along+=force*dz/distance;
      maximumImpulse=Math.max(maximumImpulse,force);
      if (force>.052 && leaf.previousHit<impulse.z) {
        leaf.previousHit=impulse.z;
        pushed++;
      }
    }
    const boatX=leaf.x-hull.x, boatZ=leaf.z-hull.y;
    const bow=boatX*hull.z+boatZ*hull.w;
    const beam=boatX*hull.w-boatZ*hull.z;
    const reachAtBeam=(.71-.42*smooth(Math.abs(bow),.41,1.64));
    if (Math.abs(bow)<1.78 && Math.abs(beam)<reachAtBeam) {
      const force=(beam>=0 ? 1 : -1)*(.34+.9*(reachAtBeam-Math.abs(beam)));
      across+=force*hull.w;
      along-=force*hull.z;
    }
    leaf.x+=across*dt;
    leaf.z+=along*dt;
    const nearBank=canalShoreRadius(leaf.z-origin.y,leaf.side)-.16;
    leaf.x=origin.x+THREE.MathUtils.clamp(leaf.x-origin.x,-nearBank,nearBank);
    leaf.y=field.height(leaf.x,leaf.z,time)+.006+.002*Math.sin(4.4*leaf.z+time*2.3+leaf.seed*7.);
  }

  function frame(time,dt) {
    release(time);
    let flying=0;
    for (const [i,leaf] of data.entries()) {
      if (leaf.mode==="air") falling(leaf,time,i);
      if (leaf.mode==="water") {
        afloat(leaf,time,dt);
        if (leaf.z>origin.y+end) {
          if (i<seededLeaves) {
            leaf.z-=end*2;
          } else {
            leaf.mode="dormant";
          }
        }
      }
      const age=time-leaf.began;
      const edge=smooth(end-Math.abs(leaf.z-origin.y),.16,1.2);
      let scale=leaf.size;
      if (leaf.mode==="air") {
        flying++;
        dummy.rotation.set(age*(2.4+leaf.seed*1.8),age*3.1+i,age*2.1+.44*Math.sin(age*5.3));
      } else {
        if(leaf.mode==="water"){
          const { x,z }=leaf;
          const d=.053;
          terrainNormal.set(field.height(x-d,z,time)-field.height(x+d,z,time),2*d,
            field.height(x,z-d,time)-field.height(x,z+d,time)).normalize();
          dummy.quaternion.setFromUnitVectors(up,terrainNormal)
            .multiply(heading.setFromAxisAngle(up,i+z*.82+.10*Math.sin(time*2.1+i)));
        } else {
          dummy.rotation.set(0,i+leaf.z*.84,0);
        }
        scale*=edge;
        if (leaf.mode==="land") scale*=1-smooth(age,.8,2.1);
      }
      if (leaf.mode==="dormant") scale=0;
      dummy.position.set(leaf.x,leaf.y,leaf.z);
      dummy.scale.setScalar(Math.max(.0001,scale));
      dummy.updateMatrix();
      leaves.setMatrixAt(i,dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate=true;
    stats={ releases, wetLandings, flying, pushed, maximumImpulse };
  }

  let stats={ releases:0,wetLandings:0,flying:0,pushed:0,maximumImpulse:0 };
  return { mesh:leaves, frame, source(fn) { source=fn; }, inspect:()=>stats, seededLeaves };
}
