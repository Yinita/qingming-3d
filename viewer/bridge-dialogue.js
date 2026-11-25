const lines={
  courier:["伙计","茶箱就在桥头。过桥往左是茶铺，也能从南边的渡口过河。"],
  delivery:["掌柜","来得正好。茶叶放这儿吧，五文钱收好。"],
  cake:["摊主","一文。刚蒸好的，我给您包一块。"],
  shopper:["采买客","多谢，这一路正饿着。"],
};

export function createMissionDialogue(contextAction) {
  const panel=document.createElement("div");
  panel.id="missionDialogue";
  panel.hidden=true;
  panel.innerHTML=`
    <button id="missionContext" type="button" aria-keyshortcuts="E" hidden><kbd>E</kbd><span></span></button>
    <p id="missionCaption" role="status" hidden><b></b><span></span></p>`;
  document.body.appendChild(panel);
  const prompt=panel.querySelector("button"), label=prompt.querySelector("span");
  const caption=panel.querySelector("p"), speaker=caption.querySelector("b"), text=caption.querySelector("span");
  let active=false, timer, presented=null;
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
    update, dispatch, clear,
    speak(id) {
      if(!active) return;
      const [name,line]=lines[id];
      clearTimeout(timer);
      speaker.textContent=name;
      text.textContent=line;
      caption.hidden=false;
      timer=setTimeout(clear,Math.max(4000,line.length*190));
      update();
    },
  };
}
