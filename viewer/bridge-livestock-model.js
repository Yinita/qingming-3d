import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const {lerp,smoothstep}=THREE.MathUtils;
const root=0, chest=1, head=2, tail=3, leftEar=4, rightEar=5, firstLeg=6;
const blueprints={
  horse:{
    coat:[0x96674a,0x795f4c,0xb6ab98,0x766859],points:[0x45312b,0x342923,0x635952,0x443733],
    muzzle:0x69544d,mane:0x43322a,
    trunk:[[-.61,1.08,.061,.12],[-.53,1.075,.181,.229],[-.40,1.06,.222,.298],[-.23,1.055,.261,.319],
      [-.04,1.037,.281,.300],[.18,1.034,.268,.267],[.37,1.064,.257,.252],[.52,1.075,.199,.218],[.63,1.079,.097,.143],[.66,1.08,.008,.026]],
    neck:[[0,1.065,-.353,.198,.224],[0,1.192,-.487,.174,.212],[0,1.342,-.565,.141,.181],
      [0,1.494,-.608,.102,.112],[0,1.587,-.697,.096,.081]],
    skull:[[0,1.565,-.601,.033,.052],[0,1.579,-.676,.097,.093],[0,1.542,-.769,.113,.106],
      [0,1.473,-.864,.088,.079],[0,1.380,-.975,.068,.062],[0,1.343,-1.027,.072,.058],[0,1.337,-1.059,.021,.034]],
    pivot:[0,1.473,-.578],eye:[.100,1.557,-.759],ear:[.057,1.648,-.660],
    muzzleAt:[.054,1.348,-1.034],sniff:[0,1.344,-1.055],jaw:[.066,1.299,-.998],earLength:.157,earTilt:.22,
    rear:[.165,1.115,.390],fore:[.151,1.126,-.425],hindFoot:[.168,.0,.399],frontFoot:[.159,.0,-.432],
    tail:[[0,1.185,.567,.080,.063],[0,1.043,.678,.065,.070],[0,.799,.731,.055,.078],
      [.013,.528,.721,.082,.053],[.043,.321,.650,.061,.040],[.059,.254,.625,.013,.016]],
    maneLine:[[1.255,-.321],[1.439,-.455],[1.604,-.538],[1.671,-.606],[1.666,-.724]],
  },
  donkey:{
    coat:[0x9b9385,0x84786a],points:[0x6b5d51,0x594d45],muzzle:0xb1a193,mane:0x574b40,
    trunk:[[-.57,.886,.047,.090],[-.49,.881,.156,.202],[-.33,.846,.197,.238],[-.16,.828,.234,.245],
      [.09,.805,.230,.233],[.30,.835,.200,.216],[.44,.850,.172,.186],[.56,.846,.092,.111],[.590,.846,.008,.019]],
    neck:[[0,.921,-.339,.174,.197],[0,1.037,-.447,.147,.154],[0,1.153,-.529,.110,.122],[0,1.239,-.586,.089,.079]],
    skull:[[0,1.257,-.554,.023,.048],[0,1.263,-.628,.098,.101],[0,1.216,-.726,.105,.091],
      [0,1.169,-.828,.073,.073],[0,1.098,-.917,.075,.064],[0,1.079,-.976,.068,.055],[0,1.070,-1.010,.021,.028]],
    pivot:[0,1.182,-.513],eye:[.095,1.236,-.698],ear:[.058,1.347,-.604],
    muzzleAt:[.053,1.090,-.975],sniff:[0,1.083,-1.009],jaw:[.061,1.026,-.943],earLength:.275,earTilt:.35,
    rear:[.142,.883,.355],fore:[.137,.921,-.343],hindFoot:[.148,0,.374],frontFoot:[.147,0,-.365],
    tail:[[0,.956,.513,.025,.022],[0,.805,.602,.017,.021],[.008,.611,.639,.014,.015],
      [.012,.467,.604,.033,.034],[.021,.362,.584,.046,.035],[.037,.331,.572,.018,.015]],
    maneLine:[[1.010,-.282],[1.152,-.380],[1.252,-.473],[1.350,-.571],[1.351,-.638]],
  },
  ox:{
    coat:[0x8c7863],points:[0x685748],muzzle:0x66594a,mane:0x574336,
    trunk:[[-.62,1.034,.065,.119],[-.541,1.026,.226,.283],[-.40,1.036,.280,.348],[-.18,1.018,.316,.355],
      [.04,.989,.328,.345],[.25,.993,.303,.309],[.43,1.022,.264,.275],[.57,1.030,.170,.211],[.65,1.037,.072,.123],[.68,1.037,.009,.024]],
    neck:[[0,1.013,-.403,.233,.272],[0,1.065,-.515,.204,.256],[0,1.155,-.639,.161,.210],[0,1.234,-.722,.136,.142]],
    skull:[[0,1.317,-.668,.038,.077],[0,1.334,-.742,.141,.126],[0,1.296,-.834,.137,.127],[0,1.228,-.941,.108,.105],
      [0,1.149,-1.016,.103,.077],[0,1.116,-1.064,.101,.071],[0,1.113,-1.092,.039,.036]],
    pivot:[0,1.221,-.615],eye:[.127,1.302,-.830],ear:[.126,1.358,-.733],
    muzzleAt:[.079,1.146,-1.063],sniff:[0,1.118,-1.089],jaw:[.085,1.061,-1.020],earLength:.170,earTilt:1.34,
    rear:[.178,1.041,.442],fore:[.171,1.059,-.391],hindFoot:[.189,0,.435],frontFoot:[.180,0,-.436],
    tail:[[0,1.166,.598,.027,.026],[0,.976,.685,.020,.021],[.015,.693,.710,.015,.014],
      [.029,.448,.684,.017,.018],[.049,.391,.657,.043,.033],[.056,.288,.606,.014,.014]],
  },
};

export const livestockKinds=new Set(Object.keys(blueprints));
const pigmentation=new THREE.Color();
const longitudinal=new THREE.Vector3(), lateral=new THREE.Vector3(), altitude=new THREE.Vector3();
const centre=new THREE.Vector3();

function limbRows(points,radii) {
  return points.map(([x,y,z],i)=>[x,y,z,...radii[i]]);
}

function sectionPath(rows) {
  const curve=new THREE.CatmullRomCurve3(rows.map(([x,y,z])=>new THREE.Vector3(x,y,z)),false,"catmullrom",.44);
  const sideways=rows.some(([x,y,z],i)=>i>0 &&
    Math.abs(x-rows[i-1][0])>.79*Math.hypot(x-rows[i-1][0],y-rows[i-1][1],z-rows[i-1][2]));
  const ref=new THREE.Vector3(sideways ? 0 : 1,0,sideways ? 1 : 0);
  const section={width:0,depth:0};
  return t=>{
    const ring=t*(rows.length-1),i=Math.min(Math.floor(ring),rows.length-2),f=ring-i;
    curve.getPoint(t,centre);
    curve.getTangent(t,longitudinal);
    lateral.copy(ref).addScaledVector(longitudinal,-ref.dot(longitudinal)).normalize();
    altitude.crossVectors(longitudinal,lateral);
    section.width=lerp(rows[i][3],rows[i+1][3],f);
    section.depth=lerp(rows[i][4],rows[i+1][4],f);
    return section;
  };
}

function edge(section,angle,offset=0) {
  return centre.clone().addScaledVector(lateral,Math.sin(angle)*(section.width+offset))
    .addScaledVector(altitude,Math.cos(angle)*(section.depth+offset));
}

// Each ring lies perpendicular to the anatomical centreline. Weights and
// pigment are interpolated on the same ring, including the UV seam.
function sweep(rows,radial,steps,paint,flex,fur=1) {
  const at=sectionPath(rows);
  const p=[],uv=[],color=[],nap=[],indices=[],weights=[],joints=[];
  const ringCount=(rows.length-1)*steps+1;
  const stride=radial+1;
  for(let ring=0;ring<ringCount;ring++) {
    const t=ring/(ringCount-1);
    const {width,depth}=at(t);
    const [a,b,mix]=flex(t,centre);
    for(let j=0;j<=radial;j++) {
      const theta=(j%radial)*Math.PI*2/radial,c=Math.cos(theta),s=Math.sin(theta);
      const x=centre.x+lateral.x*s*width+altitude.x*c*depth;
      const y=centre.y+lateral.y*s*width+altitude.y*c*depth;
      const z=centre.z+lateral.z*s*width+altitude.z*c*depth;
      p.push(x,y,z);
      uv.push(j/radial,t);
      color.push(...paint(x,y,z,t,theta).toArray());
      nap.push(fur);
      joints.push(a,b,0,0);weights.push(1-mix,mix,0,0);
      if(ring && j) {
        const k=ring*stride+j,h=k-stride;
        indices.push(h-1,k-1,h,h,k-1,k);
      }
    }
  }
  for(const t of [0,1]) {
    at(t);
    const cap=p.length/3,first=t===0 ? 0 : (ringCount-1)*stride;
    const [a,b,mix]=flex(t,centre);
    p.push(...centre.toArray());
    uv.push(.5,t);
    color.push(...paint(centre.x,centre.y,centre.z,t,0).toArray());
    nap.push(fur);
    joints.push(a,b,0,0);weights.push(1-mix,mix,0,0);
    for(let i=0;i<radial;i++) {
      if(t===0) indices.push(cap,first+i,first+i+1);
      else indices.push(cap,first+i+1,first+i);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute("color",new THREE.Float32BufferAttribute(color,3));
  g.setAttribute("nap",new THREE.Float32BufferAttribute(nap,1));
  g.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(joints,4));
  g.setAttribute("skinWeight",new THREE.Float32BufferAttribute(weights,4));
  g.computeVertexNormals();
  const normals=g.getAttribute("normal"), tip=new THREE.Vector3(), seam=new THREE.Vector3();
  for(let i=0;i<ringCount;i++) {
    const a=i*stride,b=a+radial;
    seam.fromBufferAttribute(normals,a).add(tip.fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,seam.x,seam.y,seam.z);
    normals.setXYZ(b,seam.x,seam.y,seam.z);
  }
  return g;
}

function fixed(bone) {return ()=>[bone,bone,0];}

function paintSurface() {
  const skin=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.84});
  skin.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>","#include <common>\nattribute float nap; varying float vNap; varying vec3 vCoat;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nvNap=nap; vCoat=position;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nvarying float vNap; varying vec3 vCoat;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec3 coat = vCoat*vec3(111.,251.,154.);
        float filament = coat.x*.91 + coat.y*.57 + sin(coat.z*.093)*2.5 + sin(coat.x*.14+coat.z*.19);
        float visibleStrand = 1.-smoothstep(.44,2.2,fwidth(filament));
        float sparse = smoothstep(-.43,.91,sin(coat.z*.41+sin(coat.y*.57)));
        float fiber = sin(filament)*sparse + .33*sin(filament*1.89-coat.z*.33);
        float brush = .019*cos(coat.y*.039+coat.z*.068) + .026*sin(coat.x*.079-coat.z*.12);
        diffuseColor.rgb *= 1.+max(vNap,0.)*(brush+.063*fiber*visibleStrand);
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor = mix(.42,.91,clamp(.47+.53*vNap,0.,1.));
      `);
  };
  skin.customProgramCacheKey=()=>"livestock-short-fur";
  return skin;
}

const skinMaterial=paintSurface();

function detail(g,colour,bone,nap) {
  const n=g.attributes.position.count,pigment=new THREE.Color(colour);
  const colors=new Float32Array(n*3);
  const indices=new Uint16Array(n*4),weights=new Float32Array(n*4);
  for(let i=0;i<n;i++) {
    pigment.toArray(colors,i*3);
    indices[i*4]=bone;weights[i*4]=1;
  }
  g.setAttribute("color",new THREE.BufferAttribute(colors,3));
  g.setAttribute("nap",new THREE.Float32BufferAttribute(new Float32Array(n).fill(nap),1));
  g.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(indices,4));
  g.setAttribute("skinWeight",new THREE.BufferAttribute(weights,4));
  return g;
}

function buildGeometry(kind,coating,lod) {
  const spec=blueprints[kind];
  const horse=kind==="horse",ox=kind==="ox";
  const parts=[], radial=lod ? 12 : 24, samples=lod ? 1 : 3;
  const segments=lod ? 8 : 14;
  const body=new THREE.Color(spec.coat[coating]), dark=new THREE.Color(spec.points[coating]);
  const snout=new THREE.Color(spec.muzzle), hair=new THREE.Color(spec.mane), amber=new THREE.Color(0xb5a28b);
  const groundColor=new THREE.Color(0x594435);
  function coat(x,y,z) {
    const ribs=.052*Math.cos(x*6.1+y*6+z*13)*Math.sin(z*13.7);
    const top=Math.exp(-((x/.103)**2))*smoothstep(y,.89,1.27);
    const stripe=kind==="donkey" ? top*.55 : top*.23;
    const belly=(1-smoothstep(y,.62,1.04))*.18;
    const dapple=horse && coating===2 ? Math.max(0,Math.sin(z*23+2*Math.cos(y*29))*Math.cos(y*31+x*14))**2*.18 : 0;
    return pigmentation.copy(body).lerp(dark,stripe).lerp(amber,belly+dapple).multiplyScalar(1.02+ribs);
  }
  function shape(rows,paint,flex,nap=1,density=radial,detailSteps=samples) {
    parts.push(sweep(rows,density,detailSteps,paint,flex,nap));
  }
  function lump(x,y,z,sx,sy,sz,mat,bone,nap,turn=0) {
    const g=new THREE.SphereGeometry(1,segments,lod ? 6 : 11).scale(sx,sy,sz).rotateY(turn).translate(x,y,z);
    parts.push(detail(g,mat,bone,nap));
  }
  function tube(rows,color,bone,count=radial,nap=.2) {
    const pigment=new THREE.Color(color);
    shape(rows,()=>pigment,fixed(bone),nap,count);
  }
  const maneEnd=spec.neck.length-1;
  const bodyRows=[...spec.neck.slice(1).reverse(),...spec.trunk.slice(2).map(([z,y,w,h])=>[0,y,z,w,h])];
  const bodyAt=sectionPath(bodyRows);
  function bodyWeight(t,p) {
    const row=t*(bodyRows.length-1);
    if(row<maneEnd) return [root,head,1-smoothstep(row,0,maneEnd)];
    return [root,chest,.78*smoothstep(row,maneEnd,maneEnd+.81)*smoothstep(p.y,.69,1.04)*Math.sin(t*Math.PI)**.74];
  }
  shape(bodyRows,coat,bodyWeight);
  shape(spec.skull,(x,y,z,t)=>{
    const pale=kind==="donkey" ? smoothstep(t,.53,.94) : smoothstep(t,.69,.98)*.74;
    const blaze=horse && coating===0 ? (1-smoothstep(Math.abs(x),.010,.032))*smoothstep(t,.19,.56)*(1-smoothstep(t,.80,1))*.79* smoothstep(y,1.395,1.552) : 0;
    return coat(x,y,z).lerp(snout,pale).lerp(amber,blaze);
  },fixed(head),.88);

  for(const s of [-1,1]) {
    const [ex,ey,ez]=spec.eye;
    lump(s*ex,ey,ez,.014,.026,.036,0x6a5748,head,.40,s*.13);
    lump(s*(ex+.008),ey+.001,ez-.002,.013,.016,.024,0x241c18,head,-.47,s*.21);
    lump(s*(ex+.017),ey+.008,ez-.009,.004,.004,.005,0xbdb4a2,head,-.4);
    const [nx,ny,nz]=spec.muzzleAt;
    lump(s*nx,ny,nz,.010,ox ? .014 : .012,.021,0x392c27,head,-.29,s*.32);
    const [jx,jy,jz]=spec.jaw;
    tube([[s*jx,jy+.006,jz-.035,.004,.003],[s*(jx-.001),jy,jz,.006,.004],
      [s*(jx+.006),jy+.014,jz+.057,.002,.002]],0x534238,head,8,.12);
    const [ax,ay,az]=spec.ear, earBone=s<0 ? leftEar : rightEar;
    const l=spec.earLength,dx=s*Math.sin(spec.earTilt)*l,dy=Math.cos(spec.earTilt)*l;
    tube([[s*ax,ay,az,.018,.016],[s*ax+dx*.33,ay+dy*.33,az+.009,.034,.022],
      [s*ax+dx*.63,ay+dy*.63,az+.010,.030,.020],[s*ax+dx,ay+dy,az+.014,.003,.004]],spec.coat[coating],earBone,12,.75);
    lump(s*ax+dx*.52,ay+dy*.53,az-.010,ox ? .043 : .019, ox ? .021 : l*.28,.011,0x685247,earBone,.33);
    if(ox) {
      shape([[s*.107,1.398,-.724,.040,.038],[s*.206,1.420,-.731,.038,.034],[s*.305,1.449,-.768,.025,.021],
        [s*.356,1.517,-.830,.014,.013],[s*.358,1.565,-.865,.002,.002]],
      (x,y,z,t)=>pigmentation.setHex(0xb7a582).lerp(groundColor,smoothstep(t,.63,1)),fixed(head),0,14);
    }
  }

  if(spec.maneLine) {
    const path=spec.maneLine.map(([y,z],i)=>[0,y,z,.013+.008*Math.sin(i*.87),.028+.017*Math.sin(i*.62)]);
    tube(path,spec.mane,head,12,.8);
    const ridge=new THREE.CatmullRomCurve3(path.map(([x,y,z])=>new THREE.Vector3(x,y,z)));
    const lock=new THREE.Vector3();
    for(let i=0;i<(lod ? 7 : 17);i++) {
      ridge.getPoint(i/(lod ? 8 : 18),lock);
      const curl=horse ? .127 : .068;
      const tip=horse ? .115 : .047;
      const side=coating%2===0 ? 1 : -1;
      shape([[0,lock.y+.015,lock.z,.012,.012],[side*curl*.51,lock.y-.041,lock.z+.012,.020,.016],
        [side*curl,lock.y-tip,lock.z+.035,.004,.006]],(_x,_y,_z,t)=>pigmentation.copy(hair)
        .multiplyScalar(.82+.23*Math.sin(i*.9)+t*.23),fixed(head),.95,7,1);
    }
  }
  shape(spec.tail,(x,y,z,t)=>pigmentation.copy(hair).multiplyScalar(.83+.17*Math.sin(x*42+z*31+y*11)+t*.15),
    fixed(tail),1,radial);

  const contacts=[];
  for(const s of [-1,1]) for(const front of [true,false]) {
    const [hx,hy,hz]=front ? spec.fore : spec.rear;
    const [fx,fy,fz]=front ? spec.frontFoot : spec.hindFoot;
    const step=horse ? .026 : .020;
    const bone=firstLeg+contacts.length;
    const kneeZ=front ? hz-.014 : hz-.093;
    const hockZ=front ? lerp(kneeZ,fz,.50)+.002 : fz+.080;
    const points=[[s*hx,hy,hz],[s*hx,hy*.84,kneeZ],[s*(hx*.79+fx*.21),hy*.66,kneeZ],
      [s*fx,hy*.54,hockZ],[s*fx,hy*.29,lerp(hockZ,fz,.67)],[s*fx,.145,fz+.022],[s*fx,.079,fz]];
    const breadth=ox ? 1.15 : 1;
    const radii=[[.081,.109],[front ? .097 : .118,front ? .106 : .136],[.068,.075],
      [.049,.058],[.033,.040],[.037,.045],[.045,.047]].map(v=>v.map(n=>n*breadth));
    shape(limbRows(points,radii),(x,y,z,t)=>coat(x,y,z).lerp(dark,smoothstep(t,.32,.87)*.77)
      .lerp(amber,horse && coating===0 && s<0 && front ? smoothstep(t,.65,.92)*.66 : 0),
      t=>[root,bone,smoothstep(t,.10,.83)],1,lod ? 9 : 18);
    const blocks=ox ? [-.026,.026] : [0];
    for(const gap of blocks) {
      const w=ox ? .023 : .050;
      const rows=[[s*fx+gap,.095,fz,w*.84,.041],[s*fx+gap,.068,fz-.009,w,.062],
        [s*fx+gap,.017,fz-.014,w*1.09,.065],[s*fx+gap,fy,fz-.012,w*.89,.057]];
      shape(rows,(_x,_y,_z,t)=>pigmentation.copy(dark).lerp(groundColor,.43+t*.17).multiplyScalar(.66+.16*Math.sin(t*Math.PI)),
        fixed(bone),-.15,12);
    }
    contacts.push(new THREE.Vector3(s*fx,0,fz-step));
  }
  const headAt=sectionPath(spec.skull);
  const bridle=ox ? 0x918067 : coating%2===0 ? 0x79573e : 0x554537;
  const noseBand=horse ? .775 : ox ? .862 : .806;
  const ringSteps=lod ? 16 : 30;
  const noseSection=headAt(noseBand);
  const halter=Array.from({length:ringSteps},(_,i)=>edge(noseSection,i/ringSteps*Math.PI*2,.009));
  function lace(points,closed,radius) {
    const curve=new THREE.CatmullRomCurve3(points,closed);
    parts.push(detail(new THREE.TubeGeometry(curve,points.length*2,radius,7,closed),bridle,head,.17));
  }
  lace(halter,true,ox ? .009 : .007);
  if(!ox) for(const side of [-1,1]) {
    const buckle=edge(headAt(noseBand),side*Math.PI*.52,.013);
    const straps=Array.from({length:8},(_,i)=>{
      const t=i/7;
      return edge(headAt(lerp(noseBand,.226,t)),side*Math.PI*lerp(.53,.44,t),.010);
    });
    lace(straps,false,.006);
    lump(buckle.x,buckle.y,buckle.z,.007,.014,.013,0xa9936a,head,-.35);
  }

  if((horse && coating!==1) || (kind==="donkey" && coating===1)) {
    const fabric=[0x596664,0x716f56,0x77796a,0x805e4b][coating];
    const edgeColor=new THREE.Color(0xa78a62);
    const cloth=new THREE.Color(fabric);
    const p=[],uv=[],colors=[],nap=[],indices=[],skinIndices=[],skinWeights=[];
    const rows=lod ? 5 : 13,columns=lod ? 12 : 27;
    for(let r=0;r<=rows;r++) {
      const v=r/rows;
      const t=lerp(.43,.77,v);
      const section=bodyAt(t);
      const [a,b,mix]=bodyWeight(t,centre);
      for(let i=0;i<=columns;i++) {
        const u=i/columns,angle=(2*u-1)*(1.46+.19*Math.sin(v*Math.PI));
        const border=Math.min(u,1-u,v,1-v);
        const folds=.004*Math.cos(v*17+u*6)*Math.sin(Math.PI*u)+.007*(1-smoothstep(border,0,.11));
        const clothPoint=edge(section,angle,.018+folds);
        p.push(...clothPoint.toArray());
        uv.push(u,v);
        const trim=(1-smoothstep(Math.abs(border-.046),.012,.029))*.62;
        colors.push(...pigmentation.copy(cloth).lerp(edgeColor,trim).multiplyScalar(.88+.14*Math.cos(angle)).toArray());
        nap.push(.64);
        skinIndices.push(a,b,0,0);skinWeights.push(1-mix,mix,0,0);
        if(r && i) {
          const d=r*(columns+1)+i,a=d-columns-1;
          indices.push(a-1,d-1,a,a,d-1,d);
        }
      }
    }
    const pad=new THREE.BufferGeometry();
    pad.setIndex(indices);
    pad.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
    pad.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
    pad.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
    pad.setAttribute("nap",new THREE.Float32BufferAttribute(nap,1));
    pad.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(skinIndices,4));
    pad.setAttribute("skinWeight",new THREE.Float32BufferAttribute(skinWeights,4));
    pad.computeVertexNormals();
    parts.push(pad);
  }
  const geometry=mergeGeometries(parts);
  parts.forEach(g=>g.dispose());
  geometry.computeBoundingSphere();
  return {geometry,contacts};
}

const templates=new Map();
function template(kind,coat,lod) {
  const id=kind+":"+coat+":"+Number(lod);
  if(!templates.has(id)) templates.set(id,buildGeometry(kind,coat,lod));
  return templates.get(id);
}

export function createLivestockRig(kind,variant) {
  const spec=blueprints[kind], coat=variant%spec.coat.length;
  const near=template(kind,coat,false), far=template(kind,coat,true);
  const mesh=new THREE.SkinnedMesh(near.geometry,skinMaterial);
  const bones=Array.from({length:10},()=>new THREE.Bone());
  mesh.add(bones[root]);
  const [a,b,c]=spec.pivot;
  bones[chest].position.set(0,kind==="donkey" ? .83 : 1.047,0);
  bones[head].position.set(a,b,c);
  bones[tail].position.set(...spec.tail[0].slice(0,3));
  for(const i of [chest,head,tail,6,7,8,9]) bones[root].add(bones[i]);
  for(const [i,s] of [[leftEar,-1],[rightEar,1]]) {
    const [x,y,z]=spec.ear;
    bones[i].position.set(s*x-a,y-b,z-c);
    bones[head].add(bones[i]);
  }
  mesh.bind(new THREE.Skeleton(bones));
  mesh.boundingSphere=near.geometry.boundingSphere.clone();
  mesh.boundingSphere.radius+=.27;
  mesh.castShadow=mesh.receiveShadow=true;
  return {
    mesh,bones:[bones[chest],bones[head],bones[tail],bones[leftEar],bones[rightEar]],
    hoofBones:bones.slice(firstLeg),contacts:near.contacts,sniff:new THREE.Vector3(...spec.sniff).sub(bones[head].position),
    setFar(distant){mesh.geometry=distant ? far.geometry : near.geometry;},
  };
}
