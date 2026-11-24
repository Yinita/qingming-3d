import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";
import { legRig } from "./bridge-gait.js";
import { buildHand } from "./bridge-hands.js";

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
  const pleat=theta*5-y*4+.35*Math.sin(theta*3+y*6.9);
  const skirt=THREE.MathUtils.smoothstep(y,.39,.62)*(1-THREE.MathUtils.smoothstep(y,.73,.96));
  const gathers=skirt*(.048*Math.cos(pleat)-.091*Math.pow(Math.max(0,-Math.cos(pleat)),7));
  return 1+.058*Math.sin(theta*7+y*4.2)+.026*Math.sin(theta*13-y*6.2)+.042*crease+gathers;
}

function robePleats(theta,y) {
  // The folds open below the sash and bend toward the two stitched sides.
  const fall=1-THREE.MathUtils.smoothstep(y,.54,1.01);
  const bias=.38*Math.sin(theta*2-.55)+.63*Math.sin((y-.67)*5.9);
  const folds=Math.cos(theta*6+bias);
  return fall*(.107*folds-.053*Math.max(0,-folds)**5+.027*Math.sin(theta*11+bias));
}

function robeVolume(theta,y) {
  const front=Math.max(0,-Math.cos(theta));
  const chest=THREE.MathUtils.smoothstep(y,1.03,1.20)*(1-THREE.MathUtils.smoothstep(y,1.26,1.36));
  const tuck=Math.exp(-(((y-.94)/.083)**2));
  const kneeRoom=.22*front*(1-THREE.MathUtils.smoothstep(y,.60,.88));
  const diagonal=Math.exp(-(((y-1.071+.075*Math.sin(theta))/.102)**2))*front;
  const folds=.027*Math.sin(theta*5+y*5)-.015*Math.cos(theta*9-y*11);
  return 1+folds+robePleats(theta,y)+kneeRoom+.082*chest*front-.041*tuck+
    diagonal*(.040*Math.cos(theta*4+y*33)-.026*Math.sin(theta*7+y*23));
}

function robeClothGeometry(profile,segments) {
  const geometry=fabric(profile,.70,.012,segments,0,robeVolume);
  const position=geometry.attributes.position, colors=[];
  for(let i=0;i<position.count;i++) {
    const theta=Math.atan2(position.getX(i),position.getZ(i)/.70);
    const y=position.getY(i)-.012*Math.cos(theta);
    const fold=robePleats(theta,y);
    const seam=Math.exp(-((Math.sin(theta)**2)/.023));
    const scuff=(1-THREE.MathUtils.smoothstep(y,profile[0][1],profile[0][1]+.14))*
      (.40+.29*Math.sin(theta*7+.6)+.17*Math.cos(theta*19));
    const pigment=1+.026*Math.sin(theta*8+y*37)+.026*Math.cos(theta*3-y*18);
    const tone=pigment+.38*fold-.065*seam;
    colors.push(tone+.080*scuff,tone+.051*scuff,tone-.038*scuff);
  }
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  return geometry;
}

function fabric(points, depth, offset = 0, count = 32, foldOrigin = 0, folds=foldFactor) {
  const contour=points.map(([radius,y])=>new THREE.Vector2(radius,y));
  const outline=count>32 ? contour.flatMap((p,i)=>i===0 ? [p] : [contour[i-1].clone().lerp(p,.5),p]) : contour;
  const g = new THREE.LatheGeometry(outline,count);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const circumference=2*Math.PI*Math.max(...points.map(([r])=>r));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const theta = Math.atan2(x, z);
    const fold=folds(theta,y+foldOrigin);
    pos.setXYZ(i, x * fold, y + offset * Math.cos(theta), z * depth * fold);
    uv.setXY(i,uv.getX(i)*circumference,y);
  }
  g.computeVertexNormals();
  return g;
}

function robeRadius(profile,y) {
  const i=profile.findIndex(([,h],j)=>j>0 && y<=h);
  const [a,low]=profile[i-1], [b,high]=profile[i];
  return THREE.MathUtils.lerp(a,b,(y-low)/(high-low));
}

function surfacePoint(profile,theta,y,standOff) {
  const radius=robeRadius(profile,y)*robeVolume(theta,y)+standOff;
  return [radius*Math.sin(theta),y+.012*Math.cos(theta),radius*.70*Math.cos(theta)];
}

function robeSeam(parent,profile,points,material,width,detail,standOff=.008) {
  const course=new THREE.CatmullRomCurve3(points.map(([theta,y])=>new THREE.Vector3(theta,y,0)));
  const vertices=[],uv=[],indices=[];
  const rows=detail ? 28 : 14, columns=detail ? 6 : 4;
  const arcRadius=.22;
  for(let row=0;row<=rows;row++) {
    const t=row/rows, taper=.70+.30*Math.sin(Math.PI*t)**.35;
    const point=course.getPoint(t), tangent=course.getTangent(t);
    const direction=new THREE.Vector2(-tangent.y,tangent.x*arcRadius).normalize();
    for(let col=0;col<=columns;col++) {
      const v=col/columns;
      const spread=(v-.5)*width*taper;
      const y=point.y+direction.y*spread, theta=point.x+direction.x*spread/arcRadius;
      vertices.push(...surfacePoint(profile,theta,y,standOff));
      uv.push(t,v);
      if(row>0 && col>0) {
        const i=row*(columns+1)+col, upper=i-columns-1;
        indices.push(upper-1,i-1,upper,upper,i-1,i);
      }
    }
  }
  const shape=new THREE.BufferGeometry();
  shape.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  shape.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  piece(parent,shape,material,0,0,0).name="Fitted robe binding";
}

function wrapSkirt(figure,robe,cloth,binding,hem,sash,lowDetail) {
  const positions=[],uv=[],colors=[],index=[];
  const rows=lowDetail ? 7 : 16, columns=lowDetail ? 7 : 15;
  function edges(t) {
    return [2.43-.55*t-.24*t*t,3.74+.17*t];
  }
  for(let row=0;row<=rows;row++) {
    const t=row/rows;
    const [opening,side]=edges(t);
    for(let col=0;col<=columns;col++) {
      const u=col/columns, theta=THREE.MathUtils.lerp(opening,side,u);
      const y=THREE.MathUtils.lerp(sash,hem+.013*Math.sin(u*Math.PI),t);
      const overlap=.009+.010*t*(1-u)**2;
      positions.push(...surfacePoint(robe,theta,y,overlap));
      uv.push(u*.37,t*(sash-hem));
      const crease=.075*Math.cos(u*19.8-t*2.2)*t;
      const worn=t**3*.12;
      colors.push(.88+crease+worn,.88+crease+worn*.7,.87+crease+worn*.36);
      if(!row || !col) continue;
      const a=row*(columns+1)+col,b=a-columns-1;
      index.push(b-1,a-1,b,b,a-1,a);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  piece(figure,geometry,cloth,0,0,0).name="Overlapping skirt panel";
  const flap=Array.from({length:6},(_,i)=>{
    const t=i/5;
    return [edges(t)[0],THREE.MathUtils.lerp(sash,hem+.007,t)];
  });
  robeSeam(figure,robe,flap,binding,.017,!lowDetail,.021);
}

function apron(figure,profile,material,edge,hem=.609) {
  const positions=[],uv=[],indices=[];
  const columns=18, rows=10;
  for(let row=0;row<=rows;row++) {
    const t=row/rows;
    const spread=.63+.16*t;
    for(let col=0;col<=columns;col++) {
      const u=col/columns, theta=Math.PI+(2*u-1)*spread;
      const y=THREE.MathUtils.lerp(.950,hem,t)+Math.sin(Math.PI*u)*.016*t;
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
    robeSeam(figure,profile,[[Math.PI+side*.63,.95],[Math.PI+side*.71,(.95+hem)*.5],
      [Math.PI+side*.78,hem+.004]],edge,.009,true,.022);
  }
}

function sleevelessCoat(figure,robe,material,short,lowDetail) {
  const positions=[],uv=[],colors=[],indices=[];
  const rows=lowDetail ? 8 : 22, columns=lowDetail ? 18 : 48;
  const collar=1.342, bottom=short ? .915 : .749;
  const edgeAt=t=>.57-.23*Math.sin(t*Math.PI*.71);
  for(let row=0;row<=rows;row++) {
    const t=row/rows, trim=row===0 || row===rows;
    const gap=edgeAt(t);
    for(let col=0;col<=columns;col++) {
      const u=col/columns, theta=THREE.MathUtils.lerp(-Math.PI+gap,Math.PI-gap,u);
      const side=Math.sin(theta)**2;
      const armhole=.143*side**2*Math.exp(-(t*t)/.12)*(1-t);
      const y=THREE.MathUtils.lerp(collar,bottom,t)-armhole+.018*t*Math.cos(theta);
      const waist=.021*Math.exp(-(((y-1.026)/.061)**2));
      const relief=.038+.006*Math.cos(theta*11+t*4)*t+.012*t**4+waist;
      positions.push(...surfacePoint(robe,theta,y,relief));
      uv.push(u*1.34,y);
      const edge=trim || col===0 || col===columns;
      colors.push(edge ? .75 : 1,edge ? .69 : 1,edge ? .60 : 1);
      if(row && col) {
        const i=row*(columns+1)+col, a=i-columns-2;
        indices.push(a,i-1,a+1,a+1,i-1,i);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  material.vertexColors=true;
  piece(figure,geometry,material,0,0,0).name="Open sleeveless work coat";
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

function bootPoint(point,side,sole) {
  const {x,y,z}=point;
  const toe=1-THREE.MathUtils.smoothstep(z,-.93,-.16);
  const heel=THREE.MathUtils.smoothstep(z,.05,.83);
  const width=1+.13*toe-.25*heel;
  const height=sole ? Math.max(-.57,y)+.14*toe : y*(.62+.33*heel)+.24*toe;
  return point.set(x*width+side*.17*toe,height,z);
}

function bootLast(geometry,side,sole) {
  const vertices=geometry.attributes.position;
  const point=new THREE.Vector3();
  for(let i=0;i<vertices.count;i++) {
    bootPoint(point.fromBufferAttribute(vertices,i),side,sole);
    vertices.setXYZ(i,point.x,point.y,point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function articulatedLeg(figure,side,trousers,binding,dyed,hem,footwear,lowDetail) {
  const hip=new THREE.Vector3(side*legRig.separation,legRig.hip,0);
  const kneeY=-legRig.upper;
  const geometry=fabric([[.076,kneeY-.179],[.077,kneeY-.091],[.071,kneeY-.038],[.073,kneeY],
    [.077,kneeY+.043],[.083,-.23],[.088,-.126],[.089,.032]],.93,0,40);
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
  const upperShoe=bootLast(new THREE.SphereGeometry(1,lowDetail ? 9 : 26,lowDetail ? 5 : 15),side,false);
  const shoe=piece(ankle,upperShoe,footwear,0,-.027,-.034);
  shoe.scale.set(.078,.050,.128);
  shoe.name=side<0 ? "Left boot" : "Right boot";
  const soleShape=bootLast(new THREE.SphereGeometry(1,lowDetail ? 9 : 28,lowDetail ? 5 : 13),side,true);
  const soleVertices=soleShape.attributes.position;
  const sole=piece(ankle,soleShape,hem,0,-.05845,-.039);
  sole.scale.set(.081,.015,.132);
  sole.name=side<0 ? "Left sole" : "Right sole";
  const footprint=[];
  for(let i=0;i<soleVertices.count;i+=2){
    if(soleVertices.getY(i)>0) continue;
    footprint.push(new THREE.Vector3().fromBufferAttribute(soleVertices,i).multiply(sole.scale).add(sole.position));
  }
  if(!lowDetail) {
    const points=[];
    const rimY=.30;
    const radius=Math.sqrt(1-rimY*rimY)*1.013;
    for(let i=0;i<=16;i++) {
      const theta=Math.PI*i/16;
      const onSole=new THREE.Vector3(Math.cos(theta)*radius,rimY,-Math.sin(theta)*radius);
      points.push(bootPoint(onSole,side,true).multiply(sole.scale).add(sole.position));
    }
    const piping=new THREE.CatmullRomCurve3(points);
    piece(ankle,new THREE.TubeGeometry(piping,24,.0019,5,false),binding,0,0,0);
  }
  return { upper,calf,ankle,footprint,hip };
}

function tailoredSleeve(arm, cloth, binding, sections, cut) {
  const joint=-.212;
  const profile=[
    [0,-.381],[.055,-.382],[.062,-.373],[.065,-.351],[.071,-.332],
    [.075,-.305],[.079,-.265],[.080,-.221],[.082,-.181],
    [.091,-.130],[.097,-.067],[.091,-.024],[.078,.012],[.059,.039],[0,.053],
  ];
  const contour=fabric(profile,.88,0,sections,0,(angle,y)=>{
    const elbow=Math.exp(-(((y-joint)/.092)**2));
    const fullness=Math.sin(Math.PI*clamp((y+.376)/.426,0,1));
    const fall=Math.max(0,Math.cos(angle-.4))*fullness;
    const crease=angle*3+y*35;
    return 1+cut*fullness+.13*cut*fall+.072*Math.cos(angle*4+y*14)+
      elbow*(.092*Math.sin(crease)-.061*Math.cos(crease*2));
  });
  const positions=contour.attributes.position;
  const indices=new Uint16Array(positions.count*4);
  const weights=new Float32Array(positions.count*4);
  for(let i=0;i<positions.count;i++) {
    const upper=THREE.MathUtils.smoothstep(positions.getY(i),joint-.082,joint+.064);
    indices[4*i+1]=1;
    weights[4*i]=upper;
    weights[4*i+1]=1-upper;
  }
  contour.setAttribute("skinIndex",new THREE.BufferAttribute(indices,4));
  contour.setAttribute("skinWeight",new THREE.BufferAttribute(weights,4));
  const sleeve=new THREE.SkinnedMesh(contour,cloth);
  sleeve.name="Tailored articulated sleeve";
  sleeve.castShadow=sleeve.receiveShadow=true;
  sleeve.frustumCulled=false;
  arm.add(sleeve);
  const shoulder=new THREE.Bone(), elbow=new THREE.Bone();
  elbow.position.set(0,joint,-.005);
  sleeve.add(shoulder);
  shoulder.add(elbow);
  arm.updateWorldMatrix(true,true);
  sleeve.bind(new THREE.Skeleton([shoulder,elbow]));
  const edge=fabric([[.056,-.172],[.063,-.167],[.065,-.150],[.063,-.145]],.88,0,sections);
  piece(elbow,edge,binding,0,0,.005).name="Bound sleeve cuff";
  return elbow;
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

const residentProfiles=[
  {skin:0xb08264,hair:0x372e26,head:[.87,.91,.83],jaw:.12,nose:1.10,shoulders:1.15,armWidth:1.05,sleeve:1.01,
    bun:.166,hem:-.035,skirt:1.14,waist:1.12,cuff:.19,cheek:1.19,chin:1.12,binding:0x74614c,cord:0xc8a880,apron:0xc0a275,smile:.006,sash:.955,hairPart:.14,trousers:0x888b76},
  {skin:0xc1a084,hair:0x615a50,head:[.74,1.00,.85],jaw:.30,nose:1.31,shoulders:.86,armWidth:.95,sleeve:1.06,
    bun:.151,beard:true,cheek:.65,chin:1.32,coat:0x93957f,binding:0x62513d,cord:0xad8b63,hem:-.137,skirt:1.01,waist:.96,cuff:.12,eyes:.69,smile:-.003,sash:1.00,hairPart:-.19,trousers:0x817965},
  {skin:0xd2ad90,hair:0x362c28,head:[.74,.89,.81],jaw:.40,nose:.77,shoulders:.86,armWidth:.82,sleeve:.96,
    bun:.151,cheek:.87,chin:.63,hem:-.102,skirt:.97,waist:.86,cuff:-.12,binding:0x4b6870,cord:0xaeb5a3,eyes:1.03,smile:.007,sash:1.033,hairPart:.23,trousers:0x74838c},
  {skin:0xa87f62,hair:0x3d3228,head:[.85,.87,.91],jaw:.15,nose:.96,shoulders:1.09,armWidth:.88,sleeve:.88,
    bun:.145,wrap:true,cheek:1.32,chin:.96,coat:0x947e63,hem:.137,skirt:.88,waist:1.02,cuff:-.16,binding:0xa7906d,cord:0xc0ab89,eyes:.88,smile:-.001,sash:.911,hairPart:-.03,trousers:0xab9878},
];

function shoulderSatchel(figure,robe,cloth,edge,lowDetail) {
  // The strap follows the robe on both sides and meets the pouch at the hip.
  for(const side of [-1,1]) {
    const front=side<0;
    const strap=front ? [[3.89,1.333],[3.48,1.263],[3.08,1.167],[2.71,1.050],[2.27,.949]] :
      [[-.75,1.333],[-.44,1.260],[-.04,1.164],[.38,1.050],[.92,.949]];
    robeSeam(figure,robe,strap,edge,.043,!lowDetail,.030);
  }
  const bag=new THREE.Group();
  bag.position.set(.232,.823,.006);
  bag.rotation.z=.21;
  bag.rotation.y=.69;
  figure.add(bag);
  piece(bag,fabric([[0,-.117],[.067,-.111],[.095,-.075],[.101,.004],
    [.091,.063],[.076,.080],[0,.085]],.59,0,lowDetail ? 10 : 28),cloth,0,0,0).name="Cloth shoulder satchel";
  const flap=piece(bag,new THREE.SphereGeometry(1,lowDetail ? 8 : 16,lowDetail ? 5 : 9),
    edge,0,.055,-.024);
  flap.scale.set(.086,.037,.039);
  piece(bag,new THREE.SphereGeometry(.011,10,7),edge,0,.024,-.066);
}

function sculptedEye(feature,side,opening,slant,look,lowDetail) {
  const strips=lowDetail ? 8 : 24, rows=lowDetail ? 4 : 10;
  const points=[],uv=[],colors=[],indices=[];
  const {smoothstep,lerp}=THREE.MathUtils;
  for(let j=0;j<=rows;j++) for(let i=0;i<=strips;i++) {
    const u=i/strips, v=j/rows;
    const x=.053+(u-.5)*.041;
    const openingAtX=Math.sin(Math.PI*u)**.76;
    const y=.011+slant*(u-.5)+(v-.43)*openingAtX*opening;
    const lift=.0022+.0064*openingAtX*Math.sin(Math.PI*v);
    points.push(...feature(side*x,y,lift).toArray());
    uv.push(u,v);
    const r=Math.hypot(x-.053-look,(y-.011)*1.07);
    const iris=smoothstep(r,.0048,.0069);
    const pupil=smoothstep(r,.0027,.0041);
    const wetEdge=1-.22*smoothstep(v,.53,.98);
    const glint=.15*Math.exp(-((x-.051-look)**2+(y-.0126)**2)/.000004);
    colors.push(lerp(lerp(.039,.168,pupil),.62*wetEdge,iris)+glint,
      lerp(lerp(.033,.105,pupil),.54*wetEdge,iris)+glint,
      lerp(lerp(.027,.070,pupil),.43*wetEdge,iris)+glint);
    if(i && j) {
      const d=j*(strips+1)+i, a=d-strips-2;
      if(side>0) indices.push(a,d-1,a+1,a+1,d-1,d);
      else indices.push(a,a+1,d-1,a+1,d,d-1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sculptedEar(side,lowDetail) {
  const shape=new THREE.SphereGeometry(1,lowDetail ? 8 : 20,lowDetail ? 6 : 14);
  const position=shape.attributes.position, colors=[];
  for(let i=0;i<position.count;i++) {
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    const front=Math.max(-z,0);
    const hollow=front*Math.exp(-(x*x/.26+(y-.07)**2/.35));
    const lobule=Math.exp(-((y+.69)**2)/.09);
    position.setXYZ(i,side*(.017*x+.004*y),.030*y,.020*z+.010*hollow-.003*lobule);
    const tone=1-.27*hollow-.08*front*(1-lobule);
    colors.push(tone,tone*(.96-.16*hollow),tone*(.91-.12*hollow));
  }
  if(side<0) {
    const index=shape.index.array;
    for(let i=0;i<index.length;i+=3) [index[i],index[i+1]]=[index[i+1],index[i]];
  }
  shape.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  shape.computeVertexNormals();
  return shape;
}

function faceDepth(x,y,z,nose,cheekbone,chin) {
  const patch=(cx,cy,dx,dy)=>Math.exp(-((x-cx)**2/dx+(y-cy)**2/dy));
  const cheek=patch(.076,-.023,.0014,.0012);
  const lowerCheek=patch(.080,-.073,.00077,.00091);
  const supraorbital=patch(.055,.034,.00145,.00023);
  const socket=patch(.053,.012,.00043,.00025);
  const jaw=patch(0,-.114,.0031,.00065);
  const muzzle=patch(0,-.052,.0023,.0010);
  const upperLip=patch(0,-.057,.00095,.000055);
  const lowerLip=patch(0,-.065,.00112,.000061);
  const chinFold=patch(0,-.077,.0011,.000077);
  const alar=patch(.013,-.037,.000075,.000070);
  const bridge=patch(0,.005,.00040,.0019);
  const noseTip=patch(0,-.026,.00064,.00031);
  const nostril=patch(.015,-.041,.000065,.00009);
  const front=THREE.MathUtils.smoothstep(-z,.047,.118);
  return z*.87-front*(.026*cheek*cheekbone-.012*lowerCheek-.016*socket+
    .010*supraorbital+.019*jaw*chin+.009*muzzle+
    .006*upperLip+.007*lowerLip-.005*chinFold+
    (.020*bridge+.028*noseTip+.006*alar)*nose-.008*nostril);
}

// The sparse skull can cross the analytic face between vertices. Attach the
// low-detail eyelids and lips to its actual triangles at their projected x/y.
function projectedFaceDepth(skull,x,y) {
  const {position}=skull.attributes;
  const indices=skull.index.array;
  let depth=Infinity;
  for(let i=0;i<indices.length;i+=3) {
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const az=position.getZ(a),bz=position.getZ(b),cz=position.getZ(c);
    if(az>=0 && bz>=0 && cz>=0) continue;
    const ax=position.getX(a),ay=position.getY(a);
    const bx=position.getX(b)-ax,by=position.getY(b)-ay;
    const cx=position.getX(c)-ax,cy=position.getY(c)-ay;
    const area=bx*cy-by*cx;
    if(Math.abs(area)<1e-8) continue;
    const u=((x-ax)*cy-(y-ay)*cx)/area,v=(bx*(y-ay)-by*(x-ax))/area;
    if(u<0 || v<0 || u+v>1) continue;
    depth=Math.min(depth,az+u*(bz-az)+v*(cz-az));
  }
  return depth;
}

export function riverWorker(parent, surface, role, residentHat=false, variant=0,lowDetail=false) {
  const profile=role==="resident" ? residentProfiles[variant] : null;
  const shoulders=profile?.shoulders??1;
  const garmentWaist=profile?.waist??1;
  const figure = new THREE.Group();
  parent.add(figure);
  const shades = {
    player: [0xc1cdd0, 0x717d76, 0x647378, 0xbfb28e],
    merchant: [0xd1b398, 0x766f60, 0x7e6d52, 0xc6b58f],
    helper: [0xa9b69e, 0x788275, 0x58604a, 0xc1aa7c],
    resident: [0xfdf5e3, 0xaaa591, 0x6e6453, 0xc1aa86],
  }[role];
  const cloth = surface("indigo-linen", shades[0], .40);
  const bodyLinen = surface("indigo-linen", shades[0], .39);
  const trousers = surface("indigo-linen", profile?.trousers??shades[1], .55);
  bodyLinen.vertexColors=true;
  cloth.userData.streetCloth=bodyLinen.userData.streetCloth=role==="resident";
  const apronColor=role==="merchant" ? 0xc7a079 : profile?.apron;
  const apronLinen=apronColor ? surface("indigo-linen",apronColor,.57) : null;
  const coatColor=profile?.coat;
  const coatLinen=coatColor ? surface("indigo-linen",coatColor,.54) : null;
  for(const linen of [bodyLinen,cloth,trousers,apronLinen,coatLinen].filter(Boolean)) {
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
  const binding = plain(profile?.binding??shades[2], .78);
  const dyed = plain(profile?.cord??shades[3], .79);
  binding.side=dyed.side=THREE.DoubleSide;
  const skin=plain(profile?.skin??{player:0xcfab8c,merchant:0xb7896b,helper:0xc09576}[role],.72);
  const facePaint=skin.clone();
  facePaint.vertexColors=true;
  const lips = plain(0x785245, .80);
  const eyeSurface=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.32});
  const brow = plain(0x363128, .84);
  const footwear = plain(profile ? [0x493a2c,0x393836,0x3e4442,0x4f4233][variant] : 0x3a332a, .89);
  const hem = plain(0x554c3b, .84);
  const strapPaint = plain(0x9a8968);
  const moisture={ value:new THREE.Vector3() };
  if (role==="player") {
    for (const mat of [trousers,footwear,hem,dyed,cloth,bodyLinen]) waterStain(mat,moisture);
  }
  const detail=!lowDetail;
  const hemOffset=profile?.hem??0, skirt=profile?.skirt??1;
  const robe=[[0,.606+hemOffset],[.263*skirt,.619+hemOffset],[.276*skirt,.66+hemOffset],
    [.269*skirt,.722+hemOffset*.77],[.255*skirt,.807+hemOffset*.46],
    [.239*garmentWaist,.88],[.225*garmentWaist,.95],[.229*garmentWaist,1.04],
    [.238*shoulders,1.13],[.254*shoulders,1.207],[.257*shoulders,1.248],
    [.224*shoulders,1.286],[.186*shoulders,1.318],[.133,1.343],[.101,1.361],[0,1.364]];
  const garmentSections=lowDetail ? 14 : 32;
  const robeSegments=lowDetail ? garmentSections : 64;
  piece(figure,robeClothGeometry(robe.slice(2),robeSegments),bodyLinen,0,0,0).name="Outer robe shell";
  piece(figure,fabric(robe.slice(0,3),.70,.012,robeSegments,0,robeVolume),binding,0,0,0).name="Bound robe hem";
  piece(figure, new THREE.CylinderGeometry(.072,.084,.105,lowDetail ? 8 : 16), skin, 0, 1.382, -.005);
  const sashBottom=profile?.sash??.948;
  const sash=profile?.beard ? binding : hem;
  const sashHeight=profile?.beard ? .077 : .053;
  const sashRows=[[sashBottom,.006],[sashBottom+.011,.013],
    [sashBottom+sashHeight-.009,.012],[sashBottom+sashHeight,.006]];
  const sashRim=sashRows.map(([y,rise])=>[robeRadius(robe,y)+rise,y]);
  piece(figure,fabric(sashRim,.70,.012,garmentSections,0,robeVolume),sash,0,0,0).name="Tied cloth sash";
  const lapel=profile?.beard ? .081 : profile?.wrap ? .046 : .064;
  robeSeam(figure,robe,[[3.64,1.324],[3.30,1.281],[3.00,1.229],[2.67,1.173],
    [2.48,1.115],[2.35,sashBottom+sashHeight*.77]],binding,lapel,detail,.018);
  robeSeam(figure,robe,[[2.47,1.329],[2.64,1.281],[2.86,1.25],[2.99,1.236]],
    dyed,.032,detail,.018);
  if(role==="player" || role==="helper" || (role==="resident" && variant===2)) {
    wrapSkirt(figure,robe,bodyLinen,binding,.685+hemOffset,sashBottom,lowDetail);
  }
  const tailSide=profile?.beard ? 3.82 : 2.47;
  if(role!=="merchant") {
    const knotHeight=sashBottom+.028;
    const tail=profile?.wrap ? .103 : .155;
    robeSeam(figure,robe,[[tailSide,knotHeight],[tailSide-.10,knotHeight-tail*.37],
      [tailSide-.19,knotHeight-tail*.72],[tailSide-.25,knotHeight-tail]],
      profile?.wrap ? binding : dyed,.031,detail,.019);
    const knotPoint=surfacePoint(robe,tailSide,knotHeight,.023);
    const knot=piece(figure,new THREE.SphereGeometry(1,12,8),dyed,...knotPoint);
    knot.scale.set(.043,.019,.022);
    knot.rotation.z=-.24;
  }
  if(profile?.beard) {
    const edge=2.38;
    robeSeam(figure,robe,[[edge,1.059],[edge-.04,.94],[edge-.14,.78+hemOffset*.39],
      [edge-.22,.665+hemOffset]],binding,.021,!lowDetail,.010);
  }
  if (apronLinen) {
    apronLinen.side=THREE.DoubleSide;
    apron(figure,robe,apronLinen,binding,.626+hemOffset);
  }

  if(coatLinen) {
    coatLinen.side=THREE.DoubleSide;
    sleevelessCoat(figure,robe,coatLinen,profile.wrap,lowDetail);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.497, -.025);
  head.scale.set(...(profile?.head??[.81,.89,.84]));
  figure.add(head);
  const skullRadius=.149, nose=profile?.nose??(role==="merchant" ? 1.18 : role==="helper" ? .93 : 1);
  const cheekbone=profile?.cheek??(role==="merchant" ? .81 : 1);
  const chin=profile?.chin??1;
  const eyeOpening=(profile?.eyes??(role==="merchant" ? .76 : 1))*.016;
  const jawWidth=y=>{
    const lower=THREE.MathUtils.smoothstep(-y,.022,.128);
    const temple=THREE.MathUtils.smoothstep(y,.061,.133);
    return 1-lower*(profile?.jaw??.29)-temple*(profile?.beard ? .075 : .027);
  };
  const skull=new THREE.SphereGeometry(skullRadius,lowDetail ? 18 : detail ? 52 : 40,lowDetail ? 13 : detail ? 36 : 28);
  const position = skull.attributes.position;
  const faceColours=[];
  for (let i = 0; i < position.count; i++) {
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    const front=THREE.MathUtils.smoothstep(-z,.019,.101);
    const cheek=Math.exp(-((Math.abs(x)-.081)**2/.0017+(y+.031)**2/.0011));
    const socket=Math.exp(-((Math.abs(x)-.053)**2/.00037+(y-.017)**2/.00026));
    const nostril=Math.exp(-((Math.abs(x)-.017)**2/.00010+(y+.042)**2/.00010));
    const pores=.011*Math.sin(331*x+192*y)*Math.sin(259*y-138*z);
    const templeCreases=(profile?.beard || role==="merchant") ?
      .08*Math.sin(289*y+33*x)*Math.exp(-((Math.abs(x)-.091)**2/.00045+(y-.004)**2/.00035)) : 0;
    const chinLight=.035*Math.exp(-(x*x/.0022+(y+.102)**2/.00043));
    const underlip=.072*Math.exp(-(x*x/.0015+(y+.078)**2/.00013));
    const temples=THREE.MathUtils.smoothstep(Math.abs(x),.078,.143);
    const throat=Math.exp(-((y+.124)**2/.0013))*front;
    position.setXYZ(i,x*jawWidth(y),y*1.105,faceDepth(Math.abs(x),y,z,nose,cheekbone,chin));
    const stubble=(profile?.beard || role==="merchant") ?
      .095*THREE.MathUtils.smoothstep(-y,.060,.126)*front : 0;
    const cheekLight=.077*Math.exp(-((Math.abs(x)-.072)**2/.00058+(y+.013)**2/.00039));
    const laughLine=Math.exp(-((Math.abs(x)-.039+.51*(y+.057))**2/.000048+(y+.056)**2/.00055));
    const faceVolume=front*(chinLight+cheekLight-underlip-templeCreases-(profile?.beard ? .13 : .065)*laughLine);
    faceColours.push(1+faceVolume-front*(.17*socket+.25*nostril)+pores-stubble-.10*throat-.055*temples,
      .97+faceVolume-front*(.23*socket+.16*cheek+.31*nostril)+pores-stubble-.12*throat-.069*temples,
      .93+faceVolume-front*(.22*socket+.16*cheek+.31*nostril)+pores-stubble*.5-.13*throat-.081*temples);
  }
  skull.setAttribute("color",new THREE.Float32BufferAttribute(faceColours,3));
  skull.computeVertexNormals();
  piece(head, skull, facePaint, 0, 0, 0).name="Sculpted face";
  function feature(x,y,clearance) {
    const fy=y/1.105, fx=x/jawWidth(fy);
    const z=-Math.sqrt(Math.max(0,skullRadius**2-fx**2-fy**2));
    const analytic=faceDepth(Math.abs(fx),fy,z,nose,cheekbone,chin);
    const projected=lowDetail ? projectedFaceDepth(skull,x,y) : analytic;
    const surface=Number.isFinite(projected) ? projected : analytic;
    return new THREE.Vector3(x,y,surface-clearance);
  }
  function faceLine(points,mat,radius,segments) {
    const path=new THREE.CatmullRomCurve3(points.map(point=>feature(...point)));
    return piece(head,new THREE.TubeGeometry(path,lowDetail ? 5 : segments,radius,lowDetail ? 3 : 5,false),mat,0,0,0);
  }
  const cap = new THREE.SphereGeometry(skullRadius,lowDetail ? 16 : 40,lowDetail ? 9 : 20,0,Math.PI*2,0,Math.PI*.62);
  const hairVertices=cap.attributes.position;
  const hairTones=[];
  const hairPart=profile?.hairPart??.09;
  for(let i=0;i<hairVertices.count;i++) {
    const x=hairVertices.getX(i),y=hairVertices.getY(i),z=hairVertices.getZ(i);
    const az=Math.atan2(x,z), cos=Math.cos(az), sin=Math.sin(az);
    const front=THREE.MathUtils.smoothstep(-cos,.25,.96);
    const back=THREE.MathUtils.smoothstep(cos,.05,.92);
    const temple=Math.exp(-((Math.abs(sin)-.93)**2/.015))*THREE.MathUtils.smoothstep(-cos,.05,.39);
    const edge=.58+.15*back-.175*front+.048*temple+.026*cos*Math.sin(az+hairPart*7)
      -(profile?.wrap && !residentHat ? .064*(1-back) : 0);
    const length=Math.acos(clamp(y/skullRadius,-1,1))/(Math.PI*.62);
    const angle=length*edge*Math.PI;
    const growth=THREE.MathUtils.smoothstep(length,0,.52);
    const strands=Math.sin(az*31+Math.sin(az*3+hairPart*8)-length*(7+4*sin));
    const radius=skullRadius+.005+.0027*growth*(1+.85*strands);
    const sx=radius*Math.sin(angle)*sin, sy=radius*Math.cos(angle), sz=radius*Math.sin(angle)*cos;
    hairVertices.setXYZ(i,sx*jawWidth(sy),sy*1.105,faceDepth(Math.abs(sx),sy,sz,nose,cheekbone,chin));
    const tone=.84+.104*strands*growth+.105*Math.cos(az*7-length*5)*growth;
    hairTones.push(tone,tone*.97,tone*.91);
  }
  cap.setAttribute("color",new THREE.Float32BufferAttribute(hairTones,3));
  cap.computeVertexNormals();
  const hairPigment=profile ? plain(profile.hair,.87) : brow;
  const hairSurface=hairPigment.clone();
  hairSurface.vertexColors=true;
  piece(head,cap,hairSurface,0,0,0).name="Sculpted hairline and strands";
  if(profile?.wrap && !residentHat) {
    const headcloth=surface("indigo-linen",0x839080,.48,.94);
    const clothBand=fabric([[.145,.045],[.156,.066],[.158,.084],[.150,.115],
      [.131,.149],[.084,.171],[0,.176]],.98,.013,garmentSections,0,
    (az,y)=>1+.028*Math.sin(az*3+y*80)+.022*Math.cos(az*6+y*49));
    piece(head,clothBand,headcloth,0,0,.012).name="Folded headcloth";
    const fold=piece(head,new THREE.SphereGeometry(.045,14,9),headcloth,.089,.108,.119);
    fold.scale.set(.93,.54,.61);
  } else {
    const shape=new THREE.SphereGeometry(.045,lowDetail ? 10 : 20,lowDetail ? 7 : 13);
    const p=shape.attributes.position;
    for(let i=0;i<p.count;i++) {
      const a=Math.atan2(p.getX(i),p.getZ(i));
      const curl=1+.07*Math.cos(a*9+p.getY(i)*92);
      p.setX(i,p.getX(i)*curl);
      p.setZ(i,p.getZ(i)*curl);
    }
    shape.computeVertexNormals();
    const bun=piece(head,shape,hairPigment,.016*variant-.018,profile?.bun??.166,variant===2 ? .09 : .059);
    bun.scale.set(variant===2 ? .79 : 1.06,variant===2 ? 1.05 : .80,.96);
    bun.rotation.z=hairPart;
    if(!lowDetail && variant===2) {
      const pin=piece(head,new THREE.CylinderGeometry(.0035,.005,.124,8),dyed,.018,.151,.091);
      pin.rotation.z=1.38;
    }
  }
  for (const side of [-1, 1]) {
    const ear=piece(head,sculptedEar(side,lowDetail),facePaint,side*.132,-.016,-.003);
    ear.rotation.y=side*-.48;
    const slant=profile?.beard ? -.004 : variant===2 ? .005 : .002;
    piece(head,sculptedEye(feature,side,eyeOpening,slant,side*(profile?.hairPart??.09)*.012,lowDetail),
      eyeSurface,0,0,0).name="Sculpted eyelid opening and iris";
    const upper=eyeOpening*.57;
    faceLine([[side*.032,.011-slant*.5,.0021],[side*.045,.012+upper*.87,.0059],
      [side*.057,.011+upper,.0068],[side*.073,.011+slant*.5,.0021]],lips,.0015,14);
    const lift=profile?.beard ? -.004 : profile?.wrap ? .003 : 0;
    faceLine([[side*.030,.033+lift,.001],[side*.046,.040+lift,.002],
      [side*.061,.041+lift,.002],[side*.077,.035+lift,.0015]],hairPigment,.0022,12);
  }
  const mouthWidth=profile ? [.032,.026,.023,.030][variant] : .028;
  const mouthCorner=-.065+(profile?.smile??.002);
  faceLine([[-mouthWidth,mouthCorner,.0007],[-mouthWidth*.43,-.064,.0015],
    [0,-.066,.002],[mouthWidth*.39,-.064,.0016],[mouthWidth,mouthCorner-.002,.0007]],lips,.0017,18);
  if(!lowDetail) {
    const lowerLip=plain(profile?.beard ? 0x946b59 : 0xa87362,.70);
    faceLine([[-.017,-.069,.0007],[0,-.072,.0012],[.017,-.069,.0007]],lowerLip,.0016,10);
  }
  if(role==="merchant" || profile?.beard) {
    const beardTint=profile ? hairPigment : lips;
    const beard=piece(head,fabric([[0,-.170],[.015,-.145],[.039,-.115],[.048,-.094],
      [.026,-.081],[0,-.077]],.44,0,lowDetail ? 12 : 22),beardTint,0,0,-.087);
    beard.rotation.x=-.13;
    for(const side of [-1,1]) {
      faceLine([[side*.004,-.051,.005],[side*.017,-.052,.006],
        [side*.033,-.058,.005],[side*.043,-.065,.002]],beardTint,.0043,12);
    }
  }
  if (role !== "player" && (role!=="resident" || residentHat)) {
    const straw = plain(0xb49a62, .90);
    const rim = plain(0x7f6a4a, .94);
    wovenHat(head,straw,rim,lowDetail);
    const cord=plain(0x77654b,.97);
    for (const side of [-1,1]) {
      const trace=new THREE.CatmullRomCurve3([[side*.139,.158,-.018],[side*.144,.072,-.027],
        [side*.135,-.018,-.048],[side*.108,-.081,-.067],[side*.052,-.127,-.064],[0,-.141,-.059]]
        .map(p=>new THREE.Vector3(...p)));
      piece(head,new THREE.TubeGeometry(trace,lowDetail ? 7 : detail ? 20 : 12,.0048,lowDetail ? 3 : 5,false),cord,0,0,0);
    }
  }

  if(profile?.wrap) {
    const satchel=surface("indigo-linen",0xad9b79,.76,.94);
    shoulderSatchel(figure,robe,satchel,binding,lowDetail);
  }
  // The courier and player reuse their gait phase to drive the loose cloth.
  const clothPanels=role==="player" || role==="helper"
    ? figure.children.filter(part=>["Outer robe shell","Bound robe hem","Fitted robe binding","Overlapping skirt panel"].includes(part.name))
        .map(({geometry})=>({geometry,rest:geometry.attributes.position.array.slice()}))
    : [];
  let clothMotion=0;
  const torsoPivot=new THREE.Group(), torso=role==="merchant" ? figure : new THREE.Group();
  if(torso!==figure) {
    for(const part of [...figure.children]) torso.add(part);
    torsoPivot.position.y=.91;
    torso.position.y=-.91;
    torsoPivot.add(torso);
    figure.add(torsoPivot);
  }
  const limbs = { legs: [], arms: [], elbows:[], hands:[] };
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
  const wrapTint=profile ? plain([0xaa997c,0x908679,0x797e75,0xc5ac86][variant],.95) : dyed;
  for (const side of [-1, 1]) {
    if (role==="player" || role==="helper" || role==="resident") {
      articulated.push(articulatedLeg(figure,side,trousers,binding,dyed,hem,footwear,lowDetail));
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
    arm.position.set(side*.236*shoulders,1.228,.005);
    arm.scale.set(profile?.armWidth??1,profile?.sleeve??1,profile?.armWidth??1);
    // Hang the arm slightly away from the body so the hand clears the flared robe.
    arm.rotation.z=side*.11;
    torso.add(arm);
    const elbow=tailoredSleeve(arm,cloth,binding,garmentSections,profile?.cuff??.04);
    const hand=buildHand(elbow,skin,side,{lowDetail,scale:profile?.hand??1});
    hand.group.position.set(0,-.163,-.009);
    limbs.hands.push(hand);
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
    const cos=Math.cos(yaw), sin=Math.sin(yaw);
    const stagger=profile ? [.048,-.057,.048,-.071][variant] : 0;
    const spread=profile ? [1.17,1.27,.84,1.12][variant] : 1;
    const feet=[-1,1].map(side=>{
      const advance=side*stagger;
      const apart=side*legRig.separation*spread;
      const px=x+apart*cos-advance*sin, pz=z-apart*sin-advance*cos;
      return {x:px,y:floor(px,pz),z:pz,yaw:yaw+side*(profile ? .13 : 0),side};
    });
    poseFeet(feet,floor,x,y,z,yaw);
    return feet;
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
    if(clothPanels.length && (balance>.002 || clothMotion>.002)) {
      const lead=Math.sin(phase-.44)*balance;
      const rebound=Math.sin(phase*2-.88)*balance;
      for(const {geometry,rest} of clothPanels) {
        const vertices=geometry.attributes.position;
        for(let i=0;i<vertices.count;i++) {
          const at=i*3, y=rest[at+1];
          if(y>=.93) continue;
          const x=rest[at],z=rest[at+2];
          const loose=1-THREE.MathUtils.smoothstep(y,.61,.93);
          const sides=clamp(x/.217,-1,1);
          vertices.setXYZ(i,x+loose*(.006*lead-.032*z*lead),
            y+loose*.010*sides*rebound,z+loose*(.040*sides*lead+.010*rebound));
        }
        vertices.needsUpdate=true;
        geometry.computeVertexNormals();
      }
      clothMotion=balance;
    }
    for(let i=0;i<limbs.arms.length;i++) {
      const swing=Math.sin(phase+(i+1)*Math.PI);
      limbs.arms[i].rotation.x=THREE.MathUtils.lerp(.25*balance*swing,.88,carryWeight);
    }
    for(let i=0;i<limbs.elbows.length;i++) {
      const forward=Math.max(0,Math.sin(phase+(i+1)*Math.PI));
      limbs.elbows[i].rotation.x=-THREE.MathUtils.lerp(.12+.35*forward,.25,carryWeight)*effort;
    }
    // Relaxed fingers while walking; a closed grip on the harness straps when carrying.
    for(const hand of limbs.hands) hand.setGrip(.08+.12*effort+.74*carryWeight);
  }
  return {figure,limbs,straps,head,torsoPivot,reachWithRightHand,poseFeet,stand,walkBody,moisture:moisture.value};
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
