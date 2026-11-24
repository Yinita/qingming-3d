import * as THREE from "three";

// Articulated hands for the procedural figures.
//
// The hand hangs from the wrist with the palm facing the body (medial, -side·x)
// and the thumb forward (-z). Each finger is a chain of joint groups, so one
// grip value curls every phalanx toward the palm. All measurements are metres
// in the elbow frame used by bridge-people.js.

const FINGERS=[
  // z offset along the knuckle line, spread, phalanx lengths, radius
  {name:"index", z:-.0205, spread:.085, lengths:[.0270,.0175,.0140], radius:.0071},
  {name:"middle",z:-.0068, spread:.025, lengths:[.0295,.0190,.0150], radius:.0073},
  {name:"ring",  z:.0068,  spread:-.035,lengths:[.0275,.0180,.0142], radius:.0068},
  {name:"little",z:.0190,  spread:-.095,lengths:[.0215,.0142,.0120], radius:.0060},
];
// Joint angles (radians) toward the palm: relaxed hanging hand and a closed grip
// around a strap or handle. The little finger rests slightly more curled.
const REST=[.20,.30,.20], GRIP=[1.28,1.42,.92];
const THUMB_REST={curl:.20,oppose:.28}, THUMB_GRIP={curl:.70,oppose:.48};

const capsules=new Map();
function phalanxShape(radius,length,radial) {
  const key=[radius,length,radial].join(":");
  if(!capsules.has(key)) {
    // Shared geometry; the capsule hangs from its joint at the origin.
    capsules.set(key,new THREE.CapsuleGeometry(radius,length,radial>4 ? 3 : 2,radial)
      .translate(0,-length/2,0));
  }
  return capsules.get(key);
}

function segment(parent,material,radius,length,radial) {
  const mesh=new THREE.Mesh(phalanxShape(radius,length,radial),material);
  mesh.receiveShadow=true;
  mesh.castShadow=false; // centimetre-scale parts add draw calls to the shadow pass for no visible gain
  parent.add(mesh);
  return mesh;
}

export function buildHand(parent,skin,side,{lowDetail=false,scale=1}={}) {
  const group=new THREE.Group();
  group.name="Articulated hand";
  group.scale.setScalar(scale);
  parent.add(group);
  const radial=lowDetail ? 4 : 7;
  const medial=-side;

  // Palm: a flattened ellipsoid, thicker at the heel, plus a soft thenar pad.
  const palm=new THREE.Mesh(new THREE.SphereGeometry(1,lowDetail ? 8 : 16,lowDetail ? 6 : 11),skin);
  palm.scale.set(.0128,.0385,.0292);
  palm.position.set(0,-.034,.0005);
  palm.castShadow=true;
  palm.receiveShadow=true;
  group.add(palm);
  if(!lowDetail) {
    const pad=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),skin);
    pad.scale.set(.0090,.0200,.0120);
    pad.position.set(medial*.0058,-.026,-.0160);
    pad.receiveShadow=true;
    group.add(pad);
  }

  const chains=[];
  for(const finger of FINGERS) {
    const base=new THREE.Group();
    base.position.set(medial*.0015,-.066,finger.z*.92);
    base.rotation.x=finger.spread;
    group.add(base);
    const joints=[];
    let joint=base;
    const lengths=lowDetail ? [finger.lengths.reduce((a,b)=>a+b,0)] : finger.lengths;
    lengths.forEach((length,i)=>{
      const pivot=i===0 ? base : new THREE.Group();
      if(i>0) {
        pivot.position.y=-lengths[i-1];
        joint.add(pivot);
      }
      segment(pivot,skin,finger.radius*(1-.09*i),length,radial);
      joints.push(pivot);
      joint=pivot;
    });
    chains.push({finger,joints});
  }

  // Thumb: metacarpal rotated forward and toward the palm, then two phalanges.
  const thumbBase=new THREE.Group();
  thumbBase.position.set(medial*.0055,-.010,-.026);
  group.add(thumbBase);
  const thumbLengths=lowDetail ? [.040] : [.021,.0170,.0135];
  const thumbJoints=[];
  let thumbJoint=thumbBase;
  thumbLengths.forEach((length,i)=>{
    const pivot=i===0 ? thumbBase : new THREE.Group();
    if(i>0) {
      pivot.position.y=-thumbLengths[i-1];
      thumbJoint.add(pivot);
    }
    segment(pivot,skin,[.0098,.0083,.0074][i]??.0083,length,radial);
    thumbJoints.push(pivot);
    thumbJoint=pivot;
  });

  let grip=-1;
  function setGrip(value) {
    const t=THREE.MathUtils.clamp(value,0,1);
    if(Math.abs(t-grip)<1e-4) return;
    grip=t;
    for(const [index,{joints}] of chains.entries()) {
      const extra=index===3 ? .10 : index===2 ? .04 : 0;
      joints.forEach((pivot,j)=>{
        const angle=lowDetail
          ? THREE.MathUtils.lerp(.55,1.55,t)+extra
          : THREE.MathUtils.lerp(REST[j]+extra,GRIP[j]+extra*.5,t);
        pivot.rotation.z=medial*angle;
      });
    }
    const curl=THREE.MathUtils.lerp(THUMB_REST.curl,THUMB_GRIP.curl,t);
    const oppose=THREE.MathUtils.lerp(THUMB_REST.oppose,THUMB_GRIP.oppose,t);
    // Metacarpal: forward (+x rotation tips -y toward -z) and across the palm.
    thumbBase.rotation.set(.58+.52*t,0,medial*oppose);
    thumbJoints.slice(1).forEach(pivot=>{ pivot.rotation.x=curl*.55; pivot.rotation.z=medial*curl*.65; });
  }
  setGrip(0);
  return {group,setGrip,get grip() { return grip; }};
}
