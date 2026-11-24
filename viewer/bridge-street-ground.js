import * as THREE from "three";
import { canalDepth, waterHeight } from "./bridge-canal-bed.js";

// Shallow stonework set into the dirt at the market and bridge approaches.
const lanes=[
  {x:25.18,z:-25.5,angle:.06,length:17.2,width:4.65,seed:245,market:true},
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
    const erosion=.009*Math.sin(along*1.4+side*.58)+.005*Math.cos(along*3.1+side*1.2);
    const shoulder=(.034+erosion)*smoothstep(cross,1.05,2.33);
    const ridge=(.011+erosion*.45)*Math.exp(-(((rut-.24)/.18)**2));
    const grit=.008*Math.sin(x*3.7+z*1.1)*Math.sin(z*4.2+x*.87)+
      .006*Math.sin(z*2.3-x*2.1);
    height+=fade*(crown+shoulder+ridge+(.022+grit)*smoothstep(rut,.08,.36));
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

function paving(lane,origin,material,addSurface) {
  let seed=lane.seed;
  const random=()=>{
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    return seed/4294967296;
  };
  const position=[],uv=[],color=[],indices=[];
  const pigment=new THREE.Color();
  const palette=[0xbec3ba,0xa6afa9,0xb4bcba,0xc9c2ad,0x9da8a6,0xb1b3a3,0xb4afa2];
  const sediment=new THREE.Color(0xae9676);
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
    const grainX=Math.cos(grainAngle)/.89,grainY=Math.sin(grainAngle)/.89;
    function vertex(du,dv,y,shade,dust=0) {
      const [px,pz]=point(u+du,v+dv);
      position.push(px,streetSurfaceHeight(px,pz)+y,pz);
      color.push(THREE.MathUtils.lerp(pigment.r,sediment.r,dust)*shade,
        THREE.MathUtils.lerp(pigment.g,sediment.g,dust)*shade,
        THREE.MathUtils.lerp(pigment.b,sediment.b,dust)*shade);
      uv.push(mapU+du*grainX+dv*grainY,mapV+dv*grainX-du*grainY);
    }
    for(const [du,dv] of rim) vertex(du,dv,-.020,.54,.57);
    for(const [du,dv,chip] of rim) {
      vertex(du,dv,height*.32+du*tiltU+dv*tiltV,.72+.17*chip,.32+.26*chip);
    }
    for(const [du,dv,chip] of rim) {
      const inset=(gravel ? .72 : .96)-chip*.09;
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV-.007*chip,.89+.12*chip,.27+.25*chip);
    }
    for(const [du,dv,chip] of rim) {
      const inset=(gravel ? .72 : .96)-chip*.09;
      vertex(du*inset,dv*inset,height+du*tiltU+dv*tiltV-.007*chip,.94+.15*chip,.12+.29*chip);
    }
    vertex(width*(random()-.5)*.25,length*(random()-.5)*.31,height+.002,.98+.09*random());
    for(let i=0;i<8;i++) {
      const a=offset+i,b=offset+(i+1)%8;
      indices.push(a,a+8,b,b,a+8,b+8,a+8,a+16,b+8,b+8,a+16,b+16,offset+32,b+24,a+24);
      if(!gravel) addSurface(position,(offset+32)*3,(b+24)*3,(a+24)*3);
    }
  }

  for(let row=-lane.width*.5;row<lane.width*.5-.19;) {
    const width=Math.min(.31+random()*.30,lane.width*.5-row);
    for(let column=-lane.length*.5+random()*.65;column<lane.length*.5-.24;) {
      const length=Math.min(.37+random()*.33,lane.length*.5-column);
      const v=column+length*.5;
      const u=row+width*.5+Math.sin(v*.48)*.29;
      const edge=lane.width*.50-.23-.38*Math.sin(v*.68+1.1)*Math.cos(v*.23);
      const exposedEdge=Math.abs(row+width*.5)>.34*lane.width;
      const fadingEnd=Math.abs(v)>.39*lane.length;
      const chance=exposedEdge && fadingEnd ? .38 : exposedEdge || fadingEnd ? .76 : .97;
      if((!lane.market || Math.abs(u)<edge) && random()<chance) {
        stone(u,v,width-.022,length-.020,lane.market ? .009+random()**1.6*.035 : .007+random()**1.7*.027);
      }
      else if(random()<.72) {
        stone(u-width*.13,v-length*.14,width*.44,length*.41,.016,true);
        stone(u+width*.17,v+length*.17,width*.26,length*.28,.010,true);
      }
      column+=length;
    }
    row+=width;
  }
  for(let i=0;i<lane.length*47;i++) {
    const v=(random()-.5)*lane.length*1.11;
    const spread=.53+.33*Math.sin(v*.93+lane.seed)+.19*Math.cos(v*2.61);
    const shoulder=(.43+.10*Math.cos(v*1.7))*lane.width;
    const edge=(shoulder+random()**2*(.96+spread))*(random()<.5 ? -1 : 1);
    const size=.012+random()**2*.078;
    stone(edge+Math.sin(v*.48)*.29,v,size,size*(.67+random()*.63),size*.25,true);
  }
  if(lane.market) for(const side of [-1,1]) {
    // Broken lines of larger edge stones hold the road beside the clay shoulder.
    for(let v=-lane.length*.40;v<lane.length*.40;) {
      const length=.24+random()*.34;
      const edge=side*(lane.width*.53+.16*Math.sin(v*.84)+.21*Math.cos(v*.39));
      if(Math.sin(v*1.71+side)+random()*.8>-.38) {
        stone(edge+Math.sin(v*.48)*.29,v,.13+random()*.17,length,.027+random()*.02);
      }
      v+=length+.06+random()*.17;
    }
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

// Only the walkable tops participate in foot placement. Gravel and bevels
// remain visual detail; ankles should not react to individual small chips.
export function buildStreetGround(root,origin,surface) {
  const stone=surface("worn-stone",0xf9ffff,1.14,.94);
  stone.vertexColors=true;
  const cells=new Map();
  function addSurface(p,i,j,k) {
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
  for(const lane of lanes) root.add(paving(lane,origin,stone,addSurface));
  return (x,z)=>{
    let y=streetSurfaceHeight(x,z);
    const candidates=cells.get(Math.floor(x)+":"+Math.floor(z));
    if(candidates) for(const t of candidates) {
      const dx=x-t.ax, dz=z-t.az;
      const u=(dx*t.cz-dz*t.cx)*t.invArea;
      const v=(dz*t.bx-dx*t.bz)*t.invArea;
      if(u>=0 && v>=0 && u+v<=1) y=Math.max(y,t.ay+u*t.by+v*t.cy);
    }
    return y;
  };
}
