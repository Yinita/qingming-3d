import * as THREE from "three";
import { surfaceGLSL } from "./bridge-water-field.js";
import { waterHeight } from "./bridge-canal-bed.js";

const capacity=176;
const fraction=n=>n-Math.floor(n);

export function createCanalBubbles(water,field,depthAt,releaseFoam) {
  const layer=new THREE.WebGLRenderTarget(768,432);
  layer.texture.name="Canal bubble color";
  layer.depthTexture=new THREE.DepthTexture(768,432,THREE.UnsignedIntType);
  const uniforms=Object.fromEntries(["time","origin","waterState","simulationBounds","simulationHeight"]
    .map(key=>[key,water[key]]));
  uniforms.refractionDepth=water.refractionDepth;
  uniforms.bubbleSize={value:new THREE.Vector2(768,432)};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,
    vertexShader:`
      varying vec3 pointWorld;
      varying vec3 bubbleNormal;
      void main() {
        pointWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;
        bubbleNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
        gl_Position=projectionMatrix*viewMatrix*vec4(pointWorld,1.);
      }
    `,
    fragmentShader:`
      ${surfaceGLSL}
      uniform sampler2D refractionDepth;
      uniform vec2 bubbleSize;
      varying vec3 pointWorld;
      varying vec3 bubbleNormal;
      void main() {
        float depth=${waterHeight}+surfaceOffset(pointWorld.xz)-pointWorld.y;
        if(depth<-.003) discard;
        if(gl_FragCoord.z>texture2D(refractionDepth,gl_FragCoord.xy/bubbleSize).r+.00015) discard;
        vec3 n=normalize(bubbleNormal);
        vec3 eye=normalize(cameraPosition-pointWorld);
        float edge=pow(1.-max(0.,dot(n,eye)),2.1);
        vec3 light=normalize(vec3(-.42,.82,-.33));
        float glint=pow(max(0.,dot(n,normalize(light+eye))),39.);
        float bounce=pow(max(0.,dot(n,normalize(eye+vec3(.51,-.77,.34)))),16.);
        vec3 color=mix(vec3(.21,.26,.18),vec3(.78,.83,.65),.82*edge+.19*bounce)
          +vec3(.91,.84,.67)*1.04*glint;
        float opacity=(.22+.73*edge+.37*glint)*smoothstep(-.003,.015,depth);
        if(opacity<.035) discard;
        gl_FragColor=vec4(color,clamp(opacity,0.,.97));
        #include <colorspace_fragment>
      }
    `});
  const mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,9,7),material,capacity);
  mesh.name="Submerged canal bubbles";
  mesh.layers.set(1);
  mesh.frustumCulled=false;
  mesh.renderOrder=3;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count=0;
  const pass=new THREE.Scene();
  pass.add(mesh);
  const clear=new THREE.Color();
  const bubbleLayer={value:layer.texture}, bubbleDepth={value:layer.depthTexture};
  const bubblesReady={value:0};
  const particles=Array.from({length:capacity},()=>({active:false}));
  const current=new THREE.Vector2(), pose=new THREE.Object3D();
  const emitters={stone:0,trail:0,step:0,boat:0,breaker:0};
  let next=0,born=0,popped=0,peak=0,highestRise=0,downstream=0,lastPop=null,passes=0;

  function burst(x,y,z,time,kind,strength,vx=0,vz=0) {
    const count=kind==="stone" ? 21 : kind==="trail" ? 3 : kind==="boat" ? 8 : 10;
    const spread=kind==="stone" ? .21 : kind==="trail" ? .048 : .14;
    const turbulence=kind==="stone" ? .91 : kind==="trail" ? .58 : .27;
    for(let i=0;i<count;i++) {
      const seed=fraction(born*.618033989+time*.271);
      const angle=born*2.39996;
      const width=spread*(.20+.8*fraction(i*.37177+time*.838));
      const b=particles[next];
      const horizontalX=x+Math.cos(angle)*width, horizontalZ=z+Math.sin(angle)*width;
      const depth=depthAt(horizontalX,horizontalZ);
      next=(next+1)%capacity;
      born++;
      if(depth<.061) { b.active=false; continue; }
      const ceiling=field.height(horizontalX,horizontalZ,time);
      const floor=waterHeight-depth;
      const radius=(.0052+.0131*seed*seed)*(.73+.31*strength);
      if(ceiling-floor<4*radius) { b.active=false; continue; }
      b.active=true;
      b.seed=seed;
      b.x=horizontalX;
      b.z=b.startZ=horizontalZ;
      b.y=b.lowest=THREE.MathUtils.clamp(y-width*.58,floor+radius*1.7,ceiling-radius*1.8);
      b.kickX=vx*.15+Math.cos(angle)*.21*seed;
      b.kickZ=vz*.15+Math.sin(angle)*.21*seed;
      b.vy=-turbulence*(.29+.58*seed)*strength;
      b.radius=radius;
      b.life=.92+2.75*seed+Math.max(0,ceiling-b.y)*2.4;
      b.began=time;
      emitters[kind]++;
    }
  }

  function frame(time,step) {
    const dt=Math.min(.045,Math.max(0,step));
    mesh.count=0;
    for(const b of particles) {
      if(!b.active) continue;
      const age=time-b.began;
      if(age>=b.life) { b.active=false; continue; }
      field.velocity(b.x,b.z,time,current);
      const kick=Math.exp(-age*5.8);
      const phase=age*(11.+b.seed*17.)+b.seed*32.;
      const orbit=.047*(.45+.55*b.seed);
      b.x+=dt*(current.x*.88+b.kickX*kick+orbit*Math.cos(phase));
      b.z+=dt*(current.y*.88+b.kickZ*kick+orbit*Math.sin(phase*.73));
      const depth=depthAt(b.x,b.z);
      if(depth<.047) { b.active=false; continue; }
      const ceiling=field.height(b.x,b.z,time);
      const floor=waterHeight-depth;
      const terminal=.117+.24*Math.min(1,b.radius/.019);
      b.vy+=(terminal-b.vy)*Math.min(1,dt*5.7);
      b.y=Math.max(floor+b.radius*1.2,b.y+b.vy*dt);
      b.lowest=Math.min(b.lowest,b.y);
      highestRise=Math.max(highestRise,b.y-b.lowest);
      downstream=Math.max(downstream,b.z-b.startZ);
      if(b.y+b.radius>=ceiling) {
        releaseFoam(b.x,b.z,b.radius*3.4);
        b.active=false;
        popped++;
        lastPop={x:b.x,z:b.z,y:b.y,surface:ceiling,radius:b.radius,time};
        continue;
      }
      const fade=1-THREE.MathUtils.smoothstep(age,b.life-.31,b.life);
      const expansion=1+.12*THREE.MathUtils.smoothstep(b.y-b.lowest,0,.8);
      const radius=b.radius*Math.max(.1,fade)*expansion;
      const wobble=Math.sin(phase)*.13;
      pose.position.set(b.x,b.y,b.z);
      pose.scale.set(radius*(1+wobble),radius*(.83-wobble*.67),radius);
      pose.updateMatrix();
      mesh.setMatrixAt(mesh.count++,pose.matrix);
    }
    if(mesh.count) mesh.instanceMatrix.needsUpdate=true;
    peak=Math.max(peak,mesh.count);
    if(!mesh.count) bubblesReady.value=0;
  }

  function render(renderer,camera,width,height) {
    if(!mesh.count) return;
    if(layer.width!==width || layer.height!==height) layer.setSize(width,height);
    uniforms.bubbleSize.value.set(width,height);
    renderer.getClearColor(clear);
    const alpha=renderer.getClearAlpha();
    try {
      renderer.setClearColor(0,0);
      renderer.setRenderTarget(layer);
      renderer.render(pass,camera);
    } finally {
      renderer.setClearColor(clear,alpha);
    }
    bubblesReady.value=1;
    passes++;
  }

  return {burst,frame,render,uniforms:{bubbleLayer,bubbleDepth,bubblesReady,bubbleStrength:{value:1}},
    inspect:()=>({active:mesh.count,peak,emitters:{...emitters},popped,highestRise,downstream,lastPop,passes})};
}
