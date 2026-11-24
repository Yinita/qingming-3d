import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";

function piece(parent, shape, material, x, y, z) {
  const mesh = new THREE.Mesh(shape, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const { clamp }=THREE.MathUtils;

const plain = (color, roughness = .84) => new THREE.MeshStandardMaterial({ color, roughness });

function fabric(points, depth, offsets = []) {
  const count = 32;
  const g = new THREE.LatheGeometry(points.map(([radius, y]) => new THREE.Vector2(radius, y)), count);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const theta = Math.atan2(x, z);
    const fold = 1 + .051 * Math.sin(theta * 7.0 + y * 4.2) + .021 * Math.sin(theta * 13.0 - y * 6.2);
    pos.setXYZ(i, x * fold, y + (offsets[0] || 0) * Math.cos(theta), z * depth * fold);
  }
  g.computeVertexNormals();
  return g;
}

function ribbon(parent, from, to, width, material, depth = .017) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const middle = a.clone().lerp(b, .5);
  const o = piece(parent, detailedBox(width, a.distanceTo(b), depth, material, .006),
                  material, middle.x, middle.y, middle.z);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  return o;
}

function articulatedLeg(figure,side,trousers,binding,dyed,hem,footwear) {
  const upper=piece(figure,fabric([[.072,-.357],[.085,-.29],[.102,-.17],[.106,-.063],[.102,.028]],.94),
    trousers,side*.119,.68,0);
  const knee=piece(figure,new THREE.SphereGeometry(.075,14,9),trousers,0,0,0);
  const calf=piece(figure,fabric([[.057,-.301],[.065,-.25],[.074,-.17],[.076,-.085],[.075,.03]],.92),
    trousers,0,0,0);
  const linen=piece(calf,new THREE.CylinderGeometry(.071,.060,.14,18),dyed,0,-.232,0);
  linen.rotation.z=.025;
  for (const y of [-.28,-.25,-.218,-.183]) {
    const r=.061+(y+.28)*.095;
    const band=piece(calf,new THREE.TorusGeometry(r,.0042,5,16).rotateX(Math.PI/2),binding,0,y,0);
    band.rotation.z=.069;
  }
  const ankle=new THREE.Group();
  figure.add(ankle);
  const shoe=piece(ankle,new THREE.SphereGeometry(1,22,13),footwear,0,-.023,-.034);
  shoe.scale.set(.079,.041,.127);
  shoe.name=side<0 ? "Player left boot" : "Player right boot";
  const sole=piece(ankle,new THREE.SphereGeometry(1,20,9),hem,0,-.052,-.039);
  sole.scale.set(.081,.015,.132);
  return { upper,knee,calf,ankle,hip:new THREE.Vector3(side*.119,.68,0) };
}

function waterStain(material, moisture) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.wetCloth=moisture;
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 wetPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nwetPoint=(modelMatrix*vec4(position,1.)).xyz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        uniform vec3 wetCloth;
        varying vec3 wetPoint;
      `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        float margin=.025*sin(wetPoint.x*41.+wetPoint.z*37.)+.012*sin(wetPoint.z*72.);
        float wet=wetCloth.z*(1.-smoothstep(wetCloth.y-.075,wetCloth.y+.018,
          wetPoint.y-wetCloth.x+margin));
        diffuseColor.rgb*=mix(vec3(1.),vec3(.49,.55,.53),wet);
      `)
      .replace("#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.32,wet*.72);");
  };
  material.customProgramCacheKey=()=>"river-worker-wet-cloth";
}

export function riverWorker(parent, surface, role) {
  const figure = new THREE.Group();
  parent.add(figure);
  const shades = {
    player: [0xc1cdd0, 0x717d76, 0x647378, 0xbfb28e],
    merchant: [0xd1b398, 0x766f60, 0x7e6d52, 0xc6b58f],
    helper: [0xa9b69e, 0x788275, 0x58604a, 0xc1aa7c],
  }[role];
  const cloth = surface("indigo-linen", shades[0], .40);
  const trousers = surface("indigo-linen", shades[1], .49);
  const binding = plain(shades[2], .78);
  const dyed = plain(shades[3], .79);
  const skin = plain(0xb99074, .75);
  const lips = plain(0x624638, .76);
  const brow = plain(0x363128, .84);
  const footwear = plain(0x3a332a, .89);
  const hem = plain(0x554c3b, .84);
  const strapPaint = plain(0x9a8968);
  const moisture={ value:new THREE.Vector3() };
  if (role==="player") {
    for (const mat of [trousers,footwear,hem,dyed,cloth]) waterStain(mat,moisture);
  }
  const body = fabric([[0, .606], [.292, .619], [.302, .66], [.275, .77],
    [.232, .91], [.229, 1.04], [.251, 1.17], [.267, 1.256], [.21, 1.32],
    [.114, 1.357], [.101, 1.353], [0, 1.344]], .70, [.012]);
  piece(figure, body, cloth, 0, 0, 0);
  piece(figure, new THREE.CylinderGeometry(.072, .084, .105, 16), skin, 0, 1.382, -.005);
  piece(figure, fabric([[.232,.948],[.238,.961],[.236,1.008],[.229,1.015]], .72), hem, 0, 0, 0);
  ribbon(figure, [-.115, 1.329, -.105], [.145, 1.164, -.169], .042, binding);
  ribbon(figure, [.145, 1.164, -.169], [-.067, .986, -.166], .043, binding);
  ribbon(figure, [.103, 1.332, -.099], [.043, 1.248, -.155], .035, dyed);
  ribbon(figure, [.182, .984, -.133], [.142, .772, -.158], .034, dyed);
  if (role === "merchant") {
    const apron = detailedBox(.307, .351, .035, dyed, .018);
    const panel = piece(figure, apron, dyed, .001, .792, -.175);
    panel.rotation.x = -.11;
    for (const x of [-.121, .121]) ribbon(figure, [x, .946, -.197], [x, .636, -.187], .011, binding, .008);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.50, -.016);
  figure.add(head);
  const skull = new THREE.SphereGeometry(.149, 26, 18);
  const position = skull.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const chin = 1 - THREE.MathUtils.smoothstep(-y, .045, .155) * .21;
    position.setXYZ(i, position.getX(i) * chin, y * 1.09, position.getZ(i) * .87);
  }
  skull.computeVertexNormals();
  piece(head, skull, skin, 0, 0, 0);
  const cap = new THREE.SphereGeometry(.151, 24, 17, 0, Math.PI * 2, 0, Math.PI * .62);
  const hair = piece(head, cap, brow, 0, .045, .022);
  hair.scale.set(.99, .91, .87);
  const bun = piece(head, new THREE.SphereGeometry(.051, 14, 10), brow, 0, .170, .064);
  bun.scale.set(.96, .79, .99);
  for (const side of [-1, 1]) {
    const ear = piece(head, new THREE.SphereGeometry(.026, 10, 8), skin, side * .136, -.014, -.004);
    ear.scale.set(.55, 1, .67);
    const eye = piece(head, new THREE.SphereGeometry(.018, 12, 7), lips, side * .052, .012, -.118);
    eye.scale.set(1.1, .48, .38);
    ribbon(head, [side * .033, .043, -.115], [side * .075, .045, -.107], .011, brow, .006);
  }
  const nose = piece(head, new THREE.SphereGeometry(.031, 12, 8), skin, 0, -.021, -.118);
  nose.scale.set(.65, .91, .86);
  ribbon(head, [-.023, -.060, -.107], [.023, -.060, -.107], .010, lips, .004);
  if (role === "merchant") {
    const beard = piece(head, new THREE.SphereGeometry(.054, 14, 9), lips, 0, -.096, -.091);
    beard.scale.set(.76, .90, .47);
    for (const side of [-1,1]) ribbon(head, [0, -.052, -.12], [side*.065, -.068, -.102], .014, brow, .008);
  }
  if (role !== "player") {
    const straw = plain(0xb49a62, .90);
    const rim = plain(0x7f6a4a, .94);
    const hat = new THREE.LatheGeometry([[0,.15],[.083,.162],[.163,.114],[.230,.086],[.348,.043],
      [.348,.031],[.229,.064],[.114,.089],[0,.10]].map(p => new THREE.Vector2(...p)), 36);
    piece(head, hat, straw, 0, .098, 0);
    for (const [r,y] of [[.337,.139],[.281,.157],[.206,.181],[.128,.222]]) {
      const spun = new THREE.TorusGeometry(r, .0058, 4, 36).rotateX(Math.PI/2);
      piece(head, spun, rim, 0, y, 0);
    }
    for (const x of [-.112,.112]) ribbon(head,[x,.095,-.067],[x*.51,-.104,-.081], .012, dyed,.009);
  }

  const limbs = { legs: [], arms: [] };
  const straps = new THREE.Group();
  figure.add(straps);
  const articulated=[];
  for (const side of [-1, 1]) {
    if (role==="player") {
      articulated.push(articulatedLeg(figure,side,trousers,binding,dyed,hem,footwear));
    } else {
      const leg = new THREE.Group();
      leg.position.set(side * .119, .68, 0);
      figure.add(leg);
      piece(leg, fabric([[.064,-.512],[.069,-.481],[.082,-.4],[.078,-.285],[.103,-.15],[.100,.01]], .93),
            trousers, 0, 0, 0);
      piece(leg, new THREE.CylinderGeometry(.078,.071,.125,16), dyed, 0, -.526, 0);
      for (const wrap of [-.559,-.529,-.499]) {
        piece(leg, new THREE.CylinderGeometry(.079,.079,.007,16), hem, 0, wrap, 0);
      }
      const shoe = piece(leg, new THREE.SphereGeometry(1, 20, 12), footwear, 0, -.627, -.046);
      shoe.scale.set(.083,.049,.130);
      const sole = new THREE.SphereGeometry(1, 18, 7);
      const edge = piece(leg, sole, hem, 0, -.662, -.046);
      edge.scale.set(.083,.015,.128);
      limbs.legs.push(leg);
    }
    const arm = new THREE.Group();
    arm.position.set(side * .247, 1.239, .012);
    figure.add(arm);
    piece(arm, fabric([[.075,-.371],[.085,-.34],[.083,-.23],[.106,-.12],[.098,-.01],[.061,.049],[0,.061]], .86),
          cloth, 0, 0, 0);
    piece(arm, new THREE.CylinderGeometry(.078,.073,.033,16), binding, 0, -.358, -.003);
    const hand = piece(arm, new THREE.SphereGeometry(.059, 13, 9), skin, 0, -.412, -.009);
    hand.scale.set(.69,1.16,.82);
    const thumb = piece(arm,new THREE.SphereGeometry(.025,10,8),skin, -.033 * side, -.405, -.034);
    thumb.scale.set(.74,1.17,.74);
    limbs.arms.push(arm);
    ribbon(straps,[side*.10,1.340,.085],[side*.15,1.237,-.151],.049,strapPaint,.025);
    ribbon(straps,[side*.15,1.237,-.151],[side*.116,.956,-.17],.043,strapPaint,.02);
  }
  let reachWithRightHand;
  if (role === "merchant") {
    const up = new THREE.Vector3(0,1,0);
    const shoulder = limbs.arms[0].position;
    const posed = new THREE.Group();
    posed.visible = false;
    figure.add(posed);
    const upper = piece(posed, fabric([[.081,0],[.101,.099],[.095,.221],[.046,.28],[0,.305]], .87),
                        cloth,0,0,0);
    const forearm = piece(posed, fabric([[.063,0],[.080,.087],[.084,.186],[.075,.258],[0,.27]], .85),
                          cloth,0,0,0);
    const cuff = piece(forearm,new THREE.CylinderGeometry(.064,.062,.030,16),binding,0,.012,0);
    cuff.rotation.z = .06;
    const clasp = new THREE.Group();
    posed.add(clasp);
    const palm = piece(clasp,new THREE.SphereGeometry(.055,14,10),skin,0,0,.017);
    palm.scale.set(.83,1.0,.65);
    for (let i=0; i<3; i++) {
      const finger = piece(clasp,new THREE.CapsuleGeometry(.0105,.026,4,8),skin,.021-i*.020,.003,-.019);
      finger.rotation.x = .93;
    }
    const thumb = piece(clasp,new THREE.CapsuleGeometry(.012,.020,4,8),skin,-.033,.025,.016);
    thumb.rotation.z = .65;
    const wrist = new THREE.Vector3(), elbow = new THREE.Vector3();
    const straight = new THREE.Vector3(), outward = new THREE.Vector3();
    const worldTarget = new THREE.Vector3();

    function fit(sleeve, end, start, length) {
      sleeve.position.copy(end);
      straight.copy(start).sub(end);
      sleeve.scale.y = straight.length()/length;
      sleeve.quaternion.setFromUnitVectors(up,straight.normalize());
    }

    reachWithRightHand = (grip, reach) => {
      limbs.arms[0].visible = reach <= .005;
      posed.visible = reach > .005;
      if (!posed.visible) return;
      figure.worldToLocal(worldTarget.copy(grip));
      wrist.set(shoulder.x,shoulder.y-.389,shoulder.z-.012).lerp(worldTarget,reach);
      straight.copy(wrist).sub(shoulder).normalize();
      outward.set(-1,-.61,.24).addScaledVector(straight,-straight.dot(outward)).normalize();
      const distance = Math.min(.542,wrist.distanceTo(shoulder));
      elbow.copy(shoulder).lerp(wrist,.50).addScaledVector(outward,Math.sqrt(.272**2-(distance*.5)**2));
      fit(upper,elbow,shoulder,.28);
      fit(forearm,wrist,elbow,.25);
      clasp.position.copy(wrist);
      clasp.rotation.set(.12,.38 + reach*.41,-.40);
    };
  }
  let poseFeet;
  if (articulated.length) {
    const down=new THREE.Vector3(0,-1,0), up=new THREE.Vector3(0,1,0);
    const anklePoint=new THREE.Vector3(), axis=new THREE.Vector3();
    const bend=new THREE.Vector3(), kneePoint=new THREE.Vector3(), direction=new THREE.Vector3();
    const tilt=new THREE.Vector3();
    const heading=new THREE.Quaternion();
    const outer=.332, inner=.306;
    function bone(mesh,start,end,rest) {
      mesh.position.copy(start);
      direction.copy(end).sub(start);
      mesh.scale.y=direction.length()/rest;
      mesh.quaternion.setFromUnitVectors(down,direction.normalize());
    }
    poseFeet=(feet,floor,x,y,z,yaw)=>{
      const cos=Math.cos(yaw), sin=Math.sin(yaw);
      for(const [i,leg] of articulated.entries()){
        const foot=feet[i], gx=foot.x-x, gz=foot.z-z;
        anklePoint.set(gx*cos-gz*sin,foot.y-y+.067,gx*sin+gz*cos);
        axis.copy(anklePoint).sub(leg.hip);
        const span=Math.max(.045,axis.length());
        axis.normalize();
        const reach=Math.min(outer+inner-.002,span);
        const joint=(outer*outer-inner*inner+reach*reach)/(2*reach);
        bend.set(.085*foot.side,0,-1).addScaledVector(axis,-axis.dot(bend)).normalize();
        kneePoint.copy(leg.hip).addScaledVector(axis,joint)
          .addScaledVector(bend,Math.sqrt(Math.max(0,outer**2-joint**2)));
        bone(leg.upper,leg.hip,kneePoint,outer);
        bone(leg.calf,kneePoint,anklePoint,inner);
        leg.knee.position.copy(kneePoint);
        leg.ankle.position.copy(anklePoint);
        const delta=.075;
        const sx=clamp((floor(foot.x-delta,foot.z)-floor(foot.x+delta,foot.z))/(2*delta),-.6,.6);
        const sz=clamp((floor(foot.x,foot.z-delta)-floor(foot.x,foot.z+delta))/(2*delta),-.6,.6);
        tilt.set(sx*cos-sz*sin,1,sx*sin+sz*cos).normalize();
        leg.ankle.quaternion.setFromUnitVectors(up,tilt)
          .multiply(heading.setFromAxisAngle(up,foot.yaw-yaw));
      }
    };
  }
  return { figure, limbs, straps, head, reachWithRightHand, poseFeet, moisture:moisture.value };
}

export function counterCeramics(stall) {
  const glaze = [0x6f8269, 0x928267, 0x92937b].map(color =>
    new THREE.MeshPhysicalMaterial({ color, roughness: .35, clearcoat: .31, clearcoatRoughness: .26 }));
  const voidInk = plain(0x332c24);
  const rim = plain(0xa99f7c, .55);
  const large = [[0,.019],[.065,.019],[.068,.041],[.098,.061],[.125,.102],[.13,.16],[.118,.214],
    [.101,.247],[.094,.278],[.111,.283],[.108,.300],[.086,.299],[.078,.276],[.078,.252],
    [.102,.208],[.111,.16],[.101,.12],[.072,.05],[0,.049]];
  const cup = [[0,.008],[.059,.008],[.064,.029],[.085,.079],[.096,.117],[.094,.125],[.084,.125],
    [.085,.106],[.077,.082],[.052,.033],[0,.019]];
  const bowl = outline => new THREE.LatheGeometry(outline.map(v => new THREE.Vector2(...v)), 36);
  const jug = bowl(large);
  const dish = bowl(cup);
  for (const [i, x] of [-1.40, 1.24].entries()) {
    const jar = piece(stall, jug, glaze[i], x, .887, .88);
    jar.scale.setScalar(i ? .83 : 1);
    const circle = new THREE.CircleGeometry(.077*(i ? .83 : 1), 30).rotateX(-Math.PI/2);
    piece(stall, circle, voidInk, x, .887 + (i ? .177 : .218), .88);
    piece(stall, new THREE.TorusGeometry(.102*(i ? .83 : 1),.004,6,32).rotateX(Math.PI/2),
          rim, x, .887 + (i ? .246 : .294), .88);
  }
  for (const [i,x] of [-1.10,-.86,1.08].entries()) {
    const mug = piece(stall, dish, glaze[(i+2)%3], x, .889, 1.21 - i * .075);
    mug.scale.setScalar(.77+i*.075);
  }
}
