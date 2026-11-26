import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { tileRoof } from "./bridge-architecture.js";

const {clamp,damp,lerp,smoothstep}=THREE.MathUtils;
const waterline=-.88, low=-.80, high=1.251, drumY=1.377, drumRadius=.125;
const pourDuration=2.94;
export const wellSite={x:-73.02,z:-37.66,opening:.51};

function wedge(from,to,inner,outer,y,depth,bevel) {
  const shape=new THREE.Shape();
  let first=true;
  function point(radius,t,rough) {
    if(rough) radius+=.009*Math.sin(t*87+y*43)*Math.cos(t*32.9-y*20);
    const x=radius*Math.cos(t),z=-radius*Math.sin(t);
    if(first) {shape.moveTo(x,z);first=false;}
    else shape.lineTo(x,z);
  }
  for(let i=0;i<=6;i++) point(outer,lerp(from,to,i/6),true);
  for(let i=6;i>=0;i--) point(inner,lerp(from,to,i/6),false);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2})
    .rotateX(-Math.PI*.5).translate(0,y,0);
}

export function buildStreetWell(parent,city,surface,floor) {
  const root=new THREE.Group();
  root.name="West bank drawing well";
  root.position.set(wellSite.x,floor(wellSite.x,wellSite.z),wellSite.z);
  parent.add(root);
  const {x,y,z}=root.position;
  const place=(group,shape,material,x=0,y=0,z=0)=>{
    const mesh=new THREE.Mesh(shape,material);
    mesh.position.set(x,y,z);
    mesh.castShadow=mesh.receiveShadow=true;
    group.add(mesh);
    return mesh;
  };
  let phase=0;
  const plank=(group,mat,w,h,d,x,y,z,b=.011)=>
    place(group,detailedBox(w,h,d,mat,b,++phase*.37),mat,x,y,z);
  const plain=(color,roughness,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const ash=surface("rail-wood",0xcbab82,.83,.93),end=surface("tea-wood",0xa67a52,.72,.88);
  const wetWood=surface("tea-wood",0x99734b,.91,.73);
  const roof=surface("gray-roof-tile",0xb2b3a2,.93,.89);
  const stone=[0xc2bb9e,0xabaa95,0xbcb09b,0x989f8b].map(c=>surface("worn-stone",c,.87,.94));
  const shaft=surface("worn-stone",0x6d6d59,.64,.92);
  const iron=plain(0x494238,.64,.42), brass=plain(0x8c6c45,.56,.47), hemp=plain(0x95734b,.98);
  const dark=plain(0x3a3629,.92);
  const ring=new THREE.Group();
  ring.name="Beveled masonry and deep well lining";
  root.add(ring);
  const batches=stone.map(()=>[]);
  for(let row=0;row<3;row++) {
    const count=row===2 ? 11 : 13;
    for(let i=0;i<count;i++) {
      const t=(i+.46*(row%2))*2*Math.PI/count;
      const bob=.007*Math.sin(i*8.73+row);
      batches[(i*3+row*2+(i>>2))%stone.length].push(wedge(t+.023,t+2*Math.PI/count-.026,
        row===2 ? .427 : .452,.698+.042*Number(row===2)+.013*Math.sin(i*3.93),
        .016+row*.246+bob,row===2 ? .178 : .213,row===2 ? .018 : .013));
    }
  }
  for(let i=0;i<batches.length;i++) {
    const pieces=batches[i];
    place(ring,mergeGeometries(pieces),stone[i]);
    for(const part of pieces) part.dispose();
  }
  const liner=place(ring,new THREE.CylinderGeometry(.458,.474,2.49,48,1,true),
    new THREE.MeshStandardMaterial({color:0x5d5a47,roughness:.96,side:THREE.BackSide}),0,-.637,0);
  liner.castShadow=false;
  const insideRings=[];
  for(let row=0;row<5;row++) for(let i=0;i<12;i++) {
    const a=(i+.5*(row%2))*Math.PI/6;
    insideRings.push(wedge(a+.026,a+Math.PI/6-.026,.447,.477,-.935+row*.241,.213,.007));
  }
  place(ring,mergeGeometries(insideRings),shaft);
  for(const part of insideRings) part.dispose();
  city.cylinder("Stone well",x,z,y-1.5,y+.72,.755);

  const footing=new THREE.Group();
  footing.name="Well's pitched stone apron";
  root.add(footing);
  const support=floor.registerPavedSurface;
  for(let i=0;i<17;i++) {
    const angle=i*Math.PI*2/17;
    const radius=1.00+.09*Math.sin(i*3.1);
    const u=radius*Math.cos(angle),v=radius*Math.sin(angle);
    const base=floor(x+u,z+v)-y;
    const size=.35+.09*Math.cos(i*4);
    const edge=plank(footing,stone[(i+1)%4],size,.072,.275,u,base+.016,v,.029);
    edge.rotation.y=-angle-.20;
    if(support) {
      const corners=[[-.43,-.41],[.43,-.41],[.43,.41],[-.43,.41]];
      const p=corners.flatMap(([u,v])=>{
        const a=u*size,b=v*.275,c=Math.cos(edge.rotation.y),s=Math.sin(edge.rotation.y);
        return [x+edge.position.x+a*c+b*s,y+edge.position.y+.036,z+edge.position.z-a*s+b*c];
      });
      support(p,0,3,6);support(p,0,6,9);
    }
  }

  const shelter=new THREE.Group();
  shelter.name="Oak windlass shelter";
  root.add(shelter);
  for(const dx of [-.81,.81]) for(const dz of [-.51,.56]) {
    const base=floor(x+dx,z+dz)-y;
    plank(shelter,stone[1],.232,.131,.221,dx,base+.041,dz,.024);
    plank(shelter,ash,.138,2.25,.143,dx,base+1.19,dz,.019);
    const rod=plank(shelter,end,.085,.43,.096,dx*.88,1.94,dz,.009);
    rod.rotation.z=.33*Math.sign(dx);
    city.box("Well shelter post",x+dx-.073,x+dx+.073,z+dz-.075,z+dz+.075,y+base,y+2.31);
  }
  for(const dz of [-.54,.58]) {
    plank(shelter,ash,1.98,.136,.173,0,2.25,dz,.015);
    plank(shelter,end,2.06,.061,.106,0,2.315,dz,.01);
  }
  for(const dx of [-.81,.81]) {
    plank(shelter,ash,.118,.128,1.36,dx,2.20,.015,.014);
    plank(shelter,ash,.129,.134,1.31,dx,.89,.01,.012);
    plank(shelter,ash,.150,.493,.188,dx,1.11,0,.015);
    for(const side of [-1,1]) {
      const brace=plank(shelter,end,.102,.39,.098,dx,1.028,.19*side,.012);
      brace.rotation.x=.83*side;
    }
    plank(shelter,iron,.161,.198,.168,dx,drumY,0,.013);
  }
  tileRoof(shelter,roof,2.32,.84,2.308,.01,.50);
  plank(shelter,end,2.37,.125,.153,0,2.727,.01,.019);
  const lettering=document.createElement("canvas");
  lettering.width=256;lettering.height=84;
  const ctx=lettering.getContext("2d");
  ctx.fillStyle="#c5a778";ctx.fillRect(0,0,256,84);
  ctx.strokeStyle="#755737";ctx.lineWidth=4;ctx.strokeRect(8,8,240,68);
  ctx.fillStyle="#4d3423";ctx.font="49px 'Noto Serif CJK SC','Songti SC',serif";
  ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("汲水井",128,44);
  const sign=new THREE.CanvasTexture(lettering);sign.colorSpace=THREE.SRGBColorSpace;
  plank(shelter,end,.71,.241,.036,0,2.085,-.565);
  const signMesh=place(shelter,new THREE.PlaneGeometry(.668,.213),
    new THREE.MeshStandardMaterial({map:sign,roughness:.94}),0,2.086,-.587);
  signMesh.rotation.y=Math.PI;
  signMesh.castShadow=false;

  const drum=new THREE.Group(), crank=new THREE.Group(), bail=new THREE.Group(), crankGrip=new THREE.Object3D();
  drum.name="Turning windlass";
  drum.position.y=drumY;
  crank.position.y=drumY-.191;
  root.add(drum,crank,bail);
  bail.name="Water bucket and iron bail";
  const axle=(parent,mat,r,length,x,y,z)=>place(parent,new THREE.CylinderGeometry(r,r,length,22),mat,x,y,z);
  axle(drum,ash,.113,1.40,0,0,0).rotation.z=Math.PI*.5;
  for(const dx of [-.61,.61]) {
    axle(drum,end,.143,.089,dx,0,0).rotation.z=Math.PI*.5;
    axle(drum,iron,.060,.229,dx*1.33,0,0).rotation.z=Math.PI*.5;
  }
  const coils=[];
  const cord=new THREE.TorusGeometry(.123,.0095,7,40);
  for(let i=0;i<25;i++) {
    const coil=place(drum,cord,hemp,-.009*i,0,0);
    coil.rotation.y=Math.PI*.5;
    coils.push(coil);
  }
  for(const gear of [drum,crank]) {
    axle(gear,end,.083,.046,-.903,0,0).rotation.z=Math.PI*.5;
    axle(gear,iron,.044,.057,-.897,0,0).rotation.z=Math.PI*.5;
    for(let i=0;i<16;i++) {
      const a=(i+(gear===crank ? .5 : 0))*Math.PI/8;
      const tooth=plank(gear,ash,.043,.020,.022,-.903,.088*Math.cos(a),.088*Math.sin(a),.004);
      tooth.rotation.x=a;
    }
  }
  plank(shelter,iron,.094,.107,.120,-.825,crank.position.y,0,.014);
  plank(crank,iron,.038,.184,.049,-.949,-.088,0,.007);
  axle(crank,end,.029,.154,-1.018,-.164,0).rotation.z=Math.PI*.5;
  axle(crank,brass,.017,.023,-1.096,-.164,0).rotation.z=Math.PI*.5;
  crankGrip.position.set(-1.032,-.164,0);
  crankGrip.name="Well crank palm target";
  crank.add(crankGrip);
  const cable=place(root,new THREE.CylinderGeometry(.0087,.0087,1,9),hemp,0,0,drumRadius);
  cable.name="Hanging well rope";

  const profile=[[0,-.398],[.151,-.398],[.158,-.377],[.176,-.175],[.176,-.143],
    [.154,-.143],[.154,-.169],[.134,-.356],[.122,-.373],[0,-.373]];
  place(bail,new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),32),wetWood);
  const staveWood=[0xa6835a,0xb39060,0x977951].map(c=>surface("tea-wood",c,.91,.84));
  const staves=staveWood.map(()=>[]);
  const outerStave=profile.slice(1,5).map(([x,y])=>new THREE.Vector2(x+.0024,y));
  for(let i=0;i<18;i++) {
    const step=Math.PI/9;
    const panel=new THREE.LatheGeometry(outerStave,4,i*step+.011,step-.022);
    const uv=panel.attributes.uv;
    for(let j=0;j<uv.count;j++) uv.setXY(j,uv.getX(j)*.074+i*.37,uv.getY(j)*.30+i*.19);
    staves[(i+(i>>2))%staves.length].push(panel);
  }
  for(const [i,panels] of staves.entries()) {
    const mesh=place(bail,mergeGeometries(panels),staveWood[i]);
    mesh.castShadow=false;
    for(const panel of panels) panel.dispose();
  }
  for(const at of [-.345,-.197]) {
    const r=at<-.3 ? .161 : .177;
    const band=place(bail,new THREE.TorusGeometry(r,.010,7,36),iron,0,at,0);
    band.rotation.x=-Math.PI*.5;
    for(let i=0;i<8;i++) {
      const angle=i*Math.PI*.25;
      place(bail,new THREE.SphereGeometry(.0061,8,5),brass,r*Math.cos(angle),at,r*Math.sin(angle));
    }
  }
  const bailShape=new THREE.CatmullRomCurve3([
    [-.164,-.22,0],[-.153,-.10,0],[-.087,-.019,0],[0,0,0],[.087,-.019,0],[.153,-.10,0],[.164,-.22,0],
  ].map(p=>new THREE.Vector3(...p)));
  place(bail,new THREE.TubeGeometry(bailShape,24,.009,8,false),iron);
  place(bail,new THREE.TorusGeometry(.017,.005,8,16),iron,0,.009,0);
  const wet=plain(0x465943,.28,.34), streamMat=plain(0xa4b9a6,.24,.28);
  streamMat.transparent=true;streamMat.opacity=.77;streamMat.depthWrite=false;streamMat.side=THREE.DoubleSide;
  const water=wet.clone();
  const ripples={value:0}, agitation={value:0};
  water.customProgramCacheKey=()=>"windlass-water";
  water.onBeforeCompile=shader=>{
    shader.uniforms.wellTime=ripples;
    shader.uniforms.wellAgitation=agitation;
    shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying vec2 wellSurface;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nwellSurface=position.xy;");
    shader.fragmentShader=shader.fragmentShader.replace("#include <common>",`#include <common>
      varying vec2 wellSurface;
      uniform float wellTime, wellAgitation;
    `).replace("#include <color_fragment>",`#include <color_fragment>
      float distanceToFlow=length(wellSurface-vec2(0.,-.08));
      float ripple=sin(dot(wellSurface,vec2(37.,19.))+wellTime*2.4)*
        sin(dot(wellSurface,vec2(-13.,56.))-wellTime*1.8);
      float wave=sin(distanceToFlow*82.-wellTime*14.)*exp(-distanceToFlow*4.6)*wellAgitation;
      diffuseColor.rgb*=1.+.083*ripple+.19*wave;
    `);
  };
  const drawSurface=(parent,geo,atX,atY,atZ)=>{
    const m=place(parent,geo,water,atX,atY,atZ);
    m.rotation.x=-Math.PI*.5;m.castShadow=false;
    return m;
  };
  drawSurface(root,new THREE.CircleGeometry(.453,56),0,waterline,0);
  const bucketWater=drawSurface(bail,new THREE.CircleGeometry(.153,36),0,-.190,0);
  const troughZ=1.54;
  const trough=new THREE.Group();trough.name="Stone watering trough";
  root.add(trough);
  plank(trough,stone[2],1.24,.242,.686,0,.126,troughZ,.037);
  for(const zz of [-.341,.341]) plank(trough,stone[0],1.24,.291,.138,0,.347,troughZ+zz,.034);
  for(const xx of [-.55,.55]) plank(trough,stone[1],.146,.291,.625,xx,.347,troughZ,.031);
  const troughWater=drawSurface(trough,new THREE.PlaneGeometry(.936,.530),0,.29,troughZ);
  city.box("Watering trough",x-.62,x+.62,z+troughZ-.41,z+troughZ+.41,y,y+.493);
  const flume=new THREE.Group();flume.name="Pivoting wooden water chute";
  flume.position.set(0,.725,.747);
  root.add(flume);
  const channel=new THREE.Group();
  channel.rotation.x=.333;
  flume.add(channel);
  plank(channel,wetWood,.188,.041,1.30,0,0,0,.007);
  for(const xx of [-.093,.093]) plank(channel,ash,.029,.103,1.31,xx,.052,0,.008);
  for(const end of [-.49,.35]) plank(channel,iron,.212,.010,.030,0,-.021,end,.004);
  const lever=new THREE.Group();
  lever.name="Well chute lever";
  lever.position.set(-.905,1.093,.356);
  root.add(lever);
  plank(lever,iron,.031,.263,.057,0,-.021,0,.006);
  axle(lever,end,.028,.133,-.051,.102,0).rotation.z=Math.PI*.5;
  const leverGrip=new THREE.Object3D();leverGrip.name="Well lever palm target";leverGrip.position.set(-.055,.102,0);
  lever.add(leverGrip);
  city.box("Water chute bracket",x-.21,x+.21,z+.665,z+.865,y,y+.76);
  plank(root,ash,.244,.762,.168,0,.367,.762,.017);
  const waterMark=new THREE.Vector3(),viewGrip=new THREE.Vector3(),viewFrame=new THREE.Quaternion();
  const holdPose=new THREE.Euler();
  const fallingWater=streamMat.clone();
  fallingWater.side=THREE.FrontSide;
  const stream=(name)=>{
    const mesh=place(root,new THREE.CylinderGeometry(.50,.36,1,9,1,true),fallingWater);
    mesh.name=name;mesh.castShadow=mesh.receiveShadow=false;
    return mesh;
  };
  const fall=stream("Water falling from the bucket"),outflow=stream("Water falling into the trough");
  const wetChannel=place(channel,new THREE.PlaneGeometry(.133,1.25),streamMat,0,.027,0);
  wetChannel.rotation.x=-Math.PI*.5;wetChannel.castShadow=false;
  const start=new THREE.Vector3(),finish=new THREE.Vector3(),direction=new THREE.Vector3();
  const vertical=new THREE.Vector3(0,1,0);
  function falling(mesh,from,to,width) {
    direction.subVectors(to,from);
    mesh.position.copy(from).addScaledVector(direction,.5);
    mesh.scale.set(width,direction.length(),width*.58);
    mesh.quaternion.setFromUnitVectors(vertical,direction.normalize());
  }
  const dropMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,6,5),wet,20);
  dropMesh.name="Trough splash droplets";
  dropMesh.frustumCulled=false;
  root.add(dropMesh);
  const droplet=new THREE.Object3D();
  const station={x:x-1.32,z:z+.157,yaw:-Math.PI*.5};
  const laneZ=station.z-1.25;
  const southEntry={x:x-.15,z:laneZ}, westEntry={x:station.x,z:laneZ};
  function approachMarker(player) {
    if(player.z<laneZ-.14 && player.x>station.x-.12) return southEntry;
    if(player.z<station.z-.88 && player.x>station.x+.18) return westEntry;
    return station;
  }
  let stage="idle",age=0,gripAge=0,bucketY=low,drive=0,filled=true,volume=.18,pours=0,latch=false;
  function canPour() {return bucketY>=high-.018 && filled && volume<.985;}
  function near(player) {return Math.hypot(player.x-station.x,player.z-station.z)<1.17;}
  function use(player) {
    if(stage==="idle" && near(player)) {stage="approach";age=gripAge=0;return "take";}
    if(stage==="working" && canPour()) {stage="pour";age=0;return "pour";}
    if(stage==="working" || stage==="approach") return "leave";
    return null;
  }
  function release() {
    if(stage==="pour") return false;
    stage="idle";age=0;drive=0;
    return true;
  }
  function frame(dt,input,player,bodyYaw,grounded) {
    const previous=age;
    age+=dt;
    if(stage==="working" || stage==="pour") gripAge+=dt;
    if(stage==="approach") {
      const turn=Math.atan2(Math.sin(bodyYaw-station.yaw),Math.cos(bodyYaw-station.yaw));
      if(Math.hypot(player.x-station.x,player.z-station.z)<.026 && Math.abs(turn)<.049 && grounded) {
        stage="working";age=0;
        return "ready";
      }
      if(age>4) {release();return "blocked";}
    } else if(stage==="working") {
      drive=damp(drive,input>0 ? .70 : input<0 ? -.76 : 0,12,dt);
      const prevY=bucketY;
      bucketY=clamp(bucketY+drive*dt,low,high);
      if(bucketY<=low+.007 && !filled) {filled=true;return "fill";}
      const atLip=bucketY>=high-.015;
      if(atLip && !latch && filled) {latch=true;return "rim";}
      if(!atLip) latch=false;
      if(Math.floor((prevY-low)/.276)!==Math.floor((bucketY-low)/.276)) return "turn";
    } else if(stage==="pour" && age>=pourDuration) {
      volume=Math.min(1,volume+.285);
      filled=false;
      stage="working";age=0;drive=0;pours++;
      return "done";
    }
    if(stage==="pour" && previous<1.11 && age>=1.11) return "stream";
    return null;
  }
  function render(time) {
    const winch=(bucketY-low)/drumRadius;
    drum.rotation.x=-winch;
    crank.rotation.x=winch;
    for(const [i,coil] of coils.entries()) coil.visible=i<5+Math.floor(winch/2.92);
    cable.position.y=(drumY+bucketY)*.5;
    cable.scale.y=drumY-bucketY;
    bail.position.set(0,bucketY,.125);
    const pouring=stage==="pour";
    const move=pouring ? smoothstep(age,.06,.61)*(1-smoothstep(age,2.23,2.91)) : 0;
    const tip=pouring ? 1.04*smoothstep(age,.56,1.17)*(1-smoothstep(age,2.10,2.76)) : 0;
    bail.rotation.x=tip;
    flume.rotation.y=1.46*(1-move);
    lever.rotation.x=-.47*move;
    const drained=pouring ? smoothstep(age,.88,2.11) : 0;
    bucketWater.visible=filled && drained<.98;
    bucketWater.position.y=lerp(-.188,-.362,drained);
    bucketWater.scale.setScalar(1-.11*drained);
    const channelFlow=pouring && age>.92 && age<2.31;
    fall.visible=pouring && age>.83 && age<2.13;
    wetChannel.visible=channelFlow;
    outflow.visible=dropMesh.visible=pouring && age>1.10 && age<2.51;
    ripples.value=time;
    agitation.value=pouring ? smoothstep(age,1.03,1.24)*(1-smoothstep(age,2.26,2.88)) : 0;
    const amount=volume+(pouring ? (.285*smoothstep(age,1.12,2.44)) : 0);
    troughWater.position.y=.264+.183*Math.min(1,amount);
    if(fall.visible) {
      start.set(0,-.147,.166);
      bail.localToWorld(start);root.worldToLocal(start);
      finish.set(0,.948,.118);
      falling(fall,start,finish,.052+.008*Math.sin(time*30));
    }
    if(outflow.visible) {
      start.set(0,.536,1.344);finish.set(0,troughWater.position.y,1.460);
      falling(outflow,start,finish,.106+.012*Math.sin(time*33));
      for(let i=0;i<20;i++) {
        const u=(age*1.76+i*.341)%1,theta=i*2.38;
        droplet.position.set(Math.cos(theta)*u*.175,troughWater.position.y+.128*Math.sin(u*Math.PI),1.46+Math.sin(theta)*u*.18);
        droplet.scale.setScalar((1-u)*(.008+.006*(i%4)/3));
        droplet.updateMatrix();
        dropMesh.setMatrixAt(i,droplet.matrix);
      }
      dropMesh.instanceMatrix.needsUpdate=true;
    }
  }
  function pose(person) {
    if(stage!=="working" && stage!=="pour") return;
    const weight=smoothstep(gripAge,0,.23);
    const grip=crankGrip.getWorldPosition(viewGrip);
    holdPose.set(.06,Math.PI*.47,-.18,"YXZ");
    person.graspProp(0,grip,viewFrame.setFromEuler(holdPose),weight,.81);
    holdPose.set(-.19,Math.PI*.43,.32,"YXZ");
    person.graspProp(1,leverGrip.getWorldPosition(waterMark),viewFrame.setFromEuler(holdPose),weight,.64);
  }
  function restore(saved=.18) {
    stage="idle";age=gripAge=0;bucketY=low;drive=0;filled=true;latch=false;pours=0;
    volume=Number.isFinite(saved) ? clamp(saved,.18,1) : .18;
    render(0);
  }
  restore();
  return {station,approachMarker,near,use,release,frame,render,pose,restore,canPour,
    active:()=>stage!=="idle",operating:()=>stage==="working" || stage==="pour",
    pouring:()=>stage==="pour", progress:()=>(bucketY-low)/(high-low), full:()=>volume>=.985, filled:()=>filled,
    inspect:()=>({stage,bucketY,angle:drum.rotation.x,volume,filled,pours,tip:bail.rotation.x,stream:fall.visible})};
}
