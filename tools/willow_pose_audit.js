async (release=null) => {
  const THREE=await import(new URL("./vendor/three/build/three.module.js",location.href).href);
  const tree=release?.tree ?? __scene.scene.getObjectByName("Volumetric riverside willow");
  const body=tree.getObjectByName("Willow trunk and branches");
  const leaves=tree.getObjectByName("Willow canopy leaf instances");
  const {point}=tree.userData.branchMotion;
  const attribute=leaves.geometry.getAttribute("branchLink");
  const profiles=leaves.geometry.getAttribute("bladeProfile");
  const profileAt=i=>profiles ? [profiles.getX(i),profiles.getY(i),profiles.getZ(i),profiles.getW(i)] : [0,0,0,1];
  const matrix=new THREE.Matrix4(), samples=[];
  for(let i=0;i<leaves.count;i+=Math.max(1,Math.floor(leaves.count/96))) {
    leaves.getMatrixAt(i,matrix);
    if(Math.hypot(matrix.elements[4],matrix.elements[5],matrix.elements[6])<.01) continue;
    const rest=new THREE.Vector3().setFromMatrixPosition(matrix);
    const link=[attribute.getX(i),attribute.getY(i),attribute.getZ(i)];
    samples.push({matrix:matrix.elements.slice(),rest,link,profile:profileAt(i),expected:point(rest,link,new THREE.Vector3())});
  }

  const gl=document.createElement("canvas").getContext("webgl2");
  if(!gl) throw Error("WebGL2 transform feedback is required");
  function compile(type,source) {
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;
    out vec4 pixel;
    void main(){pixel=vec4(0.);}`);
  const textures=new Map();
  function textureFor(source,unit) {
    gl.activeTexture(gl.TEXTURE0+unit);
    if(textures.has(source)) {
      gl.bindTexture(gl.TEXTURE_2D,textures.get(source));
      return;
    }
    const {data,width,height}=source.image, floating=data instanceof Float32Array;
    const texture=gl.createTexture();
    textures.set(source,texture);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    const filter=floating ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,floating ? gl.RGBA32F : gl.RGBA8,width,height,0,gl.RGBA,
      floating ? gl.FLOAT : gl.UNSIGNED_BYTE,data);
  }

  function feedback(material,blade,inputs=samples) {
    const base=material.isMeshDepthMaterial ? THREE.ShaderLib.depth : THREE.ShaderLib.standard;
    const patched={vertexShader:base.vertexShader,fragmentShader:base.fragmentShader,uniforms:{}};
    material.onBeforeCompile(patched,__scene.renderer);
    function after(name) {
      return (patched.vertexShader.split(`#include <${name}>`)[1]??"")
        .split("#include")[0].trim();
    }
    const common=after("common").replace(/varying/g,"out").replace(/attribute/g,"in");
    const normal=material.isMeshDepthMaterial ? "" : after("beginnormal_vertex");
    const main=after("begin_vertex");
    const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;
      #define texture2D texture
      in vec3 position;
      in vec3 modelNormal;
      in mat4 instanceMatrix;
      const vec2 uv=vec2(.5,0.);
      ${common}
      out vec3 stemResult;
      out vec3 normalResult;
      void main(){
        vec3 transformed=position;
        vec3 objectNormal=modelNormal;
        ${normal}
        ${main}
        stemResult=${blade ? "(instanceMatrix*vec4(transformed,1.)).xyz" : "transformed"};
        mat3 axes=mat3(instanceMatrix);
        normalResult=${blade ? "normalize(axes*(objectNormal/vec3(dot(axes[0],axes[0]),dot(axes[1],axes[1]),dot(axes[2],axes[2]))))" : "objectNormal"};
        gl_Position=vec4(0.,0.,0.,1.);
      }`);
    const program=gl.createProgram();
    gl.attachShader(program,vertex);
    gl.attachShader(program,fragment);
    gl.transformFeedbackVaryings(program,["stemResult","normalResult"],gl.SEPARATE_ATTRIBS);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    let unit=0;
    for(const [name,{value}] of Object.entries(patched.uniforms)) {
      const location=gl.getUniformLocation(program,name);
      if(location===null) continue;
      if(value?.isTexture) {
        textureFor(value,unit);
        gl.uniform1i(location,unit++);
      } else if(typeof value==="number") gl.uniform1f(location,value);
      else if(value.isVector2) gl.uniform2f(location,value.x,value.y);
      else if(value.isVector3 || name==="willowBase") gl.uniform3f(location,value.x,value.y,value.z);
      else if(value.isVector4) gl.uniform4f(location,value.x,value.y,value.z,value.w);
    }

    const stride=36;
    const vertices=new Float32Array(inputs.length*stride);
    inputs.forEach(({matrix,rest,link,position,normal,flex,profile,blend},i)=>{
      (position ?? (!blade && rest ? rest : null))?.toArray(vertices,i*stride);
      vertices.set(link,i*stride+3);
      vertices.set(matrix,i*stride+6);
      vertices.set(normal ?? [0,0,1],i*stride+22);
      vertices.set(flex ?? [0,0,0],i*stride+25);
      vertices.set(profile ?? [0,0,0,1],i*stride+28);
      vertices.set(blend ?? [0,0,0,0],i*stride+32);
    });
    const array=gl.createVertexArray();
    gl.bindVertexArray(array);
    const input=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,input);
    gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    function attribute(name,length,offset,columns=1) {
      const base=gl.getAttribLocation(program,name);
      if(base<0) return;
      for(let n=0;n<columns;n++) {
        gl.enableVertexAttribArray(base+n);
        gl.vertexAttribPointer(base+n,length,gl.FLOAT,false,stride*4,(offset+n*length)*4);
      }
    }
    attribute("position",3,0);
    attribute("branchLink",3,3);
    attribute("instanceMatrix",4,6,4);
    attribute("modelNormal",3,22);
    attribute("bladeFlex",3,25);
    attribute("bladeProfile",4,28);
    attribute("branchBlend",4,32);
    const result=[0,1].map(index=>{
      const output=gl.createBuffer(), data=new Float32Array(inputs.length*3);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,data.byteLength,gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,index,output);
      return {output,data};
    });
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS,0,inputs.length);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    for(const [index,{output,data}] of result.entries()) {
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,index,null);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);
    }
    if(gl.getError()!==gl.NO_ERROR) throw Error("GPU stem readback failed");
    return {positions:result[0].data,normals:result[1].data};
  }

  if(release) {
    const {event,originalMatrix,link}=release;
    const airborne=__scene.scene.getObjectByName("Floating and falling willow leaves");
    airborne.getMatrixAt(event.index,matrix);
    const a=airborne.geometry.getAttribute("bladeFlex");
    const flex=a ? [a.getX(event.index),a.getY(event.index),a.getZ(event.index)] : undefined;
    const input=(mesh,basis,link,flex,profile)=>{
      const {position,normal}=mesh.geometry.attributes;
      return Array.from({length:position.count},(_,i)=>({matrix:basis.elements,link,flex,profile,
        position:new THREE.Vector3().fromBufferAttribute(position,i),
        normal:new THREE.Vector3().fromBufferAttribute(normal,i).toArray()}));
    };
    const attachedInput=input(leaves,originalMatrix,link,null,profileAt(event.canopyIndex));
    const detachedInput=input(airborne,matrix,[0,0,0],flex);
    const attached=feedback(leaves.material,true,attachedInput);
    const detached=feedback(airborne.material,true,detachedInput);
    const detachedShadow=airborne.customDepthMaterial && feedback(airborne.customDepthMaterial,true,detachedInput);
    const from=new THREE.Vector3(), to=new THREE.Vector3(), shadow=new THREE.Vector3();
    let maximum=0, squared=0, angle=0, shadowGap=0;
    for(let i=0;i<attachedInput.length*3;i+=3) {
      from.fromArray(attached.positions,i).applyMatrix4(tree.matrixWorld);
      to.fromArray(detached.positions,i).applyMatrix4(airborne.matrixWorld);
      const distance=from.distanceTo(to);
      maximum=Math.max(maximum,distance);
      squared+=distance*distance;
      const dot=from.fromArray(attached.normals,i).normalize().dot(to.fromArray(detached.normals,i).normalize());
      angle=Math.max(angle,Math.acos(THREE.MathUtils.clamp(dot,-1,1)));
      if(detachedShadow) shadowGap=Math.max(shadowGap,shadow.fromArray(detachedShadow.positions,i)
        .distanceTo(to.fromArray(detached.positions,i)));
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return {vertices:attachedInput.length,maximum,rms:Math.sqrt(squared/attachedInput.length),
      degrees:THREE.MathUtils.radToDeg(angle),shadowGap:detachedShadow ? shadowGap : null,flex};
  }

  const visible=feedback(leaves.material,true).positions, shadow=feedback(leaves.customDepthMaterial,true).positions;
  const wood=feedback(body.material,false).positions, woodShadow=feedback(body.customDepthMaterial,false).positions;
  let cpuGap=0,shadowGap=0,woodGap=0,branchShadowGap=0,motion=0;
  const leaf=new THREE.Vector3(), sample=new THREE.Vector3();
  const scale=tree.scale.x;
  for(const [i,{expected,rest}] of samples.entries()) {
    leaf.fromArray(visible,i*3);
    cpuGap=Math.max(cpuGap,leaf.distanceTo(expected)*scale);
    motion=Math.max(motion,leaf.distanceTo(rest)*scale);
    shadowGap=Math.max(shadowGap,leaf.distanceTo(sample.fromArray(shadow,i*3))*scale);
    woodGap=Math.max(woodGap,leaf.distanceTo(sample.fromArray(wood,i*3))*scale);
    branchShadowGap=Math.max(branchShadowGap,sample.distanceTo(leaf.fromArray(woodShadow,i*3))*scale);
  }
  let collar=null;
  const blend=body.geometry.attributes.branchBlend;
  if(blend) {
    const binding=body.geometry.attributes.branchLink;
    const vertices=body.geometry.attributes.position;
    const junctions=[], turnA=new THREE.Quaternion(), turnB=new THREE.Quaternion();
    const normalA=new THREE.Vector3(), normalB=new THREE.Vector3();
    const second=new THREE.Vector3();
    for(let i=0;i<blend.count;i+=7) {
      const weight=blend.getW(i);
      if(weight<.09) continue;
      const rest=new THREE.Vector3().fromBufferAttribute(vertices,i);
      const link=[binding.getX(i),binding.getY(i),binding.getZ(i)];
      const other=[blend.getX(i),blend.getY(i),blend.getZ(i)];
      const expected=point(rest,link,new THREE.Vector3(),turnA);
      expected.lerp(point(rest,other,second,turnB),weight);
      const normal=new THREE.Vector3().fromBufferAttribute(body.geometry.attributes.normal,i);
      normalA.copy(normal).applyQuaternion(turnA);
      normalB.copy(normal).applyQuaternion(turnB);
      const expectedNormal=normalA.lerp(normalB,weight).normalize().clone();
      junctions.push({matrix:matrix.identity().elements.slice(),rest,link,blend:[...other,weight],
        expected,normal:normal.toArray(),expectedNormal});
    }
    const shaded=feedback(body.material,false,junctions);
    const depth=feedback(body.customDepthMaterial,false,junctions);
    let posedError=0,normalError=0,depthError=0;
    for(const [i,{expected,expectedNormal}] of junctions.entries()) {
      leaf.fromArray(shaded.positions,3*i);
      posedError=Math.max(posedError,leaf.distanceTo(expected)*scale);
      depthError=Math.max(depthError,leaf.distanceTo(sample.fromArray(depth.positions,3*i))*scale);
      leaf.fromArray(shaded.normals,3*i).normalize();
      normalError=Math.max(normalError,Math.acos(THREE.MathUtils.clamp(leaf.dot(expectedNormal),-1,1)));
    }
    collar={samples:junctions.length,posedError,depthError,normalDegrees:THREE.MathUtils.radToDeg(normalError)};
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return {samples:samples.length,cpuGap,shadowGap,woodGap,branchShadowGap,motion,collar};
}
