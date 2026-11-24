import * as THREE from "three";
import { canalDepth, waterHeight } from "./bridge-canal-bed.js";

// Shallow stonework set into the dirt at the market and bridge approaches.
const lanes=[
  {x:25.18,z:-25.5,angle:.06,length:15.5,width:3.45,seed:245},
  {x:30.0,z:-28.5,angle:1.44,length:7.8,width:1.46,seed:703},
  {x:-71.8,z:-44.23,angle:1.53,length:7.2,width:1.13,seed:134},
  {x:-42.86,z:-39.12,angle:1.61,length:8.55,width:1.36,seed:428},
];

// Shared by the terrain, slabs and foot placement. Strength fades before each
// patch reaches the canal or the undecorated outskirts of the scroll.
const streets=[
  {x:25.8,z:-26.3,length:15.2,width:5.6,axis:"z",angle:.079},
  {x:-71.8,z:-41.42,length:6.4,width:5.7,axis:"x",angle:.035},
  {x:-43.1,z:-41.42,length:7.1,width:5.1,axis:"x",angle:-.09},
];
const {smoothstep}=THREE.MathUtils;

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
    const shoulder=.024*smoothstep(cross,1.05,2.3);
    const ridge=.012*Math.exp(-(((rut-.27)/.16)**2));
    const grit=.008*Math.sin(x*3.7+z*1.1)*Math.sin(z*4.2+x*.87)+
      .006*Math.sin(z*2.3-x*2.1);
    height+=fade*(crown+shoulder+ridge+(.020+grit)*smoothstep(rut,.08,.31));
  }
  return height;
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
  const xs=coordinates(-width/2,width/2,[[-75,-63],[-52,-33],[15,38]]);
  const zs=coordinates(-depth,0,[[-49,-32],[-32,-14],[-14,-11]]);
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
  return geometry;
}

function paving(lane,origin,material) {
  let seed=lane.seed;
  const random=()=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  };
  const position=[],uv=[],color=[],indices=[];
  const pigment=new THREE.Color();
  const palette=[0xb5b4a7,0xd3c9b3,0xa9b1a7,0xdbcfba,0x969b93,0xb1a18d,0xa69d91];
  const c=Math.cos(lane.angle),s=Math.sin(lane.angle);
  const point=(u,v)=>[lane.x+c*u+s*v,lane.z-s*u+c*v];

  function stone(u,v,width,length,height,gravel=false) {
    const [x,z]=point(u,v);
    if(canalDepth(origin,x,z)>waterHeight+.015) return;
    const cuts=Array.from({length:4},()=>.045+random()*.22);
    const [sw,se,ne,nw]=cuts;
    const turn=(random()-.5)*(gravel ? 1.6 : .30);
    const ca=Math.cos(turn),sa=Math.sin(turn);
    const rim=[[-.5+sw,-.5],[.5-se,-.5],[.5,-.5+se],[.5,.5-ne],
      [.5-ne,.5],[-.5+nw,.5],[-.5,.5-nw],[-.5,-.5+sw]]
      .map(([a,b])=>{
        const du=(a+(random()-.5)*.083)*width,dv=(b+(random()-.5)*.14)*length;
        return [du*ca+dv*sa,-du*sa+dv*ca,random()];
      });
    pigment.setHex(palette[Math.floor(random()*palette.length)]);
    const tiltU=(random()-.5)*.061,tiltV=(random()-.5)*.059;
    const offset=position.length/3;
    const mapU=random(),mapV=random();
    const grainAngle=random()*Math.PI;
    const grainX=Math.cos(grainAngle)/1.25,grainY=Math.sin(grainAngle)/1.25;
    function vertex(du,dv,y,shade) {
      const [px,pz]=point(u+du,v+dv);
      position.push(px,streetSurfaceHeight(px,pz)+y,pz);
      color.push(pigment.r*shade,pigment.g*shade,pigment.b*shade);
      uv.push(mapU+du*grainX+dv*grainY,mapV+dv*grainX-du*grainY);
    }
    for(const [du,dv] of rim) vertex(du,dv,-.014,.48);
    for(const [du,dv,chip] of rim) {
      vertex(du,dv,height*.35+du*tiltU+dv*tiltV,.63+.15*chip);
    }
    for(const [du,dv,chip] of rim) {
      const inset=(gravel ? .65 : .92)-chip*.10;
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV-.009*chip,.86+.18*chip);
    }
    for(const [du,dv,chip] of rim) {
      const inset=(gravel ? .65 : .92)-chip*.10;
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV-.009*chip,.91+.16*chip);
    }
    vertex(width*(random()-.5)*.25,length*(random()-.5)*.31,height+.004,1.04);
    for(let i=0;i<8;i++) {
      const a=offset+i,b=offset+(i+1)%8;
      indices.push(a,a+8,b,b,a+8,b+8,a+8,a+16,b+8,b+8,a+16,b+16,offset+32,b+24,a+24);
    }
  }

  for(let row=-lane.width*.5;row<lane.width*.5-.19;) {
    const width=Math.min(.31+random()*.30,lane.width*.5-row);
    for(let column=-lane.length*.5+random()*.65;column<lane.length*.5-.24;) {
      const length=Math.min(.37+random()*.33,lane.length*.5-column);
      const v=column+length*.5;
      const u=row+width*.5+Math.sin(v*.48)*.29;
      const exposedEdge=Math.abs(row+width*.5)>.29*lane.width;
      const fadingEnd=Math.abs(v)>.39*lane.length;
      const chance=exposedEdge && fadingEnd ? .38 : exposedEdge || fadingEnd ? .76 : .97;
      if(random()<chance) stone(u,v,width-.031,length-.028,.004+random()**1.7*.023);
      else if(random()<.72) {
        stone(u-width*.13,v-length*.14,width*.44,length*.41,.016,true);
        stone(u+width*.17,v+length*.17,width*.26,length*.28,.010,true);
      }
      column+=length;
    }
    row+=width;
  }
  for(let i=0;i<lane.length*36;i++) {
    const v=(random()-.5)*lane.length*1.11;
    const spread=.66+.46*Math.sin(v*.93+lane.seed);
    const edge=(lane.width*.43+random()**2*(.82+spread))*(random()<.5 ? -1 : 1);
    const size=.023+random()**2*.084;
    stone(edge+Math.sin(v*.48)*.29,v,size,size*(.67+random()*.63),size*.25,true);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(color,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name="Inset street paving and gravel";
  mesh.receiveShadow=true;
  return mesh;
}

export function buildStreetGround(root,origin,surface) {
  const stone=surface("worn-stone",0xfaf4e8,.84,.97);
  stone.vertexColors=true;
  for(const lane of lanes) root.add(paving(lane,origin,stone));
}
