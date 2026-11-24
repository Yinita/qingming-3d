import * as THREE from "three";
import { waterHeight } from "./bridge-canal-bed.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function wetWood(material,height) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.boatWetLine=height;
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 hullWorld;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nhullWorld=(modelMatrix*vec4(position,1.)).xyz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        uniform float boatWetLine;
        varying vec3 hullWorld;
      `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        float timberGrain=.013*sin(hullWorld.x*38.+hullWorld.z*27.)+.006*sin(hullWorld.z*91.);
        float saturation=1.-smoothstep(boatWetLine-.032,boatWetLine+.045,hullWorld.y+timberGrain);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.63,.66,.61),saturation);
      `)
      .replace("#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.39,saturation*.65);");
  };
  material.customProgramCacheKey=()=>"moored-skiff-wet-wood";
}

export function mooredSkiff(parent, center, timber, trim, boxGeometry) {
  const boat = new THREE.Group();
  boat.name = "Moored timber skiff";
  const anchorX = center.x - 8.62, anchorZ = center.z - 8.5;
  const x = center.x - 5.03, z = center.z - 7.72;
  const shape = [[-1.63,.04,.45],[-1.43,.36,.34],[-.96,.54,.26],[-.4,.61,.25],
    [.42,.60,.25],[.97,.50,.28],[1.36,.33,.34],[1.57,.055,.48]];
  parent.add(boat);
  const wetLine={ value:waterHeight+.052 };
  wetWood(trim,wetLine);

  function solid(geometry, material, parent, x=0, y=0, z=0) {
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.layers.enable(1);
    parent.add(mesh);
    return mesh;
  }

  function plank(parent,x,y,z,w,h,d,material,angle=0) {
    const mesh = solid(boxGeometry(w,h,d,material,.011,Math.sin(z*11.2)*7),material,parent,x,y,z);
    mesh.rotation.y = angle;
    return mesh;
  }

  for (const side of [-1,1]) {
    const positions = [], uv = [], indices = [];
    for (const [i,[z,width,height]] of shape.entries()) {
      for (const [j,[r,y]] of [[.48,-.091],[.79,.005],[.944,.117],[1,height],[.93,height+.012],[.88,.124],[.625,.006]].entries()) {
        positions.push(side*r*width,y,z);
        uv.push(.27+z*.74,y*1.4+j*.31);
        const a = i*7+j, b = a+7;
        if (i<shape.length-1 && j<6) indices.push(...(side>0 ? [a,b,a+1,a+1,b,b+1] : [a,a+1,b,a+1,b+1,b]));
      }
    }
    const hull = new THREE.BufferGeometry();
    hull.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    hull.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
    hull.setIndex(indices);
    hull.computeVertexNormals();
    solid(hull,trim,boat);
    for (let i=0; i<shape.length-1; i++) {
      const [from,w1,h1] = shape[i], [to,w2,h2] = shape[i+1];
      const rail = plank(boat,(w1+w2)*.5*side,(h1+h2)*.5+.007,(from+to)*.5,
        .047,.058,Math.hypot(to-from,w2-w1)+.019,timber,Math.atan2((w2-w1)*side,to-from));
      rail.rotation.x = Math.atan2(h1-h2,to-from);
    }
  }
  for (let i=0; i<6; i++) plank(boat,(i-2.5)*.103,.026,0,.095,.045,2.32,timber);
  for (const [width,z] of [[.91,-.78],[1.10,.05],[.92,.83]]) {
    plank(boat,0,.199,z,width,.047,.172,timber);
  }
  for (const [x,z] of [[.21,.49],[-.14,.75]]) {
    plank(boat,x,.16,z,.264,.253,.239,timber,.10);
    for (const offset of [-.088,.070]) plank(boat,x+offset,.167,z+.118,.021,.266,.018,trim,.10);
  }
  for (const [z,,height] of [shape[0],shape.at(-1)]) {
    plank(boat,0,height/2-.042,z,.133,height+.075,.092,trim);
  }
  // The towline crosses a raised wooden cleat at the stem.
  const knotWood=plank(boat,-.114,.353,-1.37,.090,.067,.077,timber,.18);
  knotWood.rotation.z=.13;
  plank(boat,-.114,.387,-1.37,.152,.032,.055,trim,.12);
  const oar = plank(boat,-.338,.26,-.24,.035,.030,1.90,trim,.14);
  oar.rotation.z = .13;
  plank(boat,-.439,.255,-1.15,.115,.028,.37,timber,.14);

  for (const material of [timber,trim]) {
    const meshes = boat.children.filter(mesh => mesh.material === material);
    const parts = meshes.map(mesh => {
      mesh.updateMatrix();
      return mesh.geometry.applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(parts);
    boat.remove(...meshes);
    parts.forEach(part => part.dispose());
    solid(geometry,material,boat);
  }

  const post = plank(parent,anchorX,.28,anchorZ,.144,.65,.145,trim,-.2);
  post.rotation.z = -.042;
  const anchor = new THREE.Vector3(anchorX,.52,anchorZ);
  const cleat = new THREE.Vector3(-.114,.376,-1.37);
  const tie = new THREE.Vector3(), offset=new THREE.Vector3();
  const forward=new THREE.Vector3();
  const wake=new THREE.Vector4(x,z,Math.sin(.23),Math.cos(.23));
  const motion=new THREE.Vector4();
  const velocity=new THREE.Vector3();
  const flow=new THREE.Vector2();
  const angle=new THREE.Euler(0,.23,0,"YXZ");
  let yawVelocity=0, rollVelocity=0, pitchVelocity=0;
  let tuggedAt=-Infinity, pulls=0, rest=0, span=0, stretch=0, heaveTarget=0;
  const deckOffset=.031;
  const frameStart=new THREE.Vector3();
  boat.position.set(x,waterHeight+deckOffset,z);
  boat.rotation.copy(angle);
  boat.localToWorld(tie.copy(cleat));
  const maximum=anchor.distanceTo(tie)+.103;

  const rope = new THREE.PlaneGeometry(1,1,48,8);
  const positions=rope.attributes.position;
  positions.setUsage(THREE.DynamicDrawUsage);
  const colors=[];
  for(let edge=0;edge<=8;edge++){
    for(let i=0;i<=48;i++){
      const dye=.86+.14*Math.cos(edge*2.356+i*2.17);
      colors.push(.37*dye,.273*dye,.152*dye);
    }
  }
  rope.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  const cord=solid(rope,new THREE.MeshStandardMaterial({
    color:0xffffff,vertexColors:true,side:THREE.DoubleSide,roughness:.93
  }),parent);
  cord.name="Braided skiff mooring rope";
  cord.frustumCulled=false;
  const tangent=new THREE.Vector3(), across=new THREE.Vector3(), normal=new THREE.Vector3();
  const centerline=new THREE.Vector3();

  function renderRope() {
    const slack=Math.max(0,rest-span);
    const sag=Math.sqrt(span*slack*.36);
    across.set(tie.z-anchor.z,0,anchor.x-tie.x).normalize();
    for(let i=0;i<=48;i++){
      const t=i/48;
      centerline.lerpVectors(anchor,tie,t);
      centerline.y-=4*sag*t*(1-t);
      tangent.copy(tie).sub(anchor);
      tangent.y-=4*sag*(1-2*t);
      normal.crossVectors(tangent,across).normalize();
      for(let edge=0;edge<=8;edge++){
        const phi=edge*Math.PI/4;
        const r=.0126+.0012*Math.cos(phi*3+t*252);
        const v=i+edge*49;
        const along=Math.sin(phi)*r, lateral=Math.cos(phi)*r;
        positions.setXYZ(v,centerline.x+across.x*lateral+normal.x*along,
          centerline.y+normal.y*along,centerline.z+across.z*lateral+normal.z*along);
      }
    }
    positions.needsUpdate=true;
    rope.computeVertexNormals();
  }

  function update(time,dt,field) {
    const age=time-tuggedAt;
    const haul=.51*THREE.MathUtils.smoothstep(age,0,.60)*
      (1-THREE.MathUtils.smoothstep(age,.90,1.95));
    rest=maximum-haul;
    const c=Math.cos(angle.y), s=Math.sin(angle.y);
    function level(side,along) {
      return field.height(boat.position.x+side*c+along*s,boat.position.z-side*s+along*c,time);
    }
    const bow=level(0,1.17), stern=level(0,-1.17);
    const port=level(-.45,0), starboard=level(.45,0);
    heaveTarget=(bow+stern+port+starboard)*.25+deckOffset;
    wetLine.value=Math.max(heaveTarget-deckOffset+.048,wetLine.value-dt*.009);
    const pitch=(stern-bow)/2.34, roll=(starboard-port)/.90;
    field.velocity(boat.position.x,boat.position.z,time,flow);

    frameStart.copy(boat.position);
    const steps=Math.max(1,Math.ceil(dt/.010));
    const h=dt/steps;
    for(let i=0;i<steps;i++){
      boat.rotation.copy(angle);
      offset.copy(cleat).applyQuaternion(boat.quaternion);
      tie.copy(boat.position).add(offset);
      tangent.copy(tie).sub(anchor);
      const distance=tangent.length();
      tangent.multiplyScalar(1/distance);
      const taut=Math.max(0,distance-rest);
      const tension=taut>.0001 ? Math.max(0,54*taut+4.8*tangent.dot(velocity)) : 0;
      velocity.x+=(1.48*(flow.x-velocity.x)+.86*(x-boat.position.x)-tangent.x*tension)*h;
      velocity.z+=(1.32*(flow.y-velocity.z)+1.12*(z-boat.position.z)-tangent.z*tension)*h;
      velocity.y+=(32*(heaveTarget-boat.position.y)-5.2*velocity.y-tangent.y*tension*.16)*h;
      yawVelocity+=(5.2*(.23+.26*flow.x-angle.y)-3.8*yawVelocity+
        (offset.x*tangent.z-offset.z*tangent.x)*tension*.66)*h;
      pitchVelocity+=(19*(pitch-angle.x)-4.8*pitchVelocity-tension*.015)*h;
      rollVelocity+=(27*(roll-angle.z)-5.5*rollVelocity+tension*.026)*h;
      boat.position.addScaledVector(velocity,h);
      angle.x=THREE.MathUtils.clamp(angle.x+h*pitchVelocity,-.16,.16);
      angle.y=THREE.MathUtils.clamp(angle.y+h*yawVelocity,-.52,.65);
      angle.z=THREE.MathUtils.clamp(angle.z+h*rollVelocity,-.22,.22);
      boat.rotation.copy(angle);
      offset.copy(cleat).applyQuaternion(boat.quaternion);
      tangent.copy(boat.position).add(offset).sub(anchor);
      const extra=tangent.length()-rest-.043;
      if (extra>0) {
        const horizontal=Math.hypot(tangent.x,tangent.z);
        const allowed=Math.sqrt(Math.max(.001,(rest+.043)**2-tangent.y**2));
        tangent.set(tangent.x/horizontal,0,tangent.z/horizontal);
        boat.position.addScaledVector(tangent,allowed-horizontal);
        velocity.addScaledVector(tangent,-Math.max(0,tangent.dot(velocity)));
      }
    }
    boat.rotation.copy(angle);
    boat.localToWorld(tie.copy(cleat));
    span=anchor.distanceTo(tie);
    stretch=Math.max(0,span-rest);
    forward.set(0,0,1).applyQuaternion(boat.quaternion).setY(0).normalize();
    wake.set(boat.position.x,boat.position.z,forward.x,forward.z);
    if (dt>0) {
      motion.set((boat.position.x-frameStart.x)/dt,(boat.position.z-frameStart.z)/dt,
        yawVelocity,(boat.position.y-frameStart.y)/dt);
    }
    renderRope();
  }

  return {
    anchor, update, wake, motion,
    tug(time) {
      if(time-tuggedAt<2.2) return false;
      tuggedAt=time;
      pulls++;
      return true;
    },
    inspect: time => ({ position:boat.position.toArray(), rotation:[angle.x,angle.y,angle.z],
      velocity:[motion.x,motion.w,motion.y], heaveTarget, pulls, stage:time-tuggedAt<2.2 ? "tug" : "moored",
      line:{ rest,span,stretch, anchor:anchor.toArray(), tie:tie.toArray() } }),
  };
}
