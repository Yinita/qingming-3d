import * as THREE from "three";

function oarFinish(side) {
  const profile=[
    [.64,.018,.016,0], [.77,.024,.016,.010], [.87,.052,.014,.015],
    [1.00,.071,.012,.019], [1.12,.079,.010,.024],
    [1.19,.068,.010,.029], [1.222,.043,.008,.030], [1.229,0,0,.031],
  ];
  const position=[],uv=[],indices=[];
  const sides=16;
  for(const [row,[span,width,thickness,curve]] of profile.entries()) {
    for(let i=0;i<=sides;i++) {
      const t=i/sides, angle=t*Math.PI*2;
      const z=Math.cos(angle)*width;
      position.push(side*span,curve+Math.sin(angle)*thickness+.18*z,z);
      uv.push(span*.72,t*.101);
      if(row===0 || i===0) continue;
      const a=row*(sides+1)+i,b=a-sides-1;
      if(side>0) indices.push(a,b-1,a-1,a,b,b-1);
      else indices.push(a,a-1,b-1,a,b-1,b);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildFerryOars(boat,timber,box,solid) {
  const collarMetal=new THREE.MeshStandardMaterial({color:0x514639,roughness:.67,metalness:.55});
  const line=new THREE.MeshStandardMaterial({color:0x826e4e,roughness:.96});
  return [-1,1].map(side=>{
    const mount=new THREE.Group();
    mount.position.set(side*.586,.459,-.621);
    mount.visible=false;
    boat.add(mount);
    const post=solid(box(.086,.204,.108,timber,.013,side*.59),timber,mount,0,-.093,0);
    post.name="Ferry oarlock post";
    const socket=solid(new THREE.TorusGeometry(.037,.008,6,18).rotateY(Math.PI/2),
      collarMetal,mount,0,-.013,0);
    socket.name="Worked iron oarlock";
    const oar=new THREE.Group();
    mount.add(oar);
    const shaft=solid(new THREE.CylinderGeometry(.017,.023,1.20,12).rotateZ(side*Math.PI/2),timber,oar,side*.149,0,0);
    shaft.name="Ferry oar shaft";
    solid(new THREE.CylinderGeometry(.023,.027,.117,12).rotateZ(side*Math.PI/2),timber,oar,-side*.419,0,0);
    const blade=solid(oarFinish(side),timber,oar);
    blade.name="Ferry oar blade";
    for(let wrap=0;wrap<5;wrap++) {
      const turn=solid(new THREE.TorusGeometry(.024,.004,5,12).rotateY(Math.PI/2),
        line,oar,side*(-.029+.013*wrap),0,0);
      turn.name="Lashing on oar pivot";
    }
    return {side,mount,oar,tip:new THREE.Vector3(),lastGap:Infinity,hitAt:-Infinity};
  });
}

export function createOarSpray(parent) {
  const capacity=126;
  const droplets=Array.from({length:capacity},()=>({start:-Infinity}));
  const geometry=new THREE.IcosahedronGeometry(1,1);
  const material=new THREE.MeshStandardMaterial({
    color:0xc8d8d3,roughness:.14,transparent:true,opacity:.76,depthWrite:false,
  });
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);
  mesh.name="Ferry oar water droplets";
  mesh.frustumCulled=false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count=0;
  mesh.layers.enable(1);
  mesh.renderOrder=4;
  parent.add(mesh);
  const pose=new THREE.Object3D(), up=new THREE.Vector3(0,1,0), direction=new THREE.Vector3();
  let next=0,emitted=0,seed=78231,peak=0;
  function random() {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  }
  return {
    emit(x,y,z,time,vx,vz,effort) {
      const count=9+Math.round(effort*5);
      for(let i=0;i<count;i++) {
        const theta=random()*Math.PI*2, spread=.18+random()*.54;
        droplets[next]={start:time,x,y:y+.012,z,
          vx:vx*.38+Math.cos(theta)*spread,vy:.84+random()*1.35,vz:vz*.38+Math.sin(theta)*spread,
          size:.006+random()*.010};
        next=(next+1)%capacity;
        emitted++;
      }
    },
    frame(time,field) {
      let visible=0;
      for(const spray of droplets) {
        const age=time-spray.start;
        if(age<0 || age>.59) continue;
        const x=spray.x+spray.vx*age,y=spray.y+spray.vy*age-4.90*age*age,z=spray.z+spray.vz*age;
        if(y<field.height(x,z,time)+.001) continue;
        const size=spray.size*(1-.70*THREE.MathUtils.smoothstep(age,.27,.59));
        direction.set(spray.vx,spray.vy-9.8*age,spray.vz).normalize();
        pose.quaternion.setFromUnitVectors(up,direction);
        pose.position.set(x,y,z);
        pose.scale.set(size,size*(1.24+.50*Math.abs(direction.y)),size);
        pose.updateMatrix();
        mesh.setMatrixAt(visible++,pose.matrix);
      }
      if(mesh.count || visible) mesh.instanceMatrix.needsUpdate=true;
      mesh.count=visible;
      peak=Math.max(peak,visible);
    },
    clear() {
      for(const spray of droplets) spray.start=-Infinity;
      mesh.count=next=emitted=peak=0;
    },
    inspect:()=>({emitted,airborne:mesh.count,peak}),
  };
}
