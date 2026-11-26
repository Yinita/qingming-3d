import { MathUtils } from "three";

const {smoothstep}=MathUtils;
export const fieldBounds={west:-108.8,east:-82.54,south:-43.4,north:-22.7};
export const fieldOpening={x:fieldBounds.east,z:-32.78,width:1.66};
export const fieldShed={x:-103.62,z:-31.20,width:5.26,depth:3.43};
export const drainage={south:-41.45,north:-24.72,depth:.315};
export const channelX=z=>-89.76+.36*Math.sin((z+33.07)*.55)+.13*Math.sin((z+33.07)*1.01);
export const channelFade=z=>smoothstep(z,drainage.south,drainage.south+1.13)*
  (1-smoothstep(z,drainage.north-.83,drainage.north));
export const fieldRoadZ=x=>{
  const span=Math.max(0,fieldBounds.east-x);
  return fieldOpening.z-.052*span+.255*Math.sin(span*.43);
};
export const fieldBridges=[
  {z:-33.34,width:1.64,length:2.56,stone:false},
  {z:-37.23,width:1.24,length:2.45,stone:true},
].map(bridge=>({...bridge,x:channelX(bridge.z)}));
export const fieldPlots=[
  {x:-85.70,z:-37.55,halfX:2.34,halfZ:3.46,row:.53,type:"millet",seed:4181},
  {x:-85.73,z:-27.32,halfX:2.20,halfZ:2.74,row:.58,type:"grass",seed:827},
  {x:-95.14,z:-29.31,halfX:3.88,halfZ:2.91,row:.62,type:"buckwheat",seed:7052},
  {x:-95.12,z:-38.64,halfX:3.52,halfZ:2.43,row:.59,type:"stubble",seed:1303},
  {x:-103.25,z:-39.15,halfX:2.68,halfZ:2.45,row:.61,type:"millet",seed:2107},
];
export const fieldRoute=[
  {x:-81.94,z:fieldOpening.z,reach:.73,label:"菜园西口"},
  {x:-84.44,z:fieldRoadZ(-84.44),reach:.84,label:"田间小路"},
  {x:-88.22,z:fieldBridges[0].z,reach:.56,label:"沟渠木桥"},
  {x:-91.28,z:fieldBridges[0].z,reach:.70,label:"过木桥"},
  {x:-95.86,z:fieldRoadZ(-95.86),reach:.90,label:"田间小路"},
  {x:fieldShed.x,z:-34.10,label:"西岸粮棚"},
];

export function insideFields(x,z) {
  return x>=fieldBounds.west && x<=fieldBounds.east+.15 && z>=fieldBounds.south && z<=fieldBounds.north;
}

export function fieldsFooting(x,z) {
  if(channelFade(z)<.58 || Math.abs(x-channelX(z))>.51) return true;
  return fieldBridges.some(bridge=>Math.abs(z-bridge.z)<bridge.width*.5-.12);
}

export function fieldRelief(x,z) {
  if(x>fieldBounds.east+.11 || x<-138 || z<-51 || z>-12) return 0;
  const within=smoothstep(z,-49,-42)*(1-smoothstep(z,-23,-15));
  const fromGarden=1-smoothstep(x,-88.2,fieldBounds.east);
  const foothill=within*fromGarden*(.238+.091*Math.sin(x*.36+z*.17)+.056*Math.cos(z*.31-x*.23));
  const hillside=(1-smoothstep(x,-129,-107))*within*(.53+.27*Math.sin(x*.23-z*.09));
  const shoulder=Math.abs(z-fieldRoadZ(x));
  const road=(1-smoothstep(shoulder,0,1.06))*fromGarden*
    (.034+.011*Math.sin(x*1.8+z*.71))*(1-smoothstep(-x,105,111));
  const cut=x>-91.5 && x<-87.5 ?
    drainage.depth*channelFade(z)*(1-smoothstep(Math.abs(x-channelX(z)),.24,.86)) : 0;
  const bankRise=(.054*channelFade(z)+.121*smoothstep(z,-42.1,-40.70)*(1-smoothstep(z,-38.65,-35.45)))*
    (1-smoothstep(Math.abs(x-channelX(z)),1.12,3.10));
  let ridges=0;
  for(const plot of fieldPlots) {
    const u=Math.abs(x-plot.x)/plot.halfX,v=Math.abs(z-plot.z)/plot.halfZ;
    if(u>=1 || v>=1) continue;
    const section=(1-smoothstep(Math.max(u,v),.81,1))*
      (.036+.027*Math.cos(Math.PI*2*(x+.047*Math.sin(z*.7))/plot.row));
    ridges+=section;
  }
  return foothill+hillside+road+ridges+bankRise-cut;
}

export const fieldsGLSL=`
  float fieldChannel(float z) {
    return -89.76+.36*sin((z+33.07)*.55)+.13*sin((z+33.07)*1.01);
  }
  float fieldCartway(vec2 p) {
    float d=max(0.,-82.54-p.x);
    float z=-32.78-.052*d+.255*sin(d*.43);
    float tread=(1.-smoothstep(.53,1.18,abs(p.y-z)))*(1.-smoothstep(23.8,27.6,d))*
      (1.-smoothstep(-82.25,-81.67,p.x));
    float side=(1.-smoothstep(.29,.82,abs(p.y-(${fieldBridges[1].z.toFixed(2)})+.19*sin((p.x+90.)*.53))))*
      smoothstep(-104.8,-101.2,p.x)*(1.-smoothstep(-86.3,-83.5,p.x));
    return max(tread,side*.73);
  }
  vec3 fieldPigments(vec2 p,float rough) {
    if(p.x>-82.25 || p.x<-134. || p.y<-47. || p.y>-17.) return vec3(0.);
    float skirt=(1.-smoothstep(-85.,-82.44,p.x))*
      smoothstep(-47.,-41.,p.y)*(1.-smoothstep(-25.,-17.,p.y));
    float greens=skirt*(.35+.29*rough), furrow=0.;
    float channel=(1.-smoothstep(.42,.91,abs(p.x-fieldChannel(p.y))))*
      smoothstep(-41.45,-40.32,p.y)*(1.-smoothstep(-25.55,-24.72,p.y));
    ${fieldPlots.map(({x,z,halfX,halfZ,row,type})=>`
      { vec2 d=abs(p-vec2(${x.toFixed(3)},${z.toFixed(3)}))/vec2(${halfX.toFixed(3)},${halfZ.toFixed(3)});
        float edge=1.-smoothstep(.82,1.02,max(d.x,d.y)+.065*(rough-.5));
        float bars=.5+.5*cos(6.283185*(p.x+.047*sin(p.y*.7))/${row.toFixed(3)});
        greens=max(greens,edge*(${type==="stubble" ? ".20+.13*bars" : ".46+.41*bars"}));
        furrow=max(furrow,edge*(.34+.49*(1.-bars)));}
    `).join("")}
    float tread=fieldCartway(p);
    return vec3(greens*(1.-tread),furrow*(1.-tread),channel);
  }
`;
