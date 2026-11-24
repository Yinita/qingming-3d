import * as THREE from "three";
import { airUniforms } from "./bridge-air.js";
import { canopyShift, leafFlutter } from "./bridge-wind.js";

const cell=.36;
const bladeCenter=new THREE.Vector3(0,.56,.014);
const bladeTip=new THREE.Vector3(.054,1,.066*Math.sin(2.7)-.19+.00052);
const bladeStem=new THREE.Vector3(0,.21,.018);
const streetTip=bladeTip.clone().setZ(bladeTip.z+.00036);

export function canopyCatch(canopy) {
  const {leaves,tree,pose}=canopy;
  const street=!!canopy.transforms;
  const instance=new THREE.Matrix4();
  const posedOrigin=new THREE.Vector3(), deflection=new THREE.Vector3(), tip=new THREE.Vector3(), shift=new THREE.Vector3();
  const links=leaves?.geometry.getAttribute("branchLink");
  const samples=[], columns=20, grid=Array.from({length:columns**2},()=>[]);
  const minX=canopy.x-cell*columns*.5, minZ=canopy.z-cell*columns*.5;
  const index=(x,z)=>[Math.floor((x-minX)/cell),Math.floor((z-minZ)/cell)];
  const center=new THREE.Vector3();
  let top=0,bottom=0,last=-Infinity;
  const pending=[];

  // Select from the persistent part of the instanced leaf set, shared by every camera LOD.
  const first=street ? 0 : 3, limit=street ? canopy.transforms.length : leaves.userData.minimumVisible;
  for(let i=first;i<limit;i+=street ? 1 : 3) {
    if(street) instance.copy(canopy.transforms[i]);
    else leaves.getMatrixAt(i,instance);
    samples.push({
      index:i,
      binding:street ? null : [links.getX(i),links.getY(i),links.getZ(i)],
      transform:instance.clone(), anchor:new THREE.Vector3().setFromMatrixPosition(instance),
      rest:bladeCenter.clone().applyMatrix4(instance),
      tipRest:bladeTip.clone().applyMatrix4(instance),
      stemRest:bladeStem.clone().applyMatrix4(instance),
      position:new THREE.Vector3(), stem:new THREE.Vector3(), tip:new THREE.Vector3(),
    });
  }

  function world(rest,leaf,out) {
    if(street) return out.copy(rest).add(canopyShift(leaf.anchor,canopy.windRoot,.85,shift));
    return pose.point(rest,leaf.binding,out).applyMatrix4(tree.matrixWorld);
  }

  function visible(leaf) {
    if(street) return true;
    leaves.getMatrixAt(leaf.index,instance);
    const a=instance.elements;
    return a[0]*a[0]+a[1]*a[1]+a[2]*a[2]>=.000001;
  }

  function flutterTip(leaf,out) {
    if(street) posedOrigin.copy(leaf.anchor);
    else world(leaf.anchor,leaf,posedOrigin);
    leafFlutter(posedOrigin,airUniforms.windTime.value,airUniforms.windOrigin.value,deflection);
    const source=street ? streetTip : bladeTip;
    tip.set(source.x+deflection.z,1,source.z+deflection.x+source.x*deflection.y);
    return world(tip.applyMatrix4(leaf.transform),leaf,out);
  }

  function refresh(time) {
    if(time-last<.073) return;
    last=time;
    for(const bin of grid) bin.length=0;
    top=-Infinity;
    bottom=Infinity;
    for(const leaf of samples) {
      if(!visible(leaf)) continue;
      world(leaf.rest,leaf,leaf.position);
      const {x,y,z}=leaf.position;
      const [col,row]=index(x,z);
      if(col<0||col>=columns||row<0||row>=columns) continue;
      world(leaf.stemRest,leaf,leaf.stem);
      world(leaf.tipRest,leaf,leaf.tip);
      top=Math.max(top,y+.072);
      bottom=Math.min(bottom,y-.072);
      grid[row*columns+col].push(leaf);
    }
  }

  function intercept(drop,x,y,z,earliest) {
    if(drop.y<bottom || y>top || Math.abs(x-canopy.x)>3.65 || Math.abs(z-canopy.z)>3.65) return null;
    const [col,row]=index((drop.x+x)*.5,(drop.z+z)*.5);
    let first=earliest, hit=null;
    for(let r=Math.max(0,row-1);r<Math.min(columns,row+2);r++) {
      for(let c=Math.max(0,col-1);c<Math.min(columns,col+2);c++) {
        for(const leaf of grid[r*columns+c]) {
          const f=(drop.y-leaf.position.y)/(drop.y-y);
          if(!(f>=0 && f<first)) continue;
          const px=THREE.MathUtils.lerp(drop.x,x,f), pz=THREE.MathUtils.lerp(drop.z,z,f);
          const ax=leaf.tip.x-leaf.stem.x, az=leaf.tip.z-leaf.stem.z;
          const span=Math.max(.00001,ax*ax+az*az);
          const t=THREE.MathUtils.clamp(((px-leaf.stem.x)*ax+(pz-leaf.stem.z)*az)/span,0,1);
          const separation=(px-leaf.stem.x-t*ax)**2+(pz-leaf.stem.z-t*az)**2;
          if(separation>(street ? .092 : .049*canopy.scale)**2) continue;
          hit=leaf;
          first=f;
        }
      }
    }
    return hit ? {leaf:hit,f:first} : null;
  }

  function store(hit,time,mass,latency) {
    const {leaf}=hit;
    const held=pending.find(p=>p.leaf===leaf);
    if(held) {
      held.mass=Math.min(1.7,held.mass+mass);
      held.due=Math.min(held.due,time+.17);
    } else if(pending.length<56) {
      pending.push({leaf,mass,due:time+latency});
    }
    canopy.caught++;
    canopy.wet.value=Math.min(1,canopy.wet.value+.041+.061*mass);
  }

  function drain(time,makeDrop,makeBead) {
    for(let i=pending.length-1;i>=0;i--) {
      const bead=pending[i];
      const leaf=bead.leaf;
      flutterTip(leaf,center);
      if(time>=bead.due || !visible(leaf)) {
        if(!makeDrop(center.x,center.y-.01,center.z,bead.mass)) continue;
        pending[i]=pending.at(-1);
        pending.pop();
        canopy.runoff++;
      } else {
        const radius=.004+.007*Math.sqrt(bead.mass);
        makeBead(center.x,center.y-.004,center.z,radius);
      }
    }
  }
  return {refresh,intercept,store,drain,pending:()=>pending.length};
}
