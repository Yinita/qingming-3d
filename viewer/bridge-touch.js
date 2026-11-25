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
  return {
    move:key=>!panel.hidden && held.has(key),
    visible(on) {
      const hidden=!on;
      if(panel.hidden===hidden) return;
      panel.hidden=hidden;
      if(hidden) clear();
    },
    rowing(active) {
      if(panel.dataset.rowing===String(active)) return;
      panel.dataset.rowing=String(active);
      panel.querySelector('[data-move="w"]').setAttribute("aria-label",active ? "划向对岸" : "向前");
      panel.querySelector('[data-move="s"]').setAttribute("aria-label",active ? "划向出发岸" : "后退");
    },
    size:h=>panel.style.setProperty("--mission-hud-height",h+"px"),
  };
}
