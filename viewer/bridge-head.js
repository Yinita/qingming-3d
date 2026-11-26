import * as THREE from "three";
import { headData } from "./bridge-head-data.js";

const { clamp,lerp,smoothstep,damp }=THREE.MathUtils;
const sourceScale=[-.149,.132,-.145];
const sourceCentre=[0,7.235,.57];
const gaussian=(x,y,cx,cy,sx,sy)=>Math.exp(-(((x-cx)/sx)**2+((y-cy)/sy)**2));

function decode(encoded,Type) {
  const buffer=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0)).buffer;
  return new Type(buffer);
}

const base=decode(headData.vertices,Int16Array);
const indices=decode(headData.triangles,Uint16Array);
const weights=new Map();

function local(x,y,z) {
  return [x*sourceScale[0],(y-sourceCentre[1])*sourceScale[1],(z-sourceCentre[2])*sourceScale[2]];
}

function skinColour(x,y,z,role,mouth) {
  const a=Math.abs(x);
  const front=smoothstep(z,1.02,1.46);
  const cheek=gaussian(a,y,.453,7.024,.206,.241)*front;
  const lids=gaussian(a,y,.319,7.22,.192,.095)*smoothstep(z,1.21,1.45);
  const nose=gaussian(a,y,.072,6.96,.151,.14)*front;
  const ears=.64*gaussian(a,y,.814,7.09,.132,.332);
  const jaw=smoothstep(6.88-y,0,.74);
  const brow=gaussian(a,y,.352,7.393,.184,.130)*front;
  const lipU=Math.abs(x-mouth.center.x)/mouth.width;
  const lipMid=mouth.mid(x);
  const vermilion=Math.max(0,1-lipU**2);
  const top=lipMid+(.068+.020*Math.exp(-((lipU-.26)**2)/.032))*vermilion;
  const bottom=lipMid-.064*vermilion;
  const lip=(1-smoothstep(lipU,.73,1.04))*smoothstep(y,bottom-.017,bottom+.010)*
    (1-smoothstep(y,top-.015,top+.025))*smoothstep(z,1.40,1.54);
  const upperLip=lip*smoothstep(y,lipMid-.014,lipMid+.014);
  const flush=.10*cheek+.11*nose+.16*ears+.046*lids;
  const underEye=.096*lids;
  const mottle=.008*Math.sin(x*48+y*32)*Math.sin(y*39-z*82);
  const lashU=a-.31;
  const lash=Math.exp(-(((y-7.346+.38*lashU*lashU)/.015)**2))*(1-smoothstep(Math.abs(lashU),.115,.155))*smoothstep(z,1.30,1.40);
  const beard=role==="merchant" ? .24*gaussian(a,y,.149,6.45,.358,.32)*front : 0;
  const parting=Math.exp(-(((y-lipMid)/.007)**2))*(1-smoothstep(lipU,.82,1.04))*smoothstep(z,1.46,1.54);
  const tone=1+mottle-.078*jaw-.071*brow-beard-.42*lash-.051*parting-.033*upperLip;
  return [
    tone+flush+.023*lip,
    tone-.43*flush-.157*lip-underEye,
    tone-.66*flush-.123*lip-underEye*.67,
  ];
}

function closedLid(x,y,z) {
  const a=Math.abs(x);
  const u=clamp((a-.174)/.30,0,1), curve=Math.sin(Math.PI*u)**.78;
  const seam=7.271+.125*(a-.319);
  const reach=.061*curve;
  const band=1-smoothstep(Math.abs(y-seam),.074,.19);
  const top=y>=seam;
  const closure=(top ? -reach*1.16 : reach*.83)*band*smoothstep(z,1.27,1.37);
  const nextY=y+closure;
  const dz=Math.sqrt(Math.max(0,.146**2-(a-.30777)**2-(nextY-7.28414)**2));
  const globe=1.24536+dz+.017;
  const forward=(top ? .82 : .77)*curve*band*smoothstep(z,1.25,1.40);
  return local(x,nextY,z+Math.max(0,globe-z)*forward);
}

const mouthPoses=[
  {jaw:.059,lift:.007,width:-.023,purse:.007,smile:0},
  {jaw:.048,lift:.003,width:-.20,purse:.051,smile:0},
  {jaw:.037,lift:.007,width:.090,purse:-.011,smile:.016},
];

function mouthPosition(x,y,z,lip,mouth,pose) {
  const u=Math.abs(x-mouth.center.x)/mouth.width, vertical=y-mouth.mid(x);
  const front=smoothstep(z,.98,1.48);
  const seam=lip==="corner" ? 0 : Math.max(0,1-u*u)**1.45;
  const lips=front*Math.exp(-((vertical/.132)**2))*(1-smoothstep(u,.94,1.58));
  const lower=lip==="lower" ? 1 : lip==="upper" ? 0 : 1-smoothstep(vertical,-.009,.015);
  // Ease the corner constraint into a wider jaw rotation below the lower lip.
  const jawBlend=smoothstep(-vertical,.021,.29);
  const angle=pose.jaw*front*lower*lerp(seam,1-smoothstep(u,.60,2.0),jawBlend)*smoothstep(y,6.19,6.46);
  const hingeY=mouth.center.y+.22, hingeZ=.58;
  const armY=y-hingeY, armZ=z-hingeZ;
  const sin=Math.sin(angle),cos=Math.cos(angle);
  const jawY=hingeY+armY*cos-armZ*sin;
  const jawZ=hingeZ+armZ*cos+armY*sin;
  const lift=pose.lift*(1-lower)*seam*lips;
  const corner=pose.smile*smoothstep(u,.27,.92)*lips;
  return local(x+(x-mouth.center.x)*pose.width*lips,jawY+lift+corner,jawZ+pose.purse*lips);
}

function fitMouthSeam(source) {
  const pairs=headData.mouth.map(([upper,lower])=>{
    const a=upper*3,b=lower*3;
    return {upper,lower,x:(source[a]+source[b])*.5,upperY:source[a+1],lowerY:source[b+1],
      y:(source[a+1]+source[b+1])*.5,z:(source[a+2]+source[b+2])*.5};
  }).sort((a,b)=>a.x-b.x);
  const center=pairs[(pairs.length-1)/2];
  const width=Math.max(center.x-pairs[0].x,pairs.at(-1).x-center.x);
  const span=x=>Math.abs(x-center.x)/width;
  const mid=x=>{
    const u=Math.min(1,span(x));
    return center.y+.006*Math.sin(Math.PI*u)**2-.022*u**4;
  };
  const depth=x=>lerp(center.z,x<center.x ? pairs[0].z : pairs.at(-1).z,Math.min(1,span(x))**1.83);
  // Move the skin above and below the cut with its own edge to keep the lip rows from folding.
  for(let i=0;i<source.length;i+=3) {
    const x=source[i],y=source[i+1],z=source[i+2];
    const u=span(x);
    if(u>1.42 || z<1.37 || Math.abs(y-center.y)>.23) continue;
    const above=pairs.findIndex(pair=>pair.x>=x);
    const b=pairs[above<0 ? pairs.length-1 : above],a=pairs[Math.max(0,(above<0 ? pairs.length-1 : above)-1)];
    const t=a===b ? 0 : clamp((x-a.x)/(b.x-a.x),0,1);
    const aboveLip=y>=lerp(a.y,b.y,t);
    const edgeY=aboveLip ? lerp(a.upperY,b.upperY,t) : lerp(a.lowerY,b.lowerY,t);
    const front=smoothstep(z,1.37,1.49);
    const around=(1-smoothstep(Math.abs(y-edgeY),.012,.148))*(1-smoothstep(u,.94,1.42));
    source[i+1]+=(mid(x)-edgeY)*around*front;
    const vertical=source[i+1]-mid(x), distance=Math.abs(vertical);
    const lower=vertical<0;
    // Let the lower lip turn into the chin across several rows of the source mesh.
    const roll=(lower ? .023 : .034)*Math.sin(Math.PI*clamp(distance/(lower ? .103 : .118),0,1));
    const inset=(lower ? .049 : .010)*smoothstep(distance,.032,lower ? .168 : .134);
    const profile=depth(x)-inset+roll*(1-smoothstep(u,.40,1));
    const blend=front*(1-smoothstep(u,.66,1.18))*(1-smoothstep(distance,lower ? .089 : .074,lower ? .182 : .154));
    source[i+2]=lerp(z,profile,blend);
  }
  const region=new Map();
  for(const [i,{upper,lower,x}] of pairs.entries()) {
    const a=upper*3,b=lower*3;
    source[a]=source[b]=x;
    source[a+1]=source[b+1]=mid(x);
    source[a+2]=source[b+2]=depth(x);
    const corner=i===0 || i===pairs.length-1;
    region.set(upper,corner ? "corner" : "upper");
    region.set(lower,corner ? "corner" : "lower");
  }
  return {pairs,region,center,width,mid};
}

function skinProgram(material) {
  material.customProgramCacheKey=()=>"painted-anatomical-skin";
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 skinPoint;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nskinPoint=position;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>",`#include <common>
      varying vec3 skinPoint;
      float brushGrain(vec3 p) {
        return sin(dot(p,vec3(2763.,2168.,938.)))*
          sin(dot(p,vec3(2037.,-2742.,-1459.)));
      }`)
      .replace("#include <color_fragment>",`#include <color_fragment>
        float footprint=length(dFdx(skinPoint))+length(dFdy(skinPoint));
        float skinGrain=(1.-smoothstep(.00028,.00145,footprint))*brushGrain(skinPoint);
        diffuseColor.rgb*=1.+skinGrain*.028;
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        float skinOil=exp(-pow(skinPoint.x/.041,2.))*smoothstep(.015,.12,-skinPoint.z);
        roughnessFactor=clamp(roughnessFactor-.097*skinOil+.023*skinGrain,.49,.88);
      `);
  };
}

// Facial structure on top of the MakeHuman base, in source units (one unit is about 15 cm).
// Leads get a tapered jaw, a forward chin, high cheekbones, a straight raised nose bridge and a
// firm brow; the eye sockets and lids are untouched so the blink and eyeball fit still hold.
// Per-role face design. k scales the shared refinement; the other terms give each person
// their own structure: longer or shorter lower face, jaw taper, cheek fullness, chin
// projection and nose width, so residents can be told apart side on as well as head on.
const faceDesign={
  player:   {k:1,   length:.010, taper:1.00, full:0,    chin:1.0, nose:1.0},
  helper:   {k:.85, length:-.012,taper:.80,  full:.35,  chin:.8,  nose:1.0},
  attendant:{k:.8,  length:.006, taper:.95,  full:.10,  chin:1.0, nose:.9},
  shopper:  {k:.7,  length:.000, taper:.70,  full:.25,  chin:.9,  nose:1.0},
  baker:    {k:.6,  length:-.018,taper:.40,  full:.70,  chin:.6,  nose:1.25},
  porter:   {k:.55, length:.014, taper:.55,  full:-.10, chin:1.3, nose:1.1},
  merchant: {k:.45, length:.004, taper:.60,  full:.30,  chin:.9,  nose:1.1},
  resident0:{k:.65, length:.030, taper:.70,  full:-.25, chin:1.35,nose:.9},
  resident1:{k:.4,  length:-.022,taper:.15,  full:.85,  chin:.5,  nose:1.3},
  resident2:{k:.75, length:.016, taper:1.10, full:0,    chin:1.1, nose:.85},
  resident3:{k:.5,  length:-.006,taper:.35,  full:.55,  chin:.7,  nose:1.2},
};
function sculptFace(source,role) {
  const d=faceDesign[role]??{k:.5,length:0,taper:.6,full:.2,chin:1,nose:1};
  const k=d.k;
  for(let i=0;i<source.length;i+=3) {
    const x=source[i],y=source[i+1],z=source[i+2];
    const a=Math.abs(x),sign=Math.sign(x)||1;
    const neck=smoothstep(y,6.02,6.30);
    const side=smoothstep(z,-.15,.65)*neck;
    const lower=smoothstep(7.02-y,0,.58);
    const taper=.17*k*d.taper*lower*smoothstep(a,.10,.62)*side;
    const chin=gaussian(a,y,0,6.42,.21,.13)*smoothstep(z,1.08,1.40)*neck;
    const cheekbone=gaussian(a,y,.52,7.06,.15,.11)*smoothstep(z,.85,1.30);
    const hollow=gaussian(a,y,.49,6.80,.13,.10)*smoothstep(z,.75,1.25);
    const cheek=gaussian(a,y,.46,6.78,.20,.17)*smoothstep(z,.70,1.25)*neck;
    const bridge=gaussian(a,y,0,7.11,.055,.16)*smoothstep(z,1.40,1.56);
    const wing=gaussian(a,y,.12,6.91,.075,.08)*smoothstep(z,1.28,1.50);
    const brow=gaussian(a,y,.30,7.44,.21,.05)*smoothstep(z,1.33,1.50);
    // Lengthen or shorten the face below the eyes, fading out at the neck seam.
    const drop=d.length*smoothstep(7.08-y,0,.62)*neck;
    // Open the eye: stretch lids away from the eyeball centre, more vertically than across.
    const eye=Math.exp(-(((a-.308)/.19)**2+((y-7.284)/.13)**2))*smoothstep(z,1.15,1.30);
    const open=.24*k*eye;
    source[i]=x*(1-taper-.15*k*(2-d.nose)*wing)+sign*(k*(.015*cheekbone-.016*hollow*(1-d.full))+.030*d.full*cheek)+
      sign*.05*open*(a-.308);
    source[i+1]=y-.030*k*d.chin*chin+open*(y-7.284)-drop;
    source[i+2]=z+k*(.038*d.chin*chin+.012*cheekbone+.032*bridge+.016*brow)+.010*d.full*cheek;
  }
}

function makeHeadGeometry(role,animated,beard) {
  const source=Float32Array.from(base,value=>value/10000);
  for(let i=1;i<source.length;i+=3) source[i]+=7;
  if(!weights.has(role)) weights.set(role,decode(headData.options[role],Int16Array));
  const delta=weights.get(role);
  for(let i=0;i<delta.length;i+=4) {
    const start=delta[i]*3;
    for(let a=0;a<3;a++) source[start+a]+=delta[i+a+1]/10000;
  }
  sculptFace(source,role);
  const mouth=fitMouthSeam(source);
  const positions=[],colour=[],closed=[],talk=[],round=[],wide=[];
  const mouthTargets=[talk,round,wide];
  for(let i=0;i<source.length;i+=3) {
    const x=source[i],y=source[i+1],z=source[i+2];
    positions.push(...local(x,y,z));
    colour.push(...skinColour(x,y,z,beard ? "merchant" : role,mouth));
    if(animated) {
      closed.push(...closedLid(x,y,z));
      const lip=mouth.region.get(i/3);
      for(const [j,target] of mouthTargets.entries()) target.push(...mouthPosition(x,y,z,lip,mouth,mouthPoses[j]));
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colour,3));
  geometry.computeVertexNormals();
  if(!animated) return {geometry,source,mouth};
  const morphPositions=[talk,closed,round,wide].map(target=>new THREE.Float32BufferAttribute(target,3));
  const deformed=new THREE.BufferGeometry();
  deformed.setIndex(geometry.index);
  geometry.morphAttributes.normal=morphPositions.map(target=>{
    deformed.setAttribute("position",target);
    deformed.computeVertexNormals();
    return deformed.attributes.normal.clone();
  });
  geometry.morphAttributes.position=morphPositions;
  return {geometry,source,mouth};
}

function attach(parent, geometry, material, name) {
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=name;
  mesh.castShadow=mesh.receiveShadow=true;
  parent.add(mesh);
  return mesh;
}

function eyeballMaterial() {
  const iris=new THREE.MeshStandardMaterial({roughness:.43});
  iris.customProgramCacheKey=()=>"painted-brown-iris";
  iris.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nattribute vec3 irisPoint; varying vec3 eyeball;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\neyeball=irisPoint;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nvarying vec3 eyeball;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec3 p=normalize(eyeball);
        float radius=p.z<0. ? length(p.xy) : 1.;
        float angle=atan(p.y,p.x);
        float fibers=.54+.26*sin(angle*39.+radius*11.)+.13*sin(angle*67.-radius*9.);
        vec3 brown=mix(vec3(.055,.039,.026),vec3(.146,.089,.039),
          fibers*smoothstep(.15,.32,radius));
        brown=mix(brown,vec3(.033,.023,.017),smoothstep(.35,.458,radius));
        brown=mix(vec3(.015,.011,.009),brown,smoothstep(.150,.185,radius));
        float whitesVeil=.17*smoothstep(.42,.86,abs(p.x))+.08*(1.-smoothstep(.02,.67,p.y));
        vec3 white=mix(vec3(.64,.58,.50),vec3(.51,.35,.27),whitesVeil);
        diffuseColor.rgb=mix(brown,white,smoothstep(.444,.476,radius));
      `);
  };
  return iris;
}

function eyesFor(head,material,animated) {
  const shape=new THREE.SphereGeometry(1,animated ? 32 : 18,animated ? 22 : 12);
  shape.setAttribute("irisPoint",shape.attributes.position.clone());
  return headData.eyes.map(([x,y,z])=>{
    const eye=attach(head,shape,material,"Recessed eyeball and iris");
    eye.position.set(...local(x,y,z));
    eye.scale.set(.1382*Math.abs(sourceScale[0]),.1382*sourceScale[1],.151*Math.abs(sourceScale[2]));
    eye.castShadow=false;
    return eye;
  });
}

function coverLine(x,z,wrapped) {
  const front=smoothstep(z,.79,1.31);
  const earDistance=Math.abs(x);
  const earClearance=.74*smoothstep(earDistance,.655,.790);
  const temple=.114*smoothstep(earDistance,.49,.67)*smoothstep(z,.92,1.28);
  const point=wrapped ? .036*Math.sin(x*6.9)*front : 0;
  // A combed hairline: a slight peak at the centre and recessed temples, not a level cap edge.
  const shape=wrapped ? 0 : front*(.062*smoothstep(earDistance,.10,.40)*(1-smoothstep(earDistance,.50,.66))
    -.034*Math.exp(-((x/.13)**2)));
  // At the back the hair ends in a soft point at the nape instead of a level bowl cut.
  const nape=wrapped ? 0 : -(1-front)*(.105*Math.exp(-((x/.27)**2))-.03*smoothstep(earDistance,.30,.55));
  return 6.91+.743*front+earClearance+temple+point+shape+nape+(wrapped ? .035 : 0);
}

function scalpGeometry(skin,source,wrapped) {
  const xyz=skin.attributes.position,normal=skin.attributes.normal;
  const vertices=[],rgb=[],lookup=new Map(),faces=[];
  const atA=new THREE.Vector3(),atB=new THREE.Vector3(),axis=new THREE.Vector3();
  const rise=new Float32Array(xyz.count);
  for(let i=0;i<xyz.count;i++) {
    const x=source[i*3], y=source[i*3+1], z=source[i*3+2];
    rise[i]=y-coverLine(x,z,wrapped);
  }
  function vertex(a,b,t) {
    const key=a===b ? a : Math.min(a,b)+"/"+Math.max(a,b);
    if(lookup.has(key)) return lookup.get(key);
    const p=atA.fromBufferAttribute(xyz,a).lerp(atB.fromBufferAttribute(xyz,b),t);
    const angle=Math.atan2(p.x,p.z);
    const ribs=Math.sin(angle*4.4+p.y*113)+.63*Math.cos(angle*7.0-p.y*70);
    // Thin the hair to nothing at its edge so it grows out of the skin rather than ending in a lip.
    const height=a===b ? rise[a] : 0;
    const edge=wrapped ? 1 : .15+.85*smoothstep(height,0,.09);
    const thickness=(wrapped ? .0074+.00165*ribs : .0026+.00048*ribs)*edge;
    axis.fromBufferAttribute(normal,a).lerp(atB.fromBufferAttribute(normal,b),t).normalize();
    p.addScaledVector(axis,thickness);
    const id=vertices.length/3;
    vertices.push(p.x,p.y,p.z);
    const tone=wrapped ? .94+.047*ribs : .965+.018*ribs;
    rgb.push(tone,tone*.977,tone*.944);
    lookup.set(key,id);
    return id;
  }
  for(let i=0;i<indices.length;i+=3) {
    const face=[indices[i],indices[i+1],indices[i+2]],edge=[];
    for(let j=0;j<3;j++) {
      const a=face[j],b=face[(j+2)%3];
      const inside=rise[a]>=0;
      if(inside!==(rise[b]>=0)) edge.push(vertex(a,b,rise[a]/(rise[a]-rise[b])));
      if(inside) edge.push(vertex(a,a,0));
    }
    for(let j=1;j<edge.length-1;j++) faces.push(edge[0],edge[j],edge[j+1]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(rgb,3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return roundScalp(geometry);
}

function roundScalp(mesh) {
  const positions=mesh.attributes.position,normals=mesh.attributes.normal,colors=mesh.attributes.color;
  const coordinates=Array.from(positions.array),tints=Array.from(colors.array),triangles=[];
  const edges=new Map();
  const start=new THREE.Vector3(),end=new THREE.Vector3(),nA=new THREE.Vector3(),nB=new THREE.Vector3();
  const mid=new THREE.Vector3(),chord=new THREE.Vector3();
  function midpoint(a,b) {
    const key=Math.min(a,b)+"/"+Math.max(a,b);
    if(edges.has(key)) return edges.get(key);
    start.fromBufferAttribute(positions,a);end.fromBufferAttribute(positions,b);
    nA.fromBufferAttribute(normals,a);nB.fromBufferAttribute(normals,b);
    chord.subVectors(end,start);
    mid.copy(start).addScaledVector(chord,.5)
      .addScaledVector(nA,-.16*chord.dot(nA)).addScaledVector(nB,.16*chord.dot(nB));
    const i=coordinates.length/3;
    coordinates.push(mid.x,mid.y,mid.z);
    tints.push((colors.getX(a)+colors.getX(b))*.5,(colors.getY(a)+colors.getY(b))*.5,
      (colors.getZ(a)+colors.getZ(b))*.5);
    edges.set(key,i);
    return i;
  }
  const indices=mesh.index.array;
  for(let i=0;i<indices.length;i+=3) {
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const x=midpoint(a,b),y=midpoint(b,c),z=midpoint(c,a);
    triangles.push(a,x,z,x,b,y,y,c,z,x,y,z);
  }
  mesh.setAttribute("position",new THREE.Float32BufferAttribute(coordinates,3));
  mesh.setAttribute("color",new THREE.Float32BufferAttribute(tints,3));
  mesh.deleteAttribute("normal");
  mesh.setIndex(triangles);
  mesh.computeVertexNormals();
  mesh.setAttribute("scalpPoint",mesh.attributes.position.clone());
  return mesh;
}

function hairFinish(color,wrapped) {
  const material=new THREE.MeshStandardMaterial({color,vertexColors:true,roughness:wrapped ? .91 : .52});
  material.customProgramCacheKey=()=>wrapped ? "fitted-woven-headwrap" : "combed-scalp-hair";
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nattribute vec3 scalpPoint; varying vec3 headCloth;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nheadCloth=scalpPoint;");
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>","#include <common>\nvarying vec3 headCloth;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        float az=atan(headCloth.x,headCloth.z);
        float strand=${wrapped
          ? "headCloth.y*3300.+sin(az*7.)*2.+sin(az*227.)*.7"
          : "az*96.+sin(headCloth.y*23.+az*3.)*3."};
        float line=sin(strand)*(1.-smoothstep(.35,2.5,fwidth(strand)));
        diffuseColor.rgb*=.99+${wrapped?".053":".085"}*line;
      `);
  };
  return material;
}

function frontDepth(face,x,y) {
  const p=face.attributes.position;
  let result=Infinity;
  for(let i=0;i<indices.length;i+=3) {
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const az=p.getZ(a),bz=p.getZ(b),cz=p.getZ(c);
    if(az>-.016 && bz>-.016 && cz>-.016) continue;
    const ax=p.getX(a),ay=p.getY(a),dx=p.getX(b)-ax,dy=p.getY(b)-ay;
    const ex=p.getX(c)-ax,ey=p.getY(c)-ay;
    const area=dx*ey-dy*ex;
    if(Math.abs(area)<1e-9) continue;
    const u=((x-ax)*ey-(y-ay)*ex)/area,v=(dx*(y-ay)-dy*(x-ax))/area;
    if(u<0 || v<0 || u+v>1) continue;
    result=Math.min(result,az+u*(bz-az)+v*(cz-az));
  }
  return result;
}

function eyebrows(head,skin,color,role) {
  const points=[],tones=[],index=[];
  function put(x,y,shade,opacity) {
    const z=frontDepth(skin,x,y);
    if(!Number.isFinite(z)) return false;
    points.push(x,y,z-.00085);
    tones.push(shade,shade*.96,shade*.90,opacity);
    return true;
  }
  // Elders keep a soft arch; everyone else gets a straighter, lower brow that rises towards
  // the tail and turns down at the very end.
  const elder=role==="merchant";
  function height(t,side) {
    if(elder) {
      const arch=Math.sin(Math.PI*t**.76);
      return .0244+.0101*arch-.0028*t-.0018*side;
    }
    return .0228+.0052*t-.0058*smoothstep(t,.72,1)**1.4+.0006*side;
  }
  const thickness=t=>elder ? .0027*Math.sin(Math.PI*t)**.42
    : (.0041-.0017*t)*Math.sin(Math.PI*(.12+.88*t))**.36;
  for(const side of [-1,1]) {
    const first=points.length/3;
    let previous=first-3;
    for(let i=0;i<=28;i++) {
      const row=points.length/3;
      const t=i/28,x=side*lerp(elder ? .024 : .019,.088,t),y=height(t,side);
      const taper=Math.sin(Math.PI*t)**.42;
      for(let k=-1;k<=1;k++) put(x,y+k*thickness(t),elder ? .78 : .62,k===0 ? (elder ? .68 : .88)*taper : 0);
      if(points.length/3-row!==3) {
        points.length=row*3;
        tones.length=row*4;
        previous=first-3;
        continue;
      }
      if(previous>=first) for(let k=0;k<2;k++) {
        const a=previous+k,b=row+k;
        index.push(a,b,a+1,b,b+1,a+1);
      }
      previous=row;
    }
    const strokes=elder ? 59 : 96;
    for(let i=0;i<strokes;i++) {
      const t=clamp((i+.47*Math.sin(i*19.4))/(strokes-1),0,1);
      const x=side*lerp(elder ? .024 : .019,.088,t),y=height(t,side)+(elder ? .0016 : .0024)*Math.sin(i*31.1);
      const length=(.0038-.0019*t)*(.55+.45*Math.sin(i*5.41)**2);
      const shift=side*(.0015+.0031*t);
      const start=points.length/3;
      for(const [dx,dy,shade,alpha] of [[-.00027,-.0012,.82,.81],[.00038,-.0012,.86,.86],
        [shift+.00019,length,.68,.33],[shift-.00017,length,.64,.29]]) {
        put(x+dx,y+dy,shade,alpha);
      }
      if(points.length/3-start===4) index.push(start,start+2,start+1,start,start+3,start+2);
      else {
        points.length=start*3;
        tones.length=start*4;
      }
    }
  }
  if(role==="merchant") for(const side of [-1,1]) for(let i=0;i<48;i++) {
    const t=i/47;
    const x=side*lerp(.007,.038,t);
    const y=-.052-.012*t**1.5+.0017*Math.sin(i*17.4);
    const curl=side*(.002+.004*t);
    const start=points.length/3;
    for(const [dx,dy,shade,alpha] of [[-.00045,.0007,.84,.76],[.00045,.0007,.76,.81],
      [curl+.00021,-.0046,.67,.31],[curl-.00021,-.0049,.68,.21]]) put(x+dx,y+dy,shade,alpha);
    if(points.length/3-start===4) index.push(start,start+2,start+1,start,start+3,start+2);
    else {
      points.length=start*3;
      tones.length=start*4;
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(tones,4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({
    color,vertexColors:true,side:THREE.DoubleSide,roughness:.91,transparent:true,depthWrite:false,
  });
  attach(head,geometry,material,"Combed brow strokes").castShadow=false;
}

function mouthLining(head,face,mouth) {
  const upper=mouth.pairs.map(pair=>pair.upper);
  const lower=mouth.pairs.map(pair=>pair.lower).reverse();
  const boundary=[...upper,...lower.slice(1,-1)], count=boundary.length;
  function liningPositions(source) {
    const positions=[];
    const midY=(source.getY(mouth.center.upper)+source.getY(mouth.center.lower))*.5;
    const midZ=source.getZ(mouth.center.upper);
    const width=[1,1.03,.72], height=[1,1.17,1.01], depth=[0,.004,.025];
    for(let ring=0;ring<3;ring++) {
      for(const i of boundary) {
        const x=source.getX(i), y=source.getY(i), z=source.getZ(i);
        positions.push(x*width[ring],lerp(midY,y,height[ring]),z+depth[ring]);
      }
    }
    positions.push(source.getX(mouth.center.upper),midY,midZ+.036);
    return new THREE.Float32BufferAttribute(positions,3);
  }
  const indices=[],colors=[];
  const shades=[[.124,.053,.049],[.077,.026,.024],[.042,.012,.015]];
  for(let band=0;band<3;band++) for(let i=0;i<count;i++) {
    const p=band*count+i,q=band*count+(i+1)%count;
    colors.push(...shades[band]);
    if(band===2) indices.push(p,q,3*count);
    else indices.push(p,q,p+count,q,q+count,p+count);
  }
  colors.push(.027,.007,.008);
  const geometry=new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position",liningPositions(face.attributes.position));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.morphAttributes.position=[0,2,3].map(i=>liningPositions(face.morphAttributes.position[i]));
  const lining=attach(head,geometry,
    new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}),"Mouth lining");
  lining.castShadow=lining.receiveShadow=false;
  return lining;
}

function dentalRow(head,mouth,lower,material) {
  const [centerX,centerY,centerZ]=local(mouth.center.x,mouth.center.y,mouth.center.z);
  const halfWidth=mouth.width*Math.abs(sourceScale[0])*(lower ? .59 : .69);
  const vertices=[],colors=[],index=[];
  const sections=64;
  const contacts=[0,.255,.455,.658,.857];
  // Four rows form the rounded enamel face and return under the cut edge.
  for(let i=0;i<=sections;i++) {
    const t=2*i/sections-1, curve=Math.abs(t);
    const contact=Math.min(...contacts.map(edge=>Math.abs(curve-edge)));
    const grooves=1-smoothstep(contact,.008,.035);
    const arch=.0012*curve**2, groove=.00023*grooves;
    const cut=centerY+(lower ? -.0102+arch-groove : -.0025+arch+groove);
    const root=cut+(lower ? -.0065 : .0076)*(1-.31*curve);
    const depth=centerZ+.0108+.018*curve**2+.00038*grooves+(lower ? .0053 : 0);
    const tone=.96-.16*curve-.062*grooves;
    for(const [y,z,shade] of [[root,depth+.0017,.87],[lerp(root,cut,.49),depth,tone],
      [cut,depth+.00086,.94*tone],[cut,depth+.0037,.67*tone]]) {
      vertices.push(centerX+t*halfWidth,y,z);
      const light=lower ? shade*.79 : shade;
      colors.push(light,light*.983,light*.944);
    }
    if(i) for(let j=0;j<3;j++) {
      const p=(i-1)*4+j,q=p+4;
      index.push(p,q,p+1,q,q+1,p+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  const row=attach(head,geometry,material,lower ? "Lower teeth on the jaw" : "Recessed upper teeth");
  row.castShadow=row.receiveShadow=false;
  return row;
}

function mouthInterior(head,face,mouth) {
  const lining=mouthLining(head,face,mouth);
  const enamel=new THREE.MeshStandardMaterial({color:0xc8b8a2,roughness:.76,
    vertexColors:true,side:THREE.DoubleSide});
  const upper=dentalRow(head,mouth,false,enamel),lower=dentalRow(head,mouth,true,enamel);
  const base=face.attributes.position, center=mouth.center.lower;
  const baseY=base.getY(center),baseZ=base.getZ(center);
  const jawDeltas=[0,2,3].map(i=>{
    const target=face.morphAttributes.position[i];
    return [target.getY(center)-baseY,target.getZ(center)-baseZ,
      target.getY(mouth.center.upper)-target.getY(center)];
  });
  const tongue=attach(lower,new THREE.SphereGeometry(1,16,8),
    new THREE.MeshBasicMaterial({color:0x4a2222}),"Tongue behind the dental arch");
  tongue.position.set(base.getX(center),baseY-.0092,baseZ+.030);
  tongue.scale.set(.020,.004,.013);
  tongue.castShadow=tongue.receiveShadow=false;
  return morph=>{
    const amount=morph[0]+morph[2]+morph[3];
    lining.visible=amount>.001;
    let jawY=0,jawZ=0,opening=0;
    for(const [i,[dy,dz,gap]] of jawDeltas.entries()) {
      const weight=morph[i===0 ? 0 : i+1];
      lining.morphTargetInfluences[i]=weight;
      jawY+=dy*weight;
      jawZ+=dz*weight;
      opening+=gap*weight;
    }
    upper.visible=lower.visible=opening>.0012;
    // Move the lower dental arch and tongue with the jaw. The upper arch stays on the skull.
    lower.position.set(0,jawY,jawZ);
  };
}

export function buildAnatomicalHead(head,role,tone,style) {
  const animated=!style.static;
  const {geometry,source,mouth}=makeHeadGeometry(role,animated,style.beard);
  const material=new THREE.MeshStandardMaterial({color:tone,roughness:.75,vertexColors:true});
  if(animated) skinProgram(material);
  const skin=attach(head,geometry,material,"Sculpted face");
  const eyes=eyesFor(head,eyeballMaterial(),animated);
  eyebrows(head,geometry,style.hair,style.beard ? "merchant" : role);
  const wrapped=Boolean(style.headcloth);
  const hair=hairFinish(style.headcloth??style.hair,wrapped);
  const cap=attach(head,scalpGeometry(geometry,source,wrapped),hair,wrapped ? "Tailored cloth headwrap" : "Combed scalp crown");
  if(wrapped) {
    const knot=attach(head,new THREE.SphereGeometry(1,18,12),new THREE.MeshStandardMaterial({
      color:style.headcloth,roughness:.93,
    }),"Rolled knot on headwrap");
    knot.position.set(.054,.081,.092);
    knot.scale.set(.034,.019,.022);
    knot.rotation.z=.53;
  } else {
    // A neat topknot: a smooth bun, a cloth band at its root and a slim wooden hairpin.
    const knot=attach(head,new THREE.SphereGeometry(1,24,16),
      new THREE.MeshStandardMaterial({color:style.hair,roughness:.5}),"Tied hair knot");
    knot.position.set(.009,.171,.034);
    knot.scale.set(.032,.030,.029);
    const band=attach(head,new THREE.TorusGeometry(.027,.0045,8,28),
      new THREE.MeshStandardMaterial({color:0x3a2c22,roughness:.8}),"Topknot band");
    band.position.set(.009,.150,.034);
    band.rotation.x=Math.PI/2;
    const pin=attach(head,new THREE.CylinderGeometry(.0022,.0016,.094,8),
      new THREE.MeshStandardMaterial({color:0x5b3b22,roughness:.45}),"Wooden hairpin");
    pin.position.set(.009,.172,.034);
    pin.rotation.z=Math.PI/2-.12;
    pin.castShadow=false;
  }
  cap.castShadow=true;
  if(!animated) return {};
  skin.morphTargetDictionary.speak=0;
  skin.morphTargetDictionary.blink=1;
  skin.morphTargetDictionary.round=2;
  skin.morphTargetDictionary.wide=3;
  const aim=new THREE.Vector2();
  const morph=skin.morphTargetInfluences;
  const poseMouth=mouthInterior(head,geometry,mouth);
  poseMouth(morph);
  return {
    articulate(amount) {
      morph[0]=clamp(amount,0,1);
      morph[2]=morph[3]=0;
      poseMouth(morph);
    },
    speak(shape,dt) {
      const open=shape?.[0]??0,round=shape?.[1]??0,wide=shape?.[2]??0;
      const total=Math.max(1,open+round+wide);
      morph[0]=damp(morph[0],open/total,34,dt);
      morph[2]=damp(morph[2],round/total,34,dt);
      morph[3]=damp(morph[3],wide/total,34,dt);
      poseMouth(morph);
    },
    blink(amount) { skin.morphTargetInfluences[1]=clamp(amount,0,1); },
    lookEyes(x,y,dt) {
      aim.x=damp(aim.x,.19*x,13,dt);
      aim.y=damp(aim.y,.16*y,13,dt);
      for(const eye of eyes) eye.rotation.set(aim.y,-aim.x,0,"YXZ");
    },
  };
}
