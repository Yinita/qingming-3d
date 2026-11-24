const spread=.46, search=1.55;

export function createCanalRunoff({minX,minZ,columns,rows,dx,dz,floor,eastDepth,southDepth,east,south,flow,dt}) {
  const area=dx*dz, kernelCache=new Map(), queue=[];
  const stamp=new Uint32Array(floor.length);
  let generation=0, received=0, applied=0, taggedApplied=0, rejected=0, peakMarker=0, lastMouth=null;
  const marker={current:new Float32Array(floor.length),next:new Float32Array(floor.length)};

  function kernel(x,z) {
    const key=`${x},${z}`;
    if(kernelCache.has(key)) return kernelCache.get(key);
    const c0=Math.max(0,Math.floor((x-minX-search)/dx)), c1=Math.min(columns-1,Math.floor((x-minX+search)/dx));
    const r0=Math.max(0,Math.floor((z-minZ-search)/dz)), r1=Math.min(rows-1,Math.floor((z-minZ+search)/dz));
    let start=-1, closest=search**2;
    for(let row=r0;row<=r1;row++) for(let col=c0;col<=c1;col++) {
      const i=row*columns+col;
      if(!floor[i]) continue;
      const distance=(minX+(col+.5)*dx-x)**2+(minZ+(row+.5)*dz-z)**2;
      if(distance>=closest) continue;
      closest=distance;
      start=i;
    }
    if(start<0) {
      kernelCache.set(key,null);
      return null;
    }

    // Walk only shared wet faces. A runoff mouth cannot deposit through a pier.
    const todo=[start], cells=[];
    const col=start%columns,row=Math.floor(start/columns);
    let sum=0;
    generation++;
    stamp[start]=generation;
    for(let j=0;j<todo.length;j++) {
      const i=todo[j];
      const squared=((i%columns-col)*dx)**2+((Math.floor(i/columns)-row)*dz)**2;
      if(squared>spread**2) continue;
      const weight=Math.exp(-squared/(.21**2));
      cells.push([i,weight]);
      sum+=weight;
      function visit(next) {
        if(stamp[next]===generation) return;
        stamp[next]=generation;
        todo.push(next);
      }
      if(eastDepth[i]) visit(i+1);
      if(i%columns && eastDepth[i-1]) visit(i-1);
      if(southDepth[i]) visit(i+columns);
      if(i>=columns && southDepth[i-columns]) visit(i-columns);
    }
    for(const cell of cells) cell[1]/=sum;
    const result={cells,x:minX+(col+.5)*dx,z:minZ+(row+.5)*dz};
    kernelCache.set(key,result);
    return result;
  }

  function enqueue(x,z,volume,vx,vz,tagged,duration) {
    const mouth=kernel(x,z);
    if(!mouth) {
      rejected+=volume;
      return null;
    }
    const steps=Math.max(1,Math.ceil(duration/dt));
    queue.push({mouth,volume:volume/steps,tagged:tagged/steps,vx,vz,steps});
    received+=volume;
    return mouth;
  }

  function apply(height) {
    let keep=0;
    let largest=0;
    for(const source of queue) {
      const {mouth,volume,tagged,vx,vz}=source;
      if(volume>largest) {
        largest=volume;
        lastMouth={x:mouth.x,z:mouth.z,flowLitresPerSecond:volume*1000/dt,vx,vz};
      }
      applied+=volume;
      taggedApplied+=tagged;
      for(const [i,weight] of mouth.cells) {
        const addition=volume*weight/area;
        height[i]+=addition;
        // Split incoming momentum between the available staggered faces.
        const fraction=addition/(2*(floor[i]+addition));
        if(eastDepth[i]) east[i]+=fraction*(vx-flow.east[i]-east[i]);
        if(i%columns && eastDepth[i-1]) east[i-1]+=fraction*(vx-flow.east[i-1]-east[i-1]);
        if(southDepth[i]) south[i]+=fraction*(vz-flow.south[i]-south[i]);
        if(i>=columns && southDepth[i-columns]) south[i-columns]+=fraction*(vz-flow.south[i-columns]-south[i-columns]);
        // A near-surface optical tracer based on the incoming clear and tagged water.
        // Its units represent relative turbidity, independent of the water budget.
        marker.current[i]=Math.min(1,marker.current[i]+(volume+.7*tagged)*weight/(area*.016));
        peakMarker=Math.max(peakMarker,marker.current[i]);
      }
      if(--source.steps>0) queue[keep++]=source;
    }
    queue.length=keep;
  }

  return {
    marker,enqueue,apply,
    inspect:()=>({acceptedLitres:received*1000,appliedLitres:applied*1000,
      pendingLitres:Math.max(0,received-applied)*1000,rejectedLitres:rejected*1000,
      taggedLitres:taggedApplied*1000,activeSources:queue.length,peakMarker,lastMouth}),
  };
}
