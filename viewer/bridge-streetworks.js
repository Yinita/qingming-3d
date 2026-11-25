import * as THREE from "three";

const {clamp,lerp,smoothstep}=THREE.MathUtils;

// Frontage coordinates use the same metre grid as the fitted houses. The
// pavement stops at the stone plinths, leaving the earthen lane uninterrupted.
export const pavedAprons=[
  {name:"Workshop stone approach",x:-71.73,z:-48.67,w:4.84,d:2.13,front:.087,outer:.022,seed:2451,cut:-47.88},
  {name:"Central courtyard paving",x:-23.42,z:-43.65,w:4.87,d:3.46,front:.120,outer:.028,seed:4425,cut:-42.38},
  {name:"Clerestory hall forecourt",x:4.853,z:-23.32,w:9.38,d:2.04,front:.095,outer:.019,seed:8417,cut:-22.44},
  {name:"Market shopfront stone walk",x:26.35,z:-42.41,w:9.40,d:1.93,front:.081,outer:.024,seed:9262,cut:-41.55},
  {name:"Freight lane stone repairs",x:-44.24,z:-35.48,w:2.20,d:1.75,front:.014,outer:.015,seed:2216,repair:true},
];

const wheelRoads=[
  {x:-43.07,z:-35.65,run:2.80,angle:.019,phase:.77},
  {x:-43.11,z:-33.62,run:2.73,angle:.012,phase:2.31},
];

const drainWidth=.43;
const drainBanks=.101;
const stance=new THREE.Color();
const palettes={
  edges:[0x7c8274,0x839487,0x8c8e80,0x8b8067,0x707974],
  slabs:[0xa3a79a,0xb5b2a1,0x949f95,0xada28d,0x8c9a95,0xb9b4a4,0x9e9d8d],
};
const loam=new THREE.Color(0x9e886d);
const dampstone=new THREE.Color(0x626c64);

function cross(a,x) {
  return a.cut+.027*Math.sin(x*1.39+a.seed)+.019*Math.cos(x*1.94-a.seed);
}

export function streetworksRelief(x,z) {
  let height=0;
  for(const road of wheelRoads) {
    const u=x-road.x;
    if(Math.abs(u)>road.run) continue;
    const v=z-road.z-u*road.angle-.040*Math.sin(u*1.04+road.phase);
    const lateral=Math.abs(v);
    if(lateral>1.22) continue;
    const fade=(1-smoothstep(Math.abs(u),road.run*.55,road.run))*
      (1-smoothstep(lateral,.86,1.22));
    const depression=Math.abs(lateral-.647);
    const rut=(1-smoothstep(depression,.057,.20))*(.032+.008*Math.sin(u*1.3+road.phase));
    const centre=.010*(1-smoothstep(lateral,.26,.63));
    const rolled=.044+.006*Math.sin(u*2.2-v);
    height+=fade*(rolled+centre-rut);
  }
  for(const a of pavedAprons) {
    if(a.repair || Math.abs(x-a.x)>a.w*.5+.42 || Math.abs(z-a.z)>a.d*.5+.50) continue;
    const v=Math.abs(z-cross(a,x));
    const across=1-smoothstep(Math.abs(x-a.x),a.w*.5-.07,a.w*.5+.42);
    const apron=smoothstep(z,a.z-a.d*.5-.34,a.z-a.d*.5+.32)*
      (1-smoothstep(z,a.cut+.14,a.cut+.48));
    const berm=(1-smoothstep(v,.20,.46))*.046;
    const dip=.060*(1-smoothstep(v,.051,.204));
    height+=across*Math.max(0,.038*apron+berm-dip);
  }
  return height;
}

function seeded(seed) {
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return seed/4294967296;
  };
}

function meshData() {
  return {p:[],uv:[],colors:[],indices:[]};
}

function createMesh(data,mat,name) {
  const {p,uv,colors,indices}=data;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,mat);
  mesh.name=name;
  mesh.receiveShadow=true;
  return mesh;
}

function profile(a,x,z,floor) {
  const inward=clamp((a.z+a.d*.5-z)/a.d,0,1);
  const edge=Math.min(a.w*.5-Math.abs(x-a.x),a.d*.5-Math.abs(z-a.z));
  const grade=lerp(a.outer,a.front,smoothstep(inward,.0,1));
  const toe=lerp(.72,1,smoothstep(edge,.04,.35));
  return floor(x,z)+grade*toe+.004*Math.sin(x*.87+z*1.39);
}

function slab(data,random,box,support,shade,register,{cut=false,chip=false}={}) {
  const {x,z,w,d}=box;
  const {p,uv,colors,indices}=data;
  const tone=(cut ? palettes.edges : palettes.slabs);
  stance.setHex(tone[Math.floor(random()*tone.length)]);
  const base=p.length/3;
  const a=.07+.19*random(),b=.04+.19*random(),c=.04+.22*random(),e=.07+.19*random();
  const facets=[[-.5+a,-.5],[.5-b,-.5],[.5,-.5+b],[.5,.5-c],
    [.5-c,.5],[-.5+e,.5],[-.5,.5-e],[-.5,-.5+a]];
  const variation=.011+.012*random();
  const ox=random(),oz=random(),az=random()*Math.PI,cx=Math.cos(az),sz=Math.sin(az);
  const dust=lerp(.10,.31,random());
  const weather=stance.clone().lerp(cut ? dampstone : loam,dust);
  function vertex(px,pz,lift,tone,frac=0) {
    p.push(px,support(px,pz)+lift,pz);
    uv.push(ox+((px-x)*cx+(pz-z)*sz)/.88,oz+((pz-z)*cx-(px-x)*sz)/.88);
    const tint=stance.clone().lerp(weather,frac).multiplyScalar(tone*shade);
    colors.push(tint.r,tint.g,tint.b);
  }
  for(const layer of [0,1,2]) for(const [u,v] of facets) {
    const factor=layer===2 ? .885+random()*.055 : 1;
    const px=x+w*u*factor,pz=z+d*v*factor;
    const lip=layer===0 ? -.071 : layer===1 ? -.025 : -.004-random()*.005;
    vertex(px,pz,lip+variation*(u*.62-v*.78),layer===0 ? .52 : layer===1 ? .68 : .98,layer<2 ? .96 : .5);
  }
  const centre=p.length/3;
  vertex(x+(random()-.5)*w*.27,z+(random()-.5)*d*.26,.004,1.02+random()*.07,.21);
  function triangle(a,b,c) {
    indices.push(a,b,c);
    if(!chip) register(p,a*3,b*3,c*3);
  }
  for(let i=0;i<8;i++) {
    const j=(i+1)%8, a=base+i,b=base+j;
    triangle(a,a+8,b);
    triangle(b,a+8,b+8);
    triangle(a+8,a+16,b+8);
    triangle(b+8,a+16,b+16);
    triangle(centre,b+16,a+16);
  }
}

function draining(data,random,a,height,register) {
  const start=a.x-a.w*.5, stop=a.x+a.w*.5;
  const supply=(x,z)=>height(x,z)+.015+.014*clamp((x-start)/a.w,0,1);
  const pathAt=(x,v)=>cross(a,x)+v;
  for(let x=start;x<stop-.03;) {
    const width=Math.min(.35+random()*.20,stop-x);
    const cx=x+width*.5,cz=pathAt(cx,0);
    slab(data,random,{x:cx,z:cz,w:width-.010,d:drainWidth*.65},supply,.80,register,{cut:true});
    for(const side of [-1,1]) {
      const bank=supply(cx,cz)+.058;
      const at=pathAt(cx,side*drainWidth*.47);
      slab(data,random,{x:cx,z:at,w:width-.015,d:drainBanks},()=>bank,.91,register,{cut:true});
    }
    x+=width;
  }
  // Broad removable stones carry the footway over the low channel.
  const walkCrossings=a.name.startsWith("Clerestory") ? [-a.w*.31,a.w*.31] : [0];
  for(const offset of walkCrossings) {
    const x=a.x+offset,z=pathAt(x,0);
    const top=supply(x,z)+.064;
    slab(data,random,{x,z,w:1.05,d:drainWidth+.155},()=>top,1.08,register);
  }
}

export function buildStreetworks(root,surface,height,register) {
  const group=new THREE.Group();
  group.name="Street stonework at the reconstructed frontages";
  root.add(group);
  const stone=surface("worn-stone",0xfff2dd,1.24,.94);
  stone.vertexColors=true;
  let slabs=0;
  for(const a of pavedAprons) {
    const data=meshData();
    const random=seeded(a.seed);
    const support=(x,z)=>profile(a,x,z,height);
    const widthMin=a.repair ? .36 : .47;
    const lengthMin=a.repair ? .31 : .43;
    const z0=a.z-a.d*.5;
    const z1=a.repair ? a.z+a.d*.5 : Math.min(a.z+a.d*.5,a.cut-.25);
    for(let front=z0,row=0;front<z1-.098;row++) {
      const left=a.x-a.w*.5+.046*Math.sin(row*1.76);
      const right=a.x+a.w*.5+.064*Math.cos(row*1.57);
      const depth=Math.min(lengthMin+random()*.23,z1-front);
      for(let x=left;x<right-.14;){
        const width=Math.min(widthMin+random()*.24,right-x);
        const cx=x+width*.5,cz=front+depth*.5;
        if(!a.repair || (Math.abs(cx-a.x)*.54+Math.abs(cz-a.z)<1.15+random()*.27)) {
          slab(data,random,{x:cx,z:cz,w:width-.016,d:depth-.017},support,.97+random()*.06,register);
          slabs++;
        }
        x+=width;
      }
      front+=depth;
    }
    if(!a.repair) draining(data,random,a,height,register);
    for(let j=0;j<(a.repair ? 38 : 58);j++) {
      const side=random()<.5 ? -1 : 1;
      const x=a.x+side*(a.w*.5+.05+random()**2*.30);
      const z=lerp(a.z-a.d*.5,a.z+a.d*.5,random());
      const size=.018+.088*random()**2;
      slab(data,random,{x,z,w:size,d:size*(.72+random()*.52)},
        (x,z)=>height(x,z)+size*.20,.81,register,{chip:true});
    }
    group.add(createMesh(data,stone,a.name));
  }
  return {slabs,frontages:pavedAprons.length,channels:pavedAprons.filter(a=>!a.repair).length};
}
