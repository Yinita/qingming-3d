import * as THREE from "three";

const stride=.24;
const bounds={west:-48.8,east:-37,south:-51.6,north:-31.34};
const cols=Math.floor((bounds.east-bounds.west)/stride)+1;
const rows=Math.floor((bounds.north-bounds.south)/stride)+1;
const directions=[[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]];
const chevron=[[-.087,-.051],[0,.085],[0,.03],[-.087,-.051],[0,.03],[-.087,-.102],
  [.087,-.051],[0,.03],[0,.085],[.087,-.051],[.087,-.102],[0,.03]];
const gap=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const heading=(a,b)=>Math.atan2(a.x-b.x,a.z-b.z);

function segment(a,b,pass) {
  const pieces=Math.max(1,Math.ceil(gap(a,b)/.115)),yaw=heading(a,b);
  for(let i=1;i<=pieces;i++) {
    const t=i/pieces;
    if(!pass(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,yaw)) return false;
  }
  return true;
}

function canArrive(point,goal,pass) {
  if(gap(point,goal)>goal.reach) return false;
  const yaw=heading(point,goal);
  return pass(point.x,point.z,yaw) && (!goal.prepare || goal.prepare(point,yaw));
}

export function planStreetRoute(start,goal,pass) {
  const {west,south}=bounds;
  const target={x:goal.x,z:goal.z};
  const ends=point=>canArrive(point,goal,pass);
  if(ends(start)) return [];
  // The normal standing area can be narrower than a grid cell beside a counter.
  const angles=16, angleToStart=Math.atan2(start.z-target.z,start.x-target.x);
  const arrivals=[target];
  for(const fraction of [.97,.81]) {
    for(let i=0;i<angles;i++) {
      const angle=angleToStart+i*2*Math.PI/angles, radius=goal.reach*fraction;
      arrivals.push({x:goal.x+Math.cos(angle)*radius,z:goal.z+Math.sin(angle)*radius});
    }
  }
  const standing=arrivals.filter(ends).sort((a,b)=>gap(start,a)-gap(start,b));
  if(!standing.length) return null;
  const direct=standing.find(point=>segment(start,point,pass));
  if(direct) return [direct];
  const known=new Map(),open=[];
  const at=(i,j)=>({x:west+i*stride,z:south+j*stride});
  const bound=(i,j)=>i>=0 && j>=0 && i<cols && j<rows;
  function visit(i,j,cost,previous) {
    if(!bound(i,j)) return;
    const id=j*cols+i;
    if(cost>=(known.get(id)?.cost??Infinity)) return;
    const next=at(i,j);
    if(!segment(previous,next,pass)) return;
    Object.assign(next,{i,j,id,cost,previous,rank:cost+Math.max(0,gap(next,target)-goal.reach)});
    known.set(id,next);
    open.push(next);
  }
  const x=Math.round((start.x-west)/stride),z=Math.round((start.z-south)/stride);
  for(let j=z-2;j<=z+2;j++) for(let i=x-2;i<=x+2;i++)
    visit(i,j,gap(start,at(i,j)),start);

  for(let visited=0;open.length && visited<2200;visited++) {
    open.sort((a,b)=>b.rank-a.rank);
    const current=open.pop();
    if(known.get(current.id)!==current) continue;
    const arrived=ends(current);
    const finish=arrived ? null : gap(current,target)<=goal.reach+stride*2.5 ?
      standing.find(p=>gap(p,current)<=stride*2.5 && segment(current,p,pass)) : null;
    if(arrived || finish) {
      const steps=finish ? [finish] : [];
      for(let node=current;node!==start;node=node.previous) steps.unshift({x:node.x,z:node.z});
      const path=[];
      let from=start;
      // Remove small turns only when the longer segment still clears the same solids.
      for(let first=0;first<steps.length;) {
        let last=first;
        const turn=steps[first];
        for(let i=first+1;i<steps.length && gap(from,steps[i])<4.8;i++) {
          if(!segment(from,steps[i],pass)) break;
          last=i;
        }
        from=last===first ? turn : steps[last];
        path.push(from);
        first=last+1;
      }
      return path;
    }
    for(const [di,dj] of directions)
      visit(current.i+di,current.j+dj,current.cost+stride*Math.hypot(di,dj),current);
  }
  return null;
}

export function createStreetRoute(parent,floor) {
  const maxMarks=30;
  const geometry=new THREE.BufferGeometry();
  const limit=maxMarks*chevron.length;
  const points=new THREE.BufferAttribute(new Float32Array(limit*3),3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position",points);
  geometry.setDrawRange(0,0);
  const material=new THREE.MeshBasicMaterial({color:0xe1bf80,transparent:true,opacity:.70,
    depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,side:THREE.DoubleSide});
  const dashes=new THREE.Mesh(geometry,material);
  dashes.name="Freight walking route dashes";
  dashes.frustumCulled=false;
  dashes.visible=false;
  parent.add(dashes);
  let path=null,target=null,checked=-Infinity,planned=-Infinity,at=null;

  function draw(start,route) {
    let index=0,left=.42,from=start;
    for(const point of route) {
      const length=gap(from,point);
      if(length<.001) continue;
      const dx=(point.x-from.x)/length,dz=(point.z-from.z)/length;
      for(;left<length && index<limit;left+=.49) {
        const x=from.x+dx*left,z=from.z+dz*left;
        for(const [across,along] of chevron) {
          const u=x-dz*across+dx*along,v=z+dx*across+dz*along;
          points.setXYZ(index++,u,floor(u,v)+.017,v);
        }
      }
      left-=length;
      from=point;
    }
    geometry.setDrawRange(0,index);
    points.needsUpdate=true;
    dashes.visible=index>0;
  }

  function hide() {dashes.visible=false;}

  function clear() {
    path=target=at=null;
    checked=planned=-Infinity;
    hide();
  }

  function guide(start,goal,pass,time) {
    if(start.x<bounds.west) {
      clear();
      return start.x<-69.6 && Math.abs(start.z+41.422)>.48 ?
        {point:{x:-70.8,z:-41.422},label:"西岸桥头"} : {point:{x:-48.26,z:-41.422},label:"东岸桥头"};
    }
    const changed=!target || target.id!==goal.id || gap(target,goal)>.21;
    if(changed || time-checked>.18 || gap(start,at)>.57) {
      checked=time;at={x:start.x,z:start.z};
      if(changed) {path=null;planned=-Infinity;}
      target={...goal};
      while(path?.length && gap(start,path[0])<.18) {
        if(path.length>1 && !segment(start,path[1],pass)) break;
        path.shift();
      }
      while(path?.length>1 && gap(start,path[1])<4 && segment(start,path[1],pass)) path.shift();
      const lost=path?.length ? !segment(start,path[0],pass) : !canArrive(start,goal,pass);
      if(changed || (lost || !path) && time-planned>.42) {
        planned=time;
        path=planStreetRoute(start,goal,pass);
      } else if(lost) {
        path=null;
      }
      draw(start,path??[]);
    }
    if(!path) return null;
    const point=path[0]??start;
    let length=0,from=start;
    for(const next of path) {length+=gap(from,next);from=next;}
    return {point,label:goal.label,distance:length};
  }

  return {guide,hide,clear,inspect:()=>path?.map(point=>({...point}))??null};
}
