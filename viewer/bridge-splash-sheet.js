import * as THREE from "three";

const sectors = 88;
const levels = 12;
const stride = levels + 1;
const { lerp, smoothstep } = THREE.MathUtils;
const sheetVertices = (sectors+1)*stride;
const capacity = sheetVertices+sectors*levels*4;

export const splashProfiles = {
  stone: { life:.44, arc:Math.PI*2, lift:1.96, push:.84, span:.145, gauge:.014, jets:23, rim:27 },
  step:  { life:.35, arc:3.55, lift:1.73, push:.71, span:.113, gauge:.015, jets:12, rim:8 },
  boat:  { life:.33, arc:2.60, lift:1.57, push:.82, span:.119, gauge:.012, jets:9, rim:8 },
};

const fraction = value => value - Math.floor(value);

export function createSplashSheet(material) {
  const points=new THREE.BufferAttribute(new Float32Array(capacity*3),3);
  const normals=new THREE.BufferAttribute(new Float32Array(capacity*3),3);
  const gauge=new THREE.BufferAttribute(new Float32Array(capacity),1);
  const triangles=new THREE.BufferAttribute(new Uint16Array(sectors*levels*12),1);
  for (const attr of [points,normals,gauge,triangles]) attr.setUsage(THREE.DynamicDrawUsage);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",points);
  geometry.setAttribute("normal",normals);
  geometry.setAttribute("filmGauge",gauge);
  geometry.setIndex(triangles);
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name="Curling canal splash sheet";
  mesh.frustumCulled=false;
  mesh.visible=false;
  mesh.renderOrder=4;
  const ring=Array.from({length:sectors+1},()=>({dx:0,dz:0,fibre:0,crest:0,thin:0}));
  const before=new THREE.Vector3(), after=new THREE.Vector3(), point=new THREE.Vector3();
  const across=new THREE.Vector3(), vertical=new THREE.Vector3(), normal=new THREE.Vector3();
  const mask=new Float32Array(sheetVertices), polygon=[];
  let holes=[], vertices=0, indices=0;
  let impact=null, profile=null, released=0, missing=0, folded=0, height=0;

  function begin(event) {
    impact=event;
    profile=splashProfiles[event.kind];
    released=0;
    const heading=Math.atan2(event.vz,event.vx);
    for(let i=0;i<=sectors;i++) {
      const at=i/sectors, angle=heading+(at-.5)*profile.arc;
      const fibre=(event.kind==="stone" ? 1 : Math.pow(Math.sin(Math.PI*at),.64));
      const ray=ring[i];
      ray.dx=Math.cos(angle);
      ray.dz=Math.sin(angle);
      ray.fibre=fibre;
      ray.crest=.80+.14*Math.sin(angle*5.+event.time*1.9)+.15*Math.sin(angle*9.-.96);
      ray.thin=.51+.28*Math.sin(angle*13.+1.19)+.17*Math.sin(angle*7.-event.time*1.63);
    }
    const count=event.kind==="stone" ? 7 : 4;
    holes=Array.from({length:count},(_,i)=>({
      at:(i+.48)/count+.027*Math.sin(i*9.13+event.time),
      elevation:.73+.09*Math.sin(i*2.65+event.time*.65),
      width:.018+.022*fraction(i*.7954+.51),
      height:.111+.079*fraction(i*.3819+.41),
    }));
  }

  function brokenEdge(ray, age) {
    const cut=smoothstep(age,.075,.28);
    const thin=smoothstep(ray.thin,.21,.81);
    return 1-cut*(.046+.545*thin);
  }

  function shape(ray,u,age) {
    const force=impact.strength;
    const life=smoothstep(age,0,.047)*(1-smoothstep(age,profile.life*.58,profile.life));
    const roll=smoothstep(age,.041,.181)*(1-smoothstep(age,profile.life*.74,profile.life))*ray.fibre;
    const lip=smoothstep(u,.66,1);
    const loft=Math.max(0,profile.lift*force*age-3.83*age*age)*ray.crest*ray.fibre;
    const foot=.042+age*profile.push*(.69+.44*force);
    const width=profile.span*life*(.55+.46*force)*(.78+.27*ray.crest);
    const ripple=Math.sin(ray.dx*17.+ray.dz*21.-age*18.+u*12.)*.011*u*life;
    const radius=foot+width*(u-.15-.96*roll*lip+ripple);
    const lift=loft*(u+.15*roll*Math.sin(Math.PI*u)-.34*roll*lip+ripple);
    return {radius,lift,foot};
  }

  function worldPoint(ray,u,age,surface,target) {
    const {radius,lift,foot}=shape(ray,u,age);
    const x=impact.x+ray.dx*radius+age*impact.vx*.10;
    const z=impact.z+ray.dz*radius+age*impact.vz*.10;
    const footX=impact.x+ray.dx*foot+age*impact.vx*.1;
    const footZ=impact.z+ray.dz*foot+age*impact.vz*.1;
    const base=surface(footX,footZ,impact.time+age);
    return target.set(x,base+lift-.0035,z);
  }

  function detach(age, surface, emit) {
    while(released<profile.rim) {
      const index=released;
      const birth=.063+.132*(index/profile.rim);
      if(age<birth) break;
      released++;
      const ray=ring[1+(index*17+5)%(sectors-1)];
      const u=brokenEdge(ray,birth);
      worldPoint(ray,u,birth,surface,point);
      worldPoint(ray,u,birth-.004,surface,before);
      worldPoint(ray,u,birth+.004,surface,after);
      const random=fraction(index*.61803399+impact.time*.463);
      const radius=(.0031+.0067*random)*(.64+.46*impact.strength);
      const scatter=.21+.83*random;
      emit(impact.time+birth,point.x,point.y+.003,point.z,
        (after.x-before.x)/.008+ray.dx*scatter,
        Math.max(.23,(after.y-before.y)/.008*.68)+.27+.61*random,
        (after.z-before.z)/.008+ray.dz*scatter,radius,true);
    }
  }

  function opening(at,u,growth) {
    let remaining=1;
    if(growth<=.001) return remaining;
    for(const hole of holes) {
      const x=(at-hole.at)/hole.width;
      const y=(u-hole.elevation)/hole.height;
      remaining=Math.min(remaining,x*x+y*y-growth*growth);
    }
    return remaining;
  }

  function edgePoint(a,b) {
    const t=mask[a]/(mask[a]-mask[b]);
    const i=vertices++;
    points.setXYZ(i,lerp(points.getX(a),points.getX(b),t),lerp(points.getY(a),points.getY(b),t),
      lerp(points.getZ(a),points.getZ(b),t));
    normals.setXYZ(i,lerp(normals.getX(a),normals.getX(b),t),lerp(normals.getY(a),normals.getY(b),t),
      lerp(normals.getZ(a),normals.getZ(b),t));
    gauge.setX(i,lerp(gauge.getX(a),gauge.getX(b),t));
    return i;
  }

  function triangle(a,b,c) {
    const insideA=mask[a]>=0, insideB=mask[b]>=0, insideC=mask[c]>=0;
    const dst=triangles.array;
    if(insideA && insideB && insideC) {
      dst[indices++]=a; dst[indices++]=b; dst[indices++]=c;
      return;
    }
    missing++;
    if(!insideA && !insideB && !insideC) return;
    polygon.length=0;
    if(insideA) polygon.push(a);
    if(insideA!==insideB) polygon.push(edgePoint(a,b));
    if(insideB) polygon.push(b);
    if(insideB!==insideC) polygon.push(edgePoint(b,c));
    if(insideC) polygon.push(c);
    if(insideC!==insideA) polygon.push(edgePoint(c,a));
    for(let i=1;i<polygon.length-1;i++) {
      dst[indices++]=polygon[0]; dst[indices++]=polygon[i]; dst[indices++]=polygon[i+1];
    }
  }

  function updateRange(buffer,length) {
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0,length);
    buffer.needsUpdate=true;
  }

  function frame(time,surface,emit) {
    if(!impact) return;
    const age=time-impact.time;
    mesh.visible=age>=0 && age<profile.life;
    if(!mesh.visible) return;
    missing=folded=height=0;
    indices=0;
    vertices=sheetVertices;
    const growth=smoothstep(age,.078,.257);
    const closed=impact.kind==="stone";
    for(let i=0;i<=sectors;i++) {
      const ray=ring[i];
      const edge=brokenEdge(ray,age);
      const foot=shape(ray,0,age).foot;
      const travelX=impact.x+age*impact.vx*.10, travelZ=impact.z+age*impact.vz*.10;
      const base=surface(travelX+foot*ray.dx,travelZ+foot*ray.dz,time);
      let prior=0, folds=false;
      for(let row=0;row<=levels;row++) {
        const portion=row/levels, u=portion*edge;
        const k=i*stride+row;
        const {radius,lift}=shape(ray,u,age);
        points.setXYZ(k,travelX+ray.dx*radius,base+lift-.0035,travelZ+ray.dz*radius);
        const rim=smoothstep(portion,.76,1);
        gauge.setX(k,profile.gauge*(.31+.49*rim+.29*(1-u))*(.63+.37*ray.crest)*
          (1-smoothstep(age,profile.life*.75,profile.life)*.75));
        mask[k]=opening(i/sectors,portion,growth);
        height=Math.max(height,lift);
        if(row>0 && radius<prior-.0004) folds=true;
        prior=radius;
      }
      if(folds) folded++;
    }
    for(let i=0;i<=sectors;i++) {
      const left=(i>0 ? i-1 : closed ? sectors-1 : 0)*stride;
      const right=(i<sectors ? i+1 : closed ? 1 : sectors)*stride;
      for(let row=0;row<=levels;row++) {
        const k=i*stride+row;
        const lower=row>0 ? k-1 : k, higher=row<levels ? k+1 : k;
        across.fromBufferAttribute(points,right+row).sub(before.fromBufferAttribute(points,left+row));
        vertical.fromBufferAttribute(points,higher).sub(after.fromBufferAttribute(points,lower));
        normal.crossVectors(vertical,across).normalize();
        normals.setXYZ(k,normal.x,normal.y,normal.z);
      }
    }
    for(let i=0;i<sectors;i++) {
      for(let row=0;row<levels;row++) {
        const k=i*stride+row;
        triangle(k,k+1,k+stride);
        triangle(k+1,k+stride+1,k+stride);
      }
    }
    updateRange(triangles,indices);
    updateRange(points,vertices*3);
    updateRange(normals,vertices*3);
    updateRange(gauge,vertices);
    geometry.setDrawRange(0,indices);
    detach(age,surface,emit);
  }

  return {mesh,begin,frame, inspect:()=>({kind:impact?.kind,missing,folded,height,released})};
}
