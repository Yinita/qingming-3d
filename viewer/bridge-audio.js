const bankFile=new URL("../data/bridge-audio/street-v1.mp3",import.meta.url);
const slotDuration=.5, riverStart=10.5, riverEnd=24.5;
const slots={stone:[0,6],wood:[6,3],earth:[9,6],water:[15,6]};
const preference="qingming-street-sound-v1";
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function initialPreference() {
  try { return localStorage.getItem(preference)!=="off"; }
  catch { return true; }
}

export function createStreetAudio(listener) {
  const Context=window.AudioContext || window.webkitAudioContext;
  let enabled=initialPreference(), sceneActive=false;
  let context, master, buffer, download, decoding, river;
  const voices=new Set(), variants={}, counts={}, lastBySource={};

  function load() {
    download??=fetch(bankFile,{signal:AbortSignal.timeout(15_000)}).then(response=>{
      if(!response.ok) throw new Error(`Sound HTTP ${response.status}`);
      return response.arrayBuffer();
    }).catch(error=>{
      download=null;
      throw error;
    });
    return download;
  }
  if(Context && enabled) load().catch(()=>{});

  function active() { return enabled && sceneActive && !document.hidden; }
  function sync() {
    if(!master) return;
    const now=context.currentTime;
    master.gain.setTargetAtTime(active() ? .70 : 0,now,.025);
    if(active()) return;
    for(const voice of voices) voice.stop(now+.075);
    if(river) river.source.stop(now+.075);
    river=null;
  }
  document.addEventListener("visibilitychange",sync);

  function unlock() {
    if(!Context || !enabled) return;
    if(!context) {
      try { context=new Context(); }
      catch { return; }
      master=context.createGain();
      master.gain.value=0;
      const limiter=context.createDynamicsCompressor();
      limiter.threshold.value=-13;
      limiter.ratio.value=2.6;
      master.connect(limiter).connect(context.destination);
      sync();
    }
    if(context.state!=="running") context.resume().catch(()=>{});
    if(buffer || decoding) return;
    decoding=load().then(bytes=>context.decodeAudioData(bytes.slice(0))).then(decoded=>{
      if(decoded.duration<riverEnd-.015) throw new Error("Incomplete street audio");
      buffer=decoded;
    }).catch(()=>{ download=null; }).finally(()=>{ decoding=null; });
  }

  function space(x,z,close) {
    const {x:lx,z:lz,yaw}=listener();
    const dx=x-lx,dz=z-lz,distance=Math.hypot(dx,dz);
    const right=dx*Math.cos(yaw)-dz*Math.sin(yaw);
    return {distance,pan:clamp(right/(close ? .67 : Math.max(1.8,distance)),-.86,.86)};
  }
  function spatialPan(gain,pan) {
    if(!context.createStereoPanner) {
      gain.connect(master);
      return null;
    }
    const stereo=context.createStereoPanner();
    stereo.pan.value=pan;
    gain.connect(stereo).connect(master);
    return stereo;
  }

  function play(surface,x,z,volume,emitter,speed=0,laden=false) {
    if(!active() || !buffer || context.state!=="running" || voices.size>=14) return;
    const close=emitter==="player";
    const {distance,pan}=space(x,z,close);
    if(!close && distance>10) return;
    const [first,length]=slots[surface];
    let variant=(Math.random()*length)|0;
    if(variant===variants[surface]) variant=(variant+1)%length;
    variants[surface]=variant;
    const rate=(laden ? .92 : 1.0)+.048*(Math.random()*2-1)+.022*Math.min(2,speed);
    const level=volume*(close ? 1 : 1/(1+(distance/2.15)**2));
    const source=context.createBufferSource(), gain=context.createGain();
    source.buffer=buffer;
    source.playbackRate.value=rate;
    gain.gain.value=level;
    source.connect(gain);
    const stereo=spatialPan(gain,pan);
    voices.add(source);
    source.onended=()=>{
      voices.delete(source);
      source.disconnect();
      gain.disconnect();
      stereo?.disconnect();
    };
    source.start(0,(first+variant)*slotDuration,slotDuration-.002);
    counts[surface]=(counts[surface]??0)+1;
    lastBySource[emitter]={surface,variant,rate,level,laden,pan};
  }

  function ambience(x,z,level,indoors) {
    if(!active() || !buffer || context.state!=="running") return;
    const now=context.currentTime;
    if(!river) {
      const source=context.createBufferSource(), gain=context.createGain(), filter=context.createBiquadFilter();
      source.buffer=buffer;
      source.loop=true;
      source.loopStart=riverStart;
      source.loopEnd=Math.min(riverEnd,buffer.duration);
      gain.gain.value=0;
      filter.type="lowpass";
      filter.frequency.value=4100;
      source.connect(filter).connect(gain);
      const stereo=spatialPan(gain,0);
      source.onended=()=>{
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        stereo?.disconnect();
      };
      river={source,gain,filter,stereo,next:0,level:0};
      source.start(0,riverStart);
    }
    if(river.next>now) return;
    river.next=now+.10;
    river.level=level;
    river.gain.gain.setTargetAtTime(level,now,.16);
    river.filter.frequency.setTargetAtTime(indoors ? 1050 : 4100,now,.14);
    river.stereo?.pan.setTargetAtTime(space(x,z,false).pan*.43,now,.16);
  }

  return {
    supported:!!Context,
    get enabled() { return enabled; },
    unlock, play, ambience,
    setActive(value) {
      if(sceneActive===value) return;
      sceneActive=value;
      sync();
    },
    toggle() {
      enabled=!enabled;
      try { localStorage.setItem(preference,enabled ? "on" : "off"); }
      catch { /* The current page still remembers the setting. */ }
      if(enabled) unlock();
      sync();
    },
    inspect:()=>({enabled,active:active(),loaded:!!buffer,context:context?.state??"locked",
      voices:voices.size,river:river?.level??0,counts:{...counts},lastBySource:{...lastBySource}}),
  };
}
