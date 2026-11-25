const bankFile=new URL("../data/bridge-audio/street-v1.mp3",import.meta.url);
const rainFile=new URL("../data/bridge-audio/rain-v1.mp3",import.meta.url);
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
  let rainBuffer,rainLoad,rainRetry=0,rainTrack;
  const voices=new Set(), variants={}, counts={}, lastBySource={}, scrapeCues={};

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
    if(rainTrack) rainTrack.source.stop(now+.075);
    rainTrack=null;
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

  function scrape(kind,x,z,speed) {
    if(!active() || context?.state!=="running" || voices.size>=14) return;
    const {distance,pan}=space(x,z,false);
    if(distance>7) return;
    const strike=kind==="impact", planing=kind==="plane";
    if(!scrapeCues[kind]) {
      const sampleRate=context.sampleRate;
      const cue=context.createBuffer(1,Math.round(sampleRate*(strike ? .18 : planing ? .56 : .24)),sampleRate);
      const data=cue.getChannelData(0);
      let low=0,grit=0;
      for(let i=0;i<data.length;i++) {
        const t=i/sampleRate;
        const white=Math.random()*2-1;
        low+=(white-low)*.043;
        grit+=(white-grit)*.31;
        if(strike) {
          const body=Math.sin(2*Math.PI*91*t)+.37*Math.sin(2*Math.PI*137*t);
          data[i]=(.40*body+.28*(grit-low))*Math.exp(-36*t)*Math.min(1,t*510);
        } else {
          const envelope=Math.sin(Math.PI*i/(data.length-1))**.85;
          const texture=planing ? (white-grit)*.58+grit*.39 : grit-low*.66;
          const edge=planing ? .83+.17*Math.sin(371*t+1.13*Math.sin(92*t)) : 1;
          data[i]=(texture+.16*Math.sin(2*Math.PI*(62*t+12*t*t)))*envelope*edge*.69;
        }
      }
      scrapeCues[kind]=cue;
    }
    const source=context.createBufferSource(),gain=context.createGain();
    const level=(strike ? .39 : .21)*clamp(speed+.20,.20,1)/(1+(distance/2.4)**2);
    source.buffer=scrapeCues[kind];
    source.playbackRate.value=.94+.10*Math.random();
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
    source.start();
    counts[kind]=(counts[kind]??0)+1;
    lastBySource[planing ? "joiner" : "workyard"]={surface:kind,level,pan};
  }

  function loop(sound,start,end) {
    const source=context.createBufferSource(), gain=context.createGain(), filter=context.createBiquadFilter();
    source.buffer=sound;
    source.loop=true;
    source.loopStart=start;
    source.loopEnd=Math.min(end,sound.duration);
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
    source.start(0,start);
    return {source,gain,filter,stereo,next:0,level:0};
  }

  function ambience(x,z,level,indoors) {
    if(!active() || !buffer || context.state!=="running") return;
    const now=context.currentTime;
    river??=loop(buffer,riverStart,riverEnd);
    if(river.next>now) return;
    river.next=now+.10;
    river.level=level;
    river.gain.gain.setTargetAtTime(level,now,.16);
    river.filter.frequency.setTargetAtTime(indoors ? 1050 : 4100,now,.14);
    river.stereo?.pan.setTargetAtTime(space(x,z,false).pan*.43,now,.16);
  }

  function weather(level,covered) {
    if(!active() || context?.state!=="running") return;
    const now=context.currentTime;
    if(level<.018) {
      if(rainTrack) {
        rainTrack.gain.gain.setTargetAtTime(0,now,.075);
        rainTrack.source.stop(now+.35);
        rainTrack=null;
      }
      return;
    }
    if(!rainBuffer) {
      if(!rainLoad && now>=rainRetry) {
        rainLoad=fetch(rainFile,{signal:AbortSignal.timeout(12_000)}).then(response=>{
          if(!response.ok) throw new Error("Rain audio");
          return response.arrayBuffer();
        }).then(bytes=>context.decodeAudioData(bytes)).then(decoded=>{rainBuffer=decoded;})
          .catch(()=>{rainRetry=context.currentTime+4;}).finally(()=>{rainLoad=null;});
      }
      return;
    }
    rainTrack??=loop(rainBuffer,0,rainBuffer.duration);
    if(rainTrack.next>now) return;
    rainTrack.next=now+.10;
    rainTrack.level=level*(covered ? .13 : .36);
    rainTrack.gain.gain.setTargetAtTime(rainTrack.level,now,.18);
    rainTrack.filter.frequency.setTargetAtTime(covered ? 1170 : 6300,now,.14);
  }

  return {
    supported:!!Context,
    get enabled() { return enabled; },
    unlock, play, scrape, ambience, weather,
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
      voices:voices.size,river:river?.level??0,rain:rainTrack?.level??0,counts:{...counts},lastBySource:{...lastBySource}}),
  };
}
