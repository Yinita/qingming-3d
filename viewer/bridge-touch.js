export function createMissionTouchPad() {
  const panel=document.createElement("div");
  panel.id="missionTouchPad";
  panel.hidden=true;
  panel.setAttribute("role","group");
  panel.setAttribute("aria-label","移动");
  panel.innerHTML=`
    <button type="button" data-move="w" aria-label="向前">↑</button>
    <button type="button" data-move="a" aria-label="向左">←</button>
    <button type="button" data-move="s" aria-label="后退">↓</button>
    <button type="button" data-move="d" aria-label="向右">→</button>`;
  document.body.appendChild(panel);

  const held=new Map();
  function clear() {
    for(const button of panel.children) button.removeAttribute("data-held");
    held.clear();
  }
  window.addEventListener("blur",clear);
  for(const button of panel.children) {
    const key=button.dataset.move;
    button.addEventListener("pointerdown",event=>{
      if(event.button!==0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      held.set(key,event.pointerId);
      button.dataset.held="";
    });
    for(const type of ["pointerup","pointercancel","lostpointercapture"]) {
      button.addEventListener(type,event=>{
        if(held.get(key)!==event.pointerId) return;
        held.delete(key);
        button.removeAttribute("data-held");
      });
    }
  }
  const buttons=Array.from(panel.children);
  const labels={walk:["向前","向左","后退","向右"],row:["划向对岸","向左","划向出发岸","向右"],
    haul:["向前推","左转","向后拉","右转"],well:["提起水桶","","放下水桶",""]};
  let mode="walk";
  return {
    move:key=>!panel.hidden && held.has(key),
    visible(on) {
      const hidden=!on;
      if(panel.hidden===hidden) return;
      panel.hidden=hidden;
      if(hidden) clear();
    },
    mode(next) {
      if(mode===next) return;
      clear();
      mode=next;
      panel.dataset.mode=mode;
      panel.dataset.vertical=String(mode==="row" || mode==="well");
      panel.setAttribute("aria-label",mode==="well" ? "辘轳" : "移动");
      for(const [i,button] of buttons.entries()) {
        button.setAttribute("aria-label",labels[mode][i]);
        button.textContent=(mode==="well" ? ["提桶","","放桶",""] :
          mode==="haul" ? ["↑","↶","↓","↷"] : ["↑","←","↓","→"])[i];
      }
    },
    size:h=>panel.style.setProperty("--mission-hud-height",h+"px"),
  };
}
