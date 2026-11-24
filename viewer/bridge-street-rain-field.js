import { createStreetRunoff } from "./bridge-street-runoff.js";

const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export function createStreetRainField({width,height,bed,blocked,whichRiver,basin,deck,open,area}) {
  const count=width*height;
  const wet=new Float32Array(count), raised=new Float32Array(count);
  const solid=blocked.slice(), sky=open.slice();
  const flow=createStreetRunoff(width,height,bed,solid,whichRiver,area);
  let maximum=0, peakCostMs=0;

  function changeCover(cover) {
    if(!cover) return;
    for(let i=0;i<count;i++) {
      if(!solid[i] && cover.blocked[i]) flow.displace(i);
      if(sky[i] && !cover.open[i]) wet[i]*=.06;
    }
    sky.set(cover.open);
    solid.set(cover.blocked);
  }

  function deposit(index,amount,elevated,runoff) {
    if(elevated) {
      raised[index]=Math.min(1,raised[index]+amount*1.8);
      return;
    }
    const col=index%width,row=Math.floor(index/width);
    for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++) {
      if(col+di<0 || col+di>=width || row+dj<0 || row+dj>=height) continue;
      const point=index+dj*width+di;
      const share=(sky[point] || (di===0 && dj===0) ? 1 : .04)/(1+2.1*(di*di+dj*dj));
      wet[point]=Math.min(1,wet[point]+amount*share);
      flow.add(point,amount*share*(runoff ? .83 : .19),runoff);
    }
    maximum=Math.max(maximum,wet[index]);
  }

  function tick(dt,intensity,extendOutlets) {
    const decay=Math.exp(-dt*.043);
    for(let i=0;i<count;i++) {
      const direct=intensity*sky[i];
      wet[i]=Math.min(1,wet[i]*decay+direct*(1-wet[i])*dt*.234);
      raised[i]=Math.min(1,raised[i]*decay+direct*deck[i]*(1-raised[i])*dt*.30);
    }
    flow.advance(dt,intensity,wet,sky,basin,extendOutlets);
  }

  function advance(request,buffers) {
    const start=performance.now();
    const {cover,input,dt,intensity}=request;
    changeCover(cover);
    for(let i=0;i<input.length;i+=4) deposit(input[i],input[i+1],input[i+2],input[i+3]);

    const steps=Math.max(1,Math.ceil(dt/.123));
    for(let i=0;i<steps;i++) tick(dt/steps,intensity,i>0);

    const pixels=new Uint8Array(buffers?.pixels ?? new ArrayBuffer(count*8));
    const grid=new Float32Array(buffers?.grid ?? new ArrayBuffer(count*24));
    const motionAt=count*4;
    for(let i=0;i<count;i++) {
      const h=flow.depth[i], mx=flow.motionX[i],mz=flow.motionZ[i], at=i*4;
      pixels[at]=Math.round(255*Math.max(wet[i],Math.min(1,h*1.27)));
      pixels[at+1]=Math.round(255*Math.min(1,h));
      pixels[at+2]=Math.round(255*raised[i]);
      pixels[at+3]=sky[i]*255;
      const movement=6.72/Math.max(.075,h);
      pixels[motionAt+at]=128+Math.round(127*clamp(mx*movement,-1,1));
      pixels[motionAt+at+1]=128+Math.round(127*clamp(mz*movement,-1,1));
      pixels[motionAt+at+2]=Math.round(255*Math.min(1,(Math.abs(mx)+Math.abs(mz))*14));
      const sample=i*6;
      grid[sample]=h;
      grid[sample+1]=flow.tracer[i];
      grid[sample+2]=mx;
      grid[sample+3]=mz;
      grid[sample+4]=wet[i];
      grid[sample+5]=raised[i];
    }
    const shoreline=[];
    for(const i of flow.outlets) {
      const amount=flow.shore[i];
      shoreline.push(i,amount,flow.shoreX[i]/amount,flow.shoreZ[i]/amount,flow.shoreTracer[i]);
    }
    const costMs=performance.now()-start;
    peakCostMs=Math.max(peakCostMs,costMs);
    return {pixels:pixels.buffer,grid:grid.buffer,shoreline,dt,stats:{maximum,costMs,peakCostMs,runoff:flow.inspect()}};
  }

  return {advance,resume(snapshot) {
    const grid=new Float32Array(snapshot.grid);
    for(let i=0;i<count;i++) {
      wet[i]=grid[i*6+4];
      raised[i]=grid[i*6+5];
    }
    flow.resume(grid,snapshot.stats.runoff);
    maximum=snapshot.stats.maximum;
    peakCostMs=snapshot.stats.peakCostMs;
  }};
}
