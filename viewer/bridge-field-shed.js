import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { tileRoof } from "./bridge-architecture.js";
import { circleTouchesBox, sweepYaw, workerRadius } from "./bridge-collision.js";
import { detailedBox } from "./bridge-look.js";
import { fieldShed } from "./bridge-field-layout.js";

const {damp,smoothstep}=THREE.MathUtils;
const doorway=1.54, frontInset=.043;
export const fieldDoor={x:fieldShed.x,z:fieldShed.z-fieldShed.depth*.5};

export function buildFieldShed(parent,city,surface,height) {
  const {x,z,width,depth}=fieldShed;
  const hx=width*.5,hz=depth*.5;
  const platform=Math.max(...[-1,0,1].flatMap(i=>[-1,0,1].map(j=>height(x+i*hx,z+j*hz))))+.047;
  const root=new THREE.Group();
  root.name="West bank grain store";
  root.position.set(x,platform,z);
  parent.add(root);
  const stone=surface("worn-stone",0xc0ad8f,.87,.93);
  const chalk=surface("lime-plaster",0xd6bb93,.80,.92);
  const fir=surface("rail-wood",0xa68a65,.79,.91);
  const boards=surface("tea-wood",0x8c6d4b,.91,.98);
  const roof=surface("gray-roof-tile",0xafa591,.86,.95);
  const clay=new THREE.MeshStandardMaterial({color:0x916450,roughness:.86});
  const iron=new THREE.MeshStandardMaterial({color:0x484237,roughness:.67,metalness:.39});
  const twine=new THREE.MeshStandardMaterial({color:0x957a52,roughness:.96});
  const grain=surface("rough-linen",0xb9a682,.55,.96);
  const areas=new Map();
  let phase=.7;
  function geometry(mat,g) {
    if(!areas.has(mat)) areas.set(mat,[]);
    areas.get(mat).push(g);
  }
  function timber(mat,w,h,d,px,py,pz,b=.014,yaw=0) {
    const piece=detailedBox(w,h,d,mat,b,phase+=.139);
    if(yaw) piece.rotateY(yaw);
    geometry(mat,piece.translate(px,py,pz));
  }
  function install(group,name) {
    for(const [material,parts] of areas) {
      const mesh=new THREE.Mesh(mergeGeometries(parts),material);
      for(const part of parts) part.dispose();
      mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
    }
    areas.clear();
  }
  function rectangle(ax,az,bx,bz,y,register=height.registerPavedSurface) {
    const positions=[x+ax,y,z+az,x+bx,y,z+az,x+ax,y,z+bz,x+bx,y,z+bz];
    register(positions,0,3,6);
    register(positions,3,9,6);
  }
  function support(ax,az,bx,bz,y,material,name) {
    const coords=[x+ax,z+az,x+bx,z+bz];
    const bottom=Math.min(height(coords[0],coords[1]),height(coords[2],coords[3]),y-.07)-.026;
    const piece=new THREE.Mesh(detailedBox(bx-ax,y-bottom,bz-az,material,.017,phase+=.31),material);
    piece.position.set((ax+bx)*.5,(bottom+y)*.5-platform,(az+bz)*.5);
    piece.name=name;piece.castShadow=piece.receiveShadow=true;root.add(piece);
    rectangle(ax,az,bx,bz,y);
  }
  support(-hx-.09,-hz-.10,hx+.09,hz+.10,platform,stone,"Squared fieldstone foundation");
  const approach=height(x,z-hz-.69);
  // The lower landing receives the lane from both bridges and keeps the doorway clear.
  support(-1.71,-hz-.68,1.70,-hz-.23,Math.max(approach+.018,platform-.121),
    stone,"Grain-store flagstone landing");
  support(-.88,-hz-.24,.87,-hz-.064,Math.max(approach+.031,platform-.057),
    stone,"Grain-store threshold step");
  for(let j=0;j<19;j++)
    timber(boards,.249,.034,depth-.13,-hx+.398+j*.249,.017,0,.006);
  rectangle(-hx+.18,-hz+.06,hx-.18,hz-.06,platform+.034,height.addRootSurface);
  const postTop=2.22, sill=.30, beam=.192;
  for(const side of [-1,1]) {
    for(const zz of [-hz+.09,0,hz-.09]) timber(fir,.183,postTop,.193,side*(hx-.10),postTop*.5,zz,.023);
    timber(chalk,.126,1.86,depth-.22,side*(hx-.083),1.085,0,.011);
    timber(stone,.169,sill,depth-.11,side*(hx-.079),sill*.5,0,.020);
    timber(fir,.177,.176,depth+.06,side*(hx-.069),2.13,0,.019);
  }
  timber(chalk,width-.16,1.88,.17,0,1.074,hz-.07,.010);
  timber(stone,width-.13,.30,.183,0,.151,hz-.053,.016);
  for(const xx of [-1.38,0,1.38]) timber(fir,.142,postTop,.163,xx,postTop*.5,hz-.03,.02);
  for(const side of [-1,1]) {
    const sideWidth=hx-doorway*.5;
    const cx=side*(doorway*.5+sideWidth*.5);
    timber(stone,sideWidth,.29,.205,cx,.145,-hz+.035+frontInset,.020);
    timber(chalk,sideWidth,.58,.134,cx,1.82,-hz+.065+frontInset,.010);
    timber(chalk,sideWidth,.49,.134,cx,.565,-hz+.060+frontInset,.012);
    for(const xx of [side*(doorway*.5+.02),cx-.40,cx+.40])
      timber(fir,.126,2.17,.143,xx,1.085,-hz+.046+frontInset,.014);
    timber(fir,sideWidth,.099,.164,cx,.822,-hz+.038+frontInset,.012);
    timber(fir,sideWidth,.103,.155,cx,1.537,-hz+.038+frontInset,.012);
    timber(boards,sideWidth-.084,.705,.045,cx,1.18,-hz+.110+frontInset,.007);
    for(let i=0;i<7;i++) {
      const px=cx+(i-3)*.211;
      timber(fir,.050,.698,.089,px,1.179,-hz+.049+frontInset,.007);
    }
    const steep=new THREE.Vector3(0,.74,1.94);
    geometry(fir,detailedBox(.116,steep.length(),.121,fir,.012,phase+=.37)
      .rotateX(Math.atan2(steep.z,steep.y)).translate(side*(hx-.063),2.51,-.94));
  }
  for(const zz of [-hz+.034,hz-.034]) timber(fir,width+.12,beam,.205,0,2.185,zz,.019);
  timber(fir,doorway+.11,.167,.203,0,1.946,-hz+.021,.016);
  const run=depth*.5+.51,eave=2.26,slope=.397;
  for(let i=0;i<13;i++) {
    const px=(i-6)*.422;
    for(const side of [-1,1]) {
      const bar=detailedBox(.062,.087,Math.hypot(run,run*slope),fir,.008,phase+=.43);
      geometry(fir,bar.rotateX(side*Math.atan(slope)).translate(px,eave+slope*run*.54,side*run*.497));
    }
  }
  for(const side of [-1,1]) {
    const cap=new THREE.BufferGeometry();
    cap.setAttribute("position",new THREE.Float32BufferAttribute([
      side*(hx-.067),2.21,-hz+.03,side*(hx-.067),2.21,hz-.03,
      side*(hx-.067),2.21+slope*(run-.24),0,
    ],3));
    cap.setAttribute("uv",new THREE.Float32BufferAttribute([0,0,2,0,1,1],2));
    cap.setIndex(side>0 ? [0,2,1] : [0,1,2]);cap.computeVertexNormals();
    const gable=new THREE.Mesh(cap,chalk);
    gable.name="Inset plaster gable";gable.receiveShadow=true;root.add(gable);
  }
  tileRoof(root,roof,width+.61,run,eave,0,slope,{courseWidth:.246,courseLength:.303,segments:5});
  const sign=document.createElement("canvas");
  sign.width=240;sign.height=84;
  const ink=sign.getContext("2d");
  ink.fillStyle="#a78c64";ink.fillRect(0,0,240,84);
  ink.strokeStyle="#5d4b33";ink.lineWidth=4;ink.strokeRect(9,8,222,68);
  ink.font="48px 'Noto Serif CJK SC',serif";ink.textAlign="center";ink.textBaseline="middle";
  ink.fillStyle="#403224";ink.fillText("糧棚",120,45);
  const signTexture=new THREE.CanvasTexture(sign);
  signTexture.colorSpace=THREE.SRGBColorSpace;
  const plate=new THREE.Mesh(new THREE.PlaneGeometry(.67,.236),
    new THREE.MeshStandardMaterial({map:signTexture,roughness:.89}));
  plate.rotation.y=Math.PI;plate.position.set(0,2.032,-hz-.075);
  plate.name="Grain store sign";plate.receiveShadow=true;root.add(plate);

  // The open floor has a clear central aisle. Shelves, jars, and sacks stand against the rear wall.
  for(const px of [-1.91,1.79]) {
    timber(fir,1.03,.071,.52,px,.596,.99,.012);
    for(const side of [-1,1]) for(const zz of [.79,1.20])
      timber(fir,.057,.543,.068,px+side*.45,.292,zz,.010);
    city.box("Grain-store side shelf",x+px-.515,x+px+.515,z+.73,z+1.25,platform,platform+.67);
  }
  for(const [px,pz,scale] of [[1.47,1.04,.89],[1.78,1.02,.84],[2.12,1.09,.91],[-1.95,-.61,1.13]]) {
    const jar=new THREE.LatheGeometry([[0,0],[.086,0],[.116,.052],[.143,.158],[.132,.260],[.074,.307],
      [.081,.327],[.072,.338],[.057,.332],[.053,.305],[.105,.253],[.105,.066],[0,.025]].map(
        ([r,y])=>new THREE.Vector2(r*scale,y*scale)),22);
    geometry(clay,jar.translate(px,(px>0 ? .632 : .035),pz));
    if(px<0) city.cylinder("Shed earthenware jar",x+px,z+pz,platform,platform+.414,.168);
  }
  for(const [px,pz,turn] of [[-1.97,1.035,.17],[-1.57,.94,-.42],[-1.99,.98,.22]]) {
    const sack=new THREE.LatheGeometry([[0,0],[.139,.027],[.175,.065],[.170,.153],[.137,.237],
      [.106,.267],[.054,.283],[.042,.306],[0,.315]].map(p=>new THREE.Vector2(...p)),18);
    sack.scale(1,px===-1.57 ? .80 : 1,.72).rotateZ(turn);
    geometry(grain,sack.translate(px,.629+(turn===.22 ? .214 : 0),pz));
    const tie=new THREE.TorusGeometry(.052,.0040,5,18).rotateX(-Math.PI/2);
    geometry(twine,tie.translate(px-Math.sin(turn)*.262,.896+(turn===.22 ? .214 : turn===-.42 ? -.06 : 0),pz));
  }
  const binZ=1.095, binWidth=1.26, binDepth=.55;
  for(const side of [-1,1]) {
    for(const zz of [binZ-.24,binZ+.24])
      timber(fir,.083,.554,.087,side*.603,.285,zz,.014);
    timber(boards,.071,.422,binDepth,side*.601,.308,binZ,.013);
    timber(fir,.089,.048,binDepth+.07,side*.603,.532,binZ,.013);
  }
  for(const zz of [binZ-.241,binZ+.241]) {
    for(let j=0;j<3;j++) timber(boards,binWidth-.071,.132,.060,0,.151+j*.132,zz,.009);
    timber(fir,binWidth+.028,.047,.082,0,.532,zz,.013);
  }
  timber(boards,binWidth-.072,.039,binDepth-.090,0,.130,binZ,.010);
  city.box("Grain bin",x-binWidth*.5,x+binWidth*.5,z+binZ-binDepth*.5,z+binZ+binDepth*.5,
    platform+.04,platform+.568);
  const millet=new THREE.MeshStandardMaterial({color:0xc2aa6d,roughness:.93});
  const pile=new THREE.Mesh(new THREE.SphereGeometry(1,32,12),millet);
  pile.scale.set(.55,.129,.208);pile.position.set(0,.436,binZ);
  pile.name="Millet in an open wooden bin";pile.receiveShadow=true;root.add(pile);
  const kernels=new THREE.InstancedMesh(new THREE.SphereGeometry(1,7,4),millet,234);
  kernels.name="Loose millet grains on the heap";
  const grainPose=new THREE.Object3D(), tint=new THREE.Color();
  for(let i=0;i<kernels.count;i++) {
    const ring=Math.sqrt((i+.5)/kernels.count)*.983, a=i*2.399963;
    const u=ring*Math.cos(a),v=ring*Math.sin(a);
    grainPose.position.set(u*.546,.436+.128*Math.sqrt(1-ring*ring),binZ+v*.205);
    grainPose.rotation.set(i*.22,a,i*.39);
    grainPose.scale.set(.008+.002*Math.sin(i*4.07),.0037,.0041);
    grainPose.updateMatrix();
    kernels.setMatrixAt(i,grainPose.matrix);
    kernels.setColorAt(i,tint.setScalar(.78+.28*(.5+.5*Math.sin(i*21.44))));
  }
  kernels.receiveShadow=true;root.add(kernels);
  install(root,"Timber, masonry and fitted grain-store furnishings");
  for(const side of [-1,1]) {
    const px=x+side*(hx-.082);
    city.box("Grain-store side wall",px-.10,px+.10,z-hz,z+hz,platform-.015,platform+2.26);
    const ax=side<0 ? x-hx : x+doorway*.5,bx=side<0 ? x-doorway*.5 : x+hx;
    city.box("Grain-store entrance wall",ax,bx,z-hz-.023,z-hz+.199,platform-.013,platform+2.24);
  }
  city.box("Grain-store rear wall",x-hx,x+hx,z+hz-.176,z+hz+.025,platform-.05,platform+2.27);

  const doorLeaf=new THREE.Group();
  doorLeaf.name="Hinged plank door of the grain store";
  const hinge=-doorway*.5+.074, leafWidth=doorway-.126, threshold=-hz+.035;
  doorLeaf.position.set(hinge,.068,threshold);root.add(doorLeaf);
  for(let i=0;i<7;i++) {
    const w=leafWidth/7;
    timber(boards,w-.005,1.784,.074,(i+.5)*w,.894,0,.008);
  }
  for(const high of [.19,1.535]) timber(fir,leafWidth,.107,.115,leafWidth*.5,high,.025,.011);
  const diagonal=new THREE.Vector3(leafWidth*.85,1.16,0);
  geometry(fir,detailedBox(.076,diagonal.length(),.102,fir,.009,phase+=.23)
    .rotateZ(-Math.atan2(diagonal.x,diagonal.y)).translate(leafWidth*.5,.869,.027));
  for(const high of [.16,1.557]) {
    geometry(iron,new THREE.CylinderGeometry(.018,.018,.171,12).translate(-.011,high,-.047));
    timber(iron,.182,.039,.022,.077,high,-.041,.005);
  }
  const handleX=leafWidth-.142;
  geometry(iron,new THREE.TorusGeometry(.053,.007,7,22).translate(handleX,.938,-.082));
  geometry(iron,new THREE.TorusGeometry(.049,.007,7,22).translate(handleX,.938,.087));
  install(doorLeaf,"Weathered door boards, iron hinges and ring handles");
  const solid=city.orientedBox("Grain-store door",leafWidth*.5,.056,1.78);
  const opens=-Math.PI*.55;
  const bounce=new THREE.PointLight(0xffe1ac,0,4.8,1.55);
  bounce.name="Daylight reflected through the grain-store doorway";
  bounce.position.set(.05,1.16,-hz-.075);root.add(bounce);
  let angle=0,target=0,blocked=false;
  const grip=new THREE.Vector3(), rotation=new THREE.Quaternion(), wrist=new THREE.Euler();
  function sync(next) {
    angle=doorLeaf.rotation.y=next;
    bounce.intensity=1.55*smoothstep(-next,.02,1.21);
    Object.assign(solid,{x:x+hinge+Math.cos(next)*leafWidth*.5,z:z+threshold-Math.sin(next)*leafWidth*.5,
      bottom:platform+.065,top:platform+1.875,yaw:next});
  }
  function restore(open=false) {target=open ? opens : 0;blocked=false;sync(target);}
  function inside(point) {
    return Math.abs(point.x-x)<hx-.32 && point.z>z-hz+.27 && point.z<z+hz-.20;
  }
  function near(point) {
    return Math.hypot(point.x-fieldDoor.x,point.z-fieldDoor.z)<1.31 && Math.abs(point.x-x)<1.04;
  }
  function use(point) {
    if(!near(point)) return false;
    target=target===0 ? opens : 0;blocked=false;
    return true;
  }
  function frame(dt,player) {
    if(angle===target) return null;
    const next=damp(angle,target,3.8,dt), finishing=Math.abs(next-target)<.0022;
    const settled=sweepYaw(angle,finishing ? target : next,test=>!circleTouchesBox(player.x,player.z,workerRadius+.013,
      x+hinge+Math.cos(test)*leafWidth*.5,z+threshold-Math.sin(test)*leafWidth*.5,solid.halfX,solid.halfZ,test));
    const before=blocked;
    blocked=Math.abs(settled-angle)<.00014 && settled!==target;
    sync(settled);
    if(angle===target) return "settled";
    return blocked && !before ? "blocked" : null;
  }
  function handWeight(player,yaw) {
    if(angle===target || blocked) return 0;
    const side=inside(player) ? .087 : -.082;
    doorLeaf.localToWorld(grip.set(handleX,.938,side));
    const dx=grip.x-player.x,dz=grip.z-player.z;
    if(-dx*Math.sin(yaw)-dz*Math.cos(yaw)<.14) return 0;
    return .87*(1-smoothstep(Math.hypot(dx,dz),.38,.66));
  }
  function pose(person,player,yaw,hand=1) {
    const weight=handWeight(player,yaw);
    if(weight<=.003) return;
    person.graspProp(hand,grip,rotation.setFromEuler(wrist.set(.18,angle+.15,-.12,"YXZ")),weight,.72);
  }
  restore();
  return {frame,near,use,restore,inside,pose,handWeight,grain:{root,binZ,millet,pile,kernels},opened:()=>angle===opens,
    name:()=>target===0 ? "推开粮棚门" : "合上粮棚门",
    inspect:()=>({door:{...fieldDoor},shed:{...fieldShed},platform,angle,target,blocked,open:angle===opens})};
}
