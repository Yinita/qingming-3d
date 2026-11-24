// A height of 1 in the grid represents this much water over the cell footprint.
export const depthUnit=.012;

export function createStreetRunoff(width,height,bed,blocked,river,area) {
  const count=width*height;
  const depth=new Float32Array(count), tracer=new Float32Array(count);
  const delta=new Float32Array(count), tracerDelta=new Float32Array(count);
  const motionX=new Float32Array(count), motionZ=new Float32Array(count);
  const waterHead=new Float32Array(count);
  const shore=new Float64Array(count), shoreTracer=new Float64Array(count);
  const shoreX=new Float64Array(count), shoreZ=new Float64Array(count);
  const outlets=[];
  const spacing=Math.sqrt(area);
  const litres=depthUnit*area*1000;
  let rainIn=0, dropIn=0, runoffIn=0, infiltration=0, retired=0, toRiver=0, tracerToRiver=0;
  let transported=0, tracerTransported=0, stored=0, tracerStored=0, steps=0;
  let mobile=0, maximum=0;

  function add(i,amount,tagged=false) {
    if(amount<=0 || blocked[i] || river[i]) return;
    depth[i]+=amount;
    stored+=amount;
    dropIn+=amount;
    if(tagged) {
      tracer[i]+=amount;
      tracerStored+=amount;
      runoffIn+=amount;
    }
  }

  function displace(i) {
    retired+=depth[i];
    stored-=depth[i];
    tracerStored-=tracer[i];
    depth[i]=0;
    tracer[i]=0;
  }

  function exchange(a,b,dx,dz,dt) {
    if(blocked[a] || blocked[b] || (river[a] && river[b])) return;
    const difference=waterHead[a]-waterHead[b];
    if(Math.abs(difference)<.004) return;
    const from=difference>0 ? a : b, to=difference>0 ? b : a;
    const available=depth[from];
    if(available<.00008 || river[from]) return;
    const flow=Math.min(available*.22,(Math.abs(difference)-.004)*dt*(.24+.98*available));
    const marked=flow*tracer[from]/available;
    const sign=difference>0 ? 1 : -1;
    delta[from]-=flow;
    tracerDelta[from]-=marked;
    if(river[to]) {
      toRiver+=flow;
      tracerToRiver+=marked;
      if(shore[to]===0) outlets.push(to);
      shore[to]+=flow;
      shoreTracer[to]+=marked;
      // Estimate lip velocity from local sheet depth and hydraulic grade.
      const slope=Math.abs(difference)*depthUnit/spacing;
      const speed=Math.min(1.4,(available*depthUnit)**(2/3)*Math.sqrt(slope)/.075);
      shoreX[to]+=sign*dx*flow*speed;
      shoreZ[to]+=sign*dz*flow*speed;
    } else {
      delta[to]+=flow;
      tracerDelta[to]+=marked;
      transported+=flow;
      tracerTransported+=marked;
      motionX[to]+=sign*dx*flow*.42;
      motionZ[to]+=sign*dz*flow*.42;
    }
    motionX[from]+=sign*dx*flow;
    motionZ[from]+=sign*dz*flow;
  }

  function advance(dt,intensity,wet,open,basin,extendOutlets=false) {
    steps++;
    delta.fill(0);
    tracerDelta.fill(0);
    motionX.fill(0);
    motionZ.fill(0);
    if(!extendOutlets) {
      for(const i of outlets) shore[i]=shoreTracer[i]=shoreX[i]=shoreZ[i]=0;
      outlets.length=0;
    }

    for(let i=0;i<count;i++) {
      if(blocked[i] || river[i]) {
        waterHead[i]=bed[i];
        continue;
      }
      const value=basin[i];
      const added=dt*intensity*open[i]*(.10+.51*value)*Math.max(0,wet[i]-.19);
      const loss=depth[i]*dt*(.20+.37*(1-value));
      rainIn+=added;
      infiltration+=loss;
      tracer[i]*=1-dt*(.20+.37*(1-value));
      depth[i]+=added-loss;
      waterHead[i]=bed[i]+depth[i];
    }
    let i=0;
    for(let row=0;row<height;row++) {
      const east=(row+1)*width-1, hasSouth=row<height-1;
      for(;i<=east;i++) {
        if(i<east) exchange(i,i+1,1,0,dt);
        if(hasSouth) exchange(i,i+width,0,1,dt);
      }
    }

    stored=0;
    tracerStored=0;
    mobile=0;
    maximum=0;
    for(let i=0;i<count;i++) {
      depth[i]+=delta[i];
      tracer[i]+=tracerDelta[i];
      stored+=depth[i];
      tracerStored+=tracer[i];
      if(depth[i]>.07 && Math.abs(motionX[i])+Math.abs(motionZ[i])>.007) mobile++;
      maximum=Math.max(maximum,depth[i]);
    }
  }

  return {
    depth,tracer,motionX,motionZ,outlets,shore,shoreTracer,shoreX,shoreZ,add,advance,displace,
    resume(grid,saved) {
      stored=0;
      tracerStored=0;
      for(let i=0;i<count;i++) {
        const at=i*6;
        depth[i]=grid[at];
        tracer[i]=grid[at+1];
        motionX[i]=grid[at+2];
        motionZ[i]=grid[at+3];
        stored+=depth[i];
        tracerStored+=tracer[i];
      }
      rainIn=saved.inputLitres/litres;
      runoffIn=saved.runoffInLitres/litres;
      infiltration=saved.infiltratedLitres/litres;
      retired=saved.displacedLitres/litres;
      toRiver=saved.riverLitres/litres;
      tracerToRiver=saved.runoffInRiverLitres/litres;
      transported=saved.transportedLitres/litres;
      tracerTransported=saved.runoffMovedLitres/litres;
      steps=saved.steps;
    },
    inspect() {
      const input=rainIn+dropIn;
      return {steps,mobile,maximumDepthMm:maximum*depthUnit*1000,
        inputLitres:input*litres,infiltratedLitres:infiltration*litres,
        displacedLitres:retired*litres,riverLitres:toRiver*litres,storedLitres:stored*litres,
        transportedLitres:transported*litres,runoffInLitres:runoffIn*litres,
        runoffMovedLitres:tracerTransported*litres,runoffInRiverLitres:tracerToRiver*litres,
        runoffStoredLitres:tracerStored*litres,
        balanceErrorLitres:(input-infiltration-retired-toRiver-stored)*litres};
    },
  };
}
