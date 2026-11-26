import * as THREE from "three";

const {clamp,lerp,smoothstep}=THREE.MathUtils;
const pixel=.02, width=512, height=320;
const west=-48, south=-37.60;
const sampleSpacing=.037;
const trackBounds=new THREE.Vector4(west,south,1/(width*pixel),1/(height*pixel));

export function createWheelTracks() {
  // Red is compression, green is displaced soil, and blue is retained moisture.
  const pixels=new Uint8Array(width*height*4);
  const softGround=new Uint8Array(width*height);
  const map=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);
  map.name="North lane wheel impressions";
  map.minFilter=map.magFilter=THREE.LinearFilter;
  map.needsUpdate=true;
  const uniforms={
    wheelTrackMap:{value:map},
    wheelTrackBounds:{value:trackBounds},
    wheelTrackActive:{value:0},
    wheelTrackRain:{value:0},
  };
  const rolls=[-1,1].map(side=>({side,remainder:0,distance:0,stamps:0,hard:0,last:null}));
  let road=null,moisture=null,dirty=false,uploadAt=0,marked=0,peak=0;
  const recent=[];
  const groundX=i=>west+(i+.5)*pixel;
  const groundZ=j=>south+(j+.5)*pixel;
  const col=x=>Math.floor((x-west)/pixel);
  const row=z=>Math.floor((z-south)/pixel);

  function configure(surface,wetness) {
    road=surface;
    moisture=wetness;
    softGround.fill(0);
  }

  function stamp(roll,x,y,z,tx,tz,pressure,tyre,time) {
    if(road(x,z)!=="earth") {
      roll.hard++;
      return;
    }
    const wet=moisture(x,y,z);
    const core=tyre*.5*(1+.29*wet+.12*(pressure-1));
    const reach=core+.034;
    const softness=lerp(.61,1.24,wet);
    const left=Math.max(0,col(x-.112)),right=Math.min(width-1,col(x+.112));
    const bottom=Math.max(0,row(z-.112)),top=Math.min(height-1,row(z+.112));
    let added=false;
    for(let j=bottom;j<=top;j++) for(let i=left;i<=right;i++) {
      const dx=groundX(i)-x, dz=groundZ(j)-z;
      const lateral=Math.abs(dx*tz-dz*tx),along=Math.abs(dx*tx+dz*tz);
      if(lateral>reach || along>.060) continue;
      const index=j*width+i;
      if(!softGround[index]) softGround[index]=road(groundX(i),groundZ(j))==="earth" ? 1 : 2;
      if(softGround[index]!==1) continue;
      const pass=1-smoothstep(along,.013,.060);
      const edge=.004*Math.sin(groundX(i)*117.2+Math.sin(groundZ(j)*86.3));
      const bed=(1-smoothstep(lateral,core*.66+edge,core+.007+edge))*pass;
      const shoulder=smoothstep(lateral,core-.003,core+.010)*
        (1-smoothstep(lateral,core+.016,reach))*pass;
      const bite=Math.round(38*pressure*softness*bed);
      const crumbs=Math.round(27*pressure*(.52+.48*wet)*shoulder);
      if(!bite && !crumbs) continue;
      const pixelIndex=index*4;
      if(!pixels[pixelIndex+3]) marked++;
      pixels[pixelIndex]=Math.min(255,pixels[pixelIndex]+bite);
      pixels[pixelIndex+1]=Math.min(195,pixels[pixelIndex+1]+crumbs);
      pixels[pixelIndex+2]=Math.max(pixels[pixelIndex+2],Math.round(255*wet*bed));
      pixels[pixelIndex+3]=255;
      peak=Math.max(peak,pixels[pixelIndex]);
      added=true;
    }
    if(!added) return;
    roll.stamps++;
    roll.last={x,y,z,wet,pressure,time};
    recent.push({...roll.last,side:roll.side});
    if(recent.length>32) recent.shift();
    dirty=true;
  }

  function record(index,from,to,time,pressure,tyre) {
    if(!road) return;
    const dx=to.x-from.x,dz=to.z-from.z, length=Math.hypot(dx,dz);
    if(length<.0005) return;
    const roll=rolls[index];
    if(length>.30) {
      roll.remainder=0;
      return;
    }
    roll.distance+=length;
    // Step in world metres so the stamp density follows distance at every frame rate.
    let at=sampleSpacing-roll.remainder;
    for(;at<=length;at+=sampleSpacing) {
      const t=at/length;
      stamp(roll,from.x+dx*t,lerp(from.y,to.y,t),from.z+dz*t,dx/length,dz/length,pressure,tyre,time);
    }
    roll.remainder=clamp(length-at+sampleSpacing,0,sampleSpacing);
  }

  function update(time,rain) {
    uniforms.wheelTrackRain.value=rain;
    if(!dirty || time<uploadAt) return;
    map.needsUpdate=true;
    dirty=false;
    uploadAt=time+.083;
    uniforms.wheelTrackActive.value=1;
  }

  function reset() {
    pixels.fill(0);
    marked=peak=0;
    dirty=false;
    uploadAt=0;
    recent.length=0;
    for(const roll of rolls) Object.assign(roll,{remainder:0,distance:0,stamps:0,hard:0,last:null});
    uniforms.wheelTrackActive.value=0;
    uniforms.wheelTrackRain.value=0;
    map.needsUpdate=true;
  }

  return {uniforms,configure,record,update,reset,
    inspect:()=>({marked,peak:peak/255,rolls:rolls.map(({remainder,...roll})=>({...roll})),recent:recent.slice()}),
  };
}

export const wheelTrackGLSL=`
  uniform sampler2D wheelTrackMap;
  uniform vec4 wheelTrackBounds;
  uniform float wheelTrackActive, wheelTrackRain;
  vec2 wheelTrackUV(vec2 p) {
    return (p-wheelTrackBounds.xy)*wheelTrackBounds.zw;
  }
  vec3 wheelSurface(vec2 p) {
    vec2 uv=wheelTrackUV(p);
    if(wheelTrackActive<.5 || any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) return vec3(0.);
    return texture2D(wheelTrackMap,uv).rgb;
  }
  float wheelHeight(vec2 uv) {
    vec2 road=texture2D(wheelTrackMap,uv).rg;
    return .009*road.y-.018*road.x;
  }
  vec2 wheelSlope(vec2 p) {
    vec2 uv=wheelTrackUV(p);
    vec2 e=.02*wheelTrackBounds.zw;
    return vec2(wheelHeight(uv+vec2(e.x,0.))-wheelHeight(uv-vec2(e.x,0.)),
                wheelHeight(uv+vec2(0.,e.y))-wheelHeight(uv-vec2(0.,e.y)))/.04;
  }
`;
