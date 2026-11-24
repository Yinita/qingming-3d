import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";
import { legRig } from "./bridge-gait.js";

function piece(parent, shape, material, x, y, z) {
  const mesh = new THREE.Mesh(shape, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const { clamp }=THREE.MathUtils;

const plain = (color, roughness = .84) => new THREE.MeshStandardMaterial({ color, roughness });

function foldFactor(theta,y) {
  const crease=Math.pow(Math.max(0,Math.cos(theta*6+y*6.2)),5);
  return 1+.062*Math.sin(theta*7+y*4.2)+.026*Math.sin(theta*13-y*6.2)+.047*crease;
}

function fabric(points, depth, offset = 0, count = 32, foldOrigin = 0) {
  const contour=points.map(([radius,y])=>new THREE.Vector2(radius,y));
  const outline=count>32 ? contour.flatMap((p,i)=>i===0 ? [p] : [contour[i-1].clone().lerp(p,.5),p]) : contour;
  const g = new THREE.LatheGeometry(outline,count);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const circumference=2*Math.PI*Math.max(...points.map(([r])=>r));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const theta = Math.atan2(x, z);
    const fold=foldFactor(theta,y+foldOrigin);
    pos.setXYZ(i, x * fold, y + offset * Math.cos(theta), z * depth * fold);
    uv.setXY(i,uv.getX(i)*circumference,y);
  }
  g.computeVertexNormals();
  return g;
}

function surfacePoint(profile,theta,y,standOff) {
  const i=profile.findIndex(([,h],j)=>j>0 && y<=h);
  const [a,low]=profile[i-1], [b,high]=profile[i];
  const radius=THREE.MathUtils.lerp(a,b,(y-low)/(high-low))*foldFactor(theta,y)+standOff;
  return [radius*Math.sin(theta),y+.012*Math.cos(theta),radius*.70*Math.cos(theta)];
}

function robeSeam(parent,profile,points,material,width,detail,standOff=.008) {
  const course=new THREE.CatmullRomCurve3(points.map(([theta,y])=>new THREE.Vector3(theta,y,0)));
  const vertices=[],uv=[],indices=[];
  const rows=detail ? 28 : 12;
  for(let row=0;row<=rows;row++) {
    const point=course.getPoint(row/rows);
    for (const side of [-1,1]) {
      const y=point.y+side*width*.37, theta=point.x+side*width*1.42;
      vertices.push(...surfacePoint(profile,theta,y,standOff));
      uv.push(row/rows,side*.5+.5);
    }
    if(row>0) {
      const i=row*2;
      indices.push(i-2,i-1,i,i-1,i+1,i);
    }
  }
  const shape=new THREE.BufferGeometry();
  shape.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  shape.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  piece(parent,shape,material,0,0,0);
}

function apron(figure,profile,material,edge) {
  const positions=[],uv=[],indices=[];
  const columns=18, rows=10;
  for(let row=0;row<=rows;row++) {
    const t=row/rows;
    const spread=.63+.16*t;
    for(let col=0;col<=columns;col++) {
      const u=col/columns, theta=Math.PI+(2*u-1)*spread;
      const y=.950-.344*t+Math.sin(Math.PI*u)*.016*t;
      const relief=.016+.005*Math.cos(u*22+t*2)*t;
      positions.push(...surfacePoint(profile,theta,y,relief));
      uv.push(.38*u,1-y);
      if(row>0&&col>0) {
        const i=row*(columns+1)+col;
        indices.push(i-columns-2,i-columns-1,i,i-columns-2,i,i-1);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  piece(figure,geometry,material,0,0,0).name="Fitted linen apron";
  for(const side of [-1,1]) {
    robeSeam(figure,profile,[[Math.PI+side*.63,.95],[Math.PI+side*.71,.774],
      [Math.PI+side*.78,.613]],edge,.009,true,.022);
  }
}

function wovenHat(head,straw,rim) {
  const crown=[[0,.184],[.065,.180],[.114,.151],[.175,.105],[.219,.077],
    [.262,.061],[.303,.048],[.331,.039],[.345,.034]];
  const lower=crown.slice().reverse().map(([r,y])=>[r,y-.014]);
  const geometry=new THREE.LatheGeometry([...crown,...lower].map(([r,y])=>new THREE.Vector2(r,y)),48);
  const p=geometry.attributes.position;
  const colors=[];
  for(let i=0;i<p.count;i++) {
    const a=Math.atan2(p.getX(i),p.getZ(i)), r=Math.hypot(p.getX(i),p.getZ(i));
    const tone=.83+.105*Math.sin(a*21+r*87)+.038*Math.sin(a*14-r*231);
    colors.push(tone,tone*.95,tone*.84);
    p.setY(i,p.getY(i)+r*.010*Math.sin(a*4));
  }
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  straw.vertexColors=true;
  piece(head,geometry,straw,0,.105,0);
  for(const [r,y] of crown.slice(2)) {
    const braid=new THREE.TorusGeometry(r,r>.34?.007:.0027,5,48).rotateX(Math.PI/2);
    piece(head,braid,rim,0,.105+y,0);
  }
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
  const hip=new THREE.Vector3(side*legRig.separation,legRig.hip,0);
  const kneeY=-legRig.upper;
  const geometry=fabric([[.076,kneeY-.179],[.077,kneeY-.091],[.071,kneeY-.038],[.073,kneeY],
    [.078,kneeY+.043],[.093,-.23],[.103,-.126],[.102,.032]],.93,0,40);
  const vertices=geometry.attributes.position;
  const indices=new Uint16Array(vertices.count*4), weights=new Float32Array(vertices.count*4);
  for(let i=0;i<vertices.count;i++) {
    const blend=THREE.MathUtils.smoothstep(vertices.getY(i),kneeY-.075,kneeY+.085);
    indices[4*i+1]=1;
    weights[4*i]=blend;
    weights[4*i+1]=1-blend;
  }
  geometry.setAttribute("skinIndex",new THREE.BufferAttribute(indices,4));
  geometry.setAttribute("skinWeight",new THREE.BufferAttribute(weights,4));
  const pants=new THREE.SkinnedMesh(geometry,trousers);
  pants.position.copy(hip);
  pants.castShadow=pants.receiveShadow=true;
  pants.frustumCulled=false;
  figure.add(pants);
  const upper=new THREE.Bone(), calf=new THREE.Bone();
  upper.name=side<0 ? "Left thigh" : "Right thigh";
  calf.name=side<0 ? "Left shin" : "Right shin";
  calf.position.y=kneeY;
  pants.add(upper);
  upper.add(calf);
  pants.bind(new THREE.Skeleton([upper,calf]));
  const wrap=[[.057,-.325],[.061,-.294],[.066,-.25],[.071,-.214],[.076,-.179]];
  piece(calf,fabric(wrap,.93,0,40,kneeY),dyed,0,0,0).name="Linen boot wrap";
  for (const y of [-.284,-.251,-.218,-.192]) {
    const course=Array.from({length:32},(_,i)=>{
      const theta=i*Math.PI/16;
      const height=y+.005*Math.sin(theta+.4);
      const row=wrap.findIndex(([,h])=>height<h);
      const [start,low]=wrap[row-1], [end,high]=wrap[row];
      const radius=THREE.MathUtils.lerp(start,end,(height-low)/(high-low))*foldFactor(theta,height+kneeY)+.0026;
      return new THREE.Vector3(radius*Math.sin(theta),height,radius*.93*Math.cos(theta));
    });
    const cord=new THREE.CatmullRomCurve3(course,true);
    piece(calf,new THREE.TubeGeometry(cord,36,.0034,5,true),binding,0,0,0);
  }
  const ankle=new THREE.Group();
  figure.add(ankle);
  const shoe=piece(ankle,new THREE.SphereGeometry(1,22,13),footwear,0,-.023,-.034);
  shoe.scale.set(.079,.041,.127);
  shoe.name=side<0 ? "Left boot" : "Right boot";
  const soleShape=new THREE.SphereGeometry(1,24,13);
  const soleVertices=soleShape.attributes.position;
  for(let i=0;i<soleVertices.count;i++) soleVertices.setY(i,Math.max(-.57,soleVertices.getY(i)));
  soleShape.computeVertexNormals();
  const sole=piece(ankle,soleShape,hem,0,-.05845,-.039);
  sole.scale.set(.081,.015,.132);
  sole.name=side<0 ? "Left sole" : "Right sole";
  const footprint=[];
  for(let i=0;i<soleVertices.count;i+=2){
    if(soleVertices.getY(i)>0) continue;
    footprint.push(new THREE.Vector3().fromBufferAttribute(soleVertices,i).multiply(sole.scale).add(sole.position));
  }
  const stitch=new THREE.CatmullRomCurve3([[-.068,-.030,-.093],[-.044,-.010,-.127],
    [0,-.004,-.138],[.044,-.010,-.127],[.068,-.030,-.093]].map(p=>new THREE.Vector3(...p)));
  piece(ankle,new THREE.TubeGeometry(stitch,20,.0022,5,false),hem,0,0,0);
  return { upper,calf,ankle,footprint,hip };
}

function waterStain(material, moisture) {
  const previous=material.onBeforeCompile;
  const key=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    previous.call(material,shader);
    shader.uniforms.wetCloth=moisture;
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec3 wetPoint;")
      .replace("#include <skinning_vertex>","#include <skinning_vertex>\nwetPoint=(modelMatrix*vec4(transformed,1.)).xyz;");
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
  material.customProgramCacheKey=()=>key+"-wet-cloth";
}

export function riverWorker(parent, surface, role, residentHat=false) {
  const figure = new THREE.Group();
  parent.add(figure);
  const shades = {
    player: [0xc1cdd0, 0x717d76, 0x647378, 0xbfb28e],
    merchant: [0xd1b398, 0x766f60, 0x7e6d52, 0xc6b58f],
    helper: [0xa9b69e, 0x788275, 0x58604a, 0xc1aa7c],
    resident: [0xfdf5e3, 0xaaa591, 0x6e6453, 0xc1aa86],
  }[role];
  const cloth = surface("indigo-linen", shades[0], .40);
  const trousers = surface("indigo-linen", shades[1], .49);
  cloth.userData.streetCloth=role==="resident";
  const apronLinen=role==="merchant" ? surface("indigo-linen",0xc7a079,.57) : null;
  for(const linen of [cloth,trousers,...(apronLinen ? [apronLinen] : [])]) {
    linen.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>",`
        #ifdef USE_MAP
          vec3 weave=texture2D(map,vMapUv).rgb;
          float lightness=dot(weave,vec3(.2126,.7152,.0722));
          float fiber=smoothstep(.029,.47,lightness);
          diffuseColor.rgb*=mix(vec3(.43,.41,.37),vec3(.96,1.01,1.02),fiber);
        #endif`);
    };
    linen.customProgramCacheKey=()=>"dyed-woven-linen";
  }
  const binding = plain(shades[2], .78);
  const dyed = plain(shades[3], .79);
  binding.side=dyed.side=THREE.DoubleSide;
  const skin = plain({player:0xcfab8c,merchant:0xb7896b,helper:0xc09576,resident:0xc6a182}[role],.72);
  const facePaint=skin.clone();
  facePaint.vertexColors=true;
  const lips = plain(0x785245, .80);
  const sclera=plain(0xc5ae93,.67);
  const brow = plain(0x363128, .84);
  const footwear = plain(0x3a332a, .89);
  const hem = plain(0x554c3b, .84);
  const strapPaint = plain(0x9a8968);
  const moisture={ value:new THREE.Vector3() };
  if (role==="player") {
    for (const mat of [trousers,footwear,hem,dyed,cloth]) waterStain(mat,moisture);
  }
  const detail=role!=="resident";
  const robe=[[0, .606], [.282, .619], [.293, .66], [.268, .77],
    [.232, .91], [.229, 1.04], [.251, 1.17], [.267, 1.256], [.21, 1.32],
    [.114, 1.357], [.101, 1.361], [0, 1.364]];
  piece(figure,fabric(robe,.70,.012,detail ? 48 : 32),cloth,0,0,0).name="Outer robe shell";
  piece(figure, new THREE.CylinderGeometry(.072, .084, .105, 16), skin, 0, 1.382, -.005);
  piece(figure, fabric([[.232,.948],[.238,.961],[.236,1.008],[.229,1.015]], .72), hem, 0, 0, 0);
  piece(figure,fabric([[.274,.618],[.294,.634],[.296,.657],[.287,.668]],.708,.012),binding,0,0,0);
  robeSeam(figure,robe,[[3.64,1.327],[3.24,1.268],[2.85,1.206],[2.51,1.151],[2.93,1.056],[3.41,.983]],binding,.046,detail);
  robeSeam(figure,robe,[[2.56,1.33],[2.74,1.281],[3.02,1.231]],dyed,.030,detail);
  ribbon(figure, [.179,.978,-.126],[.153,.803,-.171],.030,dyed);
  const knot=piece(figure,new THREE.SphereGeometry(1,12,8),dyed,.147,.982,-.165);
  knot.scale.set(.048,.025,.026);
  if (apronLinen) {
    apronLinen.side=THREE.DoubleSide;
    apron(figure,robe,apronLinen,binding);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.50, -.016);
  head.scale.set(.81,.89,.84);
  figure.add(head);
  const skull = new THREE.SphereGeometry(.149, detail ? 52 : 30, detail ? 36 : 22);
  const position = skull.attributes.position;
  const faceColours=[];
  for (let i = 0; i < position.count; i++) {
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    const chin=1-THREE.MathUtils.smoothstep(-y,.014,.144)*.29;
    const front=THREE.MathUtils.smoothstep(-z,.059,.124);
    const cheek=Math.exp(-((Math.abs(x)-.081)**2/.0017+(y+.031)**2/.0011));
    const socket=Math.exp(-((Math.abs(x)-.053)**2/.00037+(y-.017)**2/.00026));
    const jaw=Math.exp(-(x*x/.0043+(y+.109)**2/.0010));
    const muzzle=Math.exp(-(x*x/.0023+(y+.049)**2/.0010));
    const bridge=Math.exp(-(x*x/.00042+(y-.005)**2/.0022));
    const noseTip=Math.exp(-(x*x/.00078+(y+.026)**2/.00024));
    const nostril=Math.exp(-((Math.abs(x)-.017)**2/.00010+(y+.042)**2/.00010));
    const pores=.013*Math.sin(331*x+192*y)*Math.sin(259*y-138*z);
    position.setXYZ(i,x*chin,y*1.105,z*.87-front*(.021*cheek-.012*socket+.014*jaw+.008*muzzle+
      .019*bridge+.035*noseTip-.004*nostril));
    faceColours.push(1-.14*socket-.23*nostril+pores,.97-.18*socket-.10*cheek-.28*nostril+pores,
      .93-.18*socket-.12*cheek-.29*nostril+pores);
  }
  skull.setAttribute("color",new THREE.Float32BufferAttribute(faceColours,3));
  skull.computeVertexNormals();
  piece(head, skull, facePaint, 0, 0, 0);
  const cap = new THREE.SphereGeometry(.151, 24, 17, 0, Math.PI * 2, 0, Math.PI * .62);
  const hair = piece(head, cap, brow, 0, .045, .022);
  hair.scale.set(.99, .91, .87);
  const bun = piece(head, new THREE.SphereGeometry(.051, 14, 10), brow, 0, .170, .064);
  bun.scale.set(.96, .79, .99);
  for (const side of [-1, 1]) {
    const ear = piece(head, new THREE.SphereGeometry(.026, 10, 8), skin, side * .136, -.014, -.004);
    ear.scale.set(.55, 1, .67);
    const eye=piece(head,new THREE.SphereGeometry(.017,14,10),sclera,side*.050,.013,-.120);
    eye.scale.set(1.12,.34,.25);
    eye.rotation.z=side*.07;
    const iris=piece(head,new THREE.SphereGeometry(.0082,12,8),brow,side*.047,.013,-.125);
    iris.scale.set(.70,.62,.31);
    const lid=new THREE.CatmullRomCurve3([[side*.031,.014,-.120],[side*.049,.019,-.125],
      [side*.060,.018,-.124],[side*.070,.013,-.117]].map(x=>new THREE.Vector3(...x)));
    piece(head,new THREE.TubeGeometry(lid,12,.0025,5,false),lips,0,0,0);
    const arch=new THREE.CatmullRomCurve3([[side*.028,.034,-.123],[side*.044,.039,-.122],
      [side*.060,.041,-.114],[side*.074,.036,-.105]].map(x=>new THREE.Vector3(...x)));
    piece(head,new THREE.TubeGeometry(arch,12,.0028,5,false),brow,0,0,0);
  }
  const mouth=new THREE.CatmullRomCurve3([[-.024,-.061,-.108],[-.012,-.063,-.121],
    [0,-.064,-.125],[.012,-.063,-.121],[.024,-.061,-.108]].map(x=>new THREE.Vector3(...x)));
  piece(head,new THREE.TubeGeometry(mouth,16,.0027,5,false),lips,0,0,0);
  if (role === "merchant") {
    const beard = piece(head, new THREE.SphereGeometry(.054, 14, 9), lips, 0, -.096, -.091);
    beard.scale.set(.76, .90, .47);
    for (const side of [-1,1]) ribbon(head, [0, -.052, -.12], [side*.065, -.068, -.102], .014, brow, .008);
  }
  if (role !== "player" && (role!=="resident" || residentHat)) {
    const straw = plain(0xb49a62, .90);
    const rim = plain(0x7f6a4a, .94);
    wovenHat(head,straw,rim);
    const cord=plain(0x77654b,.97);
    for (const side of [-1,1]) {
      const trace=new THREE.CatmullRomCurve3([[side*.139,.158,-.018],[side*.144,.072,-.027],
        [side*.135,-.018,-.048],[side*.108,-.081,-.067],[side*.052,-.127,-.064],[0,-.141,-.059]]
        .map(p=>new THREE.Vector3(...p)));
      piece(head,new THREE.TubeGeometry(trace,detail ? 20 : 12,.0048,5,false),cord,0,0,0);
    }
  }

  const torsoPivot=new THREE.Group(), torso=role==="merchant" ? figure : new THREE.Group();
  if(torso!==figure) {
    for(const part of [...figure.children]) torso.add(part);
    torsoPivot.position.y=.91;
    torso.position.y=-.91;
    torsoPivot.add(torso);
    figure.add(torsoPivot);
  }
  const limbs = { legs: [], arms: [], elbows:[] };
  const straps = new THREE.Group();
  straps.name="Cargo harness";
  straps.visible=false;
  figure.add(straps);
  if(role==="helper" || role==="player"){
    piece(straps,detailedBox(.345,.385,.040,strapPaint,.011),strapPaint,0,1.012,.229);
    for(const x of [-.129,.129]) {
      ribbon(straps,[x,.842,.246],[x,1.262,.246],.043,hem,.020);
      ribbon(straps,[x,1.238,.232],[x*.83,1.337,.088],.045,strapPaint,.021);
    }
  }
  const articulated=[];
  for (const side of [-1, 1]) {
    if (role==="player" || role==="helper" || role==="resident") {
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
    torso.add(arm);
    piece(arm, fabric([[.083,-.244],[.087,-.203],[.103,-.126],[.097,-.026],[.060,.045],[0,.053]],.86),
      cloth,0,0,0);
    const elbow=new THREE.Group();
    elbow.position.set(0,-.212,-.005);
    arm.add(elbow);
    piece(elbow,fabric([[.070,-.166],[.081,-.139],[.085,-.081],[.085,-.030],[.082,.039]],.87),cloth,0,0,0);
    piece(elbow,new THREE.CylinderGeometry(.077,.073,.033,20),binding,0,-.152,-.003);
    const hand = piece(elbow, new THREE.SphereGeometry(.045, 16, 12), skin, 0, -.196, -.009);
    hand.scale.set(.73,.96,.63);
    if(detail) for(let finger=0;finger<4;finger++) {
      const digit=piece(elbow,new THREE.CapsuleGeometry(.0086,.020-.002*Math.abs(1-finger),4,8),
        skin,side*(.024-.015*finger),-.232,-.010-.005*finger);
      digit.rotation.x=.21+.11*finger;
      digit.rotation.z=side*(finger-1.5)*.082;
    }
    const thumb = piece(elbow,new THREE.SphereGeometry(.022,12,9),skin, -.031 * side, -.194, -.035);
    thumb.scale.set(.74,1.17,.74);
    limbs.arms.push(arm);
    limbs.elbows.push(elbow);
    if(role==="helper" || role==="player"){
      ribbon(straps,[side*.10,1.340,.085],[side*.15,1.237,-.151],.049,strapPaint,.025);
      ribbon(straps,[side*.15,1.237,-.151],[side*.116,.956,-.17],.043,strapPaint,.02);
    }
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
    const tilt=new THREE.Vector3(), solePoint=new THREE.Vector3(), pivot=new THREE.Vector3(), flatPivot=new THREE.Vector3();
    const heading=new THREE.Quaternion(), rock=new THREE.Quaternion(), flat=new THREE.Quaternion();
    const shinRotation=new THREE.Quaternion();
    const pitchAxis=new THREE.Vector3(1,0,0);
    const {upper:outer,lower:inner,ankle}=legRig;
    poseFeet=(feet,floor,x,y,z,yaw)=>{
      const cos=Math.cos(yaw), sin=Math.sin(yaw);
      for(const [i,leg] of articulated.entries()){
        const foot=feet[i], gx=foot.x-x, gz=foot.z-z;
        anklePoint.set(gx*cos-gz*sin,foot.y-y+ankle,gx*sin+gz*cos);
        const delta=.075;
        const sx=clamp((floor(foot.x-delta,foot.z)-floor(foot.x+delta,foot.z))/(2*delta),-.6,.6);
        const sz=clamp((floor(foot.x,foot.z-delta)-floor(foot.x,foot.z+delta))/(2*delta),-.6,.6);
        tilt.set(sx*cos-sz*sin,1,sx*sin+sz*cos).normalize();
        flat.setFromUnitVectors(up,tilt)
          .multiply(heading.setFromAxisAngle(up,foot.yaw-yaw));
        const pitch=foot.pitch || 0;
        leg.ankle.quaternion.copy(flat).multiply(rock.setFromAxisAngle(pitchAxis,pitch));
        pivot.set(0,-ankle,pitch>=0 ? .070 : -.149);
        flatPivot.copy(pivot).applyQuaternion(flat);
        anklePoint.add(flatPivot.sub(pivot.applyQuaternion(leg.ankle.quaternion)));
        let lift=0;
        for(const point of leg.footprint) {
          solePoint.copy(point).applyQuaternion(leg.ankle.quaternion).add(anklePoint);
          const sx=x+solePoint.x*cos+solePoint.z*sin;
          const sz=z-solePoint.x*sin+solePoint.z*cos;
          lift=Math.max(lift,floor(sx,sz)+.006-y-solePoint.y);
        }
        anklePoint.y+=lift;
        axis.copy(anklePoint).sub(leg.hip);
        const span=Math.max(.045,axis.length());
        axis.normalize();
        const reach=Math.min(outer+inner-.002,span);
        if(span>reach) anklePoint.copy(leg.hip).addScaledVector(axis,reach);
        const joint=(outer*outer-inner*inner+reach*reach)/(2*reach);
        bend.set(.085*foot.side,0,-1).addScaledVector(axis,-axis.dot(bend)).normalize();
        kneePoint.copy(leg.hip).addScaledVector(axis,joint)
          .addScaledVector(bend,Math.sqrt(Math.max(0,outer**2-joint**2)));
        leg.upper.quaternion.setFromUnitVectors(down,direction.copy(kneePoint).sub(leg.hip).normalize());
        shinRotation.setFromUnitVectors(down,direction.copy(anklePoint).sub(kneePoint).normalize());
        leg.calf.quaternion.copy(leg.upper.quaternion).invert().multiply(shinRotation);
        leg.ankle.position.copy(anklePoint);
      }
    };
  }
  function stand(floor,x,y,z,yaw) {
    const feet=[-1,1].map(side=>{
      const px=x+side*legRig.separation*Math.cos(yaw), pz=z-side*legRig.separation*Math.sin(yaw);
      return {x:px,y:floor(px,pz),z:pz,yaw,side};
    });
    poseFeet(feet,floor,x,y,z,yaw);
  }
  let effort=0;
  let carryWeight=0;
  function walkBody(phase,walking,carrying,dt) {
    effort=THREE.MathUtils.damp(effort,Number(walking),10,dt);
    carryWeight=THREE.MathUtils.damp(carryWeight,Number(carrying),15,dt);
    const balance=effort*(1-.65*carryWeight);
    if(torso!==figure) {
      torsoPivot.position.x=.014*balance*Math.sin(phase);
      torsoPivot.rotation.set(-effort*(.033+.032*carryWeight),.064*balance*Math.sin(phase+.32),
        .043*balance*Math.sin(phase-.21),"YXZ");
      head.rotation.z=-.029*balance*Math.sin(phase-.21);
      head.rotation.x=.013*effort*Math.sin(phase*2+.45);
    }
    for(let i=0;i<limbs.arms.length;i++) {
      const swing=Math.sin(phase+(i+1)*Math.PI);
      limbs.arms[i].rotation.x=THREE.MathUtils.lerp(.25*balance*swing,.88,carryWeight);
    }
    for(let i=0;i<limbs.elbows.length;i++) {
      const forward=Math.max(0,Math.sin(phase+(i+1)*Math.PI));
      limbs.elbows[i].rotation.x=-THREE.MathUtils.lerp(.12+.35*forward,.25,carryWeight)*effort;
    }
  }
  return {figure,limbs,straps,head,reachWithRightHand,poseFeet,stand,walkBody,moisture:moisture.value};
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
