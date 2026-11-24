// Linear shallow-water perturbations on a staggered grid. Zero normal flux at
// dry cells and bridge piles lets the reflected field evolve after a source stops.
const gravity = 9.81;
const maximumHeight = .38;
const fixedStep = 1/66;
const limit = (value,low,high) => Math.max(low,Math.min(high,value));

export function createShallowWater({
  minX,minZ,width,length,columns=132,rows=216,depthAt,piers=[],current=.39,openEnds=true,
}) {
  const dx=width/columns, dz=length/rows, n=columns*rows;
  const floor=new Float32Array(n), damping=new Float32Array(n);
  const eastDepth=new Float32Array(n), southDepth=new Float32Array(n);
  const east=new Float32Array(n), south=new Float32Array(n);
  const nextEast=new Float32Array(n), nextSouth=new Float32Array(n);
  const pressure=new Float32Array(n), hullMask=new Float32Array(n);
  const buffer=new Uint8Array(n*4);
  let height=new Float32Array(n), nextHeight=new Float32Array(n);
  let foam=new Float32Array(n), nextFoam=new Float32Array(n);
  let remainder=0, steps=0, hits=0, waterCells=0, highest=0, velocityPeak=0, foamPeak=0;
  let energy=0, volume=0;

  for(let row=0;row<rows;row++){
    const z=minZ+(row+.5)*dz;
    for(let col=0;col<columns;col++){
      const x=minX+(col+.5)*dx;
      const i=row*columns+col;
      const depth=depthAt(x,z);
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

  function impact(x,z,strength,kind,vx=0,vz=0) {
    const sigma=kind==="stone" ? .39 : kind==="step" ? .30 : .215;
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
    const amplitude=strength*(kind==="stone" ? .157 : kind==="step" ? .105 : .055);
    const balance=negative/positive;
    for(let row=r0;row<=r1;row++){
      for(let col=c0;col<=c1;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const a=(minX+(col+.5)*dx-x)/sigma, b=(minZ+(row+.5)*dz-z)/sigma;
        const radius=a*a+b*b, gauss=Math.exp(-radius);
        const shape=(radius-1)*gauss;
        height[i]+=amplitude*shape*(shape>0 ? balance : 1);
        foam[i]=Math.min(1,foam[i]+gauss*strength*(kind==="stone" ? .87 : kind==="step" ? .49 : .01));
        if(eastDepth[i]) east[i]+=.28*strength*gauss*(a+.3*vx);
        if(southDepth[i]) south[i]+=.28*strength*gauss*(b+.3*vz);
      }
    }
    hits++;
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
    const dt=fixedStep, advection=current*dt/dz;
    for(let row=0;row<rows;row++){
      for(let col=0;col<columns;col++){
        const i=row*columns+col;
        if(!floor[i]) continue;
        const above=row===0 ? i : i-columns;
        const drag=.24+damping[i];
        const load=hullMask[i];
        const surface=height[i]+pressure[i];
        if(eastDepth[i]){
          const u=east[i];
          const adv=eastDepth[above] ? advection*(east[above]-u) : 0;
          const contact=load>0 ? load*3.0*(motion.x-u) : 0;
          nextEast[i]=(u+adv+dt*(gravity*(surface-height[i+1]-pressure[i+1])/dx+contact))*(1-drag*dt);
        }
        if(southDepth[i]){
          const v=south[i];
          const adv=southDepth[above] ? advection*(south[above]-v) : 0;
          const contact=load>0 ? load*3.5*(motion.y-current-v) : 0;
          nextSouth[i]=(v+adv+dt*(gravity*(surface-height[i+columns]-pressure[i+columns])/dz+contact))*(1-drag*dt);
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
        const along=floor[north] ? advection*(height[north]-oldHeight) : 0;
        nextHeight[i]=(oldHeight+along-dt*(fluxX+fluxZ))*(1-dt*damping[i]);
        const speedX=.5*(goX+incomingX);
        const speedZ=current+.5*(goZ+incomingZ);
        const oldFoam=foam[i], upX=speedX>=0 ? left : right, upZ=speedZ>=0 ? north : southCell;
        const shiftX=floor[upX] ? abs(speedX)*dt/dx*(foam[upX]-oldFoam) : 0;
        const shiftZ=floor[upZ] ? abs(speedZ)*dt/dz*(foam[upZ]-oldFoam) : 0;
        const crest=max(0,(goX-incomingX)/dx+(goZ-incomingZ)/dz - .25);
        const shear=abs(nextEast[i]-nextEast[north])/dz+abs(nextSouth[i]-nextSouth[left])/dx;
        const breaking=max(0,(abs(oldHeight)*12+.53*crest+.24*shear)-.24);
        const scatter=min(2.8,breaking)*(.37+.23*min(1,1.2/floor[i]));
        nextFoam[i]=limit((oldFoam+shiftX+shiftZ+dt*scatter)*(1-dt*(.51+damping[i])),0,1);
      }
    }
    east.set(nextEast);
    south.set(nextSouth);
    [height,nextHeight]=[nextHeight,height];
    [foam,nextFoam]=[nextFoam,foam];
    steps++;
  }

  function advance(dt,hull,motion=null) {
    remainder+=Math.min(.085,dt);
    if(remainder<fixedStep) return false;
    forceHull(hull,motion);
    while(remainder>=fixedStep){
      step(motion);
      remainder-=fixedStep;
    }
    return true;
  }

  function pack() {
    highest=velocityPeak=foamPeak=energy=volume=0;
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
        highest=Math.max(highest,Math.abs(h));
        velocityPeak=Math.max(velocityPeak,speed);
        foamPeak=Math.max(foamPeak,foam[i]);
        energy+=h*h;
        volume+=h*dx*dz;
      }
    }
    return buffer;
  }

  function sample(x,z,out={}) {
    const u=limit((x-minX)/dx-.5,0,columns-1.001), v=limit((z-minZ)/dz-.5,0,rows-1.001);
    const col=Math.floor(u), row=Math.floor(v), i=row*columns+col;
    const ax=u-col, az=v-row;
    function bilinear(data,i0,i1,i2,i3) {
      return (1-az)*((1-ax)*data[i0]+ax*data[i1])+az*((1-ax)*data[i2]+ax*data[i3]);
    }
    out.height=bilinear(height,i,i+1,i+columns,i+columns+1);
    out.u=.5*(bilinear(east,i,i+1,i+columns,i+columns+1)+bilinear(east,i-Number(col>0),i,
      i+columns-Number(col>0),i+columns));
    out.v=.5*(bilinear(south,i,i+1,i+columns,i+columns+1)+bilinear(south,i-columns*Number(row>0),
      i+1-columns*Number(row>0),i,i+1));
    out.foam=bilinear(foam,i,i+1,i+columns,i+columns+1);
    return out;
  }

  return {
    width,length,minX,minZ,columns,rows,maximumHeight,buffer,advance,pack,impact,sample,
    inspect:()=>({columns,rows,waterCells,steps,hits,peakHeight:highest,peakSpeed:velocityPeak,peakFoam:foamPeak,energy,volume}),
  };
}
