const lines={
  courier:["伙计","茶箱就在桥头。过桥往左是茶铺，也能从南边的渡口过河。",
    "cha xiang jiu zai qiao tou / guo qiao wang zuo shi cha pu , ye neng cong nan bian de du kou guo he"],
  delivery:["掌柜","来得正好。茶叶放这儿吧，五文钱收好。",
    "lai de zheng hao / cha ye fang zher ba , wu wen qian shou hao"],
  pour:["掌柜","坐会儿，给你斟一盏热茶。",
    "zuo huir , gei ni zhen yi zhan re cha"],
  freightDriver:["车夫","绑稳了。北巷停，到了从后面卸。",
    "bang wen le / bei xiang ting , dao le cong hou mian xie"],
  roomTea:["茶博士","茶马上好。请慢坐，外头风大。",
    "cha ma shang hao / qing man zuo , wai tou feng da"],
  cake:["摊主","一文。刚蒸好的，我给您包一块。",
    "yi wen / gang zheng hao de , wo gei nin bao yi kuai"],
  shopper:["采买客","多谢，这一路正饿着。",
    "duo xie , zhe yi lu zheng e zhe"],
  grainSold:["菜农","这袋黍米够煮一锅粥。二文收好，我捎到集上去。",
    "zhe dai shu mi gou zhu yi guo zhou / er wen shou hao , wo shao dao ji shang qu"],
  gardenOffer:["菜农","有菜就放竹筐里。两株一文，我收来装箱。",
    "you cai jiu fang zhu kuang li / liang zhu yi wen , wo shou lai zhuang xiang"],
  gardenSorting:["菜农","这两株我收了。稍等，我装进木箱。",
    "zhe liang zhu wo shou le / shao deng , wo zhuang jin mu xiang"],
  gardenSold:["菜农","装好了，一文钱收好。",
    "zhuang hao le , yi wen qian shou hao"],
  joinerWaiting:["木匠","木料还在院里。推到木料位，我就给你刨一块板。",
    "mu liao hai zai yuan li / tui dao mu liao wei , wo jiu gei ni bao yi kuai ban"],
  joinerWork:["木匠","看好了，顺着木纹走刨，回手时把刨子提起来。",
    "kan hao le / shun zhe mu wen zou bao , hui shou shi ba bao zi ti qi lai"],
  joinerDone:["木匠","这一面刨好了。顺着纹路摸过去，手上就不挂刺了。",
    "zhe yi mian bao hao le / shun zhe wen lu mo guo qu , shou shang jiu bu gua ci le"],
  timberShort:["搬料伙计","我走横闸那条道，把木料送到桥头。",
    "wo zou heng zha na tiao dao , ba mu liao song dao qiao tou"],
  timberBridge:["搬料伙计","我把木料送到桥头，先从小桥过去。",
    "wo ba mu liao song dao qiao tou , xian cong xiao qiao guo qu"],
  timberArrived:["搬料伙计","木料放好了，我回院里。",
    "mu liao fang hao le , wo hui yuan li"],
  timberFinished:["搬料伙计","木料就在桥头的桌上。",
    "mu liao jiu zai qiao tou de zhuo shang"],
};

const stop=[0,0,0];
const vowels={
  open:[.80,0,.16],
  round:[.16,.84,0],
  wide:[.13,0,.83],
  neutral:[.36,.04,.15],
};
const {max,sin,PI}=Math;

function plan(pinyin) {
  return pinyin.split(" ").map((syllable,index)=>{
    if(syllable==="/" || syllable===",") return {time:syllable==="/" ? .32 : .19,shape:stop};
    // Stop consonants briefly close the lips. Compound finals can flow from
    // the rounded part into the open vowel, or narrow again on the release.
    const initial=/^[bpmf]/.test(syllable) ? .27 : .12;
    const final=syllable.replace(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcs])/,"");
    const primary=/a|er/.test(final) ? vowels.open : /[ouw]/.test(final) ? vowels.round :
      /[iy]/.test(final) ? vowels.wide : vowels.neutral;
    const secondary=/^[ouw].*[ae]/.test(final) ? vowels.open :
      /[oa][ui]$/.test(final) ? (final.endsWith("u") ? vowels.round : vowels.wide) : primary;
    return {time:.145+(index%3)*.014+(syllable.length>4 ? .025 : 0),shape:primary,secondary,initial};
  });
}

const timings={};
for(const [id,[,,pinyin]] of Object.entries(lines)) timings[id]=plan(pinyin);
export function createMissionDialogue(contextAction) {
  const panel=document.createElement("div");
  panel.id="missionDialogue";
  panel.hidden=true;
  panel.innerHTML=`
    <button id="missionContext" type="button" aria-keyshortcuts="E" hidden><kbd class="mission-key" aria-hidden="true">E</kbd><span></span></button>
    <p id="missionCaption" role="status" hidden><b></b><span></span></p>`;
  document.body.appendChild(panel);
  const prompt=panel.querySelector("button"), label=prompt.querySelector("span");
  const caption=panel.querySelector("p"), speaker=caption.querySelector("b"), text=caption.querySelector("span");
  let active=false, timer, presented=null, performance=null;
  const expression={id:null,shape:[0,0,0],emphasis:0};

  function speech(dt) {
    const out=expression.shape;
    out.fill(0);
    expression.id=performance?.id??null;
    expression.emphasis=0;
    if(!performance) return expression;
    performance.age+=dt;
    let t=performance.age;
    for(const cue of timings[performance.id]) {
      if(t>=cue.time) {
        t-=cue.time;
        continue;
      }
      if(t<0 || !cue.initial) break;
      const f=t/cue.time;
      const pulse=sin(PI*max(0,(f-cue.initial)/(1-cue.initial)))**.72;
      const travel=max(0,(f-.48)/.52);
      for(let i=0;i<3;i++) out[i]=pulse*(cue.shape[i]+(cue.secondary[i]-cue.shape[i])*travel);
      expression.emphasis=pulse;
      break;
    }
    return expression;
  }
  new ResizeObserver(()=>{
    document.body.style.setProperty("--mission-dialogue-height",panel.hidden ? "0px" : panel.offsetHeight+10+"px");
  }).observe(panel);

  function update() {
    const action=active ? contextAction() : null;
    const title=action ? action.textContent.trim().replace(/\s+[A-Z]$/,"") : "";
    if(title!==presented) {
      presented=title;
      prompt.hidden=!title;
      label.textContent=title;
    }
    panel.hidden=!active || (prompt.hidden && caption.hidden);
  }
  function dispatch() {
    if(!active) return false;
    const action=contextAction();
    if(!action) return false;
    action.click();
    update();
    return true;
  }
  prompt.onclick=dispatch;

  function clear() {
    clearTimeout(timer);
    performance=null;
    caption.hidden=true;
    text.textContent=speaker.textContent="";
    update();
  }
  return {
    activate(on) {
      if(active===on) return;
      active=on;
      if(!active) clear();
      else update();
    },
    update, dispatch, clear, speech,
    speak(id) {
      if(!active || performance?.id===id) return;
      const [name,line]=lines[id];
      performance={id,age:-.075};
      clearTimeout(timer);
      speaker.textContent=name;
      text.textContent=line;
      caption.hidden=false;
      timer=setTimeout(clear,Math.max(4500,line.length*210));
      update();
    },
  };
}
