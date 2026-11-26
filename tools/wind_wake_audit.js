async () => {
  const url=name=>new URL("./"+name,location.href).href;
  const THREE=await import(url("vendor/three/build/three.module.js"));
  const {airFromMap,airUniforms,waterWindDrift,waterWindDelay,prevailingWind}=await import(url("bridge-air.js"));
  const {airWakeAt,inspectWakes}=await import(url("bridge-air-wakes.js"));
  const {capillaryGLSL}=await import(url("bridge-water-field.js"));
  const {advanceAirborneLeaf}=await import(url("bridge-leaf-dynamics.js"));
  const fixture=await import(url("bridge-air-wakes.js?fixture=isolated"));
  const read=new THREE.Vector3();
  const posed=new THREE.Vector2();
  const view=fixture.wakeUniforms.windWakes.value;
  const hx=prevailingWind.x,hz=prevailingWind.y;
  function position(x,z,d,side=0) { return [x+hx*d-hz*side,z+hz*d+hx*side]; }
  function isolatedResponse(d,side,y) {
    return fixture.airWakeAt(...position(0,0,d,side),y,read).toArray();
  }
  const gust=(_x,_z,v,t)=>v.set(.44+2.1*Math.exp(-((t-2.14)**2/.23)),0);
  fixture.placeWakes(-16,-16,36,36,hx,hz);
  fixture.windScreen({x:0,z:0,along:1.8,cross:2.05,bottom:2.1,top:5.35,density:1.08,pose:o=>o.copy(posed)});
  const trace=[];
  for(let i=0;i<=106;i++) {
    const t=i*.06;
    fixture.refreshWakes(t,gust,true);
    trace.push({time:t,near:isolatedResponse(3.2,0,2.55)[0],far:isolatedResponse(8.9,0,2.55)[0]});
  }
  const minimum=key=>trace.reduce((a,b)=>a[key]<=b[key]?a:b);
  fixture.refreshWakes(2.76,gust,true);
  const canopy={upstream:isolatedResponse(-3.25,0,.10),shelter:isolatedResponse(3.2,0,.10),
    inside:isolatedResponse(3.2,0,2.55),upper:isolatedResponse(3.2,0,5.35),
    left:isolatedResponse(2.6,-2.3,2.55),right:isolatedResponse(2.6,2.3,2.55),
    recovery:isolatedResponse(14.4,0,2.55),above:isolatedResponse(3.2,0,10),
    nearTime:minimum("near").time,farTime:minimum("far").time};
  posed.set(.23,-.15);
  fixture.refreshWakes(2.82,gust,true);
  canopy.moved=fixture.inspectWakes().sources[0].offset;
  fixture.placeWakes(-16,-16,36,36,hx,hz);
  fixture.windScreen({x:0,z:0,along:1.9,cross:2.08,top:2.92,density:1.43,porous:false});
  fixture.refreshWakes(3.22,gust,true);
  const building={behindTime:3.22,behind:isolatedResponse(3.7,0,.10),roof:isolatedResponse(3.7,0,5.35)};
  fixture.refreshWakes(2.76,gust,true);
  building.shoulderTime=2.76;
  building.left=isolatedResponse(2.25,-2.5,.10);
  building.right=isolatedResponse(2.25,2.5,.10);
  view.dispose();

  const river=__scene.scene.getObjectByName("Canal surface");
  const source=inspectWakes().sources.find(i=>i.name==="West willow");
  const group=inspectWakes().sources.find(i=>i.name==="house");
  const riverTime=river.material.uniforms.time.value;
  const region=position(...source.position,3.55,.02);
  const samples=[];
  for(const y of [.10,.68,2.55,4.13,5.35,7.25,10.0]) {
    for(const site of [source,group]) {
      for(const [d,side] of [[-2.9,0],[1.4,0],[3.55,0],[5.7,2.25],[7.7,-2.77]]) {
        samples.push([...position(...site.position,d,side),y]);
      }
    }
  }
  const slice=samples.length;
  for(let i=0;i<20;i++) for(let j=0;j<24;j++) {
    samples.push([...position(...source.position,2.10+i*.17,-1.38+j*.12),.10]);
  }
  const gl=document.createElement("canvas").getContext("webgl2");
  if(!gl) throw Error("WebGL2 is required");
  function compile(type,code) {
    const shader=gl.createShader(type);
    gl.shaderSource(shader,code);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
    precision highp float;
    #define texture2D texture
    in vec3 location;
    uniform vec2 origin;
    uniform float time;
    ${capillaryGLSL}
    out vec3 wind;
    out vec3 ripple;
    void main() {
      wind=canalAirFlow(location.xy,windTime,location.z);
      ripple=capillaryWaves(location.xy);
      gl_Position=vec4(0.,0.,0.,1.);
    }`);
  const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;
    out vec4 color;
    void main(){color=vec4(0.);}`);
  const program=gl.createProgram();
  gl.attachShader(program,vertex);
  gl.attachShader(program,fragment);
  gl.transformFeedbackVaryings(program,["wind","ripple"],gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const uniform=n=>gl.getUniformLocation(program,n);
  for(const [name,{value}] of Object.entries({ ...airUniforms,origin:river.material.uniforms.origin,time:{value:riverTime} })) {
    const at=uniform(name);
    if(at===null) continue;
    if(typeof value==="number") gl.uniform1f(at,value);
    else if(value.isVector2) gl.uniform2f(at,value.x,value.y);
    else if(value.isVector4) gl.uniform4f(at,value.x,value.y,value.z,value.w);
  }
  for(const [unit,name] of ["windMap","windWakes"].entries()) {
    const {data,width,height}=airUniforms[name].value.image;
    const texture=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+unit);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    gl.uniform1i(uniform(name),unit);
  }
  const input=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,input);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(samples.flat()),gl.STATIC_DRAW);
  const point=gl.getAttribLocation(program,"location");
  gl.enableVertexAttribArray(point);
  gl.vertexAttribPointer(point,3,gl.FLOAT,false,0,0);
  const output=gl.createBuffer();
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,samples.length*6*4,gl.STREAM_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
  function feedback(gain) {
    gl.uniform1f(uniform("windWakeMix"),gain);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS,0,samples.length);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    const floats=new Float32Array(samples.length*6);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,floats);
    if(gl.getError()!==gl.NO_ERROR) throw Error("Wind readback failed");
    return floats;
  }
  const wake=feedback(1), free=feedback(0), u=new THREE.Vector2();
  let error=0, rmsWake=0,rmsFree=0,deflection=0;
  for(const [i,[x,z,y]] of samples.entries()) {
    const j=i*6;
    airFromMap(x,z,u,0,y);
    error=Math.max(error,Math.hypot(wake[j]-u.x,wake[j+1]-u.y));
    const a=wake[j],b=wake[j+1],c=free[j],d=free[j+1];
    if(i<slice && Math.hypot(a,b)>.25) {
      deflection=Math.max(deflection,Math.abs(Math.atan2(a*d-b*c,a*c+b*d)*180/Math.PI));
    }
    if(i>=slice) {
      rmsWake+=wake[j+4]**2+wake[j+5]**2;
      rmsFree+=free[j+4]**2+free[j+5]**2;
    }
  }
  const ratio=Math.sqrt(rmsWake/rmsFree);

  function testWind(gain) {
    airUniforms.windWakeMix.value=gain;
    const p=position(...source.position,2.65,.05);
    const where=new THREE.Vector3(p[0],3.7,p[1]);
    const initial=where.clone();
    const leaf={position:where,orientation:new THREE.Quaternion(),velocity:new THREE.Vector3(),
      spin:new THREE.Vector3(.36,.18,-.12),flex:new THREE.Vector3(),flexRate:new THREE.Vector3(),seed:.38};
    let travel=0,elapsed=0;
    while(elapsed<1.46) {
      airFromMap(where.x,where.z,u,0,where.y);
      advanceAirborneLeaf(leaf,u,1/110);
      elapsed+=1/110;
      travel=Math.hypot(where.x-initial.x,where.z-initial.z);
    }
    const slip=airFromMap(region[0],region[1],u,waterWindDelay).multiplyScalar(waterWindDrift);
    return {travel,end:where.toArray(),surfaceSlip:slip.toArray()};
  }
  const gain=airUniforms.windWakeMix.value;
  let sheltered,exposed;
  try {
    sheltered=testWind(1);
    exposed=testWind(0);
  } finally {
    airUniforms.windWakeMix.value=gain;
  }
  const speck=new THREE.Vector3();
  const mapping={west:-77,east:-47,south:-55,north:-37,columns:76,rows:51};
  mapping.layers=[.10,2.55].map(y=>{
    const cells=[];
    for(let row=0;row<mapping.rows;row++) for(let col=0;col<mapping.columns;col++) {
      const x=mapping.west+(mapping.east-mapping.west)*col/(mapping.columns-1);
      const z=mapping.south+(mapping.north-mapping.south)*row/(mapping.rows-1);
      const wake=airWakeAt(x,z,y,speck);
      airFromMap(x,z,u,0,y);
      cells.push([wake.x,u.x,u.y].map(n=>Math.round(n*10000)/10000));
    }
    return {y,cells};
  });
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {canopy,building,trace,gpu:{samples:samples.length,error,deflection,ratio},leaf:{sheltered,exposed},
    region,riverTime,atlas:inspectWakes(),mapping};
}
