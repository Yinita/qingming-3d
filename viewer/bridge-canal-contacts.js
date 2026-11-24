import * as THREE from "three";
import { canalSpeed, waterHeight } from "./bridge-canal-bed.js";

export const contactCount = 12;
const sprayCapacity = 240;
const gravity = 9.81;

const sprayShader = new THREE.ShaderMaterial({
  vertexShader: `
    varying vec3 pointWorld;
    varying vec3 shapeNormal;
    void main() {
      pointWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;
      shapeNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
      gl_Position=projectionMatrix*viewMatrix*vec4(pointWorld,1.);
    }
  `,
  fragmentShader: `
    varying vec3 pointWorld;
    varying vec3 shapeNormal;
    void main() {
      vec3 eye=normalize(cameraPosition-pointWorld);
      vec3 n=normalize(shapeNormal);
      vec3 sun=normalize(vec3(-.42,.82,-.33));
      float gleam=pow(max(0.,dot(n,normalize(eye+sun))),31.);
      float rim=pow(1.-max(0.,dot(eye,n)),3.);
      vec3 color=mix(vec3(.24,.28,.176),vec3(.78,.77,.58),min(1.,.71*rim+.93*gleam));
      gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }
  `,
});

const splashVertex = `
  uniform float age;
  uniform float force;
  varying vec3 pointWorld;
  varying vec3 shapeNormal;
  varying float crest;
  varying float azimuth;
  void main() {
    float a=position.x;
    float u=position.y;
    float t=age;
    float petal=.68+.19*sin(a*7.+t*3.)+.13*sin(a*11.+1.3);
    float opening=.037+t*(.49+.40*force);
    float spread=opening+(u-.28)*(.03+t*.13);
    float launch=1.60*force*t-3.4*t*t;
    float y=u*max(.007,launch)*petal;
    vec3 p=vec3(cos(a)*spread,y,sin(a)*spread);
    crest=u; azimuth=a;
    shapeNormal=normalize(vec3(cos(a),-.39+.8*u,sin(a)));
    pointWorld=(modelMatrix*vec4(p,1.)).xyz;
    gl_Position=projectionMatrix*viewMatrix*vec4(pointWorld,1.);
  }
`;

const splashFragment = `
  uniform float age;
  varying vec3 pointWorld;
  varying vec3 shapeNormal;
  varying float crest;
  varying float azimuth;
  void main() {
    vec3 eye=normalize(cameraPosition-pointWorld);
    float gloss=pow(1.-abs(dot(normalize(shapeNormal),eye)),2.2);
    float torn=sin(azimuth*7.+age*4.)*.09+sin(azimuth*11.+1.3)*.07;
    float edge=1.-smoothstep(.86+torn,.99+torn,crest);
    float glint=smoothstep(.72,.99,crest+torn);
    float ageFade=smoothstep(0.,.036,age)*(1.-smoothstep(.20,.39,age));
    vec3 water=mix(vec3(.39,.44,.29),vec3(.82,.81,.66),gloss*.70+.27*glint);
    gl_FragColor=vec4(water,ageFade*edge*(.22+.54*gloss+.15*glint));
    #include <colorspace_fragment>
  }
`;

function crownGeometry() {
  const detail = 48;
  const heights = 6;
  const positions = [], indices = [];
  for (let i=0; i<=detail; i++) {
    for (let j=0; j<=heights; j++) {
      positions.push(i/detail*2*Math.PI,j/heights,0);
      const k=i*(heights+1)+j;
      if (i<detail && j<heights) indices.push(k,k+1,k+heights+1,k+1,k+heights+2,k+heights+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  return geometry;
}

export function buildWaterContacts(parent) {
  const events = Array.from({length:contactCount},() => new THREE.Vector4(0,0,-10,0));
  const spray = new THREE.InstancedMesh(new THREE.SphereGeometry(1,7,5),sprayShader,sprayCapacity);
  spray.name = "Ballistic canal droplets";
  spray.frustumCulled = false;
  spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  spray.count = 0;
  const group = new THREE.Group();
  group.name = "Water contact effects";
  group.add(spray);
  parent.add(group);
  const crownShape = crownGeometry();
  const crowns = Array.from({length:3},() => {
    const mesh = new THREE.Mesh(crownShape,new THREE.ShaderMaterial({
      vertexShader:splashVertex,fragmentShader:splashFragment,
      side:THREE.DoubleSide,transparent:true,depthWrite:false,
      uniforms:{ age:{ value:0 }, force:{ value:0 } },
    }));
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 4;
    group.add(mesh);
    return { mesh, began:-10, z:0 };
  });
  const particles = Array.from({length:sprayCapacity},() => ({
    began:-10,x:0,y:0,z:0,vx:0,vz:0,vy:0,size:0,
  }));
  let nextEvent = 0, nextSpray = 0, nextCrown = 0, peakSpray = 0;
  const totals = { step:0, stone:0, leaf:0 };
  let last = null;
  let surface=()=>waterHeight;
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0,1,0);
  const velocity = new THREE.Vector3();

  function hit(x,z,time,strength,kind,vx=0,vz=0) {
    const y=surface(x,z,time);
    events[nextEvent].set(x,z,time,strength);
    nextEvent = (nextEvent+1)%events.length;
    totals[kind]++;
    last = { x,z,time,strength,kind };
    if (kind === "leaf") return;
    if (strength > .68) {
      const crown = crowns[nextCrown];
      nextCrown = (nextCrown+1)%crowns.length;
      crown.began = time;
      crown.z=z;
      crown.mesh.position.set(x,y+.003,z);
      crown.mesh.material.uniforms.force.value=strength;
    }
    const counts = kind === "stone" ? 46 : 16;
    for (let i=0; i<counts; i++) {
      const index = nextSpray;
      nextSpray = (nextSpray+1)%particles.length;
      const angle = i*2.39996 + time*2.03;
      const random = (i*.61803398875) % 1;
      const reach = (.20 + 1.05*random)*strength + .08;
      const p = particles[index];
      p.began = time + ((i*.2701)%1)*.058;
      p.x = x + .057*Math.cos(angle);
      p.y=y;
      p.z = z + .057*Math.sin(angle);
      p.vx = Math.cos(angle)*reach + vx*.18;
      p.vz = Math.sin(angle)*reach + vz*.18;
      p.vy = .38+(.48+1.44*((i*.3713)%1))*strength;
      p.size = (.0034+.0103*random)*(.51+strength*.55);
    }
  }

  function frame(time) {
    spray.count = 0;
    for (const p of particles) {
      const t = time-p.began;
      if (t<0 || t>.7) continue;
      const h = p.vy*t - .5*gravity*t*t;
      const x=p.x+p.vx*t, y=p.y+h+.004, z=p.z+p.vz*t;
      if (h<0 || (t>.065 && y<surface(x,z,time))) continue;
      dummy.position.set(x,y,z);
      const fade = Math.max(.32,1-t*1.4);
      dummy.scale.set(p.size*fade,p.size*(1.24+.43*Math.abs(p.vy-gravity*t))*fade,p.size*fade);
      velocity.set(p.vx,p.vy-gravity*t,p.vz).normalize();
      dummy.quaternion.setFromUnitVectors(up,velocity);
      dummy.updateMatrix();
      spray.setMatrixAt(spray.count++,dummy.matrix);
    }
    if (spray.count) spray.instanceMatrix.needsUpdate=true;
    peakSpray=Math.max(peakSpray,spray.count);
    for (const crown of crowns) {
      const age=time-crown.began;
      crown.mesh.visible=age>=0 && age<.39;
      crown.mesh.material.uniforms.age.value=age;
      if (crown.mesh.visible) crown.mesh.position.z=crown.z+age*canalSpeed*.22;
    }
  }

  return {
    events, group, hit, frame, followSurface(sample) { surface=sample; },
    inspect: time => ({
      totals: { ...totals }, last, spray: spray.count, peakSpray,
      activeRipples: events.filter(e=>e.w>0 && time>=e.z && time-e.z<2.4).length,
      crowns: crowns.filter(c=>c.mesh.visible).length,
    }),
  };
}
