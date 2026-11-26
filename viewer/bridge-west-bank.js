import { MathUtils } from "three";

const {smoothstep}=MathUtils;
export const gardenBounds={west:-82.54,east:-76.18,south:-35.94,north:-28.72};
export const gardenGate={x:gardenBounds.east,z:-32.78,width:1.58};
export const vergeEdge=-73.25;
const cropRows=[-81.54,-80.17,-78.87,-77.53];
export const cropBeds=cropRows.flatMap((x,i)=>[
  {x,z:-34.64,length:1.69,wide:i%2===0},
  {x,z:-30.78,length:2.23,wide:i%2===1},
]);
export const westBankTrees=[
  [-83.14,-34.55,4.95,4.85],[-82.25,-28.42,4.32,4.67],[-77.03,-28.45,5.25,4.32],
  [-87.26,-29.98,5.00,4.61],[-88.17,-38.25,4.76,4.27],[-94.35,-32.07,5.84,5.19],
  [-102.54,-28.45,6.25,5.30],[-115.01,-37.42,6.93,4.61],[-110.45,-19.01,7.30,5.17],
].map(([x,z,h,w],i)=>({id:"o"+(9017+i*37),x,z,h,w,detail:i<3 ? .78 : i<5 ? .51 : .34}));

export function westBankAccess(x,z) {
  return x>=gardenBounds.west && x<=vergeEdge && z>=gardenBounds.south && z<=gardenBounds.north;
}

export function westBankRelief(x,z) {
  if(x>-72 || z<-50 || z>-7) return 0;
  const inland=1-smoothstep(x,-83.7,-73.2);
  const within=smoothstep(z,-46,-39.8)*(1-smoothstep(z,-22.5,-12));
  const rise=within*inland*(.089+.033*Math.sin(z*.65)+.020*Math.cos(x*.92+z*.29));
  const behind=(1-smoothstep(x,-114,-84.4))*within;
  let y=rise+behind*Math.max(.08,.61+.44*Math.sin(x*.19+z*.10)+.32*Math.sin(z*.22-x*.093));
  const track=-74.62+.21*Math.sin((z+35.7)*.86);
  const span=Math.abs(x-track);
  const laneFade=smoothstep(z,-40,-38.76)*(1-smoothstep(z,-29.8,-28.4));
  const shoulder=smoothstep(span,.51,.94)*(1-smoothstep(span,1.02,1.76));
  y+=laneFade*((.031+.011*Math.sin(z*2.3))*shoulder+.014*(1-smoothstep(span,.23,.77)));
  for(const bed of cropBeds) {
    const row=Math.abs(x-bed.x), end=Math.abs(z-bed.z);
    if(row>.45 || end>bed.length*.5+.14) continue;
    y+=.134*(1-smoothstep(row,.13,.44))*(1-smoothstep(end,bed.length*.41,bed.length*.5+.13));
  }
  return y;
}

// The painted earth, collision bounds, and fitted ground all share the gate coordinates.
export const westBankEarthGLSL=`
  float westLane(vec2 p) {
    float crown=-74.62+.21*sin((p.y+35.7)*.86);
    float spine=(1.-smoothstep(.42,1.04,abs(p.x-crown)))*
      smoothstep(-40.,-38.2,p.y)*(1.-smoothstep(-29.4,-28.4,p.y));
    float across=(1.-smoothstep(.41,.87,abs(p.y+ ${(-gardenGate.z).toFixed(2)})))*
      smoothstep(-82.4,-81.8,p.x)*(1.-smoothstep(-74.3,-73.6,p.x));
    return max(spine,across);
  }
  float gardenLoamPatch(vec2 p,vec2 center,float halfLength,float radius,float uneven) {
    vec2 q=p-center;
    float along=abs(q.y)/halfLength;
    float taper=.74+.26*pow(max(0.,cos(min(1.,along)*1.5708)),.45);
    float edge=max(along,abs(q.x+.014*sin(q.y*6.2+center.x))/(radius*taper));
    return 1.-smoothstep(.84,1.15,edge+uneven*.19);
  }
  uniform vec3 gardenWater[${cropBeds.length}];
  float gardenLoam(vec2 p,float uneven,out float wet) {
    wet=0.;
    if(p.x<-82.15 || p.x>-76.86 || p.y<-35.70 || p.y>-29.4) return 0.;
    float soil=0., bedMask;
    ${cropBeds.map(({x,z,length,wide},i)=>
      `bedMask=gardenLoamPatch(p,vec2(${x.toFixed(3)},${z.toFixed(3)}),${(length*.5).toFixed(3)},${wide ? ".398" : ".372"},uneven);
    soil=max(soil,bedMask);
    wet=max(wet,bedMask*gardenWater[${i}].z*
      (.32+.68*(1.-smoothstep(.14,.98,length((p-gardenWater[${i}].xy)*vec2(1.62,1.))+uneven*.23))));`
    ).join("\n    ")}
    return soil;
  }
`;
