import { channelVelocityLimit, createChannelFlow } from "./bridge-channel-flow.js";
import { createCanalRunoff } from "./bridge-canal-runoff.js";

// Linear shallow-water perturbations on a staggered grid. Zero normal flux at
// dry cells and bridge piles lets the reflected field evolve after a source stops.
const gravity = 9.81;
const maximumHeight = .38;
const fixedStep = 1/66;
const limit = (value,low,high) => Math.max(low,Math.min(high,value));
const encodeCurrent = value => Math.round(128+limit(value/channelVelocityLimit,-1,1)*127);

export function createShallowWater({
  minX,minZ,width,length,columns=132,rows=216,depthAt,piers=[],current=.39,openEnds=true,waveMaker=null,
}) {
  const dx=width/columns, dz=length/rows, n=columns*rows;
  const floor=new Float32Array(n), bed=new Float32Array(n), damping=new Float32Array(n);
  const eastDepth=new Float32Array(n), southDepth=new Float32Array(n);
  const east=new Float32Array(n), south=new Float32Array(n);
  const nextEast=new Float32Array(n), nextSouth=new Float32Array(n);
  const pressure=new Float32Array(n), hullMask=new Float32Array(n);
  const buffer=new Uint8Array(n*4);
  let height=new Float32Array(n), nextHeight=new Float32Array(n);
  let foam=new Float32Array(n), nextFoam=new Float32Array(n);
  let remainder=0, steps=0, hits=0, waterCells=0, highest=0, velocityPeak=0, foamPeak=0;
  let energy=0, volume=0, peakCurrent=0, airInput=0;
  let runoff=null;

  for(let row=0;row<rows;row++){
    const z=minZ+(row+.5)*dz;
    for(let col=0;col<columns;col++){
      const x=minX+(col+.5)*dx;
      const i=row*columns+col;
      const depth=depthAt(x,z);
      bed[i]=depth>=.036 ? depth : 0;
      const pillar=piers.some(p=>Math.abs(x-p.x)<.145 && Math.abs(z-p.y)<.145);
      if(depth<.036 || pillar) continue;
      floor[i]=depth;
      waterCells++;
      const end=1-limit(Math.min(row,rows-1-row)/13,0,1);
      damping[i]=(openEnds ? end*end*5.2 : 0)+Math.max(0,.11-depth)*4;
    }
  }
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const i=row*columns+col, depth=floor[i];
      if(!depth) continue;
      if(col<columns-1 && floor[i+1]) eastDepth[i]=2*depth*floor[i+1]/(depth+floor[i+1]);
      if(row<rows-1 && floor[i+columns]) southDepth[i]=2*depth*floor[i+columns]/(depth+floor[i+columns]);
    }
  }
  const flow=createChannelFlow({minX,minZ,dx,dz,columns,rows,floor,bed,eastDepth,southDepth,piers,current});
  function enqueueRunoff(x,z,volume,vx,vz,tagged,duration) {
    if(volume<=0) return null;
    runoff??=createCanalRunoff({minX,minZ,columns,rows,dx,dz,floor,eastDepth,southDepth,east,south,flow,dt:fixedStep});
    return runoff.enqueue(x,z,volume,vx,vz,tagged,duration);
  }
  const source=[];
  const breaking=waveMaker ? new Float32Array(n) : null;
  let forcing=false;
  if(waveMaker) {
    const {x,z,span,period,amplitude}=waveMaker;
    const frequency=2*Math.PI/period;
    for(let row=0;row<rows;row++) {
      const offsetZ=(minZ+(row+.5)*dz-z)/span;
      if(Math.abs(offsetZ)>=1) continue;
      for(let col=0;col<columns;col++) {
        const i=row*columns+col;
        const offsetX=minX+(col+.5)*dx-x;
        if(!eastDepth[i] || Math.abs(offsetX)>=.48) continue;
        const blend=.20*Math.cos(offsetX/.48*Math.PI*.5)**2;
        const taper=Math.cos(offsetZ*Math.PI*.5)**2;
        const c=Math.sqrt(gravity*floor[i]);
        source.push({i,blend,taper,frequency,amplitude,phase:frequency*(offsetX/c+.048*offsetZ),
          velocityScale:-c/floor[i]});
      }
    }
    forcing=true;
  }

  // Relax both characteristics of a bank-bound wave in the deep source strip.
  // Outside that strip, water motion is advanced solely by the solver.
  function sendSwell() {
    const time=steps*fixedStep;
    const start=limit((time-.20)/.86,0,1), ramp=start*start*(3-2*start);
    for(const cell of source) {
      const phase=time*cell.frequency+cell.phase;
      const crest=Math.cos(phase)+.16*Math.cos(2*phase-.35);
      const wanted=cell.amplitude*cell.taper*ramp*crest;
      height[cell.i]+=(wanted-height[cell.i])*cell.blend;
      east[cell.i]+=(wanted*cell.velocityScale-east[cell.i])*cell.blend;
    }
  }

  function impact(x,z,strength,kind,vx=0,vz=0) {
    const sigma=kind==="stone" ? .39 : kind==="step" ? .30 : kind==="return" ? .151 : .215;
    const range=2.8*sigma;
    const c0=Math.max(0,Math.floor((x-range-minX)/dx)), c1=Math.min(columns-1,Math.floor((x+range-minX)/dx));
    const r0=Math.max(0,Math.floor((z-range-minZ)/dz)), r1=Math.min(rows-1,Math.floor((z+range-minZ)/dz));
    let positive=0, negative=0;
    for(let row=r0;row<=r1;row++){
      for(let col=c0;col<=c1;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const a=(minX+(col+.5)*dx-x)/sigma, b=(minZ+(row+.5)*dz-z)/sigma;
        const shape=(a*a+b*b-1)*Math.exp(-a*a-b*b);
        positive+=Math.max(0,shape);
        negative+=Math.max(0,-shape);
      }
    }
    if(positive===0 || negative===0) return;
    const amplitude=strength*(kind==="stone" ? .157 : kind==="step" ? .105 : kind==="return" ? .045 : .055);
    const balance=negative/positive;
    for(let row=r0;row<=r1;row++){
      for(let col=c0;col<=c1;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const a=(minX+(col+.5)*dx-x)/sigma, b=(minZ+(row+.5)*dz-z)/sigma;
        const radius=a*a+b*b, gauss=Math.exp(-radius);
        const shape=(radius-1)*gauss;
        height[i]+=amplitude*shape*(shape>0 ? balance : 1);
        foam[i]=Math.min(1,foam[i]+gauss*strength*(kind==="stone" ? .87 : kind==="step" ? .49 : kind==="return" ? .38 : .01));
        if(eastDepth[i]) east[i]+=.28*strength*gauss*(a+.3*vx);
        if(southDepth[i]) south[i]+=.28*strength*gauss*(b+.3*vz);
      }
    }
    hits++;
  }

  function depositFoam(x,z,strength) {
    const col=Math.floor((x-minX)/dx), row=Math.floor((z-minZ)/dz);
    for(let r=Math.max(0,row-1);r<=Math.min(rows-1,row+1);r++) {
      for(let c=Math.max(0,col-1);c<=Math.min(columns-1,col+1);c++) {
        const i=r*columns+c;
        if(!floor[i]) continue;
        const a=(minX+(c+.5)*dx-x)/.16, b=(minZ+(r+.5)*dz-z)/.16;
        foam[i]=Math.min(1,foam[i]+strength*Math.exp(-a*a-b*b));
      }
    }
  }

  function forceHull(hull,motion) {
    pressure.fill(0);
    hullMask.fill(0);
    if(!hull) return;
    const cx=hull.x, cz=hull.y, hx=hull.z, hz=hull.w;
    const slipX=motion.x, slipZ=motion.y-current;
    const amplitude=.016+.032*Math.hypot(slipX,slipZ)+limit(-motion.w*.12,-.008,.044);
    const c0=Math.max(0,Math.floor((cx-2.22-minX)/dx)), c1=Math.min(columns-1,Math.floor((cx+2.22-minX)/dx));
    const r0=Math.max(0,Math.floor((cz-2.22-minZ)/dz)), r1=Math.min(rows-1,Math.floor((cz+2.22-minZ)/dz));
    for(let row=r0;row<=r1;row++){
      for(let col=c0;col<=c1;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const x=minX+(col+.5)*dx-cx, z=minZ+(row+.5)*dz-cz;
        const along=x*hx+z*hz, beam=x*hz-z*hx;
        const footprint=(along/1.69)**2+(beam/.66)**2;
        if(footprint>=1.42) continue;
        const wetness=Math.min(1,floor[i]/.38);
        const edge=Math.min(1,Math.max(0,1.32-footprint));
        hullMask[i]=edge*edge*wetness;
        const squat=limit((slipX*x+slipZ*z)*.045,-.033,.060);
        pressure[i]=hullMask[i]*(amplitude+squat);
      }
    }
  }

  function step(motion) {
    const { abs, max, min }=Math;
    const dt=fixedStep, dtX=dt/dx, dtZ=dt/dz;
    const marker=runoff?.marker;
    if(breaking) {
      for(let i=0;i<n;i++) {
        const depth=floor[i];
        if(!depth || depth>.79) continue;
        const steepness=abs(height[i])/max(.115,depth);
        breaking[i]=min(1,max(0,(steepness-.32)*1.86));
      }
    }
    for(let row=0;row<rows;row++){
      for(let col=0;col<columns;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const bankward=flow.east[i]>=0 ? (col>0 ? i-1 : i) : (col<columns-1 ? i+1 : i);
        const upstream=flow.south[i]>=0 ? (row>0 ? i-columns : i) : (row<rows-1 ? i+columns : i);
        const mixX=abs(flow.east[i])*dtX, mixZ=abs(flow.south[i])*dtZ;
        const drag=.24+damping[i]+(breaking ? 6.1*breaking[i] : 0);
        const load=hullMask[i];
        const surface=height[i]+pressure[i];
        if(eastDepth[i]){
          const u=east[i];
          const adv=(eastDepth[bankward] ? mixX*(east[bankward]-u) : 0)+
            (eastDepth[upstream] ? mixZ*(east[upstream]-u) : 0);
          const contact=load>0 ? load*3.0*(motion.x-flow.east[i]-u) : 0;
          const next=(u+adv+dt*(gravity*(surface-height[i+1]-pressure[i+1])/dx+contact))*(1-drag*dt);
          if(breaking && eastDepth[i]<.70) {
            const cap=1.19*Math.sqrt(gravity*eastDepth[i]);
            nextEast[i]=limit(next,-cap,cap);
          } else nextEast[i]=next;
        }
        if(southDepth[i]){
          const v=south[i];
          const adv=(southDepth[bankward] ? mixX*(south[bankward]-v) : 0)+
            (southDepth[upstream] ? mixZ*(south[upstream]-v) : 0);
          const contact=load>0 ? load*3.5*(motion.y-flow.south[i]-v) : 0;
          const next=(v+adv+dt*(gravity*(surface-height[i+columns]-pressure[i+columns])/dz+contact))*(1-drag*dt);
          if(breaking && southDepth[i]<.70) {
            const cap=1.19*Math.sqrt(gravity*southDepth[i]);
            nextSouth[i]=limit(next,-cap,cap);
          } else nextSouth[i]=next;
        }
      }
    }
    for(let row=0;row<rows;row++){
      for(let col=0;col<columns;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const left=col===0 ? i : i-1, right=col===columns-1 ? i : i+1;
        const north=row===0 ? i : i-columns, southCell=row===rows-1 ? i : i+columns;
        const incomingX=col===0 ? 0 : nextEast[left];
        const incomingZ=row===0 ? 0 : nextSouth[north];
        const goX=nextEast[i], goZ=nextSouth[i];
        const fluxX=(goX*eastDepth[i]-incomingX*(col===0 ? 0 : eastDepth[left]))/dx;
        const fluxZ=(goZ*southDepth[i]-incomingZ*(row===0 ? 0 : southDepth[north]))/dz;
        const oldHeight=height[i];
        const meanX=.5*(flow.east[i]+(col ? flow.east[left] : 0));
        const meanZ=.5*(flow.south[i]+(row ? flow.south[north] : 0));
        const upX=meanX>=0 ? left : right, upZ=meanZ>=0 ? north : southCell;
        const cross=floor[upX] ? abs(meanX)*dtX*(height[upX]-oldHeight) : 0;
        const along=floor[upZ] ? abs(meanZ)*dtZ*(height[upZ]-oldHeight) : 0;
        let mixing=0;
        if(breaking) {
          if(eastDepth[i]) mixing+=(breaking[i]+breaking[right])*(height[right]-oldHeight);
          if(col && eastDepth[left]) mixing+=(breaking[i]+breaking[left])*(height[left]-oldHeight);
          if(southDepth[i]) mixing+=(breaking[i]+breaking[southCell])*(height[southCell]-oldHeight);
          if(row && southDepth[north]) mixing+=(breaking[i]+breaking[north])*(height[north]-oldHeight);
        }
        nextHeight[i]=(oldHeight+cross+along+1.1*dt*mixing-dt*(fluxX+fluxZ))*(1-dt*damping[i]);
        const speedX=meanX+.5*(goX+incomingX);
        const speedZ=meanZ+.5*(goZ+incomingZ);
        const oldFoam=foam[i], foamUpX=speedX>=0 ? left : right, foamUpZ=speedZ>=0 ? north : southCell;
        const shiftX=floor[foamUpX] ? abs(speedX)*dtX*(foam[foamUpX]-oldFoam) : 0;
        const shiftZ=floor[foamUpZ] ? abs(speedZ)*dtZ*(foam[foamUpZ]-oldFoam) : 0;
        if(marker) {
          const mist=marker.current, old=mist[i];
          const xMix=floor[foamUpX] ? abs(speedX)*dtX*(mist[foamUpX]-old) : 0;
          const zMix=floor[foamUpZ] ? abs(speedZ)*dtZ*(mist[foamUpZ]-old) : 0;
          marker.next[i]=limit((old+xMix+zMix)*(1-dt*(.47+damping[i])),0,1);
        }
        const crest=max(0,(goX-incomingX)/dx+(goZ-incomingZ)/dz - .25);
        const shear=abs(nextEast[i]-nextEast[north])/dz+abs(nextSouth[i]-nextSouth[left])/dx;
        const surfaceStress=abs(oldHeight)*(breaking ? 3.4+8.6*breaking[i] : 12);
        const agitation=max(0,(surfaceStress+.53*crest+.24*shear)-.24);
        const scatter=min(2.8,agitation)*(.37+.23*min(1,1.2/floor[i]));
        const aeration=breaking ? .64*breaking[i]*max(0,oldHeight)*8 : 0;
        nextFoam[i]=limit((oldFoam+shiftX+shiftZ+dt*(scatter+flow.air[i]+aeration))*(1-dt*(.51+damping[i])),0,1);
      }
    }
    east.set(nextEast);
    south.set(nextSouth);
    [height,nextHeight]=[nextHeight,height];
    [foam,nextFoam]=[nextFoam,foam];
    if(marker) [marker.current,marker.next]=[marker.next,marker.current];
    steps++;
  }

  function advance(dt,hull,motion=null) {
    remainder+=Math.min(.085,dt);
    if(remainder<fixedStep) return false;
    flow.update(hull,motion);
    forceHull(hull,motion);
    while(remainder>=fixedStep){
      if(forcing) sendSwell();
      if(runoff) runoff.apply(height);
      step(motion);
      remainder-=fixedStep;
    }
    return true;
  }

  function pack() {
    const marker=runoff?.marker.current;
    highest=velocityPeak=foamPeak=energy=volume=peakCurrent=airInput=0;
    for(let row=0;row<rows;row++){
      for(let col=0;col<columns;col++){
        const i=row*columns+col, at=i*4;
        const h=height[i];
        const encoded=Math.round(32768+limit(h/maximumHeight,-1,1)*32767);
        buffer[at]=encoded>>>8;
        buffer[at+1]=encoded&255;
        buffer[at+2]=Math.round(255*foam[i]);
        const u=.5*(east[i]+(col===0 ? 0 : east[i-1]));
        const v=.5*(south[i]+(row===0 ? 0 : south[i-columns]));
        const speed=Math.sqrt(u*u+v*v);
        buffer[at+3]=Math.round(255*Math.min(1,speed*.93));
        const meanU=.5*(flow.east[i]+(col ? flow.east[i-1] : 0));
        const meanV=.5*(flow.south[i]+(row ? flow.south[i-columns] : 0));
        flow.texture[at]=encodeCurrent(meanU+u);
        flow.texture[at+1]=encodeCurrent(meanV+v);
        flow.texture[at+2]=Math.round(255*Math.min(1,flow.air[i]));
        flow.texture[at+3]=marker ? Math.round(255*marker[i]) : 0;
        peakCurrent=Math.max(peakCurrent,Math.hypot(meanU,meanV));
        airInput+=flow.air[i]*dx*dz;
        highest=Math.max(highest,Math.abs(h));
        velocityPeak=Math.max(velocityPeak,speed);
        foamPeak=Math.max(foamPeak,foam[i]);
        energy+=h*h;
        volume+=h*dx*dz;
      }
    }
    return buffer;
  }

  const lookup={ i:0, col:0, row:0, ax:0, az:0 };
  function locate(x,z) {
    const u=limit((x-minX)/dx-.5,0,columns-1.001), v=limit((z-minZ)/dz-.5,0,rows-1.001);
    lookup.col=Math.floor(u);
    lookup.row=Math.floor(v);
    lookup.i=lookup.row*columns+lookup.col;
    lookup.ax=u-lookup.col;
    lookup.az=v-lookup.row;
  }
  function bilinear(data,i0,i1,i2,i3) {
    const {ax,az}=lookup;
    return (1-az)*((1-ax)*data[i0]+ax*data[i1])+az*((1-ax)*data[i2]+ax*data[i3]);
  }
  function heightAt(x,z) {
    locate(x,z);
    const {i}=lookup;
    return bilinear(height,i,i+1,i+columns,i+columns+1);
  }
  function sample(x,z,out={}) {
    locate(x,z);
    const {col,row,i}=lookup;
    out.height=bilinear(height,i,i+1,i+columns,i+columns+1);
    out.u=.5*(bilinear(east,i,i+1,i+columns,i+columns+1)+bilinear(east,i-Number(col>0),i,
      i+columns-Number(col>0),i+columns));
    out.v=.5*(bilinear(south,i,i+1,i+columns,i+columns+1)+bilinear(south,i-columns*Number(row>0),
      i+1-columns*Number(row>0),i,i+1));
    out.meanU=.5*(bilinear(flow.east,i,i+1,i+columns,i+columns+1)+bilinear(flow.east,i-Number(col>0),i,
      i+columns-Number(col>0),i+columns));
    out.meanV=.5*(bilinear(flow.south,i,i+1,i+columns,i+columns+1)+bilinear(flow.south,i-columns*Number(row>0),
      i+1-columns*Number(row>0),i,i+1));
    out.foam=bilinear(foam,i,i+1,i+columns,i+columns+1);
    out.runoff=runoff ? bilinear(runoff.marker.current,i,i+1,i+columns,i+columns+1) : 0;
    return out;
  }

  return {
    width,length,minX,minZ,columns,rows,maximumHeight,buffer,flowTexture:flow.texture,advance,pack,impact,depositFoam,
    enqueueRunoff,sample,heightAt,
    stopWaveMaker() { forcing=false; },
    inspect:()=>({columns,rows,waterCells,steps,hits,peakHeight:highest,peakSpeed:velocityPeak,peakFoam:foamPeak,
      energy,volume,peakCurrent,airInput,referenceDischarge:flow.discharge,forcing,sourceCells:source.length,
      runoff:runoff?.inspect() ?? null}),
  };
}
