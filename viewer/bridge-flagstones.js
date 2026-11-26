import * as THREE from "three";

const {lerp}=THREE.MathUtils;
const blues=[0x8e978f,0xa4aca0,0x7e8e8b,0xa6a591,0x999988,0x888e89];
const greys=[0x9e9d8c,0xb3ad97,0x829088,0x96998c,0xa5a48f];
const sand=new THREE.Color(0x998674);

export function buildFlagstoneApron(parent,surface,terrain,register,spec) {
  const {name,x,z,width,depth,level,rise=.033}=spec;
  const raised=level!==undefined;
  const detail=typeof location!=="undefined" && new URLSearchParams(location.search).get("quality")==="4k";
  const stone=surface("sandstone-approach",0xffffff,.88,.96,detail ? "sandstone-flagstone-4k" : null);
  stone.vertexColors=true;
  const mortar=surface("packed-earth",0xa99983,.66,.99);
  mortar.vertexColors=true;
  const blocks={p:[],uv:[],rgb:[],indices:[]}, fill={p:[],uv:[],rgb:[],indices:[]};
  let seed=spec.seed;
  const random=()=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  };
  const seamHeight=(x,z)=>raised ? Math.max(level-.024,terrain(x,z)+.002) : terrain(x,z)+.004;
  const tint=new THREE.Color();

  function put(mesh,x,y,z,u,v,tone,shade,dust=0) {
    mesh.p.push(x,y,z);
    mesh.uv.push(u,v);
    mesh.rgb.push(lerp(tone.r,sand.r,dust)*shade,lerp(tone.g,sand.g,dust)*shade,lerp(tone.b,sand.b,dust)*shade);
    return mesh.p.length/3-1;
  }
  function face(mesh,a,b,c,support=false) {
    mesh.indices.push(a,b,c);
    if(support) register(mesh.p,a*3,b*3,c*3);
  }
  function finish(mesh,material,name) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(mesh.p,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(mesh.uv,2));
    geometry.setAttribute("color",new THREE.Float32BufferAttribute(mesh.rgb,3));
    geometry.setIndex(mesh.indices);
    geometry.computeVertexNormals();
    const object=new THREE.Mesh(geometry,material);
    object.name=name;
    object.castShadow=object.receiveShadow=true;
    parent.add(object);
  }

  // The mortar bed is a real lower surface visible between slabs and at the worn front edge.
  const cols=Math.ceil(width/.18), rows=Math.ceil(depth/.17);
  tint.setHex(0x948978);
  for(let row=0;row<=rows;row++) for(let col=0;col<=cols;col++) {
    const px=x+width*(col/cols-.5),pz=z+depth*(row/rows-.5), y=seamHeight(px,pz);
    put(fill,px,y,pz,px*.55,pz*.55,tint,.78+.14*random(),.37);
    if(row && col) {
      const d=row*(cols+1)+col,a=d-cols-2;
      face(fill,a,d-1,a+1,true);
      face(fill,d-1,d,a+1,true);
    }
  }
  if(raised) {
    const rim=[];
    for(let col=0;col<=cols;col++) rim.push([x+width*(col/cols-.5),z-depth*.5]);
    for(let row=1;row<=rows;row++) rim.push([x+width*.5,z+depth*(row/rows-.5)]);
    for(let col=cols-1;col>=0;col--) rim.push([x+width*(col/cols-.5),z+depth*.5]);
    for(let row=rows-1;row>=1;row--) rim.push([x-width*.5,z+depth*(row/rows-.5)]);
    const side=rim.map(([px,pz])=>{
      const y=seamHeight(px,pz), base=Math.min(y-.042,terrain(px,pz)-.025);
      const u=(Math.abs(px-x)>.499*width ? pz : px)*.57;
      return [put(fill,px,base,pz,u,base,tint,.55,.47),
        put(fill,px,y-.001,pz,u,y,tint,.80,.31)];
    });
    for(let i=0;i<side.length;i++) {
      const [a,b]=side[i],[c,d]=side[(i+1)%side.length];
      face(fill,a,b,c);
      face(fill,c,b,d);
    }
  }
  finish(fill,mortar,"Pointed flagstone bedding");

  function block(px,pz,w,d,bump,outer=false,small=false) {
    const basePigments=raised ? blues : greys;
    tint.setHex(basePigments[Math.floor(random()*basePigments.length)]);
    const lat=(random()-.5)*.018,lng=(random()-.5)*.022;
    const cut=[0,0,0,0].map(()=>.035+.17*random());
    const [a,b,c,dip]=cut;
    const rim=[[-.5+a,-.5],[.5-b,-.5],[.5,-.5+b],[.5,.5-c],
      [.5-c,.5],[-.5+dip,.5],[-.5,.5-dip],[-.5,-.5+a]].map(([u,v],i)=>
      [u*w,v*d,.24+random()*.76,(i%2===0 ? .5 : 1)]);
    const grain=random()*Math.PI*2, cos=Math.cos(grain)*1.16,sin=Math.sin(grain)*1.16;
    const u0=10*random(),v0=10*random();
    const base=blocks.p.length/3,n=rim.length;
    function stoneHeight(px,pz,u,v) {
      const bedding=seamHeight(px,pz);
      return bedding+bump+lat*u+lng*v;
    }
    for(let ring=0;ring<3;ring++) for(const [u,v,cut,edge] of rim) {
      const inset=ring===2 ? 1-Math.min(.16,(.010+.014*cut)/Math.max(.06,Math.min(w,d))) : 1;
      const dx=u*inset,dz=v*inset,x=px+dx,z=pz+dz;
      const top=stoneHeight(x,z,u/w,v/d);
      const y=ring===0 ? seamHeight(x,z)-.019 : top-(ring===1 ? .008+cut*.009 : cut*.002);
      const shade=ring===0 ? .53 : ring===1 ? .72+.13*cut : .88+.10*edge;
      const dust=ring===0 ? .42 : ring===1 ? .18+.15*cut : (outer ? .12 : .035)+.071*cut;
      put(blocks,x,y,z,u0+dx*cos+dz*sin,v0+dz*cos-dx*sin+(ring===2 ? 0 : y-top),tint,shade,dust);
    }
    const centre=put(blocks,px,stoneHeight(px,pz,0,0)+.003,pz,u0,v0,tint,1.01+.12*random(),.025);
    for(let i=0;i<n;i++) {
      const j=(i+1)%n,a=base+i,b=base+j,c=a+n,d=b+n,e=c+n,f=d+n;
      face(blocks,a,c,b);
      face(blocks,b,c,d);
      face(blocks,c,e,d,!small);
      face(blocks,d,e,f,!small);
      face(blocks,centre,f,e,!small);
    }
  }

  const courses=Math.max(2,Math.round(depth/.46));
  let previous=-depth*.5;
  for(let row=0;row<courses;row++) {
    const last=row===courses-1;
    const next=last ? depth*.5 : -depth*.5+(row+1)*depth/courses+(random()-.5)*.08;
    const count=Math.max(3,Math.round(width/.59)+(row%2));
    let left=-width*.5;
    for(let i=0;i<count;i++) {
      const right=i+1===count ? width*.5 : -width*.5+(i+1)*width/count+(random()-.5)*.16;
      const along=(left+right)*.5+(random()-.5)*.010;
      const across=(next+previous)*.5+(random()-.5)*.010;
      const edge=last || row===0 || i===0 || i+1===count;
      const height=(raised ? .024 : rise)+(random()-.5)*.014;
      block(x+along,z+across,right-left-.014,next-previous-.014,height,edge);
      left=right;
    }
    previous=next;
  }
  if(!raised) for(let i=0;i<width*17;i++) {
    const u=(random()-.5)*width*1.07;
    const v=(depth*.5+.029+.122*random()**1.8)*(random()<.5 ? -1 : 1);
    const grit=.019+.078*random()**2;
    block(x+u,z+v,grit,grit*(.65+.34*random()),.010+.009*random(),true,true);
  }
  finish(blocks,stone,name);
}
