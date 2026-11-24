import { DataTexture, LinearFilter, MathUtils, Vector2, Vector4 } from "three";

const width=256, depth=144;
const elevations=[.10,2.55,5.35];
const volume=width*depth*elevations.length;
const bytes=new Uint8Array(volume*4);
const veil=new Float32Array(volume), sidestep=new Float32Array(volume);
const speedup=new Float32Array(volume), churn=new Float32Array(volume);
const map=new DataTexture(bytes,width,depth*elevations.length);
map.name="Street wake and shelter by height";
map.minFilter=map.magFilter=LinearFilter;
const bounds=new Vector4();
const wakeMix={value:1};
export const wakeUniforms={windWakes:{value:map},windWakeBounds:{value:bounds},windWakeMix:wakeMix};
const obstacles=[];
const bins=28, delay=.226;
const strength=new Float32Array(bins), gustPhase=new Float32Array(bins);
const speedBuffer=new Vector2(), posedCenter=new Vector2();
const {clamp,smoothstep,lerp}=MathUtils;
let atlasTime=-Infinity, updates=0, covered=0;
let east=.8660254,north=.5;

export function placeWakes(minX,minZ,spanX,spanZ,headingX,headingZ) {
  bounds.set(minX,minZ,1/spanX,1/spanZ);
  east=headingX;
  north=headingZ;
  obstacles.length=0;
  atlasTime=-Infinity;
  updates=covered=0;
  for(let i=0;i<bytes.length;i+=4) {
    bytes[i]=200;
    bytes[i+1]=128;
    bytes[i+2]=0;
    bytes[i+3]=255;
  }
  map.needsUpdate=true;
}

export function windScreen({x,z,along,cross,bottom=0,top,density,porous=true,pose=null,enabled=null,name="tree"}) {
  const serial=obstacles.length;
  obstacles.push({x,z,along,cross,bottom,top,density,porous,pose,enabled,name,phase:serial*2.39996,
    bakedX:Infinity,bakedZ:Infinity,cells:null,coefficients:null});
  atlasTime=-Infinity;
}

function stencil(site,x,z) {
  const {along,cross,bottom,top,density,porous}=site;
  const reach=along+cross*(porous ? 6.35 : 6.85)+1.1;
  const furthestCross=cross*2.68+1.0;
  const spanX=(Math.abs(east)*reach+Math.abs(north)*furthestCross);
  const spanZ=(Math.abs(north)*reach+Math.abs(east)*furthestCross);
  const xMin=clamp(Math.floor((x-spanX-bounds.x)*bounds.z*width),0,width-1);
  const xMax=clamp(Math.ceil((x+spanX-bounds.x)*bounds.z*width),0,width-1);
  const zMin=clamp(Math.floor((z-spanZ-bounds.y)*bounds.w*depth),0,depth-1);
  const zMax=clamp(Math.ceil((z+spanZ-bounds.y)*bounds.w*depth),0,depth-1);
  // Bake the spatial wake footprint and its advection delay. Updates only
  // evaluate the incoming gust at those delayed times.
  const which=[], coeff=[];
  const yCenter=(top+bottom)*.5;
  for(const [layer,y] of elevations.entries()) {
    const spreadY=Math.max(.68,(top-bottom)*(porous ? .61 : .44));
    const canopy=porous ? Math.exp(-.5*((y-yCenter)/spreadY)**2) : 1-smoothstep(y,top-.22,top+.84);
    const vertical=porous ? .23+.77*canopy : canopy;
    if(vertical<.012) continue;
    for(let row=zMin;row<=zMax;row++) {
      const rz=bounds.y+(row+.5)/(depth*bounds.w)-z;
      for(let col=xMin;col<=xMax;col++) {
        const rx=bounds.x+(col+.5)/(width*bounds.z)-x;
        const u=rx*east+rz*north,v=-rx*north+rz*east;
        if(u<-along*1.18 || u>reach) continue;
        const leeward=Math.max(0,u-along*.29);
        const gate=smoothstep(u,-along*.99,along*.26)*(1-smoothstep(u,reach*.70,reach));
        const widthAlong=cross*(.65+.17*Math.sqrt(1+leeward/Math.max(.65,cross)));
        const q=v/widthAlong, sign=Math.sign(q);
        if(Math.abs(q)>3.01) continue;
        const decay=Math.exp(-leeward/(cross*(porous ? 2.60 : 3.03)+.71));
        const core=Math.exp(-.64*q*q);
        const shoulder=Math.exp(-(((Math.abs(q)-1.14)*2.1)**2));
        const local=vertical*density;
        const deficit=local*gate*core*decay;
        const wrap=local*(.66+.34*gate)*shoulder*sign*
          Math.exp(-Math.abs(u-along*.11)/(along+cross*.93))* .34;
        const jet=local*shoulder*decay*(.035+.090*gate);
        const shake=local*gate*shoulder*decay*smoothstep(u,along*.48,along+cross*1.3)*.35;
        if(deficit+Math.abs(wrap)+jet+shake<.0075) continue;
        const delayBin=Math.min(bins-1,Math.round(leeward/(2.95*delay)));
        which.push((layer*depth+row)*width+col,delayBin);
        coeff.push(deficit,wrap,jet,shake);
      }
    }
  }
  site.cells=Int32Array.from(which);
  site.coefficients=Float32Array.from(coeff);
  site.bakedX=x;
  site.bakedZ=z;
}

export function refreshWakes(time,ambient,force=false) {
  if(!obstacles.length || (!force && time-atlasTime<.066)) return;
  for(const data of [veil,sidestep,speedup,churn]) data.fill(0);
  for(const site of obstacles) {
    if(site.enabled && !site.enabled()) continue;
    posedCenter.set(0,0);
    site.pose?.(posedCenter);
    const x=site.x+posedCenter.x,z=site.z+posedCenter.y;
    if(Math.hypot(x-site.bakedX,z-site.bakedZ)>.085) stencil(site,x,z);
    for(let k=0;k<bins;k++) {
      const past=time-k*delay;
      const speed=ambient(x,z,speedBuffer,past).length();
      strength[k]=.36+.69*smoothstep(speed,.33,3.17);
      gustPhase[k]=Math.sin(past*2.78+site.phase);
    }
    const cells=site.cells,a=site.coefficients;
    for(let i=0,j=0;i<cells.length;i+=2,j+=4) {
      const k=cells[i], lag=cells[i+1], power=strength[lag];
      const swirl=a[j+3]*power;
      veil[k]+=a[j]*power;
      sidestep[k]+=a[j+1]*power+swirl*.67*gustPhase[lag];
      speedup[k]+=a[j+2]*power;
      churn[k]+=swirl*(.63+.37*Math.abs(gustPhase[lag]));
    }
  }
  covered=0;
  for(let cell=0;cell<volume;cell++) {
    const i=cell*4;
    covered+=Number(veil[cell]>.085);
    // Overlapping wakes add optical-depth-like drag. Their transmissions
    // multiply, while the lateral and corner flows combine directly.
    const along=Math.exp(-Math.min(2.3,veil[cell]))+Math.min(.265,speedup[cell]);
    bytes[i]=Math.round(clamp(along*200,25,255));
    bytes[i+1]=Math.round(128+127*clamp(sidestep[cell]/.60,-1,1));
    bytes[i+2]=Math.round(255*clamp(churn[cell],0,1));
    bytes[i+3]=255;
  }
  atlasTime=time;
  updates++;
  map.needsUpdate=true;
}

const layers=new Float32Array(6);
function channel(x,z,layer,out,offset) {
  const i=Math.floor(x),j=Math.floor(z);
  const start=((layer*depth+j)*width+i)*4;
  const u=x-i,v=z-j;
  for(let c=0;c<3;c++) {
    const a=start+c,b=a+width*4;
    out[offset+c]=lerp(lerp(bytes[a],bytes[a+4],u),lerp(bytes[b],bytes[b+4],u),v);
  }
}

export function airWakeAt(x,z,height,out) {
  const u=clamp((x-bounds.x)*bounds.z*width-.5,0,width-1.001);
  const v=clamp((z-bounds.y)*bounds.w*depth-.5,0,depth-1.001);
  if(height<=elevations[0]) {
    channel(u,v,0,layers,0);
    const gain=wakeMix.value;
    return out.set(lerp(1,layers[0]/200,gain),(layers[1]-128)*(.60/127)*gain,layers[2]*gain/255);
  }
  const layer=height<elevations[1] ? 0 : 1;
  const t=clamp((height-elevations[layer])/(elevations[layer+1]-elevations[layer]),0,1);
  channel(u,v,layer,layers,0);
  channel(u,v,layer+1,layers,3);
  const open=1-smoothstep(height,5.88,9.05);
  const strength=open*wakeMix.value;
  return out.set(lerp(1,lerp(layers[0],layers[3],t)/200,strength),
    (lerp(layers[1],layers[4],t)-128)*(.60/127)*strength,
    lerp(layers[2],layers[5],t)*strength/255);
}

export function inspectWakes() {
  return {columns:width,rows:depth,elevations:elevations.slice(),obstacles:obstacles.length,
    trees:obstacles.filter(o=>o.porous).length,walls:obstacles.filter(o=>!o.porous).length,
    moving:obstacles.filter(o=>o.pose).length,updates,covered,atlasTime,
    sources:obstacles.map(o=>({name:o.name,position:[o.bakedX,o.bakedZ],offset:[o.bakedX-o.x,o.bakedZ-o.z]}))};
}

export const wakeGLSL=`
  uniform sampler2D windWakes;
  uniform vec4 windWakeBounds;
  uniform float windWakeMix;
  vec3 localWakeLayer(vec2 cell,float level) {
    float v=(cell.y+level)/3.;
    return texture2D(windWakes,vec2(cell.x,v)).rgb;
  }
  vec3 localWindWake(vec2 point,float y) {
    if(windWakeMix<.001 || y>9.05) return vec3(1.,0.,0.);
    vec2 cell=clamp((point-windWakeBounds.xy)*windWakeBounds.zw,
      vec2(.5/${width}.,.5/${depth}.),vec2(1.-.5/${width}.,1.-.5/${depth}.));
    float lower=y<2.55 ? 0. : 1.;
    float blend=clamp(lower<.5 ? (y-.10)/2.45 : (y-2.55)/2.80,0.,1.);
    vec3 field=localWakeLayer(cell,lower);
    if(blend>.001) field=mix(field,localWakeLayer(cell,lower+1.),blend);
    float strength=windWakeMix*(1.-smoothstep(5.88,9.05,y));
    return vec3(mix(1.,field.r*255./200.,strength),
      (field.g*255.-128.)*(.60/127.)*strength,field.b*strength);
  }
`;
