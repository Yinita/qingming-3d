import * as THREE from "three";

const {clamp,lerp,smoothstep}=THREE.MathUtils;
const columns=9, rows=14, patchSize=columns*rows, capacity=192;
const dustCapacity=128;
const patchWidth=.190, patchLength=.319, front=-.211;
const lifetimes={dust:11,mud:32,transfer:16};

function attribute(geometry,name,count,size) {
  const buffer=new THREE.BufferAttribute(new Float32Array(count*size),size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name,buffer);
  return buffer;
}

function tracksMaterial(clock) {
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,transparent:true,
    depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  material.customProgramCacheKey=()=>"conforming-boot-imprints";
  material.onBeforeCompile=shader=>{
    shader.uniforms.trackClock=clock;
    shader.vertexShader=shader.vertexShader
      .replace("#include <common>",`#include <common>
        varying vec2 trackUV;
        varying vec4 trackData;
        varying vec2 trackEdge;
        attribute vec4 stamp;
        attribute vec2 extent;
      `)
      .replace("#include <begin_vertex>",`#include <begin_vertex>
        trackUV=uv; trackData=stamp; trackEdge=extent;
      `);
    shader.fragmentShader=shader.fragmentShader
      .replace("#include <common>",`#include <common>
        uniform float trackClock;
        varying vec2 trackUV;
        varying vec4 trackData;
        varying vec2 trackEdge;
        float trackHash(vec2 p) {
          vec3 q=fract(vec3(p.xyx)*.1031);
          q+=dot(q,q.yzx+33.33);
          return fract((q.x+q.y)*q.z);
        }
        float soleProfile(vec2 uv,float side) {
          float x=(uv.x-.5)*2.0-side*.159*(1.-smoothstep(.13,.53,uv.y));
          float toe=length(vec2(x/.835,(uv.y-.296)/.219));
          float waist=length(vec2((x+side*.059)/.633,(uv.y-.50)/.231));
          float heel=length(vec2((x+side*.043)/.664,(uv.y-.684)/.171));
          float low=min(min(toe,waist),heel);
          float high=min(max(toe,waist),max(min(toe,waist),heel));
          float blend=max(.16-abs(low-high),0.)/.16;
          return low-blend*blend*.043;
        }
      `)
      .replace("#include <color_fragment>",`#include <color_fragment>
        float kind=trackData.y;
        float age=(trackClock-trackData.x)/max(1.,trackData.z);
        float remaining=(1.-smoothstep(.17,1.,age));
        float center=soleProfile(trackUV,trackEdge.x);
        vec2 grain=floor((trackUV+trackData.x*.003)*vec2(61.,106.));
        float pepper=trackHash(grain);
        float edge=center+.036*(pepper-.5);
        float fill=1.-smoothstep(.91,1.032,edge);
        float wall=smoothstep(.88,1.002,edge)*(1.-smoothstep(1.016,1.103,edge));
        float sewing=(1.-smoothstep(.02,.16,abs(fract(trackUV.y*29.+trackUV.x*1.7)-.5)))*
          smoothstep(.70,.85,center)*(1.-smoothstep(.90,.99,center));
        float fabric=sin(trackUV.x*119.+trackUV.y*24.)*sin(trackUV.y*176.);
        float grainVisibility=1.-smoothstep(.022,.080,max(length(dFdx(trackUV)),length(dFdy(trackUV))));
        float damp=kind>1.5 ? 1. : 0.;
        float transfer=step(2.5,kind);
        vec3 dry=vec3(.29,.211,.127)*(.85+.21*pepper);
        vec3 clay=vec3(.083,.054,.030)*(.90+.25*pepper);
        vec3 ink=vec3(.057,.043,.028)*(.87+.26*pepper);
        vec3 soil=mix(mix(dry,clay,damp),ink,transfer);
        float slope=(trackUV.x*.62-trackUV.y*.38-.1);
        vec3 rim=soil*(1.10+1.00*smoothstep(-.18,.27,slope));
        vec3 pigment=mix(soil,rim,wall*(1.-transfer*.86));
        pigment*=1.+grainVisibility*(.063*fabric-.06*sewing);
        float continuity=trackEdge.y*remaining*trackData.w;
        float floorBite=fill*(.78+.14*pepper+.10*sewing);
        float impression=clamp(floorBite+wall*(1.-transfer*.86)*.49,0.,1.);
        diffuseColor.rgb=pigment;
        diffuseColor.a*=continuity*impression;
        if(diffuseColor.a<.007) discard;
      `)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
        roughnessFactor=mix(.97,.56,damp*trackData.w) + .033*sewing;
      `)
      .replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
        vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition);
        float relief=(wall*.0015-fill*.0028)*(1.-transfer)*damp*continuity;
        vec3 dx=cross(sigmaY,normal), dy=cross(normal,sigmaX);
        float volume=dot(sigmaX,dx);
        vec3 gradient=sign(volume)*(dFdx(relief)*dx+dFdy(relief)*dy);
        normal=normalize(max(abs(volume),.0000001)*normal-gradient);
      `);
  };
  return material;
}

function dustLayer(parent,clock) {
  const geometry=new THREE.BufferGeometry();
  const position=attribute(geometry,"position",dustCapacity,3);
  const velocity=attribute(geometry,"kick",dustCapacity,3);
  const birth=attribute(geometry,"born",dustCapacity,3);
  const scale={value:0};
  const material=new THREE.ShaderMaterial({
    uniforms:{clock,scale},transparent:true,depthWrite:false,
    vertexShader:`
      uniform float clock,scale;
      attribute vec3 kick,born;
      varying float opacity,seed;
      void main() {
        float age=clock-born.x;
        float t=clamp(age/born.y,0.,1.);
        vec3 p=position+kick*age*(1.-.48*t);
        vec4 mv=modelViewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp((.018+.064*t)*scale/max(.2,-mv.z),1.,42.);
        opacity=(1.-t)*(1.-t)*smoothstep(0.,.065,age)*born.z;
        seed=dot(kick,vec3(126.,36.,49.));
      }
    `,
    fragmentShader:`
      varying float opacity,seed;
      void main() {
        vec2 p=gl_PointCoord-.5;
        float a=(1.-smoothstep(.02,.48,length(p+sin(seed+p*10.)*.038)))*opacity;
        if(a<.006) discard;
        gl_FragColor=vec4(vec3(.385,.280,.159),a);
        #include <colorspace_fragment>
      }
    `,
  });
  geometry.setDrawRange(0,0);
  const points=new THREE.Points(geometry,material);
  points.name="Dust disturbed by boots";
  points.frustumCulled=false;
  points.layers.enable(1);
  parent.add(points);
  points.onBeforeRender=(renderer,scene,camera)=>{
    scale.value=renderer.domElement.height*.5*camera.projectionMatrix.elements[5];
  };
  let cursor=0,count=0,latest=-Infinity,total=0;
  return {
    kick(x,y,z,vx,vz,speed,time) {
      for(let i=0;i<6;i++) {
        const phase=Math.sin(time*51.4+i*91.4);
        const size=.34+.20*(.5+.5*phase)+Math.min(speed,.4)*.18;
        const angle=i*2.39996+phase*.57;
        position.setXYZ(cursor,x+.032*Math.cos(angle),y+.014,z+.032*Math.sin(angle));
        velocity.setXYZ(cursor,Math.cos(angle)*.26-vx*.08+.074,
          .142+.16*(.5+.5*phase),Math.sin(angle)*.26-vz*.08+.031);
        birth.setXYZ(cursor,time,size,.17+.11*smoothstep(speed,1.25,3.5));
        for(const buffer of [position,velocity,birth]) buffer.addUpdateRange(cursor*3,3);
        latest=Math.max(latest,time+size);
        cursor=(cursor+1)%dustCapacity;
        count=Math.min(dustCapacity,count+1);
        total++;
      }
      position.needsUpdate=velocity.needsUpdate=birth.needsUpdate=true;
      geometry.setDrawRange(0,count);
    },
    update(time) { points.visible=time<latest; },
    reset() { cursor=count=total=0;latest=-Infinity;points.visible=false;geometry.setDrawRange(0,0); },
    inspect:()=>({particles:total,visible:points.visible}),
  };
}

function contactShadows(parent,heightAt) {
  const actors=["player","courier","porter","shopper","gardenKeeper","timberPorter"];
  const grid=5, samples=grid*grid, feetPerActor=2;
  const geometry=new THREE.BufferGeometry();
  const position=attribute(geometry,"position",actors.length*feetPerActor*samples,3);
  const opacity=attribute(geometry,"contactOpacity",actors.length*feetPerActor*samples,1);
  const uv=[],indices=[];
  for(let foot=0;foot<actors.length*feetPerActor;foot++) {
    for(let j=0;j<grid;j++) for(let i=0;i<grid;i++) {
      const a=foot*samples+j*grid+i,b=a+grid;
      uv.push(i/(grid-1),j/(grid-1));
      if(i<grid-1 && j<grid-1) indices.push(a,b,a+1,b,b+1,a+1);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-1,
    vertexShader:`
      attribute float contactOpacity;
      varying float opacity;
      varying vec2 contactUV;
      void main() {
        contactUV=uv;
        opacity=contactOpacity;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader:`
      varying float opacity;
      varying vec2 contactUV;
      void main() {
        vec2 p=(contactUV-.5)*2.;
        float r=dot(p,p);
        float fall=exp(-3.5*r)*(1.-smoothstep(.58,1.,r));
        gl_FragColor=vec4(vec3(.031,.024,.016),fall*opacity);
        #include <colorspace_fragment>
      }`,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name="Individual sole contact shadows";
  mesh.layers.enable(1);
  mesh.frustumCulled=false;
  parent.add(mesh);
  const levels=Array(actors.length*feetPerActor).fill(0);
  const placed=new Float64Array(levels.length*3);
  return {
    place(actor,feet,visible) {
      const index=actors.indexOf(actor);
      if(index<0) return;
      for(let i=0;i<feetPerActor;i++) {
        const foot=feet[i];
        const ground=visible ? heightAt(foot.x,foot.z) : foot.y;
        const lift=Math.max(0,foot.y-ground);
        const light=visible ? .33*Math.exp(-lift*17) : 0;
        const slot=index*feetPerActor+i,start=slot*samples,at=slot*3;
        if(!light && !levels[slot]) continue;
        if(light===levels[slot] && foot.x===placed[at] && foot.z===placed[at+1] && foot.yaw===placed[at+2]) continue;
        placed[at]=foot.x;placed[at+1]=foot.z;placed[at+2]=foot.yaw;
        const s=Math.sin(foot.yaw),c=Math.cos(foot.yaw);
        for(let j=0;j<grid;j++) for(let k=0;k<grid;k++) {
          const at=start+j*grid+k;
          const u=(k/(grid-1)-.5)*(.249+lift*.14);
          const v=(j/(grid-1)-.65)*(.363+lift*.20);
          const x=foot.x+c*u+s*v,z=foot.z-s*u+c*v;
          const y=heightAt(x,z);
          position.setXYZ(at,x,y+.0061,z);
          opacity.setX(at,Math.abs(y-ground)<.13 ? light : 0);
        }
        levels[slot]=light;
        position.addUpdateRange(start*3,samples*3);
        opacity.addUpdateRange(start,samples);
        position.needsUpdate=opacity.needsUpdate=true;
      }
    },
    reset() {
      levels.fill(0);
      opacity.array.fill(0);
      opacity.clearUpdateRanges();
      opacity.needsUpdate=true;
    },
  };
}

export function createGroundTracks(parent,{heightAt,mediumAt,moistureAt}) {
  const clock={value:0};
  const layer=new THREE.Group();
  layer.name="Ground contact marks";
  parent.add(layer);
  const geometry=new THREE.BufferGeometry();
  const position=attribute(geometry,"position",capacity*patchSize,3);
  const normal=attribute(geometry,"normal",capacity*patchSize,3);
  const stamp=attribute(geometry,"stamp",capacity*patchSize,4);
  const extent=attribute(geometry,"extent",capacity*patchSize,2);
  const uv=[],triangles=[];
  for(let mark=0;mark<capacity;mark++) for(let j=0;j<rows;j++) for(let i=0;i<columns;i++) {
    uv.push(i/(columns-1),j/(rows-1));
    if(i<columns-1 && j<rows-1) {
      const a=mark*patchSize+j*columns+i,b=a+columns;
      triangles.push(a,b,a+1,b,b+1,a+1);
    }
  }
  geometry.setIndex(triangles);
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setDrawRange(0,0);
  const imprints=new THREE.Mesh(geometry,tracksMaterial(clock));
  imprints.name="Clay impressions and wet sole transfers";
  imprints.frustumCulled=false;
  imprints.layers.enable(1);
  imprints.receiveShadow=true;
  layer.add(imprints);
  const dust=dustLayer(layer,clock);
  const support=contactShadows(layer,heightAt);
  const marks=new Array(capacity).fill(null),boots=new Map();
  const totals={dust:0,mud:0,transfer:0,water:0,clean:0};
  const patch=new Float32Array(patchSize);
  const vector=new THREE.Vector3();
  const triangleCount=(columns-1)*(rows-1)*6;
  let cursor=0,count=0,last=null,nextFloodCheck=0;

  function writeFootprint(foot,wetness,medium,kind,strength,actor) {
    const time=clock.value,duration=lifetimes[kind]*(kind==="mud" ? lerp(1,.58,wetness) : 1);
    const kindId=kind==="dust" ? 1 : kind==="mud" ? 2 : 3;
    const c=Math.cos(foot.yaw),s=Math.sin(foot.yaw);
    const start=cursor*patchSize;
    for(let j=0;j<rows;j++) for(let i=0;i<columns;i++) {
      const localX=(i/(columns-1)-.5)*patchWidth,localZ=front+j/(rows-1)*patchLength;
      const x=foot.x+c*localX+s*localZ,z=foot.z-s*localX+c*localZ;
      const y=heightAt(x,z),index=j*columns+i,at=start+index;
      const surface=mediumAt(x,y,z);
      patch[index]=y;
      const inContact=surface===medium && Math.abs(y-foot.y)<.105;
      // Only project onto the same supporting material. The patch follows individual setts.
      position.setXYZ(at,x,y+(medium==="wood" ? .0048 : .0041),z);
      extent.setXY(at,foot.side,Number(inContact));
      stamp.setXYZW(at,time,kindId,duration,strength);
    }
    for(let j=0;j<rows;j++) for(let i=0;i<columns;i++) {
      const left=Math.max(0,i-1),right=Math.min(columns-1,i+1);
      const front=Math.max(0,j-1),back=Math.min(rows-1,j+1);
      const x=(patch[j*columns+left]-patch[j*columns+right])/((right-left)*patchWidth/(columns-1));
      const z=(patch[front*columns+i]-patch[back*columns+i])/((back-front)*patchLength/(rows-1));
      vector.set(c*x+s*z,1,-s*x+c*z).normalize();
      normal.setXYZ(start+j*columns+i,vector.x,vector.y,vector.z);
    }
    last={kind,medium,actor,side:foot.side,x:foot.x,y:foot.y,z:foot.z,yaw:foot.yaw,
      born:time,duration,strength,wetness};
    marks[cursor]=last;
    cursor=(cursor+1)%capacity;
    count=Math.min(capacity,count+1);
    totals[kind]++;
    for(const buffer of [position,normal,stamp,extent]) {
      buffer.addUpdateRange(start*buffer.itemSize,patchSize*buffer.itemSize);
      buffer.needsUpdate=true;
    }
    geometry.setDrawRange(0,count*triangleCount);
    imprints.visible=true;
  }

  function contact(actor,foot,time,vx,vz) {
    const speed=Math.hypot(vx,vz);
    if(speed<.24) return;
    clock.value=time;
    const {x,y,z}=foot,medium=mediumAt(x,y,z),water=moistureAt(x,y,z,medium);
    const key=actor+":"+foot.side;
    const previous=boots.get(key)??{wet:0,mud:0,time};
    const interval=time-previous.time;
    let wet=previous.wet*Math.exp(-.083*interval),mud=previous.mud*Math.exp(-.067*interval);
    if(medium==="water" || water.pool) {
      wet=1;mud*=.73;
      totals.water++;
    } else if(medium==="earth") {
      const soft=water.wet>.26;
      const speedForce=smoothstep(speed,.24,2.88);
      if(soft) {
        mud=Math.max(mud,lerp(.48,.92,smoothstep(water.wet,.24,.87)));
        wet=Math.max(wet,.62*water.wet);
        writeFootprint(foot,water.wet,medium,"mud",.72+.17*speedForce,actor);
      } else {
        const carried=.69*mud+.34*wet;
        if(carried>.24) writeFootprint(foot,water.wet,medium,"transfer",carried*.73,actor);
        else {
          writeFootprint(foot,water.wet,medium,"dust",.27+.20*speedForce,actor);
          if(speed>1.12 && water.wet<.17) dust.kick(x,y,z,vx,vz,speed,time);
        }
        mud*=.78;wet*=.89;
      }
    } else {
      const carried=.79*mud+.61*wet;
      const contrast=(1-.49*water.wet)*carried;
      if(contrast>.076) {
        writeFootprint(foot,water.wet,medium,"transfer",Math.min(.78,contrast*1.18),actor);
      } else totals.clean++;
      wet=Math.max(wet*.70,water.wet*.50);
      mud*=.73;
    }
    boots.set(key,{wet,mud,time});
  }

  function update(time) {
    clock.value=time;
    let live=false,changed=false;
    const checkFlood=time>=nextFloodCheck;
    if(checkFlood) nextFloodCheck=time+.22;
    for(let i=0;i<count;i++) {
      const mark=marks[i];
      if(!mark || time-mark.born>=mark.duration) continue;
      if(checkFlood && moistureAt(mark.x,mark.y,mark.z,mark.medium).pool) {
        marks[i]=null;
        const start=i*patchSize;
        for(let j=0;j<patchSize;j++) stamp.setW(start+j,0);
        stamp.addUpdateRange(start*4,patchSize*4);
        changed=true;
      } else live=true;
    }
    if(changed) stamp.needsUpdate=true;
    imprints.visible=live;
    dust.update(time);
  }

  return {
    contact,update,feet:support.place,
    visible(on) { layer.visible=on; },
    reset() {
      cursor=count=0;last=null;nextFloodCheck=0;
      marks.fill(null);
      boots.clear();
      Object.keys(totals).forEach(key=>{totals[key]=0;});
      imprints.visible=false;geometry.setDrawRange(0,0);
      dust.reset();
      support.reset();
    },
    inspect() {
      const visible=marks.filter(mark=>mark && clock.value-mark.born<mark.duration);
      const byActor={};
      for(const mark of visible) byActor[mark.actor]=(byActor[mark.actor]??0)+1;
      return {time:clock.value,active:visible.length,byActor,capacity,totals:{...totals},last,
        recent:visible.slice().sort((a,b)=>b.born-a.born).slice(0,20),
        boots:Object.fromEntries(boots),dust:dust.inspect(),visible:layer.visible};
    },
  };
}
