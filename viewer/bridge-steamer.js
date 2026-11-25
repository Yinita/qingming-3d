import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedBox } from "./bridge-look.js";

const { lerp, smoothstep } = THREE.MathUtils;
const rimRadius = .238;
const hingeOffset = .214;
export const cakeLiftDuration = 2.54;

function lathe(profile, segments = 48) {
  return new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)),segments);
}

function bambooLattice(radius, pitch, depth, crown) {
  const pieces=[];
  for(let axis=0;axis<2;axis++) {
    for(let i=-Math.floor(radius/pitch);i<=Math.floor(radius/pitch);i++) {
      const along=i*pitch, extent=Math.sqrt(radius*radius-along*along);
      const points=[];
      for(let k=0;k<=16;k++) {
        const cross=lerp(-extent,extent,k/16);
        const r2=(along*along+cross*cross)/(radius*radius);
        const wave=Math.cos(Math.PI*(cross/pitch+i+axis))*.0032;
        const y=crown*(1-r2)+wave+axis*.001;
        points.push(new THREE.Vector3(axis ? cross : along,y,axis ? along : cross));
      }
      const strand=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),18,depth,5,false);
      pieces.push(strand);
    }
  }
  const geometry=mergeGeometries(pieces);
  pieces.forEach(piece=>piece.dispose());
  return geometry;
}

function steamMaterial() {
  return new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{time:{value:0},opening:{value:0},burst:{value:0},wind:{value:new THREE.Vector2()}},
    vertexShader:`
      varying vec2 mistUV;
      uniform vec2 wind;
      void main() {
        mistUV=uv;
        vec3 drift=vec3(wind.x,0.,wind.y)*pow(uv.y,1.65)*.071;
        vec4 p=modelMatrix*vec4(position,1.)+vec4(drift,0.);
        gl_Position=projectionMatrix*viewMatrix*p;
      }
    `,
    fragmentShader:`
      varying vec2 mistUV;
      uniform float time,opening,burst;
      float wisp(float x,float centre,float width) {
        float r=(x-centre)/width;
        return exp(-r*r);
      }
      void main() {
        float y=mistUV.y,x=mistUV.x;
        float rise=23.*y-time*5.9;
        float drift=y*(.088*sin(rise*.55)+.16*y);
        float spread=.038+y*.187+opening*.078;
        float core=wisp(x,.49+drift,spread)*(.40+.24*sin(rise)+.24*sin(rise*.61+1.));
        float side=wisp(x,.38-drift,spread*.57)*(.30+.26*sin(rise*.95+2.1));
        float edge=smoothstep(0.,.09,x)*(1.-smoothstep(.91,1.,x));
        float height=smoothstep(0.,.075,y)*(1.-smoothstep(.39+burst*.21,.92,y));
        float opacity=(core+side)*edge*height*(.018+opening*.090+burst*.143);
        gl_FragColor=vec4(vec3(.77,.78,.75),opacity);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function buildBambooSteamer(stall,surface,{x,y,z,place,sampleAir}) {
  const group=new THREE.Group();
  group.name="Working bamboo steamer";
  group.position.set(x,y,z);
  stall.add(group);

  const bamboo=surface("tea-wood",0xf3c995,.61,.85);
  const strips=surface("tea-wood",0xe6b47a,.61,.88);
  const tie=surface("rail-wood",0xc78a55,.59,.94);
  const hearth=new THREE.MeshStandardMaterial({color:0x65564b,roughness:.91});
  const iron=new THREE.MeshStandardMaterial({color:0x373932,roughness:.63,metalness:.23});

  const base=lathe([[0,.002],[.182,.001],[.216,.020],[.220,.038],[.213,.064],
    [.194,.078],[.180,.072],[.180,.034],[0,.033]]);
  place(group,base,hearth,0,0,0).name="Glazed earthenware steam basin";
  place(group,lathe([[.196,.056],[.209,.057],[.212,.067],[.205,.079],[.192,.080]]),iron,0,0,0);
  const basket=lathe([[.200,.066],[.225,.067],[.233,.079],[.236,.089],
    [.233,.139],[.239,.144],[.238,.157],[.224,.162],[.216,.152],[.218,.099],[.200,.075]]);
  place(group,basket,bamboo,0,0,0).name="Split bamboo basket walls";
  place(group,bambooLattice(.220,.022,.0040,0),strips,0,.109,0).name="Woven trivet underneath the cakes";
  for(const y of [.074,.094,.130,.150])
    place(group,new THREE.TorusGeometry(.232,.0036,5,48).rotateX(Math.PI/2),tie,0,y,0);

  const lid=new THREE.Group();
  lid.name="Hinged woven bamboo lid";
  lid.position.set(0,.155,hingeOffset);
  group.add(lid);
  const rim=lathe([[.224,-.010],[.236,-.010],[rimRadius,.002],[.236,.014],
    [.227,.022],[.215,.024],[.211,.015],[.224,.011]]);
  place(lid,rim,bamboo,0,0,-hingeOffset);
  place(lid,bambooLattice(.223,.016,.0049,.046),strips,0,.025,-hingeOffset).name="Interlaced domed lid";
  place(lid,new THREE.TorusGeometry(.227,.0051,6,48).rotateX(Math.PI/2),tie,0,.020,-hingeOffset);
  const handleSpace=new THREE.Group();
  handleSpace.position.set(-.007,.071,-hingeOffset+.087);
  lid.add(handleSpace);
  const handleCurve=new THREE.CatmullRomCurve3([[-.064,0],[-.049,.039],[.044,.039],[.063,0]]
    .map(([x,y])=>new THREE.Vector3(x,y,0)));
  place(handleSpace,new THREE.TubeGeometry(handleCurve,20,.008,7),tie,0,0,0)
    .name="Bent bamboo lifting handle";
  for(const x of [-.057,.057]) {
    place(handleSpace,detailedBox(.025,.015,.043,iron,.004),iron,x,.003,0);
  }
  const vent=steamMaterial();
  const steam=new THREE.Group();
  steam.position.set(0,.143,-.045);
  steam.name="Translucent convection above the steamer";
  group.add(steam);
  const veil=new THREE.PlaneGeometry(.65,.58).translate(0,.29,0);
  for(const yaw of [0,Math.PI*.42,Math.PI*.77]) {
    const plume=new THREE.Mesh(veil,vent);
    plume.rotation.y=yaw;
    plume.layers.enable(1);
    steam.add(plume);
  }

  const tongs=new THREE.Group();
  tongs.name="Bamboo serving tongs";
  stall.add(tongs);
  place(tongs,detailedBox(.059,.023,.036,tie,.007),tie,0,-.012,.020);
  const jaws=[-1,1].map(side=>{
    const lever=new THREE.Group();
    tongs.add(lever);
    const x=side*.020;
    const y=-.013;
    place(lever,detailedBox(.016,.017,.239,bamboo,.006),bamboo,x,y,-.077);
    place(lever,detailedBox(.029,.020,.046,tie,.007),tie,x,y,-.200);
    return lever;
  });
  const tipOffset=new THREE.Vector3();
  return {
    showLid(angle,heat,time) {
      lid.rotation.x=angle;
      vent.uniforms.time.value=time;
      vent.uniforms.opening.value=smoothstep(angle,.02,1.10);
      vent.uniforms.burst.value=heat;
      sampleAir?.(stall.position.x+x,stall.position.z+z,vent.uniforms.wind.value,.085,
        stall.position.y+y+.33);
    },
    lidGrip:target=>handleSpace.localToWorld(target.set(0,.036,0)),
    positionTongs(x,y,z,yaw,spread) {
      tongs.position.set(x,y,z);
      tongs.rotation.set(-.12,yaw,0);
      jaws.forEach((jaw,i)=>{jaw.rotation.y=(i===0 ? 1 : -1)*spread;});
    },
    alignTip(x,y,z) {
      tipOffset.set(0,-.021,-.198).applyEuler(tongs.rotation);
      tongs.position.set(x,y,z).sub(tipOffset);
    },
    toolGrip:target=>tongs.localToWorld(target.set(0,0,.014)),
    toolTip:target=>tongs.localToWorld(target.set(0,-.021,-.198)),
    inspect() {
      return { opening:lid.rotation.x, steam:vent.uniforms.burst.value,
        wind:vent.uniforms.wind.value.toArray(),tongs:tongs.position.toArray() };
    },
  };
}
