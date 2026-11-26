import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { riverWorker } from "./bridge-people.js";

export const wheelRadius=.434;
export const wheelTrack=.647;
export const wheelTyreWidth=.065;
export const cargoFloor=.183;
export const passengerBench={y:.619,z:.544};
export const freightBed={y:cargoFloor+.018,front:-.069,tail:.648};
const driverBench={y:.455,z:-.495};
const PI=Math.PI, up=new THREE.Vector3(0,1,0);

function mesh(parent,geometry,material,name) {
  if(material.vertexColors && !geometry.hasAttribute("color")) {
    const colors=new Float32Array(geometry.attributes.position.count*3).fill(1);
    geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  }
  const part=new THREE.Mesh(geometry,material);
  part.name=name;
  part.castShadow=part.receiveShadow=true;
  parent.add(part);
  return part;
}

function material(color,roughness=.86,metalness=0) {
  return new THREE.MeshStandardMaterial({color,roughness,metalness});
}

function fittings(parent,name) {
  const parts=new Map(), turn=new THREE.Quaternion(), axis=new THREE.Vector3();
  function add(mat,g,x,y,z) {
    g.translate(x,y,z);
    if(!parts.has(mat)) parts.set(mat,[]);
    parts.get(mat).push(g);
  }
  function box(mat,w,h,d,x,y,z,phase=0) {
    add(mat,detailedBox(w,h,d,mat,.013,phase),x,y,z);
  }
  function rod(mat,from,to,r1,r2=r1,sides=10) {
    const a=new THREE.Vector3(...from), b=new THREE.Vector3(...to);
    axis.copy(b).sub(a);
    const length=axis.length();
    const g=new THREE.CylinderGeometry(r2,r1,length,sides);
    g.applyQuaternion(turn.setFromUnitVectors(up,axis.multiplyScalar(1/length)));
    add(mat,g,...a.lerp(b,.5).toArray());
  }
  function finish() {
    for(const [mat,geometries] of parts) {
      mesh(parent,mergeGeometries(geometries),mat,name);
      geometries.forEach(geometry=>geometry.dispose());
    }
  }
  return {box,rod,add,finish};
}

// Sections follow the sternum, ribs and haunches instead of joining separate spheres.
function loft(sections,segments=24) {
  const position=[],uv=[],color=[],index=[];
  const columns=segments+1;
  for(let j=0;j<sections.length;j++) {
    const [z,y,width,height]=sections[j];
    for(let i=0;i<=segments;i++) {
      const u=i/segments, angle=2*PI*u;
      const c=Math.cos(angle),s=Math.sin(angle);
      const flank=1+.034*Math.cos(angle*3+z*9);
      position.push(s*width*flank,y+c*height,z);
      uv.push(u,z);
      const backStripe=Math.max(0,c)**21;
      const tone=.86+.12*c+.045*Math.sin(34*z+angle*9)-.38*backStripe;
      color.push(tone,tone*(.98+.034*c),tone*(.94+.046*c));
      if(i&&j) {
        const d=j*columns+i,b=d-columns;
        index.push(b-1,d-1,b,b,d-1,d);
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(position,3));
  g.setAttribute("normal",new THREE.Float32BufferAttribute(new Float32Array(position.length),3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute("color",new THREE.Float32BufferAttribute(color,3));
  g.setIndex(index);
  g.computeVertexNormals();
  const n=g.attributes.normal;
  const left=new THREE.Vector3(), right=new THREE.Vector3();
  for(let row=0;row<sections.length;row++) {
    const a=row*columns,b=a+segments;
    left.fromBufferAttribute(n,a).add(right.fromBufferAttribute(n,b)).normalize();
    n.setXYZ(a,left.x,left.y,left.z);
    n.setXYZ(b,left.x,left.y,left.z);
  }
  return g;
}

function donkey(root) {
  const hide=material(0x94816e), muzzle=material(0xb6a18b,.82);
  const mane=material(0x473c34), hoofMat=material(0x423b34,.73);
  const iris=material(0x211910,.34), lid=material(0x594638);
  const leather=material(0x4c3929,.73);
  hide.vertexColors=true;
  hide.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec2 furUV;")
      .replace("#include <uv_vertex>","#include <uv_vertex>\nfurUV=uv;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nvarying vec2 furUV;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        vec2 hair=vec2(furUV.x*415.+2.6*sin(furUV.y*31.),furUV.y*194.);
        float fibers=sin(hair.x+sin(hair.y*.34)*1.3)+.43*sin(hair.x*1.76+hair.y*.31);
        float resolved=1.-smoothstep(.31,1.65,max(fwidth(hair.x),fwidth(hair.y)));
        float coatTone=.94+.024*sin(furUV.x*65.+furUV.y*43.)+.031*cos(furUV.x*39.-furUV.y*54.);
        diffuseColor.rgb*=coatTone+.058*fibers*resolved;
      `);
  };
  hide.customProgramCacheKey=()=>"donkey-short-coat";
  const horse=new THREE.Group();
  horse.name="Articulated pack donkey";
  root.add(horse);
  mesh(horse,loft([
    [-.585,1.02,.009,.016],[-.528,1.055,.106,.146],[-.457,.954,.165,.256],
    [-.34,.833,.190,.282],[-.23,.808,.202,.222],[-.06,.775,.236,.221],
    [.13,.758,.242,.221],[.26,.764,.222,.207],[.36,.773,.216,.203],
    [.47,.774,.193,.18],[.55,.779,.112,.131],[.58,.786,.012,.022],
  ]),hide,"Donkey ribcage, shoulders and haunches");
  const joint=new THREE.Group();
  joint.position.set(0,1.054,-.429);
  horse.add(joint);
  mesh(joint,loft([
    [-.350,-.105,.026,.026],[-.33,-.102,.061,.057],[-.294,-.072,.073,.078],
    [-.237,-.028,.073,.096],[-.174,.025,.079,.109],[-.11,.064,.090,.107],
    [-.054,.075,.105,.085],[.032,.068,.095,.081],[.086,.06,.039,.055],[.105,.049,.007,.012],
  ]),hide,"Donkey skull and muzzle");
  const tip=mesh(joint,new THREE.SphereGeometry(1,20,13),muzzle,"Muzzle and lower lip");
  tip.position.set(0,-.113,-.305);
  tip.scale.set(.067,.053,.050);
  const ears=[];
  for(const side of [-1,1]) {
    const ear=new THREE.Group();
    ear.position.set(side*.070,.132,-.037);
    ear.rotation.z=-side*.17;
    joint.add(ear);
    const shell=new THREE.SphereGeometry(1,17,13);
    shell.scale(.040,.128,.026);
    shell.translate(0,.092,0);
    mesh(ear,shell,hide,"Tapered ear");
    const inner=mesh(ear,new THREE.SphereGeometry(1,14,10),muzzle,"Ear interior");
    inner.scale.set(.026,.091,.011);
    inner.position.set(0,.102,-.018);
    ears.push(ear);
    const eye=mesh(joint,new THREE.SphereGeometry(1,14,10),iris,"Eye");
    eye.scale.set(.012,.016,.024);
    eye.position.set(side*.093,.054,-.135);
    const nostril=mesh(joint,new THREE.SphereGeometry(1,12,8),lid,"Nostril");
    nostril.position.set(side*.052,-.10,-.331);
    nostril.scale.set(.007,.012,.017);
    nostril.rotation.x=-.41;
  }
  const harness=fittings(horse,"Leather breast strap and belly girth");
  for(const [z,cy,w,h] of [[-.310,.832,.199,.237],[.003,.771,.236,.225]]) {
    const sections=[];
    for(let i=0;i<=26;i++){
      const angle=i*2*PI/26;
      sections.push(new THREE.Vector3(Math.sin(angle)*w,cy+Math.cos(angle)*h,z+.034*Math.cos(angle)));
    }
    const curve=new THREE.CatmullRomCurve3(sections.slice(0,-1),true);
    harness.add(leather,new THREE.TubeGeometry(curve,36,.018,6,true),0,0,0);
  }
  const ridge=loft([[-.55,1.175,.005,.01],[-.45,1.200,.036,.043],
    [-.36,1.128,.041,.049],[-.22,1.026,.037,.041],[-.12,.989,.009,.015]],16);
  harness.add(mane,ridge,0,0,0);
  harness.finish();
  const tail=new THREE.Group();
  tail.position.set(0,.827,.493);
  horse.add(tail);
  const tailCurve=new THREE.CatmullRomCurve3([[0,0,0],[0,-.116,.097],[.011,-.268,.142],[.018,-.39,.139]]
    .map(p=>new THREE.Vector3(...p)));
  mesh(tail,new THREE.TubeGeometry(tailCurve,18,.017,8),hide,"Tail");
  const tuft=mesh(tail,new THREE.SphereGeometry(1,14,10),mane,"Tail tuft");
  tuft.scale.set(.029,.100,.032);
  tuft.position.set(.018,-.392,.140);
  const legs=[];
  for(const side of [-1,1]) for(const fore of [true,false]) {
    const hip=new THREE.Vector3(side*(fore ? .139 : .161),fore ? .720 : .744,fore ? -.362 : .366);
    const upper=fore ? .338 : .365, lower=fore ? .354 : .349;
    const jointRadius=fore ? .051 : .063;
    const upperShape=new THREE.LatheGeometry([
      [.081,-.5*upper],[fore ? .090 : .117,-.34*upper],[fore ? .087 : .108,-.17*upper],
      [.075,.12*upper],[jointRadius*1.07,.36*upper],[jointRadius,.5*upper],
    ].map(([r,y])=>new THREE.Vector2(r,y)),18);
    const upperMesh=mesh(horse,upperShape,hide,"Donkey upper leg");
    const lowerMesh=mesh(horse,new THREE.CylinderGeometry(.031,jointRadius*.74,lower,12),hide,"Donkey cannon");
    const kneecap=mesh(horse,new THREE.SphereGeometry(jointRadius*.86,12,9),hide,"Donkey knee and hock");
    const fetlock=mesh(horse,new THREE.SphereGeometry(.039,12,9),hide,"Donkey fetlock");
    const hoof=mesh(horse,detailedBox(.075,.066,.116,hoofMat,.018),hoofMat,"Donkey hoof");
    legs.push({hip,upper,lower,upperMesh,lowerMesh,kneecap,fetlock,hoof,fore,side});
  }
  const axis=new THREE.Vector3(), bend=new THREE.Vector3(), knee=new THREE.Vector3(), dir=new THREE.Vector3();
  function align(segment,a,b) {
    segment.position.copy(a).lerp(b,.5);
    segment.quaternion.setFromUnitVectors(up,dir.copy(b).sub(a).normalize());
  }
  function poseLeg(leg,contact) {
    // The toe block is anchored on the ground before solving the bone chain.
    const {hip,upper,lower}=leg;
    axis.copy(contact).sub(hip);
    const span=Math.max(.05,axis.length());
    axis.multiplyScalar(1/span);
    const length=Math.min(span,upper+lower-.001);
    if(span>length) contact.copy(hip).addScaledVector(axis,length);
    const along=(upper*upper-lower*lower+length*length)/(2*length);
    bend.set(leg.side*.085,0,leg.fore ? -.67 : 1).addScaledVector(axis,-axis.dot(bend)).normalize();
    knee.copy(hip).addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,upper*upper-along*along)));
    align(leg.upperMesh,hip,knee);
    align(leg.lowerMesh,knee,contact);
    leg.kneecap.position.copy(knee);
    leg.fetlock.position.copy(contact);
    leg.hoof.position.copy(contact);
    leg.hoof.position.y-=.039;
    leg.hoof.position.z-=.019;
  }
  return {horse,legs,poseLeg,animate(time,pace,phase){
    joint.rotation.x=.039*Math.sin(phase*2+.8)*pace+.020*Math.sin(time*1.24);
    joint.rotation.y=.033*Math.sin(time*1.19);
    for(const [i,ear] of ears.entries()) {
      ear.rotation.x=.085*Math.sin(phase+.23+i*.76)*pace;
      ear.rotation.y=.19*Math.sin(time*1.27+i*1.7)**5;
    }
    tail.rotation.x=.085*Math.sin(phase+.88)*pace;
    tail.rotation.z=.25*Math.sin(time*2.1)+.095*Math.sin(phase);
  }};
}

export function buildFreightModel(root,surface) {
  const oak=surface("rail-wood",0xbea184,1.04,.86);
  const board=surface("tea-wood",0xc6aa89,.81,.84);
  const stressWood=surface("rail-wood",0x817460,.94,.90);
  const sack=surface("indigo-linen",0xb9a47b,.93,.94);
  const hemp=material(0x9b845f), leather=material(0x524030,.76);
  const iron=material(0x504943,.70,.42);
  const frame=new THREE.Group(), chassis=new THREE.Group();
  frame.name="Freight cart axle and deck";
  frame.add(chassis);
  root.add(frame);
  const cart=fittings(chassis,"Mortised oak cart body");
  cart.box(stressWood,1.39,.103,.109,0,-.031,0);
  for(const side of [-1,1]) {
    cart.box(stressWood,.088,.132,1.56,side*.398,.065,.064);
    cart.box(oak,.064,.105,1.59,side*.477,.195,.060);
    for(const z of [-.57,.20,.72]) {
      cart.box(oak,.067,.291,.076,side*.485,.225,z);
      cart.box(iron,.076,.032,.085,side*.485,.346,z);
    }
    for(const z of [.293,.725]) cart.box(stressWood,.053,.233,.057,side*.468,.437,z);
    cart.box(board,.071,.057,.521,side*.468,.718,.509);
  }
  for(let i=0;i<7;i++) {
    cart.box(i%4===2 ? oak : board,.130,.049,1.51,.135*(i-3),cargoFloor-.024,.064,.73*i);
    for(const z of [-.565,.673]) cart.box(iron,.017,.007,.022,.135*(i-3)+.016,cargoFloor+.002,z);
  }
  for(const [y,z,w] of [[passengerBench.y,passengerBench.z,.87],[driverBench.y,driverBench.z,.92]]) {
    cart.box(board,w,.052,.254,0,y-.026,z);
    for(const x of [-.329,.329]) cart.box(oak,.066,y-cargoFloor,.065,x,(y+cargoFloor)*.5,z);
  }
  const gate=new THREE.Group();
  gate.name="Hinged freight tailboard";
  gate.position.set(0,.179,.819);
  chassis.add(gate);
  const tail=fittings(gate,"Tailboard oak and hinges");
  tail.box(board,.483,.145,.034,0,.076,0);
  tail.box(iron,.061,.035,.030,0,.137,.026);
  tail.rod(iron,[-.041,.148,.039],[.041,.148,.039],.008);
  for(const x of [-.193,.193]) {
    tail.box(iron,.036,.12,.011,x,.065,.021);
    tail.rod(iron,[x-.028,0,0],[x+.028,0,0],.012);
  }
  tail.finish();
  cart.box(board,.55,.047,.162,0,.025,.901);
  for(const x of [-.214,.214]) cart.rod(iron,[x,.030,.904],[x,.17,.752],.015,.016);
  cart.box(board,.74,.045,.154,0,.094,-.732);
  for(const x of [-.156,.156]) cart.box(stressWood,.054,.018,1.041,x,freightBed.y-.009,.295);
  cart.box(oak,.476,.035,.041,0,cargoFloor+.016,-.254);
  for(const z of [-.361]) {
    const bale=loft([[z-.15,.358,.067,.069],[z-.11,.350,.21,.15],[z,.346,.416,.164],
      [z+.088,.340,.307,.146],[z+.148,.353,.078,.074]],24);
    bale.deleteAttribute("color");
    cart.add(sack,bale,0,0,0);
    for(const x of [-.161,.191]){
      cart.rod(hemp,[x,.282,z-.14],[x,.482,z-.072],.011,.010);
      cart.rod(hemp,[x,.482,z-.072],[x,.492,z+.073],.010);
      cart.rod(hemp,[x,.492,z+.073],[x,.291,z+.139],.010,.011);
    }
  }
  cart.finish();
  const panel=document.createElement("canvas");
  panel.width=320;
  panel.height=112;
  const ink=panel.getContext("2d");
  ink.clearRect(0,0,320,112);
  ink.fillStyle="#4b3627";
  ink.font="51px 'Noto Serif SC', serif";
  ink.textAlign="center";
  ink.textBaseline="middle";
  ink.fillText("北巷貨車",160,58);
  ink.strokeStyle="#715137";
  ink.lineWidth=3;
  ink.strokeRect(5,6,310,100);
  const lettering=new THREE.CanvasTexture(panel);
  lettering.colorSpace=THREE.SRGBColorSpace;
  const sign=mesh(chassis,new THREE.PlaneGeometry(.314,.091),
    new THREE.MeshStandardMaterial({map:lettering,transparent:true,depthWrite:false,roughness:.90}),"Freight route plate");
  sign.position.set(0,.291,.837);
  sign.castShadow=false;
  const wheels=[];
  for(const side of [-1,1]) {
    const wheel=new THREE.Group();
    wheel.name="Wooden wheel with iron tyre";
    wheel.position.x=side*wheelTrack;
    chassis.add(wheel);
    const spokes=fittings(wheel,"Tenoned spokes, felloe and hub");
    const rim=new THREE.TorusGeometry(wheelRadius-.035,.031,12,56).rotateY(PI/2);
    spokes.add(oak,rim,0,0,0);
    const tyre=new THREE.CylinderGeometry(wheelRadius,wheelRadius,wheelTyreWidth,56,1,true).rotateZ(PI/2);
    spokes.add(iron,tyre,0,0,0);
    spokes.rod(stressWood,[-.092,0,0],[.104,0,0],.093,.087,18);
    for(const x of [-.086,.093]) spokes.rod(iron,[x-.016,0,0],[x+.016,0,0],.091,.091,18);
    for(let i=0;i<12;i++){
      const angle=i*PI/6, y=Math.cos(angle),z=Math.sin(angle);
      spokes.rod(board,[.008,y*.065,z*.065],[-.010,y*.393,z*.393],.022,.016,7);
    }
    spokes.finish();
    wheels.push(wheel);
  }

  const animal=donkey(root);
  const driver=riverWorker(chassis,surface,"carter",true);
  driver.figure.name="Freight cart driver";
  driver.figure.position.set(0,driverBench.y-.685,driverBench.z);
  driver.figure.visible=true;
  const straps=[], reins=[];
  for(const side of [-1,1]) {
    const beam=mesh(root,detailedBox(.062,1,.071,oak),oak,"Tapered draught shaft");
    const line=mesh(root,new THREE.CylinderGeometry(.008,.008,1,7),leather,"Rein");
    straps.push(beam);reins.push(line);
  }
  const work=new THREE.Vector3();
  const a=new THREE.Vector3(),b=new THREE.Vector3();
  const grip=new THREE.Vector3();
  function stretch(rod) {
    work.copy(b).sub(a);
    rod.position.copy(a).lerp(b,.5);
    rod.scale.y=work.length();
    rod.quaternion.setFromUnitVectors(up,work.normalize());
    rod.updateMatrixWorld(true);
  }
  const feet=[-1,1].map(side=>({x:side*.119,y:.112,z:-.825,yaw:0,side}));
  // Feet and their floor are in the cart's own frame, so they move with the seat.
  function workDriver(time,pace) {
    driver.walkBody(0,false,false,.016);
    driver.poseFeet(feet,()=>.094,0,driver.figure.position.y,driverBench.z,0);
    driver.head.rotation.y=.13*Math.sin(time*.71)+.21*pace*Math.sin(time*.34);
    driver.head.rotation.x=.018*Math.sin(time*1.4);
    driver.blink(.96*Math.max(0,1-Math.abs((time%4.42)-.19)/.115));
    for(const side of [-1,1]) {
      const index=side===-1 ? 0 : 1;
      chassis.localToWorld(grip.set(side*.210,driverBench.y+.419,driverBench.z-.282));
      driver.reachHand(index,grip,.83);
      chassis.localToWorld(a.set(side*.365,.134,-.384));
      animal.horse.localToWorld(b.set(side*.226,.788,-.176));
      stretch(straps[index]);
      a.copy(grip);
      animal.horse.localToWorld(b.set(side*.076,.962,-.732));
      stretch(reins[index]);
    }
    driver.poseSleeves();
  }
  return {frame,chassis,gate,wheels,animal,workDriver,speech:(shape,dt)=>driver.face.speak(shape,dt)};
}
