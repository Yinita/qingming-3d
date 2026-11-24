async () => {
  const path=new URL("./bridge-breaker-surface.js",location.href).href;
  const {crestRiseAt,breakerDomain}=await import(path);
  const river=__scene.scene.getObjectByName("Canal surface");
  const {material,geometry}=river;
  const source=material.uniforms;
  const layout=geometry.parameters;
  const columns=layout.widthSegments+1, rows=layout.heightSegments+1;
  const positions=geometry.index.array;
  const edges=new Map();
  for(let k=0;k<positions.length;k+=3) {
    for(let side=0;side<3;side++) {
      const a=positions[k+side], b=positions[k+(side+1)%3];
      const key=Math.min(a,b)*columns*rows+Math.max(a,b);
      edges.set(key,(edges.get(key)??0)+1);
    }
  }
  let exteriorEdges=0, invalidEdges=0;
  for(const count of edges.values()) {
    exteriorEdges+=Number(count===1);
    invalidEdges+=Number(count>2);
  }

  const meshNames=__scene.scene.getObjectsByProperty("name","Canal surface").length;
  const separateCrest=!!__scene.scene.getObjectByName("Overturning canal wavefront");
  const separateShore=!!__scene.scene.getObjectByName("Advancing and retreating canal swash");
  const samples=[], cases=[];
  const {leftExtent,length}=breakerDomain;
  const data=source.breakingRows.value.image.data;
  const count=source.breakingRows.value.image.width;
  for(let index=0;index<count;index++) {
    const offset=index*4, center=data[offset], roll=data[offset+1], lift=data[offset+2];
    if(roll<.61 || lift<.055) continue;
    const z=source.breakingBounds.value.x+index/(count-1)/source.breakingBounds.value.y;
    const start=samples.length/3;
    for(let u=0;u<=60;u++) samples.push(center-leftExtent+length*u/60,river.position.y,z);
    cases.push({start,center,roll,lift,z});
  }
  if(!cases.length) throw Error("No active overturned rows available for GPU verification");

  const canvas=document.createElement("canvas");
  const gl=canvas.getContext("webgl2");
  if(!gl) throw Error("WebGL2 transform feedback is required");
  function compile(type,text) {
    const shader=gl.createShader(type);
    gl.shaderSource(shader,text);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const vertex=`#version 300 es
    precision highp float;
    #define texture2D texture
    #define COHERENT_BREAKERS 1
    in vec3 position;
    uniform mat4 modelMatrix;
    uniform mat4 viewMatrix;
    uniform mat4 projectionMatrix;
    ${material.vertexShader.replace(/varying/g,"out")}`;
  const program=gl.createProgram();
  gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;
    out vec4 pixel;
    void main(){pixel=vec4(0.);}`));
  gl.transformFeedbackVaryings(program,["worldPoint","shapeNormal"],gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const loc=name=>gl.getUniformLocation(program,name);
  const matrix=river.matrix.clone().identity().elements;
  for(const name of ["modelMatrix","viewMatrix","projectionMatrix","reflectionUV"]) {
    gl.uniformMatrix4fv(loc(name),false,matrix);
  }
  for(const name of ["time","simulationHeight"]) gl.uniform1f(loc(name),source[name].value);
  for(const name of ["origin","breakingBounds","bankWashBounds"]) {
    const {x,y}=source[name].value;
    gl.uniform2f(loc(name),x,y);
  }
  const bounds=source.simulationBounds.value;
  gl.uniform4f(loc("simulationBounds"),bounds.x,bounds.y,bounds.z,bounds.w);
  for(const [unit,name] of ["waterState","breakingRows","bankWash"].entries()) {
    const {data,width,height}=source[name].value.image;
    const floats=data instanceof Float32Array;
    const texture=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+unit);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    const filter=floats ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,floats ? gl.RGBA32F : gl.RGBA8,width,height,0,gl.RGBA,
      floats ? gl.FLOAT : gl.UNSIGNED_BYTE,data);
    gl.uniform1i(loc(name),unit);
  }
  const input=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,input);
  const position=gl.getAttribLocation(program,"position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);
  const capture=gl.createBuffer();
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,capture);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,samples.length*2*4,gl.STREAM_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,capture);

  function sample(values,weight) {
    gl.uniform1f(loc("breakingBlend"),weight);
    gl.bindBuffer(gl.ARRAY_BUFFER,input);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS,0,values.length/3);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    const buffer=new Float32Array(values.length*2);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
    if(gl.getError()!==gl.NO_ERROR) throw Error("GPU surface readback failed");
    return buffer;
  }
  const active=sample(samples,1), inactive=sample(samples,0);
  const resample=[];
  for(let i=0;i<active.length;i+=6) resample.push(active[i],river.position.y,active[i+2]);
  const under=sample(resample,0);
  let joinGap=0, joinNormal=0, reversalWidth=0, crestRise=0, inverseUnderestimate=0, worst=null;
  for(const {start,center,roll,lift} of cases) {
    for(const endpoint of [start,start+60]) {
      const i=endpoint*6;
      joinGap=Math.max(joinGap,Math.hypot(active[i]-inactive[i],active[i+1]-inactive[i+1],active[i+2]-inactive[i+2]));
      const dot=active[i+3]*inactive[i+3]+active[i+4]*inactive[i+4]+active[i+5]*inactive[i+5];
      joinNormal=Math.max(joinNormal,Math.acos(Math.min(1,Math.max(-1,dot)))*180/Math.PI);
    }
    let swept=0;
    for(let t=0;t<=60;t++) {
      const i=(start+t)*6, x=active[i], rise=active[i+1]-under[i+1];
      if(t>0 && active[i-6]>x) swept+=active[i-6]-x;
      else {reversalWidth=Math.max(reversalWidth,swept);swept=0;}
      crestRise=Math.max(crestRise,rise);
      const predicted=crestRiseAt(x,center,roll,lift);
      if(rise-predicted>inverseUnderestimate) {
        inverseUnderestimate=rise-predicted;
        worst={u:t/60,x,rise,predicted,center,roll,lift};
      }
    }
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {vertices:geometry.attributes.position.count,triangles:positions.length/3,meshNames,separateCrest,
    separateShore,exteriorEdges,expectedExterior:2*(columns+rows-2),invalidEdges,rowsChecked:cases.length,
    joinGap,joinNormal,reversalWidth,crestRise,inverseUnderestimate,worst};
}
