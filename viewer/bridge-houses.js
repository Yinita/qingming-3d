import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";
import { tileRoof } from "./bridge-architecture.js";
import { circleTouchesBox,rectanglesOverlap } from "./bridge-collision.js";

// Individual wings follow the observed ridge count and broad silhouette of
// each painted crop. Entries are x/z offsets from the matched mesh anchor,
// with facade width, building depth, eaves height and the facade treatment.
const reconstructions={
  o0453:[[-.8,.6,9.0,4.6,2.72,"hall",0],[-4.75,4.35,3.65,3.35,2.25,"porch",3],
    [3.95,4.08,3.85,3.48,2.35,"cottage",0],[1.15,-4.16,8.25,3.82,3.17,"hall",2]],
  o0477:[[-.8,-.30,11.30,5.9,2.57,"hall",1],[-6.20,4.43,5.21,3.44,2.23,"cottage",3],
    [5.55,3.94,3.84,3.62,2.43,"porch",0]],
  o0324:[[-.55,-4.40,12.6,5.31,3.88,"loft",2],[0,2.15,13.2,5.32,2.67,"hall",1],
    [4.68,7.12,4.22,3.50,2.10,"cottage",0],[-4.79,7.12,4.22,3.50,2.12,"porch",3]],
  o0548:[[0,-.26,9.75,5.28,3.41,"loft",1]],
  o0557:[[1.41,-1.18,7.46,4.48,3.15,"loft",0],[-3.09,3.36,4.17,3.68,2.31,"porch",2]],
  o0378:[[0,0,9.80,3.12,2.87,"porch",2]],
  o0396:[[0,0,7.22,5.58,2.75,"hall",1]],
  o0457:[[0,-1.82,12.30,4.08,2.27,"hall",3],[-3.67,3.07,5.18,3.52,2.03,"cottage",2]],
  o0506:[[0,0,5.35,3.79,2.02,"cottage",3]],
  o0510:[[0,0,6.68,4.62,2.52,"porch",0]],
  o0370:[[0,0,5.46,4.35,2.37,"cottage",2]],
  o0492:[[0,0,4.64,3.96,2.06,"cottage",3]],
  o0304:[[0,0,6.91,4.91,2.76,"hall",0]],
  o0347:[[0,0,8.30,5.05,2.89,"hall",2]],
  o0446:[[0,0,2.84,5.34,2.37,"pavilion",1]],
};

export const revisedHouseIds=new Set(Object.keys(reconstructions));
const {damp,smoothstep}=THREE.MathUtils;
const workshopBounds={x:-71.73,z:-51.41,w:5.81,d:3.42};
const floorLevel=.192, eaveRise=.129;

function finishes(surface) {
  const shaded=(family,color,response,roughness)=>{
    const mat=surface(family,color,response,roughness);
    mat.vertexColors=true;
    return mat;
  };
  return {
    plaster:[0xd1bea0,0xc8baa4,0xd9c7ac,0xbbad8e].map(color=>shaded("lime-plaster",color,.80,.97)),
    timber:[0x99785d,0x7f6d57,0x806455,0xa68969].map(color=>shaded("tea-wood",color,.96,.84)),
    wood:shaded("rail-wood",0x8e785f,.78,.93),
    blackwood:shaded("rail-wood",0x65513d,.81,.91),
    paper:new THREE.MeshStandardMaterial({color:0xb9a57c,emissive:0x9c8157,emissiveIntensity:.155,
      roughness:.93,vertexColors:true}),
    stone:shaded("worn-stone",0xa8997f,1.05,.95),
    brick:shaded("stone-paving",0xa79d84,.85,.92),
    roof:palette=>surface("gray-roof-tile",[0x869184,0x8e948e,0x887e6f,0x949581][palette],.91,.82),
    decorativeRoof:[0x6f7b72,0x78817d,0x756f65,0x858873].map(color=>shaded("gray-roof-tile",color,.82,.88)),
    metal:new THREE.MeshStandardMaterial({color:0x675c4a,roughness:.66,metalness:.43,vertexColors:true}),
    porcelain:new THREE.MeshStandardMaterial({color:0x7c8b76,roughness:.45,vertexColors:true}),
  };
}

function assembly(parent) {
  const parts=new Map();
  function add(material,g,tint=1,wall=false) {
    const p=g.attributes.position, color=[];
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const dampness=wall ? (1-smoothstep(y,.21,1.17))*(.19+.057*Math.sin(5.9*x+9.9*z)) : 0;
      const age=.039*Math.cos(x*12.1+z*9.1+y*7.6);
      const shade=tint*(1+age-dampness);
      color.push(shade,shade*(1-.12*dampness),shade*(1-.24*dampness));
    }
    g.setAttribute("color",new THREE.Float32BufferAttribute(color,3));
    if(!parts.has(material)) parts.set(material,[]);
    parts.get(material).push(g);
  }
  function fit(material,w,h,d,x,y,z,{tint=1,angle=0,wall=false,phase=0}={}) {
    if(w<=0 || h<=0 || d<=0) return;
    const g=detailedBox(w,h,d,material,.013,phase);
    g.rotateX(angle);
    g.translate(x,y,z);
    add(material,g,tint,wall);
  }
  function build() {
    for(const [mat,geometries] of parts) {
      const object=new THREE.Mesh(mergeGeometries(geometries),mat);
      geometries.forEach(g=>g.dispose());
      object.name="Fitted brick and timber";
      object.castShadow=object.receiveShadow=true;
      parent.add(object);
    }
  }
  return {add,fit,build};
}

function buildHouse(parent,city,materials,spec,source=null) {
  const {x,z,w,d,eave,type,palette,workshop=false}=spec;
  const halfX=w*.5,halfZ=d*.5;
  const group=new THREE.Group();
  group.name=workshop ? "West bank joiner's workshop" : `Reconstructed ${type} ${source.id}`;
  if(source) group.userData={...source,finishFaces:[],architecture:type};
  group.position.set(x,0,z);
  parent.add(group);
  const a=assembly(group), {fit,add}=a;
  const stone=materials.stone, brick=materials.brick, wood=materials.timber[palette],
    plaster=materials.plaster[palette],backing=materials.blackwood;
  const porch=type==="porch" || type==="pavilion";
  const loft=type==="loft";
  const openEnds=type==="pavilion";
  const postHeight=eave-floorLevel;
  const count=w>8.9 ? 5 : w>4.8 ? 3 : 2;
  const bay=w/count;
  const doorW=workshop ? 1.37 : Math.min(1.30,bay*.72);
  const headY=Math.min(eave-.38,floorLevel+(workshop ? 1.99 : 1.90));
  const sillY=floorLevel+.92;
  const lean=.345+(palette%2)*.031;
  const run=halfZ+(porch ? .82 : .61);
  const slate=.68;
  const roofLevel=at=>eave+(run-Math.abs(at))*lean+eaveRise*(at/run)**4;
  function staticBox(name,width,height,depth,atX,atY,atZ) {
    return city.box(name,x+atX-width*.5,x+atX+width*.5,z+atZ-depth*.5,z+atZ+depth*.5,
      atY-height*.5,atY+height*.5);
  }
  function wall(width,height,depth,atX,atY,atZ,collision=false) {
    fit(plaster,width,height,depth,atX,atY,atZ,{wall:true});
    if(collision) staticBox("workshop plaster wall",width,height,depth,atX,atY,atZ);
  }

  // Slate base and granite column shoes carry the load through the wall.
  fit(stone,w+.22,.24,d+.22,0,floorLevel-.144,0,{wall:true});
  const slabs=Math.ceil(w/.61);
  for(const side of [-1,1]) for(let i=0;i<slabs;i++) {
    const pitch=w/slabs;
    fit(brick,pitch-.012,.119,.188,(i+.5)*pitch-halfX,.072,side*(halfZ+.084),
      {tint:.82+.18*((i*17)%9)/8,phase:i*.31});
  }
  for(const side of [-1,1]) {
    const front=side===1,face=side*halfZ;
    for(let i=0;i<=count;i++){
      const at=-halfX+bay*i;
      fit(stone,.258,.23,.241,at,.205,face,{tint:.83+.12*Math.cos(i*2.34)});
      fit(wood,.154,postHeight,.19,at,(floorLevel+eave)*.5,face,{phase:i*.74});
      fit(wood,.254,.13,.342,at,eave-.205,face+side*.035);
      fit(backing,.128,.126,.366,at,eave-.147,face+side*.112);
      if(openEnds || (porch && front)) staticBox("porch post",.178,postHeight,.20,at,(floorLevel+eave)*.5,face);
    }
    fit(wood,w+.24,.157,.204,0,eave-.177,face);
    fit(wood,w+.37,.117,.19,0,eave-.069,face);
    if(openEnds) {
      fit(wood,w-.24,.087,.27,0,floorLevel+.697,face-side*.096);
      staticBox("pavilion railing",w-.24,.087,.27,0,floorLevel+.697,face-side*.096);
      continue;
    }
    const faceSetback=porch && front ? .47 : .028;
    const wallFace=face-side*faceSetback;
    for(let i=0;i<count;i++){
      const at=-halfX+bay*(i+.5);
      const door=(front && i===Math.floor(count*.5) && count%2===1);
      const isEmpty=workshop && door;
      const opening=door ? doorW : Math.min(bay*.80,type==="hall" ? 1.76 : 1.30);
      const sill=door ? floorLevel : sillY;
      const top=headY;
      if(sill>floorLevel) wall(bay-.10,sill-floorLevel,.16,at,(sill+floorLevel)*.5,wallFace,workshop);
      wall(bay-.08,eave-.18-top,.15,at,(eave-.18+top)*.5,wallFace,workshop);
      for(const edge of [-1,1]) {
        const width=(bay-opening)*.5-.048;
        wall(width,top-sill,.155,at+edge*(opening+width)*.5,(sill+top)*.5,wallFace,workshop);
        fit(wood,.079,top-sill+.078,.144,at+edge*opening*.5,(sill+top)*.5,wallFace+side*.086);
      }
      for(const height of [sill,top]) fit(wood,opening+.138,.082,.221,at,height,wallFace+side*.073);
      if(isEmpty) continue;
      if(door) {
        for(let pl=0;pl<8;pl++) {
          const pitch=opening/8;
          fit(pl%3 ? materials.wood : wood,pitch-.007,top-sill-.052,.057,at-opening*.5+(pl+.5)*pitch,
            (sill+top)*.5,wallFace-side*.038,{tint:.81+.16*(pl%4)/3,phase:pl*.78});
        }
        for(const y of [sill+.28,top-.24]) fit(wood,opening,.095,.039,at,y,wallFace+side*.001);
        for(const px of [-.076,.079]){
          const ring=new THREE.TorusGeometry(.043,.008,7,17).translate(at+px,sill+.93,wallFace+side*.054);
          add(materials.metal,ring,.86);
        }
      } else {
        fit(workshop ? materials.paper : backing,opening+.034,top-sill,.042,at,(top+sill)*.5,
          wallFace-side*.089,{tint:front ? .86 : .69});
        const slats=Math.ceil(opening/.148);
        for(let k=1;k<slats;k++) fit(wood,.029,top-sill,.074,at+(k/slats-.5)*opening,
          (top+sill)*.5,wallFace+side*.079);
        for(const frac of [.30,.62,.80])
          fit(wood,opening,.033,.076,at,sill+frac*(top-sill),wallFace+side*.088);
        if(workshop) {
          const inner=wallFace-side*.126;
          for(const edge of [-1,1]) fit(wood,.057,top-sill+.081,.061,at+edge*opening*.50,(top+sill)*.5,inner);
          for(const y of [sill,top]) fit(wood,opening+.061,.049,.062,at,y,inner);
          for(let k=2;k<slats;k+=2)
            fit(wood,.026,top-sill,.028,at+(k/slats-.5)*opening,(top+sill)*.5,inner);
          fit(wood,opening,.025,.029,at,sill+.57*(top-sill),inner);
        }
      }
    }
  }

  for(const side of [-1,1]){
    const at=side*halfX;
    if(!openEnds) {
      wall(.164,postHeight+.012,d,at,(floorLevel+eave+.012)*.5,0,workshop);
      fit(brick,.219,.395,d+.016,at,.202,0,{wall:true});
      for(const atZ of [-halfZ,0,halfZ]){
        fit(wood,.195,postHeight,.140,at,(eave+floorLevel)*.5,atZ);
        fit(stone,.247,.199,.230,at,.193,atZ);
      }
      const gable=new THREE.Shape();
      gable.moveTo(-halfZ,0);
      gable.lineTo(halfZ,0);
      for(let k=0;k<=12;k++){
        const at=halfZ-2*halfZ*k/12;
        gable.lineTo(at,roofLevel(at)-eave-.021);
      }
      gable.closePath();
      const solid=new THREE.ExtrudeGeometry(gable,{depth:.135,bevelEnabled:false});
      solid.setIndex(Array.from({length:solid.attributes.position.count},(_,i)=>i));
      solid.rotateY(Math.PI/2).translate(at-.067,eave-.033,0);
      add(plaster,solid,.95,true);
      fit(wood,.177,run*lean,.099,at,eave+.46*run*lean,0);
    }
    for(const edge of [-1,1]){
      fit(wood,.12,.153,Math.hypot(run,run*lean),side*(halfX+.26),eave+.51*run*lean,
        edge*.5*run,{angle:edge*Math.atan(lean)});
      fit(backing,.07,.081,Math.hypot(run,run*lean),side*(halfX+.33),eave+.54*run*lean,
        edge*.5*run,{angle:edge*Math.atan(lean)});
    }
  }
  for(const side of [-1,1]) {
    const y=eave+(run-halfZ)*lean+.035;
    const boards=Math.ceil(run/.35);
    for(let j=0;j<boards;j++){
      const a=j*run/boards,b=(j+1)*run/boards;
      const dy=roofLevel(a)-roofLevel(b);
      fit(wood,w+.64,.071,Math.hypot(b-a,dy)+.014,0,(roofLevel(a)+roofLevel(b))*.5-.049,
        side*(a+b)*.5,{angle:side*Math.atan2(dy,b-a),tint:.78});
    }
    for(let i=0;i<=Math.ceil(w/.29);i++) {
      const along=Math.min(halfX,-halfX+i*.29);
      fit(wood,.067,.093,run-halfZ+.30,along,y-.091,side*(halfZ+.16),{angle:side*.12});
    }
  }
  const peak=eave+run*lean;
  fit(backing,w+.74,.133,.202,0,peak+.05,0);
  fit(brick,w+.81,.057,.139,0,peak+.139,0,{tint:.72});
  for(const end of [-1,1]) {
    const cap=new THREE.CylinderGeometry(.050,.081,.21,9);
    cap.rotateZ(-end*.34).translate(end*(halfX+.348),peak+.178,0);
    add(materials.metal,cap,.77);
  }
  // A real clerestory sits along the long facade rather than a baked shadow.
  if(loft) {
    for(const side of [-1,1]){
      const centre=side*w*.229,gap=1.18, dRun=.35;
      const z0=halfZ*.53;
      const sill=eave+(run-z0)*lean+.026;
      fit(plaster,gap,.53,dRun+.09,centre,sill+.226,z0,{wall:true,tint:.93});
      for(const xEdge of [-gap*.50,gap*.50])
        fit(wood,.092,.57,dRun+.18,centre+xEdge,sill+.261,z0);
      fit(backing,gap,.36,.047,centre,sill+.282,z0+dRun*.5+.055);
      for(let i=-3;i<=3;i++)
        fit(wood,.033,.366,.078,centre+i*gap/8,sill+.283,z0+dRun*.5+.07);
      const canopyW=gap+.284,canopyD=.742;
      fit(wood,canopyW,.089,canopyD,centre,sill+.592,z0+.016,{angle:.23});
      const span=11,spanW=canopyW/span;
      for(let i=0;i<span;i++){
        const x=centre-canopyW*.5+(i+.5)*spanW;
        const tile=new THREE.CylinderGeometry(.056,.057,canopyD*.94,7,1,true);
        tile.rotateX(Math.PI*.5-.23).translate(x,sill+.646,z0+.018);
        add(materials.decorativeRoof[palette],tile,.86+.13*Math.sin(i*6.31));
      }
      fit(backing,canopyW+.024,.062,.127,centre,sill+.565,z0+.381);
    }
  }
  a.build();
  group.userData.rainFoundation={x,z,halfX:halfX+.11,halfZ:halfZ+.10};
  const courses=porch || workshop ? {courseWidth:.232,courseLength:.33,segments:4} :
    {courseWidth:.272,courseLength:.41,segments:3};
  const cover=materials.roof(palette);
  const roof=tileRoof(group,cover,w+slate,run,eave,0,lean,courses);
  const far=tileRoof(null,cover,w+slate,run,eave,0,lean,
    {courseWidth:.63,courseLength:.89,segments:2}).geometry;
  if(!workshop && !openEnds) {
    const recessed=porch ? .47 : 0;
    staticBox("reconstructed house",w,peak+.20,d-recessed,0,(peak+.20)*.5,-recessed*.5);
  }
  return {group,wood,detail:{x,z,roof,near:roof.geometry,far,simplified:false}};
}

function joinerRoom(parent,city,materials) {
  const {x,z,w,d}=workshopBounds,halfX=w*.5,halfZ=d*.5,face=z+halfZ;
  const spec={x,z,w,d,eave:3.05,type:"hall",palette:0,workshop:true};
  const {group,wood,detail}=buildHouse(parent,city,materials,spec);
  const append=assembly(group),{fit}=append;
  const boards=materials.wood,threshold=materials.brick;
  const planks=24;
  const floorFront=halfZ+.17;
  for(let i=0;i<planks;i++) {
    const across=(i+.5)/planks*w-halfX;
    fit(i%4===1 ? wood : boards,w/planks-.005,.057,d-.034,across,floorLevel-.030,0,
      {tint:.84+.17*(1+Math.sin(i*11.4))*.5,phase:i*.62});
  }
  fit(threshold,1.63,.064,.21,0,.036,halfZ+.262);
  fit(threshold,1.51,.086,.32,0,.131,halfZ+.047);
  fit(wood,1.64,.064,.117,0,2.199,halfZ+.160);
  fit(wood,3.02,.090,.121,.68,.211,halfZ+.163);

  const bench={x:-1.61,z:-.31,length:1.77,depth:.79};
  fit(boards,bench.depth,.112,bench.length,bench.x,.814,bench.z);
  fit(wood,bench.depth-.08,.15,bench.length-.13,bench.x,.698,bench.z);
  for(const dx of [-.257,.257]) for(const dz of [-.67,.67])
    fit(wood,.095,.465,.102,bench.x+dx,.447,bench.z+dz);
  city.box("joiner's workbench",x+bench.x-bench.depth*.5,x+bench.x+bench.depth*.5,
    z+bench.z-bench.length*.5,z+bench.z+bench.length*.5,floorLevel,.876);
  for(let i=0;i<5;i++)
    fit(i%2 ? wood : boards,.139,.095, .72-i*.058,bench.x-.08+.055*i,.920+.061*i,bench.z-.22+i*.046,
      {tint:.78+i*.041,phase:1.3*i});
  fit(wood,.103,.070,.242,bench.x+.18,.895,bench.z+.49);
  fit(boards,.036,.052,.26,bench.x+.18,.910,bench.z+.34);
  for(const y of [1.16,1.70,2.16])
    fit(wood,1.24,.058,.262,1.76,y,-halfZ+.273);
  for(let i=0;i<4;i++)
    fit(i%2 ? boards : wood,.133,.328,.103,1.43+i*.151,1.355,-halfZ+.21,{phase:i*.79});
  const bowl=new THREE.LatheGeometry([[0,0],[.113,.007],[.134,.06],[.149,.099],[.139,.105],[.134,.079],
    [.115,.040],[0,.021]].map(([r,y])=>new THREE.Vector2(r,y)),20);
  append.add(materials.porcelain,bowl.translate(1.94,1.733,-halfZ+.273),.92);
  append.build();

  const plaque=document.createElement("canvas");
  plaque.width=300;plaque.height=112;
  const brush=plaque.getContext("2d");
  brush.fillStyle="#79583e";brush.fillRect(0,0,300,112);
  brush.strokeStyle="#b08e60";brush.lineWidth=5;brush.strokeRect(8,8,284,96);
  brush.fillStyle="#e0c590";brush.font="49px serif";brush.textAlign="center";brush.textBaseline="middle";
  brush.fillText("西岸作坊",150,56);
  const inscription=new THREE.CanvasTexture(plaque);
  inscription.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(.925,.343),
    new THREE.MeshStandardMaterial({map:inscription,roughness:.91}));
  sign.position.set(0,2.416,halfZ+.194);
  sign.name="West bank workshop plaque";
  group.add(sign);

  const pivot=new THREE.Group();
  pivot.name="Joiner's sliding lattice gate";
  pivot.position.set(0,floorLevel,halfZ+.173);
  group.add(pivot);
  const gate=assembly(pivot);
  const gateWidth=1.353,gateHeight=1.945,gateDepth=.081;
  for(let i=0;i<9;i++) {
    const pitch=gateWidth/9;
    gate.fit(i%3===0 ? wood : boards,pitch-.004,.812,.054,(i+.5)*pitch-gateWidth*.5,.433,0,
      {tint:.79+.16*(i%4)/3,phase:i*.38});
  }
  for(const px of [-gateWidth*.5+.035,gateWidth*.5-.035])
    gate.fit(wood,.073,gateHeight,.098,px,gateHeight*.5,0);
  for(const y of [.052,.864,1.408,gateHeight-.041])
    gate.fit(wood,gateWidth,.080,.087,0,y,0);
  for(let i=-4;i<=4;i++) gate.fit(wood,.035,1.021,.053,i*.124,gateHeight-.56,0);
  gate.add(materials.metal,new THREE.TorusGeometry(.049,.009,8,21).translate(-.41,.973,.065),.88);
  gate.build();
  const gateSolid=city.orientedBox("Joiner's sliding gate",gateWidth*.5,gateDepth*.5+.014,gateHeight);
  Object.assign(gateSolid,{x,z:face+.173,bottom:floorLevel,top:floorLevel+gateHeight});
  let position=0,target=0,blocked=false,lit=false;
  const travel=1.465;
  const lampLocal=new THREE.Vector3(-1.65,.996,.38);
  const lamp=new THREE.PointLight(0xffad66,0,3.4,1.92);
  lamp.position.copy(lampLocal);
  group.add(lamp);
  const flame=new THREE.Mesh(new THREE.SphereGeometry(.037,12,8),new THREE.MeshBasicMaterial({color:0xffce76}));
  flame.position.copy(lampLocal);
  flame.scale.set(.42,1.14,.50);
  group.add(flame);
  const stand=new THREE.Mesh(new THREE.LatheGeometry([
    [0,-.035],[.047,-.035],[.048,-.023],[.055,-.019],[.078,.008],
    [.092,.024],[.084,.029],[.064,.023],[.043,.015],[.025,.011],[0,.011],
  ].map(([r,y])=>new THREE.Vector2(r,y)),24),
  new THREE.MeshStandardMaterial({color:0x776040,roughness:.58,metalness:.42}));
  stand.position.copy(lampLocal);
  stand.position.y-=.091;
  group.add(stand);
  function support(px,pz) {
    const xx=Math.abs(px-x), dz=pz-z;
    if(xx<halfX-.045 && dz>-halfZ && dz<halfZ+.006) return floorLevel;
    if(xx>.745) return -Infinity;
    if(dz<=floorFront && dz>=halfZ-.02) return .174;
    if(dz>=floorFront && dz<halfZ+.366) return .068;
    return -Infinity;
  }
  function nearGate(player) {
    return Math.abs(player.x-x)<1.28 && Math.abs(player.z-face)<1.22;
  }
  function nearLamp(player) {
    return player.z<face-.22 && player.z>z-halfZ && Math.hypot(player.x-x-lampLocal.x,
      player.z-z-lampLocal.z)<1.15;
  }
  function action(player) {
    if(nearGate(player)) return blocked ? "门道有阻挡 E" : target>0 ? "拉合木格门 E" : "拉开木格门 E";
    if(nearLamp(player)) return lit ? "吹熄油灯 E" : "点亮油灯 E";
    return null;
  }
  function use(player) {
    if(nearGate(player)) {
      target=target>0 ? 0 : travel;
      blocked=false;
      return target ? "木格门沿着轨道拉开。" : "木格门沿着轨道关合。";
    }
    if(nearLamp(player)) {
      lit=!lit;
      return lit ? "油灯照亮了木工案。" : "油灯熄了。";
    }
    return null;
  }
  function setSlide(at) {
    position=at;
    pivot.position.x=at;
    pivot.updateMatrixWorld(true);
    gateSolid.x=x+at;
  }
  function collides(at,actors) {
    return actors.some(body=>{
      if(!body.enabled || body.top<=gateSolid.bottom || body.bottom+.02>=gateSolid.top) return false;
      return body.radius>0 ?
        circleTouchesBox(body.x,body.z,body.radius,x+at,gateSolid.z,gateSolid.halfX,gateSolid.halfZ,0) :
        rectanglesOverlap(x+at,gateSolid.z,gateSolid.halfX,gateSolid.halfZ,0,
          body.x,body.z,body.halfX,body.halfZ,body.yaw);
    });
  }
  function update(dt,time,actors) {
    const clearance=position+THREE.MathUtils.clamp(target-position,-.037,.037);
    // Require a clear margin after contact so irregular frame times cannot
    // move the gate in tiny increments against the same stationary actor.
    if(Math.abs(target-position)>.0005 && (!blocked || !collides(clearance,actors))) {
      const next=damp(position,target,6.2,dt);
      const parts=Math.max(1,Math.ceil(Math.abs(next-position)/.027));
      const from=position;
      blocked=false;
      for(let i=1;i<=parts;i++){
        const at=THREE.MathUtils.lerp(from,next,i/parts);
        if(collides(at,actors)) {blocked=true;break;}
        setSlide(at);
      }
      if(!blocked && Math.abs(target-position)<.002) setSlide(target);
    }
    flame.visible=lit;
    const intensity=lit ? 3.81+.28*Math.sin(time*13.2)+.099*Math.cos(time*21.7) : 0;
    flame.scale.y=1.10+.13*Math.sin(time*9.2);
    lamp.intensity=intensity;
  }
  function reset() {
    target=0;blocked=lit=false;setSlide(0);update(0,0,[]);
  }
  reset();
  return {support,action,use,update,reset,detail,
    materialAt(x,z,footY) {
      const top=support(x,z);
      if(top<footY-.009) return null;
      return top===floorLevel ? "wood" : "stone";
    },
    inspect:()=>({x,z,face,position,target,blocked,lit,floorLevel})};
}

export function buildStreetHouses(root,city,surface,objects) {
  const group=new THREE.Group(), mats=finishes(surface);
  group.name="Hand-built street architecture";
  root.add(group);
  const models=new Map(), details=[],roofDetails=[];
  for(const source of objects) {
    if(!source.mesh || !revisedHouseIds.has(source.id)) continue;
    const [centreX,,centreZ]=source.mesh.pos;
    const outer=new THREE.Group();
    outer.name="House reconstruction "+source.id;
    outer.userData={...source,finishFaces:[]};
    group.add(outer);
    const wings=reconstructions[source.id];
    for(const [a,b,w,d,eave,type,palette] of wings){
      const spec={x:centreX+a,z:centreZ+b,w,d,eave,type,palette};
      roofDetails.push(buildHouse(outer,city,mats,spec,source).detail);
      details.push({id:source.id,...spec});
    }
    models.set(source.id,outer);
  }
  const workshop=joinerRoom(group,city,mats);
  roofDetails.push(workshop.detail);
  return {models,details,workshop,updateDetail(eye) {
    for(const housing of roofDetails){
      const distance=Math.hypot(eye.x-housing.x,eye.z-housing.z,eye.y-3);
      const distant=distance>(housing.simplified ? 31 : 37);
      if(housing.simplified===distant) continue;
      housing.simplified=distant;
      housing.roof.geometry=distant ? housing.far : housing.near;
    }
  },inspect:()=>({reconstructed:models.size,wings:details,
    lowDetailRoofs:roofDetails.filter(roof=>roof.simplified).length,
    workshop:workshop.inspect()})};
}
