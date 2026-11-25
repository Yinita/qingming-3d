import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";
import { legRig } from "./bridge-gait.js";
import { buildHand } from "./bridge-hands.js";
import { buildAnatomicalHead } from "./bridge-head.js";

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
  const shoulder=Math.exp(-(((y-1.245)/.075)**2))*Math.abs(Math.sin(theta))**3;
  const back=Math.max(0,Math.cos(theta));
  const waistGather=tuck*Math.max(0,Math.cos(theta*9+y*10))**4;
  const pull=theta*6+y*38+.9*Math.sin(theta*2);
  const folds=.016*Math.sin(theta*5+y*5)-.011*Math.cos(theta*9-y*11);
  return 1+folds+robePleats(theta,y)+kneeRoom+.079*chest*front+
    shoulder*(.054+.037*back)-.057*tuck+.029*waistGather+
    diagonal*(.036*Math.sin(pull)-.032*Math.max(0,Math.cos(pull))**5);
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
      const armhole=.102*side**2*Math.exp(-(t*t)/.13)*(1-t);
      const y=THREE.MathUtils.lerp(collar,bottom,t)-armhole+.018*t*Math.cos(theta);
      const waist=.012*Math.exp(-(((y-1.026)/.061)**2));
      const relief=.025+.006*Math.cos(theta*11+t*4)*t+.017*t**4+waist;
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

function bambooWeave(material) {
  material.customProgramCacheKey=()=>"bamboo-over-under";
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nvarying vec2 bambooPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nbambooPoint=position.xz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nvarying vec2 bambooPoint;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float radius=length(bambooPoint);
        float azimuth=atan(bambooPoint.x,bambooPoint.y);
        float width=length(dFdx(bambooPoint))+length(dFdy(bambooPoint));
        float closeWeave=(1.-smoothstep(.002,.010,width))*smoothstep(.032,.068,radius);
        float warp=cos(azimuth*150.+.33*sin(radius*62.));
        float weft=cos(radius*1041.+.39*sin(azimuth*18.));
        float crossings=warp*weft;
        float channels=pow(max(0.,-warp),5.)+pow(max(0.,-weft),6.);
        float fleck=cos(radius*1433.+azimuth*273.);
        diffuseColor.rgb*=1.+closeWeave*(.077*crossings-.075*channels+.021*fleck);
      `);
  };
}

function wovenHat(head,straw,rim,lowDetail,shape) {
  const hat=new THREE.Group();
  hat.scale.set(...shape);
  hat.position.y=.083;
  head.add(hat);
  const segments=lowDetail ? 20 : 48;
  const crown=[[0,.184],[.065,.180],[.114,.151],[.175,.105],[.219,.077],
    [.262,.061],[.303,.048],[.331,.039],[.345,.034]];
  const lower=crown.slice().reverse().map(([r,y])=>[r,y-.014]);
  const geometry=new THREE.LatheGeometry([...crown,...lower].map(([r,y])=>new THREE.Vector2(r,y)),segments);
  const p=geometry.attributes.position, colors=[];
  for(let i=0;i<p.count;i++) {
    const a=Math.atan2(p.getX(i),p.getZ(i)), r=Math.hypot(p.getX(i),p.getZ(i));
    const tone=.86+.11*Math.sin(a*21+r*87)+.039*Math.sin(a*14-r*231);
    colors.push(tone,tone*.96,tone*.86);
    p.setY(i,p.getY(i)+r*.010*Math.sin(a*4));
  }
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  straw.vertexColors=true;
  if(!lowDetail) bambooWeave(straw);
  piece(hat,geometry,straw,0,0,0).name="Woven bamboo hat";
  for(const [r,y] of crown.slice(2)) {
    const braid=new THREE.TorusGeometry(r,r>.34?.007:.0027,5,segments).rotateX(Math.PI/2);
    piece(hat,braid,rim,0,y,0);
  }
}

function foldedHeadwrap(head,cloth,segments,variant) {
  const wrapped=variant!==2;
  const outline=wrapped ?
    [[.142,.050],[.153,.058],[.162,.078],[.161,.101],[.142,.132],[.112,.159],[.066,.171],[0,.177]] :
    [[.143,.047],[.153,.056],[.158,.071],[.158,.112],[.152,.147],[.128,.174],[.059,.192],[0,.194]];
  const geometry=fabric(outline,.98,.015,segments,0,(az,y)=>{
    const twist=az*3+y*(wrapped ? 94 : 39);
    return 1+.036*Math.sin(twist)+.019*Math.cos(az*6-y*54);
  });
  piece(head,geometry,cloth,0,0,.009).name=wrapped ? "Folded headcloth" : "Pinched cloth cap";
  const closure=piece(head,new THREE.SphereGeometry(.031,16,10),cloth,
    wrapped ? .096 : 0,wrapped ? .110 : .156,.121);
  closure.scale.set(wrapped ? 1.28 : .68,.56,1.04);
  closure.rotation.z=.44;
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

const trouserCuts=[1.07,1.16,.88,.99];

function articulatedLeg(figure,side,trousers,binding,dyed,hem,footwear,lowDetail,cut=1) {
  const hip=new THREE.Vector3(side*legRig.separation,legRig.hip,0);
  const kneeY=-legRig.upper;
  const sections=lowDetail ? 14 : 40;
  const geometry=fabric([
    [.076,kneeY-.179],[.076,kneeY-.132],[.074,kneeY-.091],[.071,kneeY-.049],
    [.073,kneeY],[.079,kneeY+.046],[.080*cut,-.23],[.089*cut,-.15],
    [.089*cut,-.072],[.087*cut,.032],
  ],.93,0,sections,0,(theta,y)=>{
    const below=THREE.MathUtils.smoothstep(y,kneeY-.175,kneeY-.060);
    const tension=Math.exp(-(((y-kneeY-.008)/.085)**2));
    const pleat=theta*4+(y-kneeY)*14+.5*side;
    const crease=theta*2+(y-kneeY)*77+.8*side;
    const front=Math.max(0,-Math.cos(theta));
    const line=Math.max(0,Math.sin(theta*2+y*6))**8;
    return 1+below*(.055*Math.cos(pleat)+.044*line+
      tension*(.044*front*Math.sin(crease)-.038*Math.max(0,Math.cos(crease))**6));
  });
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
  pants.name="Shaped, articulated trousers";
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
  piece(calf,fabric(wrap,.93,0,sections,kneeY),dyed,0,0,0).name="Linen boot wrap";
  for (const y of lowDetail ? [] : [-.284,-.251,-.218,-.192]) {
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
    const vamp=[];
    for(let i=0;i<=12;i++) {
      const t=i/12, x=THREE.MathUtils.lerp(-.86,.86,t);
      const z=-.37-.15*Math.sin(Math.PI*t);
      const y=Math.sqrt(Math.max(0,1-x*x-z*z));
      const point=new THREE.Vector3(x,y,z).multiplyScalar(1.023);
      vamp.push(bootPoint(point,side,false).multiply(shoe.scale).add(shoe.position));
    }
    piece(ankle,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vamp),16,.00165,5,false),
      binding,0,0,0).name="Stitched shoe vamp";
  }
  return { upper,calf,ankle,footprint,hip };
}

function tailoredSleeve(arm, cloth, binding, sections, cut, corrective) {
  const joint=-.212;
  const profile=[
    [0,-.381],[.055,-.382],[.062,-.373],[.065,-.351],[.071,-.332],
    [.075,-.305],[.079,-.265],[.080,-.221],[.082,-.181],
    [.087,-.130],[.085,-.067],[.078,-.024],[.063,.012],[.040,.039],[0,.051],
  ];
  const contour=fabric(profile,.88,0,sections,0,(angle,y)=>{
    const elbow=Math.exp(-(((y-joint)/.092)**2));
    const fullness=Math.sin(Math.PI*clamp((y+.376)/.426,0,1));
    const fall=Math.max(0,Math.cos(angle-.4))*fullness;
    const crease=angle*3+y*35;
    const shoulder=THREE.MathUtils.smoothstep(y,-.125,.037);
    return 1+cut*fullness+.13*cut*fall+.063*Math.cos(angle*4+y*14)*(1-.61*shoulder)+
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
  if(corrective) {
    // Restore circumference lost to linear blending near a folded elbow.
    const expanded=positions.clone();
    for(let i=0;i<positions.count;i++) {
      const y=positions.getY(i),x=positions.getX(i),z=positions.getZ(i);
      const band=Math.exp(-(((y-joint)/.063)**2));
      const width=1+band*(.36+.058*Math.cos(y*109));
      expanded.setXYZ(i,x*width,y,z*width);
    }
    const normals=contour.clone();
    normals.setAttribute("position",expanded);
    normals.computeVertexNormals();
    contour.morphAttributes.position=[expanded];
    contour.morphAttributes.normal=[normals.attributes.normal];
  }
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
  return {elbow,sleeve};
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
  {skin:0xb08264,hair:0x372e26,head:[.94,.87,.89],jaw:.12,nose:1.10,shoulders:1.15,armWidth:1.05,sleeve:1.01,
    bun:.166,hem:.012,skirt:1.08,waist:1.12,cuff:.19,cheek:1.19,chin:1.12,binding:0x74614c,cord:0xc8a880,apron:0xc0a275,smile:.006,sash:.955,hairPart:.14,trousers:0x888b76},
  {skin:0xc1a084,hair:0x615a50,head:[.72,.99,.90],jaw:.30,nose:1.31,shoulders:.86,armWidth:.95,sleeve:1.06,
    bun:.151,beard:true,cheek:.65,chin:1.32,coat:0x93957f,binding:0x62513d,cord:0xad8b63,hem:-.161,skirt:.94,waist:.96,cuff:.12,eyes:.69,smile:-.003,sash:1.00,hairPart:-.19,trousers:0x817965},
  {skin:0xd2ad90,hair:0x362c28,head:[.78,.87,.83],jaw:.40,nose:.77,shoulders:.86,armWidth:.82,sleeve:.96,
    bun:.151,cheek:.87,chin:.63,hem:-.227,skirt:.96,waist:.86,cuff:-.12,binding:0x4b6870,cord:0xaeb5a3,eyes:1.03,smile:.007,sash:1.033,hairPart:.23,trousers:0x74838c},
  {skin:0xa87f62,hair:0x3d3228,head:[.85,.90,.91],jaw:.15,nose:.96,shoulders:1.09,armWidth:.88,sleeve:.88,
    bun:.145,wrap:true,cheek:1.32,chin:.96,coat:0x947e63,hem:.185,skirt:.84,waist:1.02,cuff:-.16,binding:0xa7906d,cord:0xc0ab89,eyes:.88,smile:-.001,sash:.911,hairPart:-.03,trousers:0xab9878},
];

const marketProfiles={
  attendant:{head:[.81,.91,.86],headModel:"merchant",
    colors:[0xa8b2a1,0x646b61,0x574f40,0xd2bd9a],skin:0xb58c6c,shoulders:.86,waist:.92,hem:-.088,skirt:1.04,
    apron:0xe1c9a0,hair:0x40332b,headcloth:0x667166},
  baker:{head:[.80,.87,.77],
    colors:[0xa67462,0x626b61,0x514b3d,0xbcaa81],skin:0xca9d83,shoulders:.86,waist:.92,hem:-.104,skirt:1.21,
    apron:0xd4c39d,hair:0x342b25,headcloth:0x796658},
  porter:{head:[.93,.94,.87],
    colors:[0x758176,0x746a53,0x4f4639,0xab9776],skin:0xa97f61,shoulders:1.12,waist:1.10,hem:.119,skirt:1.02,
    coat:0x8c7559,headcloth:0x666b5f,hair:0x44352a},
  shopper:{head:[.79,.94,.85],
    colors:[0x99898f,0x788476,0x5c5d69,0xbeaa87],skin:0xc29e80,shoulders:.87,waist:.91,hem:.042,skirt:.95,
    hair:0x38332d,headcloth:0x646b72,hairPart:-.21,satchel:0xb4a383},
};

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

function residentBelongings(figure,robe,variant,sash,surface,binding,cord,lowDetail) {
  // Keep accessories below the elbow arc and attach their loops to the sash.
  // The stitching and vessel profiles also survive crowd mesh batching.
  const segments=lowDetail ? 10 : 24;
  const item=new THREE.Group();
  const theta=[3.66,3.88,0,2.61][variant];
  const [x,y,z]=surfacePoint(robe,theta,sash-.082,.030);
  item.position.set(x,y,z);
  item.rotation.set(.11,theta,.12);
  figure.add(item);
  const lifted=new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.019,.131,-.024),new THREE.Vector3(-.031,.075,.051),
    new THREE.Vector3(.011,.043,.060),new THREE.Vector3(.025,.131,-.019),
  ]);
  piece(item,new THREE.TubeGeometry(lifted,lowDetail ? 7 : 15,.006,5),cord,0,0,0).name="Sash hanging loop";
  if(variant===0) {
    const linen=surface("indigo-linen",0xa08765,.93);
    piece(item,fabric([[0,-.114],[.071,-.109],[.093,-.074],[.088,-.017],
      [.063,.031],[.051,.043],[.057,.061]],.55,0,segments,0,foldFactor),
      linen,0,0,.026).name="Gathered cloth coin pouch";
    piece(item,new THREE.TorusGeometry(.053,.006,5,segments).rotateX(Math.PI/2).scale(1,1,.59),
      binding,0,.042,.026).name="Pouch drawstring";
  } else if(variant===1) {
    const paper=plain(0xb69d74,.93), cover=surface("indigo-linen",0x53666c,.92);
    item.rotation.z=-.24;
    piece(item,detailedBox(.136,.164,.025,paper,.008),paper,0,-.025,.035).name="Bound account ledger pages";
    for(const offset of [-.016,.016]) {
      piece(item,detailedBox(.146,.174,.009,cover,.005),cover,0,-.024,.035+offset).name="Cloth ledger cover";
    }
    const spine=new THREE.CatmullRomCurve3([new THREE.Vector3(-.054,-.093,.055),
      new THREE.Vector3(-.063,-.057,.056),new THREE.Vector3(-.054,-.016,.055),
      new THREE.Vector3(-.063,.026,.056),new THREE.Vector3(-.054,.051,.055)]);
    piece(item,new THREE.TubeGeometry(spine,lowDetail ? 8 : 18,.0025,5),cord,0,0,0).name="Ledger binding thread";
  } else {
    const shell=plain(0x997445,.73);
    const outline=[[0,-.181],[.038,-.178],[.068,-.148],[.076,-.104],
      [.067,-.068],[.052,-.052],[.051,-.035],[.061,-.012],
      [.056,.015],[.040,.030],[.018,.036],[.014,.056],[.014,.068],[0,.068]];
    piece(item,fabric(outline,.75,0,segments,0,(angle)=>1+.069*Math.cos(angle*5)),
      shell,0,0,.025).name="Dried gourd flask";
    piece(item,new THREE.CylinderGeometry(.018,.013,.021,segments),
      binding,0,.074,.025).name="Carved flask stopper";
  }
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
    const lift=.0017+.0035*openingAtX*Math.sin(Math.PI*v);
    points.push(...feature(side*x,y,lift).toArray());
    uv.push(u,v);
    const r=Math.hypot(x-.053-look,y-.0122);
    const iris=smoothstep(r,.0060,.0077);
    const pupil=smoothstep(r,.0029,.0043);
    const irisRim=1-.42*smoothstep(r,.005,.0068);
    const corner=smoothstep(openingAtX,0,.52);
    const lidShade=(.69+.31*corner)*(1-.31*smoothstep(v,.59,1));
    const glint=.29*Math.exp(-((x-.051-look)**2+(y-.0134)**2)/.0000014);
    colors.push(lerp(lerp(.021,.107,pupil)*irisRim,lerp(.26,.43,corner)*lidShade,iris)+glint,
      lerp(lerp(.016,.066,pupil)*irisRim,lerp(.14,.36,corner)*lidShade,iris)+glint,
      lerp(lerp(.014,.042,pupil)*irisRim,lerp(.112,.29,corner)*lidShade,iris)+glint);
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
  const cheek=patch(.077,-.017,.00085,.00057);
  const lowerCheek=patch(.077,-.069,.00113,.00064);
  const supraorbital=patch(.051,.033,.00148,.00025);
  const socket=patch(.053,.014,.00070,.00023);
  const lowerLid=patch(.052,-.005,.00078,.000081);
  const jaw=patch(.017,-.105,.0027,.00037);
  const muzzle=patch(0,-.053,.0023,.00068);
  const upperLip=patch(0,-.057,.00095,.000055);
  const lowerLip=patch(0,-.065,.00112,.000061);
  const chinFold=patch(0,-.077,.0011,.000077);
  const alar=patch(.015,-.034,.000082,.000052);
  const bridge=patch(0,.011,.00030,.00155);
  const noseTip=patch(0,-.026,.00023,.00019);
  const nostril=patch(.015,-.041,.000061,.000057);
  const front=THREE.MathUtils.smoothstep(-z,.047,.118);
  // Keep the facial planes broad and reserve steep relief for the nose and eyelids.
  const facePlane=z*.87+front*(.011+.014*Math.max(0,-y)/.149);
  return facePlane-front*(.018*cheek*cheekbone-.011*lowerCheek-.011*socket+
    .009*supraorbital+.004*lowerLid+.023*jaw*chin+.006*muzzle+
    .005*upperLip+.006*lowerLip-.004*chinFold+
    (.027*bridge+.032*noseTip+.012*alar)*nose-.011*nostril);
}

// Attach low-detail eyelids and lips to the actual skull triangles at their projected x/y.
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

export function riverWorker(parent, surface, role, residentHat=false, variant=0,lowDetail=false,animatedFace=role!=="resident") {
  const profile=role==="resident" ? residentProfiles[variant] : null;
  const market=marketProfiles[role];
  const shoulders=profile?.shoulders??market?.shoulders??1;
  const garmentWaist=profile?.waist??market?.waist??1;
  const figure = new THREE.Group();
  parent.add(figure);
  const shades = market?.colors??{
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
  const apronColor=role==="merchant" ? 0xc7a079 : market?.apron??profile?.apron;
  const apronLinen=apronColor ? surface("indigo-linen",apronColor,.57) : null;
  const coatColor=market?.coat??profile?.coat;
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
  const skin=plain(profile?.skin??market?.skin??{player:0xcfab8c,merchant:0xb7896b,helper:0xc09576}[role],.72);
  const facePaint=skin.clone();
  facePaint.vertexColors=true;
  const lips = plain(0x80554a, .86);
  const strokeMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,
    transparent:true,alphaTest:.035,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  const eyeSurface=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.58});
  const lidTint=skin.clone();
  lidTint.color.multiplyScalar(.77);
  const brow = plain(0x363128, .84);
  const footwear = plain(profile ? [0x493a2c,0x393836,0x3e4442,0x4f4233][variant] : 0x3a332a, .89);
  const hem = plain(0x554c3b, .84);
  const strapPaint = plain(0x9a8968);
  const moisture={ value:new THREE.Vector3() };
  if (role==="player") {
    for (const mat of [trousers,footwear,hem,dyed,cloth,bodyLinen]) waterStain(mat,moisture);
  }
  const detail=!lowDetail;
  const hemOffset=profile?.hem??market?.hem??0, skirt=profile?.skirt??market?.skirt??1;
  const robe=[[0,.606+hemOffset],[.263*skirt,.619+hemOffset],[.276*skirt,.66+hemOffset],
    [.269*skirt,.722+hemOffset*.73],[.255*skirt,.798+hemOffset*.42],
    [.239*garmentWaist,.88],[.225*garmentWaist,.95],[.229*garmentWaist,1.04],
    [.238*shoulders,1.13],[.254*shoulders,1.207],[.257*shoulders,1.248],
    [.224*shoulders,1.286],[.186*shoulders,1.318],[.133,1.343],[.101,1.361],[0,1.364]];
  const garmentSections=lowDetail ? 14 : 32;
  const robeSegments=lowDetail ? garmentSections : 64;
  piece(figure,robeClothGeometry(robe.slice(2),robeSegments),bodyLinen,0,0,0).name="Outer robe shell";
  piece(figure,fabric(robe.slice(0,3),.70,.012,robeSegments,0,robeVolume),binding,0,0,0).name="Bound robe hem";
  if(lowDetail) {
    piece(figure,fabric([[.084,1.327],[.077,1.356],[.067,1.389],[.068,1.421],
      [.085,1.447],[.087,1.462]],.86,.006,garmentSections,0,()=>1),skin,0,0,0).name="Tapered neck";
  }
  const sashBottom=profile?.sash??.948;
  const sash=profile?.beard ? binding : hem;
  const sashHeight=profile?.beard ? .077 : .053;
  const sashRows=[[sashBottom,.006],[sashBottom+.011,.013],
    [sashBottom+sashHeight-.009,.012],[sashBottom+sashHeight,.006]];
  const sashRim=sashRows.map(([y,rise])=>[robeRadius(robe,y)+rise,y]);
  piece(figure,fabric(sashRim,.70,.012,garmentSections,0,robeVolume),sash,0,0,0).name="Tied cloth sash";
  const lapel=profile?.beard ? .074 : profile?.wrap ? .046 : .060;
  const overlap=[[3.52,1.334],[3.36,1.303],[3.19,1.257],[2.93,1.218],
    [2.69,1.173],[2.47,1.109],[2.35,sashBottom+sashHeight*.77]];
  // A separate folded edge catches light where the cloth crosses the chest.
  robeSeam(figure,robe,overlap,binding,lapel,detail,.015);
  robeSeam(figure,robe,overlap.map(([theta,y])=>[theta-.045,y+.013]),
    dyed,.007,detail,.019);
  robeSeam(figure,robe,[[2.53,1.335],[2.69,1.305],[2.86,1.264],[3.03,1.239]],
    dyed,.028,detail,.016);
  if(role==="player" || role==="helper" || (role==="resident" && variant===2)) {
    wrapSkirt(figure,robe,bodyLinen,binding,.685+hemOffset,sashBottom,lowDetail);
  }
  if(profile && detail) {
    const backSeams=[
      [[-.84,1.213],[-.44,1.195],[0,1.187],[.44,1.195],[.84,1.213]],
      [[.04,1.322],[.009,1.246],[-.013,1.143],[.005,1.044]],
      [[-.73,1.262],[-.43,1.224],[-.24,1.178],[.0,1.151],[.39,1.163],[.71,1.21]],
      [[-.83,1.215],[-.43,1.183],[.06,1.16],[.47,1.173],[.82,1.207]],
    ];
    const offset=coatLinen ? .041 : .012;
    robeSeam(figure,robe,backSeams[variant],binding,profile.wrap ? .020 : .013,true,offset);
  }
  if(profile && variant===0) {
    const towel=surface("indigo-linen",0xbaa988,.40,.91);
    // Both ends hang from the same shoulder over the front and back of the robe.
    const fall=[[.89,.996],[.87,1.071],[.92,1.166],[1.11,1.240],[1.51,1.281],
      [1.95,1.276],[2.20,1.224],[2.31,1.153],[2.35,1.074]];
    robeSeam(figure,robe,fall,towel,.116,detail,.027);
    if(detail) {
      robeSeam(figure,robe,fall.map(([theta,y])=>[theta+.083,y-.016]),binding,.009,true,.030);
    }
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
    const ties=[[-2.49,.946],[-1.3,.949],[-.42,.965],[.12,.971],
      [1.27,.950],[2.49,.946]];
    robeSeam(figure,robe,ties,dyed,.018,detail,.028);
    robeSeam(figure,robe,[[.14,.973],[.25,.937],[.28,.903],[.37,.880]],dyed,.024,detail,.027);
    robeSeam(figure,robe,[[.13,.970],[-.02,.952],[-.12,.920],[-.24,.904]],dyed,.017,detail,.026);
  }

  if(coatLinen) {
    coatLinen.side=THREE.DoubleSide;
    sleevelessCoat(figure,robe,coatLinen,role==="porter" || profile?.wrap,lowDetail);
  }

  if(profile && variant!==2) {
    residentBelongings(figure,robe,variant,sashBottom,surface,binding,dyed,lowDetail);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.497, -.025);
  const leadHead=role==="merchant" ? [.91,.89,.92] : role==="helper" ? [.79,.91,.89] : [.81,.89,.84];
  head.scale.set(...(profile?.head??market?.head??leadHead));
  figure.add(head);
  const face=!lowDetail ? buildAnatomicalHead(head,profile ? "resident"+variant : market?.headModel??role,skin.color,{
    static:!animatedFace,beard:profile?.beard,
    hair:profile?.hair??market?.hair??(role==="merchant" ? 0x544838 : 0x3e342b),
    headcloth:market?.headcloth??(role==="helper" || (profile?.wrap && !residentHat) ? 0x73745d :
      profile && variant===2 && !residentHat ? 0x545761 : undefined),
  }) : null;
  if(!face) {
    const skullRadius=.149, nose=profile?.nose??(role==="merchant" ? 1.18 : role==="helper" ? .93 : 1);
    const cheekbone=profile?.cheek??(role==="merchant" ? .81 : 1);
    const chin=profile?.chin??1;
    const eyeOpening=(profile?.eyes??(role==="merchant" ? .76 : 1))*.0132;
    const jawWidth=y=>{
      const lower=THREE.MathUtils.smoothstep(-y,.035,.137);
      const temple=THREE.MathUtils.smoothstep(y,.061,.133);
      return 1-lower*(profile?.jaw??.34)-temple*(profile?.beard ? .075 : .027);
    };
    const skull=new THREE.SphereGeometry(skullRadius,lowDetail ? 18 : role==="resident" ? 56 : 64,
      lowDetail ? 13 : role==="resident" ? 40 : 48);
    const position = skull.attributes.position;
    const faceColours=[];
    for (let i = 0; i < position.count; i++) {
      const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
      const front=THREE.MathUtils.smoothstep(-z,.019,.101);
      const cheek=Math.exp(-((Math.abs(x)-.081)**2/.0017+(y+.031)**2/.0011));
      const socket=Math.exp(-((Math.abs(x)-.053)**2/.00037+(y-.017)**2/.00026));
      const nostril=Math.exp(-((Math.abs(x)-.017)**2/.00010+(y+.042)**2/.00010));
      const texture=.014*Math.sin(x*119+y*176)*Math.sin(y*162-z*133);
      const flush=.058*front*(profile?.beard ? .44 : 1)*Math.exp(-((Math.abs(x)-.070)**2/.0008+(y+.021)**2/.00061));
      const templeCreases=(profile?.beard || role==="merchant") ?
        .08*Math.sin(289*y+33*x)*Math.exp(-((Math.abs(x)-.091)**2/.00045+(y-.004)**2/.00035)) : 0;
      const chinLight=.035*Math.exp(-(x*x/.0022+(y+.102)**2/.00043));
      const underlip=.072*Math.exp(-(x*x/.0015+(y+.078)**2/.00013));
      const temples=THREE.MathUtils.smoothstep(Math.abs(x),.078,.143);
      const throat=Math.exp(-((y+.141)**2/.00055))*front;
      position.setXYZ(i,x*jawWidth(y),y*1.105,faceDepth(Math.abs(x),y,z,nose,cheekbone,chin));
      const stubble=(profile?.beard || role==="merchant") ?
        .095*THREE.MathUtils.smoothstep(-y,.060,.126)*front : 0;
      const cheekLight=.042*Math.exp(-((Math.abs(x)-.072)**2/.00058+(y+.013)**2/.00039));
      const laughLine=Math.exp(-((Math.abs(x)-.039+.51*(y+.057))**2/.000048+(y+.056)**2/.00055));
      const faceVolume=front*(chinLight+cheekLight-underlip-templeCreases-(profile?.beard ? .13 : .065)*laughLine);
      faceColours.push(1+faceVolume-front*(.17*socket+.25*nostril)+flush+texture-stubble-.10*throat-.055*temples,
        .97+faceVolume-front*(.23*socket+.16*cheek+.31*nostril)+texture-stubble-.12*throat-.069*temples,
        .93+faceVolume-front*(.22*socket+.16*cheek+.31*nostril)-flush*.18+texture-stubble*.5-.13*throat-.081*temples);
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
    function faceStroke(points,pigment,width,opacity) {
      const path=new THREE.CatmullRomCurve3(points.map(([x,y])=>new THREE.Vector3(x,y,0)));
      const position=[],color=[],uv=[],indices=[];
      const divisions=lowDetail ? 7 : 24;
      for(let i=0;i<=divisions;i++) {
        const t=i/divisions;
        const {x,y}=path.getPoint(t);
        const fade=Math.sin(Math.PI*t)**.6;
        for(let row=0;row<3;row++) {
          const dy=(row-1)*width*(.16+.84*fade);
          position.push(...feature(x,y+dy,.0011).toArray());
          color.push(pigment.r,pigment.g,pigment.b,row===1 ? opacity*(.13+.87*fade) : 0);
          uv.push(t,row*.5);
        }
        if(i) for(let row=0;row<2;row++) {
          const a=(i-1)*3+row;
          indices.push(a,a+1,a+3,a+3,a+1,a+4);
        }
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setIndex(indices);
      geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
      geometry.setAttribute("color",new THREE.Float32BufferAttribute(color,4));
      geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
      geometry.computeVertexNormals();
      const stroke=piece(head,geometry,strokeMaterial,0,0,0);
      stroke.castShadow=false;
    }
    const cap = new THREE.SphereGeometry(skullRadius,lowDetail ? 16 : 56,lowDetail ? 9 : 24,0,Math.PI*2,0,Math.PI*.62);
    const hairVertices=cap.attributes.position;
    const hairTones=[];
    const hairPart=profile?.hairPart??.09;
    for(let i=0;i<hairVertices.count;i++) {
      const x=hairVertices.getX(i),y=hairVertices.getY(i),z=hairVertices.getZ(i);
      const az=Math.atan2(x,z), cos=Math.cos(az), sin=Math.sin(az);
      const front=THREE.MathUtils.smoothstep(-cos,.25,.96);
      const back=THREE.MathUtils.smoothstep(cos,.05,.92);
      const temple=Math.exp(-((Math.abs(sin)-.93)**2/.015))*THREE.MathUtils.smoothstep(-cos,.05,.39);
      const edge=.57+.15*back-.212*front+.042*temple+.034*cos*Math.sin(az+hairPart*7)
        +.015*front*Math.sin(az*5+hairPart*12)
        -(profile?.wrap && !residentHat ? .064*(1-back) : 0);
      const length=Math.acos(clamp(y/skullRadius,-1,1))/(Math.PI*.62);
      const angle=length*edge*Math.PI;
      const growth=THREE.MathUtils.smoothstep(length,0,.52);
      const strands=Math.sin(az*31+Math.sin(az*3+hairPart*8)-length*(7+4*sin));
      const radius=skullRadius+.005+.0027*growth*(1+.85*strands);
      const sx=radius*Math.sin(angle)*sin, sy=radius*Math.cos(angle), sz=radius*Math.sin(angle)*cos;
      hairVertices.setXYZ(i,sx*jawWidth(sy),sy*1.105,faceDepth(Math.abs(sx),sy,sz,nose,cheekbone,chin));
      const sweep=Math.sin(az*12-length*5+1.4*Math.sin(az*2+hairPart*12));
      const tone=.99+.087*strands*growth+.18*sweep*growth;
      hairTones.push(tone,tone*.97,tone*.91);
    }
    cap.setAttribute("color",new THREE.Float32BufferAttribute(hairTones,3));
    cap.computeVertexNormals();
    const hairPigment=profile ? plain(profile.hair,.87) : brow;
    const hairSurface=hairPigment.clone();
    hairSurface.vertexColors=true;
    piece(head,cap,hairSurface,0,0,0).name="Sculpted hairline and strands";
    const headwear=role==="helper" || (profile && !residentHat && (profile.wrap || variant===2));
    if(headwear) {
      const palette=role==="helper" ? 0x767258 : variant===2 ? 0x434952 : 0x818a78;
      foldedHeadwrap(head,surface("indigo-linen",palette,.62,.95),garmentSections,role==="helper" ? 3 : variant);
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
    }
    for (const side of [-1, 1]) {
      const ear=piece(head,sculptedEar(side,lowDetail),facePaint,side*.132,-.016,-.003);
      ear.rotation.y=side*-.48;
      const slant=profile?.beard ? -.004 : variant===2 ? .005 : .002;
      piece(head,sculptedEye(feature,side,eyeOpening,slant,side*(profile?.hairPart??.09)*.012,lowDetail),
        eyeSurface,0,0,0).name="Sculpted eyelid opening and iris";
      const upper=eyeOpening*.57;
      faceLine([[side*.0325,.011-slant*.5,.0010],[side*.044,.011+upper*.92,.0029],
        [side*.057,.011+upper*.96,.0032],[side*.0735,.011+slant*.5,.0010]],lidTint,.00135,16);
      if(!lowDetail) {
        const lower=eyeOpening*.43;
        faceLine([[side*.0325,.011-slant*.5,.0009],[side*.045,.011-lower*.88,.0025],
          [side*.059,.011-lower*.90,.0024],[side*.0735,.011+slant*.5,.0009]],skin,.00126,16);
      }
      const lift=(profile?.beard ? -.004 : profile?.wrap ? .003 : 0)+side*.0017;
      const crest=profile?.wrap ? .042 : profile?.beard ? .037 : .040;
      faceStroke([[side*.029,.032+lift],[side*.044,crest+lift],
        [side*.060,crest+.0008+lift],[side*.080,.034+lift]],hairPigment.color,profile?.beard ? .0062 : .0047,.90);
    }
    const mouthWidth=profile ? [.032,.026,.023,.030][variant] : .028;
    const mouthCorner=-.065+(profile?.smile??.002);
    const lowerLip=new THREE.Color(profile?.beard ? 0x946b59 : 0xa87362);
    faceStroke([[-mouthWidth,mouthCorner],[-mouthWidth*.39,-.067],[0,-.070],
      [mouthWidth*.39,-.067],[mouthWidth,mouthCorner-.002]],lowerLip,.0072,.62);
    faceStroke([[-mouthWidth,mouthCorner],[-mouthWidth*.43,-.064],[0,-.066],
      [mouthWidth*.39,-.064],[mouthWidth,mouthCorner-.002]],lips.color,.0031,.90);
    if(role==="merchant" || profile?.beard) {
      const beardTint=profile ? hairPigment : lips;
      const beardMat=beardTint.clone();
      beardMat.vertexColors=true;
      const profileShape=profile?.beard ?
        [[0,-.205],[.013,-.187],[.029,-.154],[.044,-.116],[.050,-.099],[.023,-.081],[0,-.079]] :
        [[0,-.163],[.027,-.153],[.041,-.132],[.051,-.103],[.044,-.091],[.024,-.084],[0,-.080]];
      const beardShape=fabric(profileShape,.51,0,lowDetail ? 12 : 32,0,
        (az,y)=>1+.13*Math.sin(az*7-y*10)+.09*Math.sin(az*13+y*21));
      const pixels=beardShape.attributes.position,tones=[];
      for(let i=0;i<pixels.count;i++) {
        const x=pixels.getX(i), y=pixels.getY(i), z=pixels.getZ(i);
        const phase=Math.atan2(x,z*2)*17-y*38;
        const silver=.28*Math.pow(Math.max(0,Math.cos(phase)),3);
        const shade=.72+.23*Math.sin(phase*.61)+silver+.19*clamp((-y-.08)*9,0,1);
        tones.push(shade,shade*.98,shade*.97);
      }
      beardShape.setAttribute("color",new THREE.Float32BufferAttribute(tones,3));
      const beard=piece(head,beardShape,beardMat,0,0,-.091);
      beard.rotation.x=-.14;
      for(const side of [-1,1]) {
        faceLine([[side*.004,-.051,.005],[side*.017,-.052,.006],
          [side*.033,-.058,.005],[side*.043,-.065,.002]],beardTint,.0043,12);
      }
    }
  }
  if (role==="merchant" || residentHat) {
    const straw = plain(profile?.beard ? 0x9c8d66 : 0xbca66e, .94);
    const rim = plain(0x7f6a4a, .95);
    const shape=role==="merchant" ? [.85,1.11,.83] :
      [[1.05,.82,1.02],[.92,.71,.92],[.86,.98,.91],[1.12,.72,1.02]][variant];
    wovenHat(head,straw,rim,lowDetail,shape);
    const cord=plain(0x77654b,.97);
    for (const side of [-1,1]) {
      const trace=new THREE.CatmullRomCurve3([[side*.139,.158,-.018],[side*.144,.072,-.027],
        [side*.135,-.018,-.048],[side*.108,-.081,-.067],[side*.052,-.127,-.064],[0,-.141,-.059]]
        .map(p=>new THREE.Vector3(...p)));
      piece(head,new THREE.TubeGeometry(trace,lowDetail ? 7 : detail ? 20 : 12,.0048,lowDetail ? 3 : 5,false),cord,0,0,0);
    }
  }

  if(profile?.wrap || market?.satchel) {
    const satchel=surface("indigo-linen",market?.satchel??0xad9b79,.76,.94);
    shoulderSatchel(figure,robe,satchel,binding,lowDetail);
  }
  // The courier and player use their gait and the posed thighs to move the robe.
  const clothPanels=role==="player" || role==="helper"
    ? figure.children.filter(part=>["Outer robe shell","Bound robe hem","Fitted robe binding","Overlapping skirt panel"].includes(part.name))
        .map(({geometry})=>({geometry,rest:geometry.attributes.position.array.slice()}))
    : [];
  let clothLead=0, clothReturn=0;
  const thighCloth=clothPanels.length ? [-1,1].map(()=>({
    hip:new THREE.Vector3(), axis:new THREE.Vector3(), inverseLength:0,
  })) : null;
  const clothSpace=thighCloth ? new THREE.Matrix4() : null;
  const torsoPivot=new THREE.Group(), torso=new THREE.Group();
  for(const part of [...figure.children]) torso.add(part);
  torsoPivot.position.y=.91;
  torso.position.y=-.91;
  torsoPivot.add(torso);
  figure.add(torsoPivot);
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
  const articulated=[], sleeveFits=[];
  for (const side of [-1, 1]) {
    articulated.push(articulatedLeg(figure,side,trousers,binding,dyed,hem,footwear,lowDetail,profile ? trouserCuts[variant] : 1));
    const arm = new THREE.Group();
    arm.position.set(side*.236*shoulders,1.228,.005);
    arm.scale.set(profile?.armWidth??1,profile?.sleeve??1,profile?.armWidth??1);
    // Hang the arm slightly away from the body so the hand clears the flared robe.
    arm.rotation.z=side*.11;
    torso.add(arm);
    const {elbow,sleeve}=tailoredSleeve(arm,cloth,binding,garmentSections,profile?.cuff??.04,detail && !profile);
    if(sleeve.morphTargetInfluences) sleeveFits.push({sleeve,elbow});
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
  function poseSleeves() {
    for(const {sleeve,elbow} of sleeveFits) {
      const flex=1-Math.abs(elbow.quaternion.w);
      sleeve.morphTargetInfluences[0]=THREE.MathUtils.smoothstep(flex,.013,.31);
    }
  }
  let holdKettle;
  if(role==="merchant" || role==="attendant") {
    const arm=limbs.arms[0], elbow=limbs.elbows[0], hand=limbs.hands[0];
    const handlePoint=new THREE.Vector3(.018,-.058,0);
    const socket=new THREE.Object3D();
    socket.name="Tea grasp contact";
    socket.position.copy(handlePoint);
    hand.group.add(socket);

    const upper=elbow.position.length(),lower=hand.group.position.length();
    const upperRest=elbow.position.clone().normalize(), lowerRest=hand.group.position.clone().normalize();
    const wrist=new THREE.Vector3(), direction=new THREE.Vector3(), bend=new THREE.Vector3();
    const joint=new THREE.Vector3(), axis=new THREE.Vector3(), offset=new THREE.Vector3();
    const next=new THREE.Quaternion(), orientation=new THREE.Quaternion();
    holdKettle=(grip,frame,amount) => {
      arm.rotation.set(0,0,-.11);
      elbow.rotation.set(0,0,0);
      hand.group.quaternion.identity();
      hand.setGrip(.09+.84*amount);
      if(amount<.001) return;
      wrist.copy(grip).sub(offset.copy(handlePoint).applyQuaternion(frame));
      arm.parent.worldToLocal(wrist);
      direction.copy(wrist).sub(arm.position);
      const span=clamp(direction.length(),.070,upper+lower-.0004);
      direction.normalize();
      bend.set(-.65,-.55,.51).addScaledVector(direction,-direction.dot(bend)).normalize();
      const projection=(upper*upper-lower*lower+span*span)/(2*span);
      joint.copy(direction).multiplyScalar(projection)
        .addScaledVector(bend,Math.sqrt(Math.max(0,upper*upper-projection*projection)));
      arm.quaternion.slerp(next.setFromUnitVectors(upperRest,axis.copy(joint).normalize()),amount);
      axis.copy(direction).multiplyScalar(span).sub(joint).applyQuaternion(orientation.copy(arm.quaternion).invert());
      elbow.quaternion.slerp(next.setFromUnitVectors(lowerRest,axis.normalize()),amount);
      elbow.getWorldQuaternion(orientation).invert().multiply(frame);
      hand.group.quaternion.slerp(orientation,amount);
    };
  }
  function settleRobe() {
    if(!thighCloth) return;
    torso.updateWorldMatrix(true,false);
    clothSpace.copy(torso.matrixWorld).invert().multiply(figure.matrixWorld);
    for(const [i,leg] of articulated.entries()) {
      const thigh=thighCloth[i];
      thigh.hip.copy(leg.hip).applyMatrix4(clothSpace);
      thigh.axis.copy(leg.calf.position).applyQuaternion(leg.upper.quaternion)
        .add(leg.hip).applyMatrix4(clothSpace).sub(thigh.hip);
      thigh.inverseLength=1/thigh.axis.lengthSq();
    }
    for(const {geometry,rest} of clothPanels) {
      const vertices=geometry.attributes.position;
      let changed=false;
      for(let i=0;i<vertices.count;i++) {
        const at=i*3, x=rest[at], y=rest[at+1],z=rest[at+2];
        if(y>=.93) continue;
        const loose=1-THREE.MathUtils.smoothstep(y,.63,.93);
        const sides=clamp(x/.217,-1,1);
        let nextX=x+loose*(.006*clothLead-.032*z*clothLead);
        let nextY=y+loose*.009*sides*clothReturn;
        let nextZ=z+loose*(.025*sides*clothLead+.009*clothReturn);
        const radial=Math.hypot(x,z);
        if(radial>.10 && y<.81) {
          let separation=0;
          for(const {hip,axis,inverseLength} of thighCloth) {
            const dx=nextX-hip.x, dy=nextY-hip.y, dz=nextZ-hip.z;
            const t=clamp((dx*axis.x+dy*axis.y+dz*axis.z)*inverseLength,0,.81);
            const distance=Math.hypot(dx-t*axis.x,dy-t*axis.y,dz-t*axis.z);
            separation=Math.max(separation,.107-distance);
          }
          // Move the hem away from a raised thigh while keeping the waist fixed.
          const clearance=separation*loose;
          nextX+=x/radial*clearance;
          nextZ+=z/radial*clearance;
          nextY+=.24*clearance;
        }
        if(Math.abs(nextX-vertices.getX(i))+Math.abs(nextY-vertices.getY(i))+
          Math.abs(nextZ-vertices.getZ(i))<.00013) continue;
        vertices.setXYZ(i,nextX,nextY,nextZ);
        changed=true;
      }
      if(changed) {
        vertices.needsUpdate=true;
        geometry.computeVertexNormals();
      }
    }
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
      settleRobe();
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
  let reachHand;
  if(role==="player" || market) {
    const target=new THREE.Vector3(), direction=new THREE.Vector3(), bend=new THREE.Vector3();
    const joint=new THREE.Vector3(), outerAxis=new THREE.Vector3(), innerAxis=new THREE.Vector3();
    const down=new THREE.Vector3(0,-1,0), next=new THREE.Quaternion(), inverse=new THREE.Quaternion();
    reachHand=(i,world,weight)=>{
      const arm=limbs.arms[i], elbow=limbs.elbows[i];
      arm.parent.worldToLocal(target.copy(world));
      direction.copy(target).sub(arm.position);
      const upper=.212, forearm=.223;
      const reach=clamp(direction.length(),.071,upper+forearm-.002);
      direction.normalize();
      bend.set(i===0 ? -.42 : .42,-.81,.39)
        .addScaledVector(direction,-direction.dot(bend)).normalize();
      const pivot=(upper**2-forearm**2+reach**2)/(2*reach);
      joint.copy(direction).multiplyScalar(pivot)
        .addScaledVector(bend,Math.sqrt(Math.max(0,upper**2-pivot**2)));
      arm.quaternion.slerp(next.setFromUnitVectors(down,outerAxis.copy(joint).normalize()),weight);
      inverse.copy(arm.quaternion).invert();
      innerAxis.copy(direction).multiplyScalar(reach).sub(joint).applyQuaternion(inverse).normalize();
      elbow.quaternion.slerp(next.setFromUnitVectors(down,innerAxis),weight);
      limbs.hands[i].setGrip(.17+.56*weight);
    };
  }
  function walkBody(phase,walking,carrying,dt,shift) {
    effort=THREE.MathUtils.damp(effort,Number(walking),10,dt);
    carryWeight=THREE.MathUtils.damp(carryWeight,Number(carrying),15,dt);
    const balance=effort*(1-.65*carryWeight);
    if(torso!==figure) {
      const roll=shift?.side??0,pitch=shift?.forward??0;
      torsoPivot.position.x=.014*balance*Math.sin(phase)+.065*roll;
      torsoPivot.rotation.set(-effort*(.033+.032*carryWeight)-pitch,.064*balance*Math.sin(phase+.32),
        .043*balance*Math.sin(phase-.21)-roll,"YXZ");
      head.rotation.z=-.029*balance*Math.sin(phase-.21)+.54*roll;
      head.rotation.x=.013*effort*Math.sin(phase*2+.45)+.55*pitch;
    }
    clothLead=THREE.MathUtils.damp(clothLead,Math.sin(phase-.44)*balance,15,dt);
    clothReturn=THREE.MathUtils.damp(clothReturn,Math.sin(phase*2-.88)*balance,12,dt);
    for(let i=0;i<limbs.arms.length;i++) {
      const swing=Math.sin(phase+(i+1)*Math.PI);
      if(reachHand) limbs.arms[i].rotation.set(0,0,i===0 ? -.11 : .11);
      limbs.arms[i].rotation.x=THREE.MathUtils.lerp(.25*balance*swing,.88,carryWeight);
    }
    for(let i=0;i<limbs.elbows.length;i++) {
      const forward=Math.max(0,Math.sin(phase+(i+1)*Math.PI));
      if(reachHand) limbs.elbows[i].rotation.set(0,0,0);
      limbs.elbows[i].rotation.x=-THREE.MathUtils.lerp(.12+.35*forward,.25,carryWeight)*effort;
    }
    // Relaxed fingers while walking; a closed grip on the harness straps when carrying.
    for(const hand of limbs.hands) hand.setGrip(.08+.12*effort+.74*carryWeight);
  }
  return {figure,limbs,straps,head,torsoPivot,holdKettle,reachHand,poseFeet,poseSleeves,stand,walkBody,
    face,blink:face?.blink,articulate:face?.articulate,lookEyes:face?.lookEyes,moisture:moisture.value};
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
