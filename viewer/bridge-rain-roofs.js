import * as THREE from "three";

const pitch=.29, bucket=6;
const cardinal=[[-1,0],[1,0],[0,-1],[0,1]];
const adjacent=[...cardinal,[-1,-1],[-1,1],[1,-1],[1,1]];

export function makeShelterIndex(levelAt) {
  const cells=new Map();
  const key=(x,z)=>x+":"+z;
  return {
    add(roof) {
      const {minX,maxX,minZ,maxZ}=roof.bounds;
      for(let z=Math.floor(minZ/bucket);z<=Math.floor(maxZ/bucket);z++) {
        for(let x=Math.floor(minX/bucket);x<=Math.floor(maxX/bucket);x++) {
          const id=key(x,z);
          if(!cells.has(id)) cells.set(id,[]);
          cells.get(id).push(roof);
        }
      }
    },
    at(x,z) { return cells.get(key(Math.floor(x/bucket),Math.floor(z/bucket))) ?? []; },
    cover(x,z) { return this.at(x,z).some(roof=>roof.enabled() && levelAt(roof,x,z)>0); },
  };
}

function cellsOfRoof(top,cols,rows,x0,z0,cellX,cellZ) {
  const count=top.length;
  const distance=new Int16Array(count).fill(-1), outlet=new Int16Array(count).fill(-1);
  const next=new Int32Array(count).fill(-1), direction=new Float32Array(count*2), flux=new Float32Array(count);
  const wave=new Int32Array(count);
  const slots=[], bins=new Map();
  let length=0;

  for(let i=0;i<count;i++) {
    if(!Number.isFinite(top[i])) continue;
    flux[i]=1;
    const col=i%cols,row=Math.floor(i/cols);
    let nx=0,nz=0,edge=false;
    for(const [dx,dz] of cardinal) {
      const x=col+dx,z=row+dz;
      if(x<0 || x>=cols || z<0 || z>=rows || !Number.isFinite(top[z*cols+x])) {
        nx+=dx;
        nz+=dz;
        edge=true;
      }
    }
    if(!edge) continue;
    const m=Math.hypot(nx,nz)||1;
    direction[i*2]=nx/m;
    direction[i*2+1]=nz/m;
    const x=x0+(col+.5+nx*.71/m)*cellX,z=z0+(row+.5+nz*.71/m)*cellZ;
    const y=top[i]-.032;
    const tag=Math.floor(x/.64)+":"+Math.floor(z/.64)+":"+Math.floor(y/.38);
    if(!bins.has(tag)) {
      bins.set(tag,slots.length);
      slots.push({x,y,z,vx:.24*nx/m,vz:.24*nz/m,mass:0,due:0});
    }
    outlet[i]=bins.get(tag);
    wave[length++]=i;
    distance[i]=0;
  }

  // Flood the roof inward from its open boundary. On a slope, route toward the
  // lowest reachable edge while keeping the graph acyclic across flat patches.
  for(let head=0;head<length;head++) {
    const i=wave[head], col=i%cols,row=Math.floor(i/cols);
    for(const [dx,dz] of cardinal) {
      const x=col+dx,z=row+dz,j=z*cols+x;
      if(x<0 || x>=cols || z<0 || z>=rows || distance[j]>=0 || !Number.isFinite(top[j])) continue;
      wave[length++]=j;
      distance[j]=distance[i]+1;
    }
    if(distance[i]===0) continue;
    let best=-1,score=-Infinity;
    for(const [dx,dz] of adjacent) {
      const x=col+dx,z=row+dz,j=z*cols+x;
      if(x<0 || x>=cols || z<0 || z>=rows || distance[j]<0 || distance[j]>=distance[i]) continue;
      const descent=(top[i]-top[j])/Math.hypot(dx,dz);
      if(descent>score) { score=descent; best=j; }
    }
    if(best>=0) {
      outlet[i]=outlet[best];
      next[i]=best;
      const dx=best%cols-col,dz=Math.floor(best/cols)-row,m=Math.hypot(dx,dz);
      direction[i*2]=dx/m;
      direction[i*2+1]=dz/m;
    }
  }
  for(let i=length-1;i>=0;i--) {
    const at=wave[i], down=next[at];
    if(down>=0) flux[down]+=flux[at];
  }
  return {distance,outlet,slots,coverage:length,direction,flux};
}

function closeFoundation(base,width,height) {
  const outside=new Uint8Array(base.length);
  const cells=new Int32Array(base.length);
  let length=0;
  function visit(x,y) {
    if(x<0 || y<0 || x>=width || y>=height) return;
    const i=y*width+x;
    if(base[i] || outside[i]) return;
    outside[i]=1;
    cells[length++]=i;
  }
  for(let x=0;x<width;x++) {
    visit(x,0);
    visit(x,height-1);
  }
  for(let y=0;y<height;y++) {
    visit(0,y);
    visit(width-1,y);
  }
  for(let head=0;head<length;head++) {
    const i=cells[head],x=i%width,y=Math.floor(i/width);
    for(const [dx,dy] of cardinal) visit(x+dx,y+dy);
  }
  for(let i=0;i<base.length;i++) if(!outside[i]) base[i]=1;
}

export function rasterRainRoof(model) {
  model.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(model);
  if(box.isEmpty()) return null;
  const x0=box.min.x,z0=box.min.z, spanX=box.max.x-x0,spanZ=box.max.z-z0;
  if(spanX<.15 || spanZ<.15) return null;
  const cols=Math.ceil(spanX/pitch), rows=Math.ceil(spanZ/pitch);
  const cellX=spanX/cols, cellZ=spanZ/rows;
  const top=new Float32Array(cols*rows).fill(-Infinity);
  const base=new Uint8Array(cols*rows);
  const floor=box.min.y+Math.max(.26,(box.max.y-box.min.y)*.145);
  const section=box.min.y+.16;
  const A=new THREE.Vector3(), B=new THREE.Vector3(), C=new THREE.Vector3();
  const corners=[A,B,C,A];
  let tested=0;

  function sectionWall() {
    let x0Wall,z0Wall,x1Wall,z1Wall;
    for(let j=0;j<3;j++) {
      const a=corners[j],b=corners[j+1];
      if((a.y<section)===(b.y<section)) continue;
      const f=(section-a.y)/(b.y-a.y), x=a.x+(b.x-a.x)*f, z=a.z+(b.z-a.z)*f;
      if(x0Wall===undefined) {x0Wall=x; z0Wall=z;}
      else {x1Wall=x; z1Wall=z;}
    }
    if(x1Wall===undefined) return;
    const steps=Math.max(1,Math.ceil(Math.hypot(x1Wall-x0Wall,z1Wall-z0Wall)/(.42*Math.min(cellX,cellZ))));
    for(let j=0;j<=steps;j++) {
      const x=x0Wall+(x1Wall-x0Wall)*j/steps,z=z0Wall+(z1Wall-z0Wall)*j/steps;
      const col=Math.floor((x-x0)/cellX), row=Math.floor((z-z0)/cellZ);
      if(col>=0 && col<cols && row>=0 && row<rows) base[row*cols+col]=1;
    }
  }

  model.traverse(mesh=>{
    if(!mesh.isMesh) return;
    const pos=mesh.geometry.getAttribute("position"), idx=mesh.geometry.index;
    if(!pos) return;
    const vertices=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++) {
      A.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).toArray(vertices,i*3);
    }
    const count=idx ? idx.count : pos.count;
    for(let i=0;i<count;i+=3) {
      A.fromArray(vertices,(idx ? idx.getX(i) : i)*3);
      B.fromArray(vertices,(idx ? idx.getX(i+1) : i+1)*3);
      C.fromArray(vertices,(idx ? idx.getX(i+2) : i+2)*3);
      if(Math.min(A.y,B.y,C.y)<section && Math.max(A.y,B.y,C.y)>=section) sectionWall();
      const ux=B.x-A.x,uz=B.z-A.z,vx=C.x-A.x,vz=C.z-A.z;
      const det=ux*vz-uz*vx;
      if(Math.abs(det)<.000006) continue;
      const loX=Math.max(0,Math.ceil((Math.min(A.x,B.x,C.x)-x0)/cellX-.5));
      const hiX=Math.min(cols-1,Math.floor((Math.max(A.x,B.x,C.x)-x0)/cellX-.5));
      const loZ=Math.max(0,Math.ceil((Math.min(A.z,B.z,C.z)-z0)/cellZ-.5));
      const hiZ=Math.min(rows-1,Math.floor((Math.max(A.z,B.z,C.z)-z0)/cellZ-.5));
      tested++;
      for(let row=loZ;row<=hiZ;row++) for(let col=loX;col<=hiX;col++) {
        const x=x0+(col+.5)*cellX-A.x,z=z0+(row+.5)*cellZ-A.z;
        const u=(x*vz-z*vx)/det,v=(ux*z-uz*x)/det;
        if(u<0 || v<0 || u+v>1) continue;
        const y=A.y+u*(B.y-A.y)+v*(C.y-A.y);
        const at=row*cols+col;
        if(y<=box.min.y+.21) base[at]=1;
        if(y>=floor) {
          top[at]=Math.max(top[at],y);
        }
      }
    }
  });

  closeFoundation(base,cols,rows);
  const {distance,outlet,slots,coverage,direction,flux}=cellsOfRoof(top,cols,rows,x0,z0,cellX,cellZ);
  if(!coverage) return null;
  const range=Math.max(.1,box.max.y-box.min.y);
  const pixels=new Uint8Array(cols*rows*4);
  for(let i=0;i<top.length;i++) {
    if(!Number.isFinite(top[i])) continue;
    pixels[i*4]=Math.round(255*(1-Math.exp(-flux[i]*.27)));
    pixels[i*4+1]=Math.round(128+127*direction[i*2]);
    pixels[i*4+2]=Math.round(128+127*direction[i*2+1]);
    pixels[i*4+3]=Math.max(1,Math.round(255*(top[i]-box.min.y)/range));
  }
  const texture=new THREE.DataTexture(pixels,cols,rows);
  texture.name="Roof runoff directions "+model.userData.id;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate=true;
  function index(x,z) {
    const col=Math.floor((x-x0)/cellX), row=Math.floor((z-z0)/cellZ);
    return col<0 || col>=cols || row<0 || row>=rows ? -1 : row*cols+col;
  }
  return {
    x:box.getCenter(A).x,z:A.z,kind:"mesh",name:model.userData.id,
    bounds:{minX:x0,maxX:box.max.x,minZ:z0,maxZ:box.max.z},
    maxY:box.max.y, stored:slots, coveredCells:coverage, testedTriangles:tested,
    film:{roofFlowMap:{value:texture},roofFlowBounds:{value:new THREE.Vector4(x0,z0,1/spanX,1/spanZ)},
      roofElevation:{value:new THREE.Vector2(box.min.y,range)}},
    wet:{value:0},caught:0,runoff:0, enabled:()=>model.visible,
    foundation(x,z) { return base[index(x,z)]===1; },
    level(x,z) { return (top[index(x,z)] ?? -Infinity)+.018; },
    route(x,z) {
      const i=index(x,z);
      const slot=slots[outlet[i]];
      return slot ? [slot,.17+Math.max(0,distance[i])*pitch*.35] : null;
    },
  };
}
