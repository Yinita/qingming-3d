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

function skinColour(x,y,z,role) {
  const a=Math.abs(x);
  const front=smoothstep(z,1.02,1.46);
  const cheek=gaussian(a,y,.453,7.024,.206,.241)*front;
  const lids=gaussian(a,y,.319,7.22,.192,.095)*smoothstep(z,1.21,1.45);
  const nose=gaussian(a,y,.072,6.96,.151,.14)*front;
  const ears=.64*gaussian(a,y,.814,7.09,.132,.332);
  const jaw=smoothstep(6.88-y,0,.74);
  const brow=gaussian(a,y,.352,7.393,.184,.130)*front;
  const lipU=clamp(a/.258,0,1);
  // The closed mouth line sits near y 6.72; colour the full upper lip above it as well as
  // the lower lip, so the line reads as the parting of two lips rather than a mark on skin.
  const lipMid=6.722-.027*lipU**2;
  const top=lipMid+.058*(1-lipU**1.4);
  const bottom=lipMid-.072*(1-lipU**1.83);
  const lip=(1-smoothstep(a,.203,.264))*smoothstep(y,bottom-.018,bottom+.018)*
    (1-smoothstep(y,top-.012,top+.018))*smoothstep(z,1.424,1.544);
  const cavity=.62*(1-smoothstep(z,1.35,1.57))*gaussian(a,y,.078,6.719,.262,.112);
  const flush=.10*cheek+.11*nose+.16*ears+.046*lids;
  const underEye=.096*lids;
  const mottle=.008*Math.sin(x*48+y*32)*Math.sin(y*39-z*82);
  const lashU=a-.31;
  const lash=Math.exp(-(((y-7.346+.38*lashU*lashU)/.015)**2))*(1-smoothstep(Math.abs(lashU),.115,.155))*smoothstep(z,1.30,1.40);
  const beard=role==="merchant" ? .24*gaussian(a,y,.149,6.45,.358,.32)*front : 0;
  const parting=Math.exp(-(((y-lipMid)/.013)**2))*(1-smoothstep(a,.19,.25))*smoothstep(z,1.42,1.52);
  const tone=1+mottle-.078*jaw-.071*brow-.66*cavity-beard-.42*lash-.22*parting;
  return [
    tone+flush+.032*lip,
    tone-.43*flush-.28*lip-underEye,
    tone-.66*flush-.27*lip-underEye*.67,
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

function speakingJaw(x,y,z,lip) {
  const below=lip==="lower" ? 1 : lip==="upper" ? 0 : 1-smoothstep(y,6.665,6.719);
  const front=smoothstep(z,.64,1.45);
  const jawLine=gaussian(Math.abs(x),y,.027,6.61,.418,.306);
  const rise=.010*gaussian(Math.abs(x),y,.082,6.791,.193,.061)*front;
  const corner=gaussian(Math.abs(x),y,0,6.702,.196,.121);
  const opening=.102*below*front*jawLine*(.28+.72*corner);
  return local(x*(1-.014*below*front),y-opening+rise,z-opening*.13);
}

function vowel(x,y,z,lip,rounded) {
  const a=Math.abs(x);
  const clench=1-smoothstep(y,6.646,6.729);
  const lower=lip==="lower" ? 1 : lip==="upper" ? 0 : clench;
  const lips=gaussian(a,y,.047,6.707,.285,.108)*smoothstep(z,1.32,1.50);
  const corner=gaussian(a,y,.208,6.707,.107,.113)*smoothstep(z,1.25,1.51);
  const jaw=gaussian(a,y,.008,6.58,.324,.208)*smoothstep(z,.95,1.48);
  const dx=rounded ? -x*(.18*lips+.12*corner) : x*(.24*corner+.07*lips);
  const dy=rounded ? -.052*lower*jaw+.013*(1-lower)*lips :
    -.026*lower*jaw+.029*corner+.006*(1-lower)*lips;
  return local(x+dx,y+dy,z+(rounded ? .097*lips-.013*corner : -.034*corner));
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
const sculptStrength={player:1,helper:.85,attendant:.8,shopper:.7,baker:.6,porter:.55,merchant:.45,
  resident0:.65,resident1:.4,resident2:.75,resident3:.5};
function sculptFace(source,role) {
  const k=sculptStrength[role]??.5;
  for(let i=0;i<source.length;i+=3) {
    const x=source[i],y=source[i+1],z=source[i+2];
    const a=Math.abs(x),sign=Math.sign(x)||1;
    const neck=smoothstep(y,6.02,6.30);
    const side=smoothstep(z,-.15,.65)*neck;
    const lower=smoothstep(7.02-y,0,.58);
    const taper=.17*k*lower*smoothstep(a,.10,.62)*side;
    const chin=gaussian(a,y,0,6.42,.21,.13)*smoothstep(z,1.08,1.40)*neck;
    const cheekbone=gaussian(a,y,.52,7.06,.15,.11)*smoothstep(z,.85,1.30);
    const hollow=gaussian(a,y,.49,6.80,.13,.10)*smoothstep(z,.75,1.25);
    const bridge=gaussian(a,y,0,7.11,.055,.16)*smoothstep(z,1.40,1.56);
    const wing=gaussian(a,y,.12,6.91,.075,.08)*smoothstep(z,1.28,1.50);
    const brow=gaussian(a,y,.30,7.44,.21,.05)*smoothstep(z,1.33,1.50);
    // Open the eye: stretch lids away from the eyeball centre, more vertically than across.
    const eye=Math.exp(-(((a-.308)/.19)**2+((y-7.284)/.13)**2))*smoothstep(z,1.15,1.30);
    const open=.24*k*eye;
    source[i]=x*(1-taper-.15*k*wing)+sign*k*(.015*cheekbone-.016*hollow)+sign*.05*open*(a-.308);
    source[i+1]=y-.030*k*chin+open*(y-7.284);
    source[i+2]=z+k*(.038*chin+.012*cheekbone+.032*bridge+.016*brow);
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
  const lipRegion=new Map();
  for(const [upper,lower] of headData.mouth) {
    const a=upper*3,b=lower*3;
    const x=.5*(source[a]+source[b]);
    const seam=.5*(source[a+1]+source[b+1]);
    const gap=0; // closed seam; the parting is painted in skinColour and opened by the speak morph
    const brink=.5*(source[a+2]+source[b+2]);
    source[a]=source[b]=x;
    source[a+1]=seam+gap;
    source[b+1]=seam-gap;
    source[a+2]=source[b+2]=brink;
    lipRegion.set(upper,"upper");
    lipRegion.set(lower,"lower");
  }
  const positions=[],colour=[],closed=[],talk=[],round=[],wide=[];
  for(let i=0;i<source.length;i+=3) {
    const x=source[i],y=source[i+1],z=source[i+2];
    positions.push(...local(x,y,z));
    colour.push(...skinColour(x,y,z,beard ? "merchant" : role));
    if(animated) {
      closed.push(...closedLid(x,y,z));
      const lip=lipRegion.get(i/3);
      talk.push(...speakingJaw(x,y,z,lip));
      round.push(...vowel(x,y,z,lip,true));
      wide.push(...vowel(x,y,z,lip,false));
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colour,3));
  geometry.computeVertexNormals();
  if(!animated) return {geometry,source};
  const morphPositions=[talk,closed,round,wide].map(target=>new THREE.Float32BufferAttribute(target,3));
  const deformed=new THREE.BufferGeometry();
  deformed.setIndex(geometry.index);
  geometry.morphAttributes.normal=morphPositions.map(target=>{
    deformed.setAttribute("position",target);
    deformed.computeVertexNormals();
    return deformed.attributes.normal.clone();
  });
  geometry.morphAttributes.position=morphPositions;
  return {geometry,source};
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
  return 6.91+.743*front+earClearance+temple+point+shape+(wrapped ? .035 : 0);
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
    const thickness=wrapped ? .0074+.00165*ribs : .0026+.00048*ribs;
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

function mouthInterior(head) {
  const cavity=attach(head,new THREE.SphereGeometry(1,22,16),
    new THREE.MeshStandardMaterial({color:0x37201c,roughness:.94}),"Recessed oral cavity");
  cavity.position.set(...local(0,6.644,1.361));
  cavity.scale.set(.033,.0178,.014);
  cavity.castShadow=false;
  const points=[],tints=[],faces=[];
  // A continuous dental arch with shallow grooves sits back from the lip seam.
  const sections=38;
  for(let i=0;i<=sections;i++) {
    const u=i/sections,t=2*u-1;
    const split=Math.pow(.5+.5*Math.cos(2*Math.PI*(u*7+.5)),11);
    const edge=6.680+.027*Math.abs(t)**1.6+.006*split;
    const arch=1.539-.123*t*t;
    const tone=.94-.15*split-.17*t*t;
    points.push(...local(.167*t,edge,arch),...local(.167*t,6.753,arch-.011));
    tints.push(tone,tone*.97,tone*.88,tone*.76,tone*.73,tone*.68);
    if(i) {
      const p=i*2;
      faces.push(p-2,p,p-1,p,p+1,p-1);
    }
  }
  const dentalArch=new THREE.BufferGeometry();
  dentalArch.setAttribute("position",new THREE.Float32BufferAttribute(points,3));
  dentalArch.setAttribute("color",new THREE.Float32BufferAttribute(tints,3));
  dentalArch.setIndex(faces);
  dentalArch.computeVertexNormals();
  const ivory=new THREE.MeshStandardMaterial({color:0xc6b795,roughness:.84,
    vertexColors:true,side:THREE.DoubleSide});
  const teeth=attach(head,dentalArch,ivory,"Upper incisors behind the lips");
  teeth.castShadow=false;
  return teeth;
}

export function buildAnatomicalHead(head,role,tone,style) {
  const animated=!style.static;
  const {geometry,source}=makeHeadGeometry(role,animated,style.beard);
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
  const teeth=mouthInterior(head);
  teeth.visible=false;
  const aim=new THREE.Vector2();
  const morph=skin.morphTargetInfluences;
  return {
    articulate(amount) {
      morph[0]=clamp(amount,0,1);
      morph[2]=morph[3]=0;
      teeth.visible=amount>.21;
    },
    speak(shape,dt) {
      morph[0]=damp(morph[0],shape?.[0]??0,34,dt);
      morph[2]=damp(morph[2],shape?.[1]??0,34,dt);
      morph[3]=damp(morph[3],shape?.[2]??0,34,dt);
      teeth.visible=morph[0]+.40*morph[2]+.40*morph[3]>.23;
    },
    blink(amount) { skin.morphTargetInfluences[1]=clamp(amount,0,1); },
    lookEyes(x,y,dt) {
      aim.x=damp(aim.x,.19*x,13,dt);
      aim.y=damp(aim.y,.16*y,13,dt);
      for(const eye of eyes) eye.rotation.set(aim.y,-aim.x,0,"YXZ");
    },
  };
}
