import * as THREE from "three";

const start = .88;
const stop = 3.11;
const duration = 4.60;
const pickupTime=.86;
const rows = 27;
const sides = 8;
const splashCount = 18;

const cupX = .28, cupZ = 1.21, cupBottom = .887;
const potX = .99, potZ = 1.07, potRest = .896;
const spoutTip = new THREE.Vector3(-.42, .235, .027);
const gravity = 9.81;
const eased = THREE.MathUtils.smoothstep;

function mount(shape, material, parent, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(shape, material);
  object.position.set(x, y, z);
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}

function lathe(outline) {
  return new THREE.LatheGeometry(outline.map(([r, y]) => new THREE.Vector2(r, y)), 48);
}

function pipe(outline, radii, segments = 24) {
  const path = new THREE.CatmullRomCurve3(outline.map(p => new THREE.Vector3(...p)));
  const geometry = new THREE.TubeGeometry(path, segments, 1, 10, false);
  const positions = geometry.attributes.position;
  const point = new THREE.Vector3(), center = new THREE.Vector3();
  for (let ring = 0; ring <= segments; ring++) {
    const u = ring / segments;
    path.getPointAt(u, center);
    const radius = THREE.MathUtils.lerp(radii[0], radii[1], u);
    for (let side = 0; side <= 10; side++) {
      const i = ring * 11 + side;
      point.fromBufferAttribute(positions, i).sub(center).multiplyScalar(radius).add(center);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function pose(t, position) {
  const lift = eased(t, .05, .78) * (1 - eased(t, 3.39, 4.27));
  const angle = .42 * eased(t, .45, .91) * (1 - eased(t, 3.12, 3.61));
  position.set(potX - lift*.036, potRest + .24*lift, potZ - .07*lift);
  return angle;
}

function turn(t) { return .33 * eased(t, .12, .88) * (1 - eased(t, 3.38, 4.27)); }

function liquidLevel(volume) { return .027 + .076 * Math.pow(volume, .68); }
function fill(t) { return THREE.MathUtils.clamp((t - start - .24) / (stop - start), 0, 1); }

const liquidShader = `
  uniform float pourTime;
  uniform float impact;
  varying vec2 teaUV;
  void main() {
    vec2 q = (teaUV-.5)*2.0 - vec2(.15,.11);
    float radius = length(q*vec2(1.,1.22));
    float phase = 30.0*radius - pourTime*22.0;
    float rings = pow(.5 + .5*cos(phase), 5.0) * exp(-1.4*radius);
    float sheen = max(0.0, .92 - length(q-vec2(.47,-.39))*1.4);
    float rim = smoothstep(.84,1.0,length((teaUV-.5)*2.0));
    vec3 tea = vec3(.126,.047,.010) + vec3(.23,.13,.042)*(sheen*.62+impact*rings*.7+rim*.22);
    gl_FragColor = vec4(tea, 1.0);
    #include <colorspace_fragment>
  }
`;

export function buildTea(stall) {
  const glaze = new THREE.MeshPhysicalMaterial({ color: 0x627868, roughness: .31,
    clearcoat: .52, clearcoatRoughness: .29 });
  const lip = new THREE.MeshStandardMaterial({ color: 0xada483, roughness: .49 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x504b39, roughness: .61 });
  const liquid = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 liquidPoint;
      varying vec3 liquidNormal;
      void main() {
        vec4 p=vec4(position,1.0);
        vec3 n=normal;
        #ifdef USE_INSTANCING
          p=instanceMatrix*p;
          n=mat3(instanceMatrix)*n;
        #endif
        liquidPoint=(modelMatrix*p).xyz;
        liquidNormal=normalize(mat3(modelMatrix)*n);
        gl_Position=projectionMatrix*viewMatrix*vec4(liquidPoint,1.);
      }
    `,
    fragmentShader: `
      varying vec3 liquidPoint;
      varying vec3 liquidNormal;
      void main() {
        vec3 eye=normalize(cameraPosition-liquidPoint);
        vec3 n=normalize(liquidNormal);
        if(dot(n,eye)<0.0) n=-n;
        float ndv=max(dot(n,eye),0.0);
        float rim=pow(1.0-ndv,2.8);
        float spec=pow(max(0.0,dot(n,normalize(eye+vec3(-.40,.79,.45)))),38.0);
        float bounce=pow(max(0.0,dot(n,normalize(eye+vec3(.75,.40,-.39)))),13.0);
        vec3 bronze=mix(vec3(.062,.019,.004),vec3(.31,.113,.023),.34+.48*rim);
        vec3 light=bronze + vec3(.69,.40,.14)*(spec*.64+bounce*.24+rim*.11);
        gl_FragColor=vec4(light,1.0);
        #include <colorspace_fragment>
      }
    `,
  });

  const pot = new THREE.Group();
  pot.name = "Celadon pouring kettle";
  stall.add(pot);
  mount(lathe([[0,.018],[.11,.018],[.125,.048],[.184,.079],[.198,.131],[.17,.190],
    [.114,.222],[.108,.232],[.08,.232],[.04,.236],[0,.242]]), glaze, pot);
  mount(lathe([[0,.002],[.086,.002],[.106,.011],[.087,.031],[.050,.044],[.031,.046],
    [.029,.066],[.018,.080],[0,.081]]), glaze, pot, 0, .230, 0);
  mount(new THREE.TorusGeometry(.105,.0046,8,40).rotateX(Math.PI/2), lip, pot, 0, .241, 0);
  mount(pipe([[-.14,.103,.002],[-.24,.110,.006],[-.312,.163,.019],
    [-.373,.218,.026],spoutTip.toArray()],[.048,.0224]), glaze, pot);
  const mouth = mount(new THREE.CircleGeometry(.017,24), clay, pot, ...spoutTip.toArray());
  mouth.lookAt(spoutTip.clone().add(new THREE.Vector3(-1,.46,0)));
  mouth.castShadow = false;
  mount(pipe([[.139,.193,-.005],[.233,.235,-.006],[.307,.198,-.004],
    [.304,.116,.003],[.183,.070,0]],[.020,.020]), glaze, pot);
  mount(new THREE.TorusGeometry(.151,.0053,7,40).rotateX(Math.PI/2), clay, pot, 0, .068, 0);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const stroke = mount(new THREE.SphereGeometry(.014,9,6), lip, pot, Math.cos(a)*.183,.111,Math.sin(a)*.183);
    stroke.scale.set(1.1,.68,1.1);
  }

  const cup = new THREE.Group();
  cup.name = "Ceramic tea cup";
  cup.position.set(cupX, cupBottom, cupZ);
  stall.add(cup);
  mount(lathe([[0,.008],[.064,.008],[.068,.022],[.090,.055],[.106,.105],[.106,.124],
    [.099,.129],[.091,.125],[.092,.108],[.081,.062],[.066,.032],[.048,.024],[0,.024]]),glaze,cup);
  mount(new THREE.TorusGeometry(.099,.0037,8,44).rotateX(Math.PI/2),lip,cup,0,.125,0);
  mount(lathe([[0,.001],[.096,.001],[.140,.010],[.144,.024],[.138,.029],
    [.119,.020],[.073,.012],[0,.012]]),glaze,cup);
  mount(new THREE.TorusGeometry(.141,.0029,6,42).rotateX(Math.PI/2),lip,cup,0,.025,0);

  const tea = mount(new THREE.CircleGeometry(1,48).rotateX(-Math.PI/2),
    new THREE.ShaderMaterial({
      uniforms: { pourTime: { value: 0 }, impact: { value: 0 } },
      vertexShader: `varying vec2 teaUV;
        void main(){ teaUV=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: liquidShader,
    }), cup);
  tea.castShadow = tea.receiveShadow = false;
  tea.visible = false;

  const steam = new THREE.Group();
  steam.name = "Convection above hot tea";
  steam.position.set(cupX,cupBottom+.106,cupZ);
  steam.visible = false;
  stall.add(steam);
  const wisps = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, heat: { value: 0 } },
    vertexShader: `varying vec2 p; void main() {
      p=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    }`,
    fragmentShader: `
      uniform float time;
      uniform float heat;
      varying vec2 p;
      void main() {
        float y=p.y;
        float drift=.56 + .20*y + .14*sin(y*10.0-time*2.4)*y;
        float curl=sin(19.0*y-time*4.0+sin(y*10.0-time*1.7));
        float width=.046 + .19*y;
        float density=exp(-pow((p.x-drift)/width,2.0))*(.45+.35*curl);
        density+=.53*exp(-pow((p.x-drift+.15*y)/(width*.57),2.0))
                   *(.47+.43*sin(22.0*y-time*4.6));
        float alpha=density*smoothstep(0.0,.24,y)*(1.0-smoothstep(.43,.96,y))*heat*.18;
        gl_FragColor=vec4(vec3(.64,.60,.49),alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const steamPlane = new THREE.PlaneGeometry(.41,.43).translate(.03,.215,0);
  const plume = new THREE.Mesh(steamPlane,wisps);
  const secondPlume = new THREE.Mesh(steamPlane,wisps);
  secondPlume.rotation.y = Math.PI*.46;
  steam.add(plume,secondPlume);

  const positions = new THREE.BufferAttribute(new Float32Array(rows * sides * 3),3)
    .setUsage(THREE.DynamicDrawUsage);
  const normals = new THREE.BufferAttribute(new Float32Array(rows * sides * 3),3)
    .setUsage(THREE.DynamicDrawUsage);
  const indices = [];
  for (let row = 0; row < rows-1; row++) {
    for (let col = 0; col < sides; col++) {
      const a = row*sides+col, b = row*sides+(col+1)%sides;
      indices.push(a,a+sides,b,b,a+sides,b+sides);
    }
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setIndex(indices);
  ribbon.setAttribute("position", positions);
  ribbon.setAttribute("normal", normals);
  const stream = mount(ribbon, liquid, stall);
  stream.name = "Ballistic tea stream";
  stream.castShadow = false;
  stream.frustumCulled = false;
  stream.visible = false;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), liquid, splashCount);
  drops.name = "Cup impact droplets";
  drops.frustumCulled = false;
  drops.count = 0;
  stall.add(drops);

  let began = -Infinity;
  let volume = 0;
  let age = Infinity;
  let steamStrength = 0;
  let peakDrops = 0;
  const spout = new THREE.Vector3(), tip = new THREE.Vector3();
  const normal = new THREE.Vector3(), derivative = new THREE.Vector3(), tangent = new THREE.Vector3();
  const drop = new THREE.Object3D();

  function source(t, point) {
    const angle = pose(t, point);
    const yaw = turn(t);
    const outletX = Math.cos(angle)*spoutTip.x - Math.sin(angle)*spoutTip.y;
    point.x += Math.cos(yaw)*outletX + Math.sin(yaw)*spoutTip.z;
    point.y += Math.sin(angle)*spoutTip.x + Math.cos(angle)*spoutTip.y;
    point.z += -Math.sin(yaw)*outletX + Math.cos(yaw)*spoutTip.z;
  }

  function jet(lag, now, level) {
    const emitted = now - lag;
    source(emitted, spout);
    const fall = Math.max(.04, spout.y - level);
    const exitY = -.24 - .082*Math.sin(emitted*2.1);
    const flight = (exitY + Math.sqrt(exitY*exitY + 2*gravity*fall))/gravity;
    const vx = (cupX + .014*Math.sin(emitted*13.4) - spout.x)/flight;
    const vz = (cupZ + .012*Math.sin(emitted*14.6) - spout.z)/flight;
    const t = Math.min(lag, flight);
    tip.set(spout.x + vx*t, spout.y + exitY*t - gravity*t*t/2, spout.z + vz*t);
    derivative.set(vx, exitY - gravity*t, vz).normalize();
    return flight;
  }

  function update(time) {
    age = time - began;
    if (!Number.isFinite(age) && !tea.visible) {
      pose(duration,pot.position);
      return;
    }
    const live = age <= duration;
    const t = Math.min(age, duration);
    pot.rotation.set(0,turn(t),pose(t,pot.position));
    volume = Number.isFinite(began) ? fill(t) : 0;
    const level = cupBottom + liquidLevel(volume);
    tea.visible = volume > .005;
    tea.position.y = liquidLevel(volume) + .0004;
    tea.scale.setScalar(.048 + .042 * Math.pow(volume,.67));
    tea.material.uniforms.pourTime.value = Math.min(age, duration + 1);
    tea.material.uniforms.impact.value = eased(t, 1.07, 1.27)*(1 - eased(t, 3.26, 4.58));
    steamStrength = eased(volume,.06,.57)*(1-eased(age,8,28));
    steam.visible = steamStrength > .01;
    wisps.uniforms.heat.value = steamStrength;
    wisps.uniforms.time.value = time;
    const flight = jet(.23, t, level);
    const lower = Math.max(0, t-stop), upper = Math.min(t-start, flight);
    stream.visible = live && upper > lower;
    if (stream.visible) {
      for (let row = 0; row < rows; row++) {
        const lag = THREE.MathUtils.lerp(lower, upper, row/(rows-1));
        jet(lag,t,level);
        normal.set(-derivative.y,derivative.x,0).normalize();
        tangent.crossVectors(derivative,normal);
        const neck = .926 + .135*Math.sin(lag*49 - 19*t) * Math.min(1,lag*8);
        const radius = (.0132 - .020*lag) * neck * (1 + .38*eased(lag, flight-.033, flight));
        for (let col = 0; col < sides; col++) {
          const phase = 2*Math.PI*col/sides;
          const x = normal.x*Math.cos(phase)+tangent.x*Math.sin(phase);
          const y = normal.y*Math.cos(phase)+tangent.y*Math.sin(phase);
          const z = normal.z*Math.cos(phase)+tangent.z*Math.sin(phase);
          const index = row*sides+col;
          positions.setXYZ(index,tip.x+radius*x,tip.y+radius*y,tip.z+radius*z);
          normals.setXYZ(index,x,y,z);
        }
      }
      positions.needsUpdate = normals.needsUpdate = true;
    }

    drops.count = 0;
    if (live && t >= start+flight && t < stop+flight+.37) {
      for (let i = 0; i < splashCount; i++) {
        const stride = .23 + .09*Math.sin(i*23.17);
        const phase = (t-start-flight + i*.137) % stride;
        const velocity = .61 + .66*(.5+.5*Math.sin(i*7.13));
        const lift = velocity*phase - gravity*phase*phase/2;
        if (lift <= .0012) continue;
        const angle = i*2.399963 + Math.floor(t/stride)*.41;
        const spread = phase*(.25+.24*(.5+.5*Math.cos(i*15.3)));
        drop.position.set(cupX+Math.cos(angle)*spread,level+lift,cupZ+Math.sin(angle)*spread);
        const width = .0024 + .0026*(.5+.5*Math.cos(i*11.13));
        drop.scale.set(width, width*1.42, width);
        drop.updateMatrix();
        drops.setMatrixAt(drops.count++, drop.matrix);
      }
      drops.instanceMatrix.needsUpdate = true;
      peakDrops = Math.max(peakDrops, drops.count);
    }
  }

  const graspFrame=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  const handleContact=new THREE.Object3D();
  handleContact.name="Kettle handle contact";
  handleContact.position.set(.311,.174,-.002);
  pot.add(handleContact);
  return {
    duration:duration+pickupTime,
    grip(target,orientation) {
      if(orientation) pot.getWorldQuaternion(orientation).multiply(graspFrame);
      return handleContact.getWorldPosition(target);
    },
    start(time) { began = time+pickupTime; peakDrops = 0; update(time); },
    age: () => age,
    reset() {
      began = -Infinity;
      age = Infinity;
      volume = peakDrops = steamStrength = 0;
      pot.rotation.set(0,0,0);
      pose(duration,pot.position);
      tea.visible = steam.visible = stream.visible = false;
      drops.count = 0;
    },
    update,
    inspect() { return { age: Number.isFinite(age) ? age : null, fill: volume,
      stream: stream.visible, steam: steamStrength, droplets: drops.count, peakDroplets: peakDrops }; },
  };
}
