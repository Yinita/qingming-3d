import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createLeafPack } from "../viewer/bridge-leaf-pack.js";

const blades=(x,z,yaw=0,y=0,mode="water",xSpeed=0,zSpeed=0)=>({
  position:{x,y,z},velocity:{x:xSpeed,z:zSpeed},yaw,yawSpeed:0,scale:{y:.18},mode,
});
function outline(leaf,shape) {
  const {x,y,z}=leaf.position, c=Math.cos(leaf.yaw),s=Math.sin(leaf.yaw);
  shape.rim.length=0;
  for(let i=0;i<10;i++) {
    const angle=i*Math.PI/5;
    const u=.027*Math.cos(angle), v=.083*Math.sin(angle);
    shape.rim.push(x+u*c+v*s,z+v*c-u*s);
  }
  shape.minY=y-.003; shape.maxY=y+.005;
}
function packed(list,wall=Infinity) {
  const contact=createLeafPack(list.length,outline,(leaf,dx,dz)=>{
    const max=wall-leaf.position.x-.028;
    const part=dx>0 ? Math.max(0,Math.min(1,max/dx)) : 1;
    leaf.position.x+=dx*part;leaf.position.z+=dz*part;
    return part;
  });
  list.forEach((leaf,index)=>{leaf.index=index;});
  return contact;
}
function area(leaf) {
  const shape={rim:[]};
  outline(leaf,shape);
  const points=[];
  for(let i=0;i<shape.rim.length;i+=2) points.push(shape.rim.slice(i,i+2));
  return points;
}
function intersection(a,b) {
  let polygon=area(a);
  const other=area(b);
  for(let i=0;i<other.length && polygon.length;i++) {
    const [x,z]=other[i], [endX,endZ]=other[(i+1)%other.length];
    const side=p=>(endX-x)*(p[1]-z)-(endZ-z)*(p[0]-x);
    const edges=polygon;
    polygon=[];
    for(let j=0;j<edges.length;j++) {
      const p=edges[j],q=edges[(j+1)%edges.length];
      const d=side(p),e=side(q);
      if(d>=0) polygon.push(p);
      if((d<0)===(e<0)) continue;
      const t=d/(d-e);
      polygon.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);
    }
  }
  return Math.abs(polygon.reduce((sum,p,i)=>{
    const q=polygon[(i+1)%polygon.length];
    return sum+p[0]*q[1]-p[1]*q[0];
  },0))*.5;
}

const [a,b]=[blades(-.03,0,.18,0,"water",.31,.17),blades(.012,.033,-.48,0,"water",-.25,-.12)];
const collision=packed([a,b]);
const originalOverlap=intersection(a,b);
const momentum=[a.velocity.x+b.velocity.x,a.velocity.z+b.velocity.z];
for(let i=0;i<8;i++) collision.step([a,b],i/60);
assert.ok(originalOverlap>.001 && intersection(a,b)<.00002);
assert.ok(Math.abs(a.velocity.x+b.velocity.x-momentum[0])<1e-9);
assert.ok(Math.abs(a.velocity.z+b.velocity.z-momentum[1])<1e-9);
assert.ok(Math.abs(a.yawSpeed)+Math.abs(b.yawSpeed)>.1);
const encounter={...collision.inspect(),before:originalOverlap,after:intersection(a,b),
  positions:[a.position,b.position],yawSpeeds:[a.yawSpeed,b.yawSpeed]};

const pile=[blades(.143,0,.04,0,"land"),blades(.111,.031,-.10,0,"water",.55),
  blades(.055,.029,.23,0,"water",.51),blades(.01,.067,.52,0,"water",.48)];
pile[0].stoneRest=true;
const shoreline=packed(pile,.171);
const pressure=[];
for(let i=0;i<45;i++) {
  shoreline.step(pile,i/60);
  assert.ok(pile.every(l=>l.position.x<=.1430000001));
  if(i%5===0) pressure.push(shoreline.inspect());
}
const held=shoreline.inspect();
assert.ok(held.touches>4 && held.blocked>0 && held.peakPairs>=2,JSON.stringify(held));
let remainingOverlap=0;
for(let i=0;i<pile.length;i++) for(let j=i+1;j<pile.length;j++) remainingOverlap+=intersection(pile[i],pile[j]);
assert.ok(remainingOverlap<.00023,remainingOverlap);
const vertical=[blades(0,0,0,0),blades(0,0,0,.024,"land")];
const separated=packed(vertical);
separated.step(vertical,0);
assert.equal(separated.inspect().touches,0);
assert.equal(vertical[0].position.x,vertical[1].position.x);
const report={encounter,held,remainingOverlap,pressure,vertical:separated.inspect()};
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({encounter,held,remainingOverlap},null,2));
