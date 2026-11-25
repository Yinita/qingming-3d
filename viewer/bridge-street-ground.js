import * as THREE from "three";
import { buildStreetworks,pavedAprons,streetworksRelief } from "./bridge-streetworks.js";
import { canalDepth, waterHeight } from "./bridge-canal-bed.js";

// Shallow stonework set into the dirt at the market and bridge approaches.
const lanes=[
  {x:25.18,z:-25.65,angle:.06,length:19.0,width:5.25,seed:245,market:true},
  {x:30.0,z:-28.5,angle:1.44,length:7.8,width:1.46,seed:703},
  {x:-71.8,z:-44.23,angle:1.53,length:7.2,width:1.13,seed:134},
  {x:-42.86,z:-39.12,angle:1.61,length:8.55,width:1.36,seed:428},
];

const ferryLanes=[
  {x:-68.30,z:-49.46,length:2.01,width:1.01,angle:.004,seed:4033},
  {x:-44.23,z:-50.57,length:8.79,width:1.33,angle:Math.PI/2,seed:5457},
  {x:-40.19,z:-46.57,length:8.03,width:1.33,angle:.017,seed:8943},
].map(lane=>({...lane,ferry:true}));

// Shared by the terrain, slabs and foot placement. Strength fades before each
// patch reaches the canal or the undecorated outskirts of the scroll.
const streets=[
  {x:25.8,z:-26.3,length:15.2,width:5.6,axis:"z",angle:.079},
  {x:-71.8,z:-41.42,length:6.4,width:5.7,axis:"x",angle:.035},
  {x:-43.1,z:-41.42,length:7.1,width:5.1,axis:"x",angle:-.09},
];
const {smoothstep}=THREE.MathUtils;
const marketStreet=lanes.find(lane=>lane.market);
const drainSide=(side,along)=>side*(2.78+.11*Math.sin(along*.82)+.14*Math.cos(along*.37));

export function streetSurfaceHeight(x,z) {
  let height=0;
  for(const street of streets) {
    const dx=x-street.x, dz=z-street.z;
    const along=street.axis==="z" ? dz : dx;
    const side=(street.axis==="z" ? dx : dz)-along*street.angle-.16*Math.sin(along*.61);
    if(Math.abs(along)>=street.length || Math.abs(side)>=street.width) continue;
    const cross=Math.abs(side);
    const fade=(1-smoothstep(Math.abs(along),street.length*.63,street.length))*
      (1-smoothstep(cross,street.width*.65,street.width));
    const rut=Math.abs(cross-(.83+.085*Math.sin(along*.56)));
    const crown=.016*(1-smoothstep(cross,.21,1.2));
    const erosion=.014*Math.sin(along*1.4+side*.58)+.007*Math.cos(along*3.1+side*1.2);
    const wash=.016*smoothstep(cross,1.48,3.65)*Math.sin(along*.81+side*1.79);
    const shoulder=(.034+erosion)*smoothstep(cross,1.05,2.33);
    const wheelWear=.66+.34*Math.sin(along*.52+1.2)*Math.cos(along*1.1);
    const rutBank=(.009+.016*wheelWear)*Math.exp(-(((rut-.205)/.153)**2));
    const grit=.008*Math.sin(x*3.7+z*1.1)*Math.sin(z*4.2+x*.87)+
      .006*Math.sin(z*2.3-x*2.1);
    const roadBed=(.022+.012*wheelWear+grit)*smoothstep(rut,.055,.31);
    height+=fade*(crown+shoulder+rutBank+wash+roadBed);
  }
  // Two shallow stone gutters follow the sides of the market's crowned tread.
  const dx=x-marketStreet.x,dz=z-marketStreet.z,c=Math.cos(marketStreet.angle),s=Math.sin(marketStreet.angle);
  const across=dx*c-dz*s,along=dx*s+dz*c;
  if(Math.abs(along)<8.8) {
    const ditch=Math.abs(across-drainSide(Math.sign(across)||1,along));
    height-=.034*(1-smoothstep(ditch,.065,.28))*(1-smoothstep(Math.abs(along),7.1,8.8));
  }
  return height+streetworksRelief(x,z);
}

export function createStreetTerrain(width,depth) {
  // Densify the regular plane only where a tread or road shoulder can be seen.
  function coordinates(start,end,ranges) {
    const axis=[start];
    for(let value=start;value<end;) {
      const increment=ranges.some(([min,max])=>value>=min && value<max) ? .115 : .72;
      value=Math.min(value+increment,end);
      axis.push(value);
    }
    return axis;
  }
  const apronRanges=pavedAprons.map(({x,w})=>[x-w*.5-.5,x+w*.5+.5]);
  const xs=coordinates(-width/2,width/2,[[-75,-63],[-52,-33],[15,38],...apronRanges]);
  const zs=coordinates(-depth,0,[[-52,-14],[-14,-11]]);
  const position=[],uv=[],index=[];
  for(const z of zs) for(const x of xs) {
    position.push(x,-(z+depth/2),streetSurfaceHeight(x,z));
    uv.push(x/width+.5,.5-(z+depth/2)/depth);
  }
  const columns=xs.length;
  for(let row=0;row<zs.length-1;row++) for(let col=0;col<columns-1;col++) {
    const a=row*columns+col, b=a+columns;
    index.push(a,b,a+1,b,b+1,a+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const vertices=geometry.attributes.position;
  function cell(axis,value) {
    let low=0,high=axis.length-1;
    while(high-low>1) {
      const middle=(low+high)>>1;
      if(value<axis[middle]) high=middle;
      else low=middle;
    }
    return low;
  }
  geometry.userData.floorHeight=(x,z)=>{
    if(x<xs[0] || x>xs.at(-1) || z<zs[0] || z>zs.at(-1)) return streetSurfaceHeight(x,z);
    const col=cell(xs,x),row=cell(zs,z);
    const u=(x-xs[col])/(xs[col+1]-xs[col]),v=(z-zs[row])/(zs[row+1]-zs[row]);
    const a=row*columns+col,b=a+columns;
    const heightA=vertices.getZ(a),heightB=vertices.getZ(b);
    const nextA=vertices.getZ(a+1),nextB=vertices.getZ(b+1);
    // Match the two triangles above, including the diagonal through each cell.
    return u+v<=1 ? heightA+u*(nextA-heightA)+v*(heightB-heightA) :
      nextB+(1-u)*(heightB-nextB)+(1-v)*(nextA-nextB);
  };
  return geometry;
}

function paving(lane,origin,material,terrain,addSurface) {
  let seed=lane.seed;
  const random=()=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  };
  const position=[],uv=[],color=[],indices=[];
  const joints=[],jointColor=[],jointIndices=[];
  const grit=[];
  const pigment=new THREE.Color();
  const palette=[0x949e96,0x718781,0xa9b4ae,0xb4a58a,0x78868f,0x9e9d88,0xaba495];
  const fragments=[0x86755a,0xaaa08a,0xa29881,0x7e8579,0x908470,0xb29c7e];
  const gutterPalette=[0x777c70,0x80918a,0x90978b,0x646f68];
  const sediment=new THREE.Color(0xaa9575);
  const seam=new THREE.Color(0x78694e);
  const c=Math.cos(lane.angle),s=Math.sin(lane.angle);
  const point=(u,v)=>[lane.x+c*u+s*v,lane.z-s*u+c*v];

  function stone(u,v,width,length,height,gravel=false,gutter=false) {
    const [x,z]=point(u,v);
    if(canalDepth(origin,x,z)>waterHeight+.015) return;
    const cuts=Array.from({length:4},()=>.045+random()*.22);
    const [sw,se,ne,nw]=cuts;
    const turn=(random()-.5)*(gravel ? 1.6 : lane.coursed ? .17 : .30);
    const ca=Math.cos(turn),sa=Math.sin(turn);
    const corners=[[-.5+sw,-.5],[.5-se,-.5],[.5,-.5+se],[.5,.5-ne],
      [.5-ne,.5],[-.5+nw,.5],[-.5,.5-nw],[-.5,-.5+sw]]
      .map(([a,b])=>{
        const du=(a+(random()-.5)*.083)*width,dv=(b+(random()-.5)*.14)*length;
        return [du*ca+dv*sa,-du*sa+dv*ca,random()];
      });
    const rim=lane.coursed && !gravel ? corners.flatMap(([du,dv,chip],i)=>{
      const corner=corners[i];
      if(i%2!==0) return [corner];
      const [nextU,nextV]=corners[i+1];
      const along=.31+.34*chip, nick=.95-.13*chip**2;
      return [corner,[THREE.MathUtils.lerp(du,nextU,along)*nick,
        THREE.MathUtils.lerp(dv,nextV,along)*nick,.43+.46*chip]];
    }) : corners;
    const colors=gutter ? gutterPalette : gravel ? fragments : palette;
    pigment.setHex(colors[Math.floor(random()*colors.length)]);
    const tiltU=(random()-.5)*(lane.coursed ? .031 : .061);
    const tiltV=(random()-.5)*(lane.coursed ? .035 : .059);
    const offset=position.length/3;
    const mapU=random(),mapV=random();
    const grainAngle=random()*Math.PI;
    const textureMetres=lane.coursed ? material.userData.tileMetres : .89;
    const grainX=Math.cos(grainAngle)/textureMetres,grainY=Math.sin(grainAngle)/textureMetres;
    const wear=THREE.MathUtils.lerp(.16,.49,Math.abs(Math.sin(x*.83+z*.57)));
    // A tight lane of cleaner polished centers leaves dust in sheltered corners.
    const traffic=lane.market ? 1-smoothstep(Math.abs(u),.41,1.91) : .30;
    const lip=gravel ? .72 : lane.coursed ? .99 : .96;
    const chipInset=lane.coursed && !gravel ? .085 : .135;
    const cornerWear=gravel ? height*.23 : lane.coursed ? .007 : .015;
    const n=rim.length, wrapSide=lane.coursed && !gravel;
    const supportsFoot=!gravel || (lane.coursed && Math.min(width,length)>.12);
    const sideSize=wrapSide ? n+1 : n;
    const perimeter=[0];
    if(wrapSide) for(let i=1;i<=n;i++) {
      const [u,v]=rim[i%n], [lastU,lastV]=rim[i-1];
      perimeter.push(perimeter.at(-1)+Math.hypot(u-lastU,v-lastV));
    }
    function vertex(du,dv,y,shade,dust=0,edge) {
      const [px,pz]=point(u+du,v+dv);
      position.push(px,terrain(px,pz)+y,pz);
      color.push(THREE.MathUtils.lerp(pigment.r,sediment.r,dust)*shade,
        THREE.MathUtils.lerp(pigment.g,sediment.g,dust)*shade,
        THREE.MathUtils.lerp(pigment.b,sediment.b,dust)*shade);
      if(edge===undefined) uv.push(mapU+du*grainX+dv*grainY,mapV+dv*grainX-du*grainY);
      else uv.push(mapU+edge/textureMetres,mapV+y/textureMetres);
    }
    function edgeRing(place) {
      for(let i=0;i<sideSize;i++) place(...rim[i%n],wrapSide ? perimeter[i] : undefined);
    }
    edgeRing((du,dv,chip,edge)=>vertex(du,dv,-.022,.48,.72,edge));
    edgeRing((du,dv,chip,edge)=>{
      const face=lane.coursed && !gravel ? .26+.38*chip : .15+.22*chip;
      vertex(du,dv,height*face+du*tiltU+dv*tiltV,.55+.23*chip,.43+.25*chip,edge);
    });
    edgeRing((du,dv,chip,edge)=>{
      const inset=lip-chip*chipInset;
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV-cornerWear*chip,.81+.16*chip,wear+.20*chip,edge);
    });
    for(const [du,dv,chip] of rim) {
      const inset=lip-chip*chipInset;
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV-cornerWear*chip,.87+.19*chip,wear+.14*chip);
    }
    const centreU=width*(random()-.5)*.37, centreV=length*(random()-.5)*.38;
    const centreShade=.97+.14*random(), crown=height+(lane.coursed ? .0015 : .004);
    const bevel=offset+3*sideSize, inside=bevel+n;
    if(!gravel) for(const [du,dv,chip] of rim) {
      const pu=du*.52+centreU*.48,pv=dv*.52+centreV*.48;
      const fracture=(lane.coursed ? .0035 : .009)*Math.sin(pu*19+pv*17+x*.21)*Math.cos(pu*13-pv*23);
      vertex(pu,pv,crown+pu*tiltU+pv*tiltV+fracture,
        .93+.17*chip+.06*traffic,wear*(.6-.36*traffic));
    }
    const centre=position.length/3;
    vertex(centreU,centreV,crown,centreShade+.08*traffic,wear*(.42-.24*traffic));
    for(let i=0;i<n;i++) {
      const j=(i+1)%n, a=offset+i,b=offset+(wrapSide ? i+1 : j);
      const sideA=a+sideSize,sideB=b+sideSize,topA=sideA+sideSize,topB=sideB+sideSize;
      indices.push(a,sideA,b,b,sideA,sideB,sideA,topA,sideB,sideB,topA,topB);
      if(supportsFoot) for(const [start,middle,end] of [[a,sideA,b],[b,sideA,sideB],[sideA,topA,sideB],[sideB,topA,topB]]) {
        addSurface(position,start*3,middle*3,end*3);
      }
      if(gravel) {
        indices.push(centre,bevel+j,bevel+i);
        if(supportsFoot) addSurface(position,centre*3,(bevel+j)*3,(bevel+i)*3);
        continue;
      }
      for(const [start,middle,end] of [[bevel+i,inside+i,bevel+j],[bevel+j,inside+i,inside+j],[centre,inside+j,inside+i]]) {
        indices.push(start,middle,end);
        addSurface(position,start*3,middle*3,end*3);
      }
    }
    if(gravel) return;
    if(lane.coursed) for(const corner of [Math.floor(mapU*n),Math.floor(mapV*n)]) {
      const [du,dv,chip]=rim[corner];
      const radius=Math.max(.02,Math.hypot(du,dv));
      const spread=1+(.010+chip*.018)/radius;
      const size=.017+.033*chip;
      grit.push([u+du*spread,v+dv*spread,size,size*.74,size*.23]);
    }
    const start=joints.length/3;
    for(const spread of [0,.034,.092]) for(const [du,dv,chip] of rim) {
      const radius=Math.max(.01,Math.hypot(du,dv));
      const r=1+spread*(.72+chip*.67)/radius;
      const [px,pz]=point(u+du*r,v+dv*r);
      joints.push(px,terrain(px,pz)+.005,pz);
      jointColor.push(seam.r,seam.g,seam.b,spread===0 ? .60 : spread<.04 ? .12+.13*chip : 0);
    }
    for(let i=0;i<n;i++) {
      const a=start+i,b=start+(i+1)%n;
      jointIndices.push(a,b,a+n,b,b+n,a+n,a+n,b+n,a+2*n,b+n,b+2*n,a+2*n);
    }
  }

  for(let row=-lane.width*.5;row<lane.width*.5-.19;) {
    const width=Math.min((lane.coursed ? .42 : .31)+random()*.34,lane.width*.5-row);
    for(let column=-lane.length*.5+random()*.65;column<lane.length*.5-.24;) {
      const length=Math.min((lane.coursed ? .50 : .37)+random()*.41,lane.length*.5-column);
      const v=column+length*.5;
      const u=row+width*.5+Math.sin(v*.48)*(lane.coursed ? .10 : .29);
      const edge=lane.width*.50-.23-.38*Math.sin(v*.68+1.1)*Math.cos(v*.23);
      const exposedEdge=Math.abs(row+width*.5)>.34*lane.width;
      const fadingEnd=Math.abs(v)>.39*lane.length;
      const chance=lane.coursed ? (exposedEdge && fadingEnd ? .68 : .99) :
        exposedEdge && fadingEnd ? .38 : exposedEdge || fadingEnd ? .76 : .97;
      if((!lane.market || Math.abs(u)<edge) && random()<chance) {
        const rise=lane.coursed ? .014+random()**1.4*.030 :
          lane.market ? .013+random()**1.6*.045 : .008+random()**1.7*.030;
        if(length>.55 && random()<.25) {
          const split=.36+random()*.21;
          stone(u-.019,v-length*(1-split)*.5,width-.044,length*split-.018,rise);
          stone(u+.023,v+length*split*.5,width-.051,length*(1-split)-.020,rise*.85);
        } else stone(u,v,width-.022,length-.020,rise);
      }
      else if(random()<.72) {
        stone(u-width*.13,v-length*.14,width*.44,length*.41,.016,true);
        stone(u+width*.17,v+length*.17,width*.26,length*.28,.010,true);
      }
      column+=length;
    }
    row+=width;
  }
  for(let i=0;i<lane.length*(lane.coursed ? 14 : 47);i++) {
    const v=(random()-.5)*lane.length*1.11;
    const spread=.53+.33*Math.sin(v*.93+lane.seed)+.19*Math.cos(v*2.61);
    const shoulder=(.43+.10*Math.cos(v*1.7))*lane.width;
    const edge=(shoulder+random()**2*(.96+spread))*(random()<.5 ? -1 : 1);
    const size=.012+random()**2*.078;
    stone(edge+Math.sin(v*.48)*.29,v,size,size*(.67+random()*.63),size*.25,true);
  }
  if(lane.market) for(const side of [-1,1]) {
    // Paving repairs spill out from opposite shop fronts at different points.
    // Each patch breaks into smaller stones before it reaches the clay.
    const front=side<0 ? -2.85 : 3.76;
    for(let row=0;row<5;row++) {
      const u=side*(lane.width*.53+.21+row*.265);
      for(let v=front-1.43;v<front+1.35;) {
        const length=.24+random()*.28;
        const edge=Math.hypot((v-front)*.72,row*.22);
        if(edge<.72+random()*.45) {
          stone(u+(random()-.5)*.075,v,.220+random()*.057,length-.027,.013+random()*.020);
        }
        v+=length;
      }
    }
    // Flat gutter stones sit between the paving and an intermittent raised outer edge.
    for(let v=-lane.length*.43;v<lane.length*.43;) {
      const length=.27+random()*.31;
      const edge=drainSide(side,v+length*.5);
      stone(edge,v+length*.5,.28+random()*.06,length-.013,.015+random()*.013,false,true);
      if(random()>.11) {
        stone(edge+side*(.25+random()*.054),v+length*.48,.17+random()*.07,length-.028,.045+random()*.030);
      }
      v+=length;
    }
  }
  // Hooves and wheels scatter small fragments just inside each shoulder.
  // They sit on the dirt surface and do not affect the walking height.
  for(let cluster=0;!lane.coursed && cluster<lane.length*1.7;cluster++) {
    const v=(random()-.5)*lane.length;
    const u=(.43+random()*.20)*lane.width*(random()<.5 ? -1 : 1);
    for(let i=0;i<11;i++) {
      const angle=random()*Math.PI*2;
      const spread=.31*random()**1.7;
      const size=.015+.069*random()**2;
      stone(u+Math.cos(angle)*spread,v+Math.sin(angle)*spread*1.95,
        size,size*(.58+random()*.62),size*(.19+random()*.10),true);
    }
  }
  for(const [u,v,width,length,height] of grit) stone(u,v,width,length,height,true);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(color,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=lane.name??"Inset street paving and gravel";
  mesh.receiveShadow=true;
  const contact=new THREE.BufferGeometry();
  contact.setAttribute("position",new THREE.Float32BufferAttribute(joints,3));
  contact.setAttribute("color",new THREE.Float32BufferAttribute(jointColor,4));
  contact.setIndex(jointIndices);
  const seams=new THREE.Mesh(contact,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,
    depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));
  seams.name="Sediment at paving joints";
  return [mesh,seams];
}

function roadsideGrass(origin,terrain) {
  const positions=[],colors=[];
  const stalk=new THREE.Color();
  let seed=7963;
  const random=()=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  };
  for(const lane of lanes) for(let i=0;i<lane.length*13;i++) {
    const u=(lane.width*(.56+random()*.31)+.13*Math.sin(i*.42))*(random()<.5 ? -1 : 1);
    const v=(random()-.5)*lane.length*.92;
    if(Math.sin(v*3.8+u*8.9)+.8*Math.cos(v*1.9)<-.35) continue;
    const c=Math.cos(lane.angle),s=Math.sin(lane.angle);
    const x=lane.x+c*u+s*v,z=lane.z-s*u+c*v;
    if(canalDepth(origin,x,z)>waterHeight+.005) continue;
    const vigor=.32+.68*random()**1.8;
    const count=3+Math.floor(random()*6);
    for(let k=0;k<count;k++) {
      const az=random()*Math.PI*2, spread=random()*.056;
      const ax=Math.cos(az),azimuthZ=Math.sin(az);
      const px=x+spread*ax,pz=z+spread*azimuthZ;
      const y=terrain(px,pz)-.006;
      const height=(.026+random()*.121)*vigor;
      const width=.002+random()*.0039, bend=.42+random()*.51;
      const wx=-azimuthZ*width,wz=ax*width;
      const dx=ax*height*bend,dz=azimuthZ*height*bend;
      stalk.setHex(random()<.68 ? 0x77794c : 0xa29970);
      positions.push(px-wx,y,pz-wz,px+wx,y,pz+wz,
        px+dx*.35+wx*.68,y+height*.64,pz+dz*.35+wz*.68,
        px-wx,y,pz-wz,px+dx*.35+wx*.68,y+height*.64,pz+dz*.35+wz*.68,
        px+dx*.35-wx*.68,y+height*.64,pz+dz*.35-wz*.68,
        px+dx*.35-wx*.68,y+height*.64,pz+dz*.35-wz*.68,
        px+dx*.35+wx*.68,y+height*.64,pz+dz*.35+wz*.68,
        px+dx,y+height,pz+dz);
      for(const tone of [.56,.63,.86,.56,.86,.80,.80,.86,1.16]) {
        colors.push(stalk.r*tone,stalk.g*tone,stalk.b*tone);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  const grass=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({side:THREE.DoubleSide,
    vertexColors:true,roughness:.99}));
  grass.name="Scattered verge grass";
  grass.receiveShadow=true;
  return grass;
}

// Only the slabs and larger fragments support feet. Individual small chips
// remain visual detail so they do not jolt feet or cart wheels.
export function buildStreetGround(root,origin,surface,anchor,terrain) {
  const stone=surface("worn-stone",0xf9ffff,1.14,.94);
  stone.vertexColors=true;
  const sandstone=surface("sandstone-approach",0xffffff,.86,.95);
  sandstone.vertexColors=true;
  stone.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        float mineralHash(vec2 p) {
          vec3 q=fract(vec3(p.xyx)*.1031);
          q+=dot(q,q.yzx+33.33);
          return fract((q.x+q.y)*q.z);
        }
        float mineralNoise(vec2 p) {
          vec2 i=floor(p), f=fract(p);
          f=f*f*(3.-2.*f);
          return mix(mix(mineralHash(i),mineralHash(i+vec2(1.,0.)),f.x),
            mix(mineralHash(i+vec2(0.,1.)),mineralHash(i+1.),f.x),f.y);
        }`)
      .replace("#include <color_fragment>",`#include <color_fragment>
        #ifdef USE_MAP
          vec2 shale=vMapUv*vec2(1.,.71);
          float mineral=mineralNoise(shale*vec2(12.,28.));
          float erosion=mineralNoise(shale*vec2(35.,57.)+vec2(9.,1.));
          float laminate=shale.y*94.+2.4*mineralNoise(shale*vec2(7.,19.))+.8*erosion;
          float seamMask=1.-smoothstep(.31,1.85,fwidth(laminate));
          float fissure=pow(max(0.,sin(laminate)),22.)*smoothstep(.40,.66,mineral)*seamMask;
          float quartz=smoothstep(.61,.81,mineral*.62+erosion*.38);
          float pit=smoothstep(.57,.81,mineralNoise(shale*146.))*smoothstep(.31,.66,erosion);
          pit*=1.-smoothstep(.24,1.17,max(length(dFdx(shale*146.)),length(dFdy(shale*146.))));
          vec3 weathering=mix(vec3(.84,.86,.85),vec3(1.12,1.11,1.06),erosion);
          diffuseColor.rgb*=weathering*(1.-.32*fissure-.19*pit)+quartz*vec3(.20,.20,.17);
        #endif`)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        #ifdef USE_MAP
          roughnessFactor=clamp(roughnessFactor-.24*quartz+.19*pit+.11*fissure,.53,1.);
        #endif`);
  };
  stone.customProgramCacheKey=()=>"weathered-street-paving-minerals";
  const pavingCells=new Map(), rootCells=new Map();
  function addSurface(p,i,j,k,cells=pavingCells) {
    const ax=p[i], az=p[i+2], bx=p[j]-ax, bz=p[j+2]-az, cx=p[k]-ax, cz=p[k+2]-az;
    const determinant=bx*cz-bz*cx;
    if(Math.abs(determinant)<1e-6) return;
    const tri={
      ax,az,bx,bz,cx,cz,ay:p[i+1],by:p[j+1]-p[i+1],cy:p[k+1]-p[i+1],
      invArea:1/determinant,
    };
    const x0=Math.floor(ax+Math.min(0,bx,cx)), x1=Math.floor(ax+Math.max(0,bx,cx));
    const z0=Math.floor(az+Math.min(0,bz,cz)), z1=Math.floor(az+Math.max(0,bz,cz));
    for(let x=x0;x<=x1;x++) for(let z=z0;z<=z1;z++) {
      const key=x+":"+z;
      if(!cells.has(key)) cells.set(key,[]);
      cells.get(key).push(tri);
    }
  }
  const addPaving=lane=>root.add(...paving(lane,origin,lane.coursed ? sandstone : stone,terrain,addSurface));
  for(const lane of [...lanes,...ferryLanes]) addPaving(lane);
  const approaches=[
    {x:-72.64,z:anchor.z,length:6.24,width:2.84,seed:1457,name:"West bridge approach"},
    {x:-43.68,z:anchor.z-.29,length:9.58,width:3.29,seed:835,name:"East bridge approach"},
  ];
  for(const approach of approaches) addPaving({...approach,angle:Math.PI/2,coursed:true});
  root.add(roadsideGrass(origin,terrain));
  const streetworks=buildStreetworks(root,surface,terrain,addSurface);
  function surfaceHeight(cells,x,z) {
    let y=-Infinity;
    const candidates=cells.get(Math.floor(x)+":"+Math.floor(z));
    if(candidates) for(const t of candidates) {
      const dx=x-t.ax, dz=z-t.az;
      const u=(dx*t.cz-dz*t.cx)*t.invArea;
      const v=(dz*t.bx-dx*t.bz)*t.invArea;
      if(u>=0 && v>=0 && u+v<=1) y=Math.max(y,t.ay+u*t.by+v*t.cy);
    }
    return y;
  }
  const pavedHeight=(x,z)=>surfaceHeight(pavingCells,x,z);
  const rootHeight=(x,z)=>surfaceHeight(rootCells,x,z);
  const height=(x,z)=>Math.max(terrain(x,z),pavedHeight(x,z),rootHeight(x,z));
  height.addThreshold=(x,z,length,width,seed)=>addPaving({x,z,length,width,seed,angle:Math.PI/2,
    coursed:true,name:"Stone threshold"});
  height.addRootSurface=(position,a,b,c)=>addSurface(position,a,b,c,rootCells);
  height.rootHeight=rootHeight;
  height.frontages=streetworks;
  return height;
}
