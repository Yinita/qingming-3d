import { Quaternion, Vector3 } from "three";

const relative=new Vector3(), normal=new Vector3(), axis=new Vector3();
const inverse=new Quaternion(), turn=new Quaternion();

// A low-inertia blade has linear edge drag and much greater drag broadside.
// The curved surface shifts its centre of pressure off the centre of mass.
export function advanceAirborneLeaf(leaf,air,dt) {
  const {velocity,orientation,spin,seed}=leaf;
  relative.set(air.x-velocity.x,-velocity.y,air.y-velocity.z);
  const speed=relative.length();
  if(speed>1e-5) {
    normal.set(0,0,1).applyQuaternion(orientation);
    const broadside=relative.dot(normal);
    velocity.addScaledVector(relative,dt*(1.30+.78*speed));
    velocity.addScaledVector(normal,dt*5.3*broadside*Math.abs(broadside));
    relative.applyQuaternion(inverse.copy(orientation).invert());
    const camber=(seed<.51 ? -.9 : 1.03)*speed;
    spin.x+=dt*(relative.z*relative.y*1.96+camber*2.2-spin.x*.94);
    spin.y+=dt*(relative.z*relative.x*.81+.87-spin.y*1.85);
    spin.z+=dt*(relative.x*relative.y*1.6+(seed-.52)*3.1-spin.z*1.44);
  }
  velocity.y-=9.81*dt;
  leaf.position.addScaledVector(velocity,dt);
  const angularSpeed=spin.length();
  if(angularSpeed>1e-5) {
    axis.copy(spin).multiplyScalar(1/angularSpeed);
    orientation.multiply(turn.setFromAxisAngle(axis,Math.min(12,angularSpeed)*dt)).normalize();
  }
}
