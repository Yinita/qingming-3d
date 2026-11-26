import * as THREE from "three";
import { detailedBox } from "./bridge-look.js";

export const parcelSize={halfX:.232,halfZ:.172,height:.333};

export function buildConsignment(parent,city,surface,freight) {
  const wood=surface("tea-wood",0xc8af8c,.82,.89);
  const frame=surface("rail-wood",0xa68c6f,.88,.88);
  const rope=new THREE.MeshStandardMaterial({color:0x86694a,roughness:.94});
  const brass=new THREE.MeshStandardMaterial({color:0x6e553e,roughness:.63,metalness:.30});
  const root=new THREE.Group();
  parent.add(root);
  function piece(group,geometry,material,x,y,z) {
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z);
    mesh.castShadow=mesh.receiveShadow=true;
    mesh.layers.enable(1);
    group.add(mesh);
    return mesh;
  }
  function board(group,mat,w,h,d,x,y,z) {
    return piece(group,detailedBox(w,h,d,mat,.011,x*7+z*11),mat,x,y,z);
  }
  function label(group,text,x,y,z,width=.51,height=.19,back=null) {
    const canvas=document.createElement("canvas");
    canvas.width=512;
    canvas.height=192;
    const ink=canvas.getContext("2d");
    const colour=ink.createLinearGradient(0,0,0,192);
    colour.addColorStop(0,"#dec6a0");
    colour.addColorStop(1,"#c6a782");
    ink.fillStyle=colour;
    ink.fillRect(0,0,512,192);
    for(let i=0;i<58;i++) {
      const y=i*3.25+.7;
      ink.strokeStyle=i%3 ? "rgba(100,60,33,.075)" : "rgba(255,239,205,.14)";
      ink.beginPath();
      ink.moveTo(0,y);
      ink.bezierCurveTo(149,y+Math.sin(i)*5,386,y-4,512,y+Math.sin(i*1.9)*3);
      ink.stroke();
    }
    ink.strokeStyle="#64452f";
    ink.lineWidth=5;
    ink.strokeRect(15,13,482,166);
    ink.fillStyle="#473022";
    ink.font='98px "Songti SC", "Noto Serif CJK SC", serif';
    ink.textAlign="center";
    ink.textBaseline="middle";
    ink.fillText(text,256,99);
    const map=new THREE.CanvasTexture(canvas);
    map.colorSpace=THREE.SRGBColorSpace;
    map.anisotropy=4;
    const geometry=new THREE.PlaneGeometry(width,height);
    const pigment=new THREE.MeshStandardMaterial({map,roughness:.88});
    piece(group,geometry,pigment,x,y,z).castShadow=false;
    if(back!==null) {
      const reverse=piece(group,geometry,pigment,x,y,back);
      reverse.rotation.y=Math.PI;
      reverse.castShadow=false;
    }
  }

  const parcel=new THREE.Group();
  parcel.name="Northern lane ceramic consignment";
  root.add(parcel);
  board(parcel,frame,.388,.300,.296,0,.162,0);
  for(const z of [-.151,.151]) for(let i=0;i<3;i++) {
    board(parcel,wood,.402,.097,.018,0,.060+i*.099,z);
  }
  for(const x of [-.198,.198]) for(let i=0;i<3;i++) {
    board(parcel,wood,.014,.094,.284,x,.060+i*.099,0);
  }
  for(const x of [-.139,0,.139]) board(parcel,wood,.132,.025,.316,x,.324,0);
  for(const x of [-.122,.122]) {
    for(const z of [-.166,.166]) board(parcel,rope,.017,.312,.009,x,.163,z);
    board(parcel,rope,.017,.012,.329,x,.337,0);
    for(const side of [-1,1]) board(parcel,brass,.026,.027,.016,x,.049,side*.164);
  }
  for(const side of [-1,1]) {
    for(const z of [-.077,.077]) {
      board(parcel,frame,.023,.043,.038,side*.207,.211,z);
      board(parcel,brass,.007,.015,.015,side*.221,.212,z);
    }
    board(parcel,wood,.028,.028,.168,side*.217,.211,0);
  }
  label(parcel,"瓷",0,.177,.173,.127,.118);
  board(parcel,brass,.051,.046,.012,0,.213,.164);
  piece(parcel,new THREE.TorusGeometry(.014,.0035,7,16),brass,0,.214,.172);
  for(const part of parcel.children) part.position.y-=.011;

  function stage(index,title,lateral) {
    const at=freight.stopPoint(index,new THREE.Vector3(),lateral,1.64);
    const depot=new THREE.Group();
    depot.name=title;
    depot.position.copy(at);
    root.add(depot);
    board(depot,wood,.63,.083,.45,0,.287,0);
    for(const x of [-.263,.263]) for(const z of [-.171,.171]) {
      board(depot,frame,.071,.272,.076,x,.135,z);
    }
    for(const x of [-.263,.263]) board(depot,frame,.066,.064,.415,x,.122,0);
    const side=index===0 ? 1 : -1, postX=side*.278, plaqueZ=.13;
    const post=board(depot,frame,.070,2.23,.074,postX,1.11,plaqueZ);
    board(depot,frame,.59,.052,.077,side*.052,2.18,plaqueZ);
    const plaqueX=-side*.022, plaqueY=1.988;
    for(const x of [plaqueX-.192,plaqueX+.192]) board(depot,rope,.019,.112,.018,x,2.124,plaqueZ);
    board(depot,frame,.608,.269,.057,plaqueX,plaqueY,plaqueZ);
    label(depot,title,plaqueX,plaqueY,plaqueZ+.030,.564,.224,plaqueZ-.030);
    for(const z of [plaqueZ-.033,plaqueZ+.033]) for(const x of [plaqueX-.266,plaqueX+.266])
      board(depot,brass,.016,.016,.012,x,plaqueY+.083,z);
    const collider=city.meshBox(title,depot.children[0]);
    const postCollider=city.meshBox(title+"牌柱",post);
    const foot={x:at.x,z:at.z,y:at.y+.329};
    const approach=freight.stopPoint(index,new THREE.Vector3(),lateral*.71,1.56);
    return {foot,approach,collider,postCollider,post:{x:at.x+postX,z:at.z+plaqueZ}};
  }
  const origin=stage(0,"瓷器貨棧",-1.19);
  const destination=stage(1,"北巷收貨",-1.26);
  function visible(on) {
    root.visible=on;
    origin.collider.enabled=on;
    destination.collider.enabled=on;
    origin.postCollider.enabled=on;
    destination.postCollider.enabled=on;
  }
  visible(false);
  return {root,parcel,origin,destination,visible};
}
