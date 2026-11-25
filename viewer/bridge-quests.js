// Quest data for the bridge tea-shop playable, kept separate from the scene code.
//
// bridge-mission.js owns movement, collision and rendering; this module owns what
// the player is asked to do, what each route costs, and the task journal. The
// rules engine in bridge-mission.js stays authoritative: nothing here moves cargo
// or coins. See docs/quest-design.md for the full specification.

export const TEA_QUEST = {
  id: "tea-shop-opening",
  title: "桥畔茶铺",
  premise: "对岸茶铺今晚要开张，可新到的一箱茶叶还搁在桥头。掌柜等着它下锅。",
  economy: { startCoins: 6, courierFee: 3, deliveryReward: 5 },
  stages: {
    waiting:   { title: "桥头取箱",   objective: "任务起点 · 取茶叶箱，再送到对岸茶铺。" },
    carrying:  { title: "送往茶铺",   objective: "已拿到茶叶。过桥，到茶铺柜台交货。" },
    courier:   { title: "伙计送货中", objective: "伙计正在送货。可以跟过去，也可以切到任务画卷。" },
    delivered: { title: "任务完成",   objective: "茶已送到，茶铺开张。" },
  },
  solutions: [
    {
      id: "self", title: "亲自送货",
      steps: ["走到桥头的茶叶箱旁，按 E 背起", "沿木桥过河，或从南侧渡口自行划船", "在茶铺柜台前按 E 交货"],
      outcome: "掌柜付五文。余额 11 文，库存 1 箱。",
    },
    {
      id: "courier", title: "委托伙计", cost: 3,
      steps: ["站在货箱旁，点「委托伙计」付三文", "伙计背箱过桥。可以跟着走，也可以打开任务画卷看箱子位置"],
      outcome: "掌柜付五文。余额 8 文，库存 1 箱。",
    },
    {
      id: "supplier", title: "对岸货栈", planned: true,
      steps: ["从对岸货栈买一小包散茶，免去搬箱过桥"],
      outcome: "规划中。只够煮一壶，茶铺可开张但库存记为半箱。",
    },
  ],
  rules: [
    "货箱只有一只。两条路线交付的是同一只箱子，不会多出货物。",
    "铜钱只在委托和交货时变化，每一笔都记在下面的账目里。",
    "撤销回到上一次拿取或委托之前；重置清空全部进度。",
  ],
};

export function stageOf(phase) {
  return TEA_QUEST.stages[phase] ?? TEA_QUEST.stages.waiting;
}

export function maxCoins() {
  const { startCoins, deliveryReward } = TEA_QUEST.economy;
  return startCoins + deliveryReward;
}

// Append one ledger line to the mission state. The state is what gets saved,
// so undo and reload see the same history.
export function record(state, text, delta = 0) {
  state.log = [...(state.log ?? []), { text, delta }].slice(-12);
}

function solutionStatus(solution, state) {
  if (solution.planned) return "planned";
  if (state.phase === "delivered") return state.method === solution.id ? "done" : "skipped";
  if (solution.id === "self" && state.phase === "carrying") return "active";
  if (solution.id === "courier" && state.phase === "courier") return "active";
  if (state.phase === "courier" || state.phase === "carrying") return "skipped";
  if (solution.id === "courier" && state.phase === "waiting" && state.coins < TEA_QUEST.economy.courierFee)
    return "blocked";
  return "open";
}

const statusLabel = { done: "已完成", active: "进行中", open: "可选", skipped: "未采用", blocked: "铜钱不足", planned: "规划中" };

const css = `
#questJournal { position:fixed; inset:auto 16px 16px auto; z-index:30; width:min(380px,calc(100vw - 32px));
  max-height:min(70vh,560px); overflow:auto; padding:14px 16px; box-sizing:border-box;
  background:rgba(246,241,230,.97); color:#2A2620; border:1px solid #C9BEA6; border-radius:6px;
  font:14px/1.6 "Noto Serif SC","Songti SC",serif; box-shadow:0 6px 24px rgba(42,38,32,.18); }
#questJournal[hidden] { display:none; }
#questJournal h2 { font-size:16px; margin:0 0 2px; }
#questJournal h3 { font-size:13px; margin:12px 0 4px; color:#6E6453; font-weight:600; }
#questJournal p { margin:0 0 6px; }
#questJournal ol, #questJournal ul { margin:0 0 4px; padding-left:20px; }
#questJournal .route { border-top:1px solid #E0D6C2; padding-top:6px; margin-top:6px; }
#questJournal .route strong { margin-right:6px; }
#questJournal .tag { font-size:12px; padding:0 6px; border-radius:3px; border:1px solid #C9BEA6; color:#6E6453; }
#questJournal .tag[data-status=active] { background:#2A2620; color:#EDE6D6; border-color:#2A2620; }
#questJournal .tag[data-status=done] { background:#5C6B4E; color:#F6F1E6; border-color:#5C6B4E; }
#questJournal .tag[data-status=blocked] { color:#8A3B2A; border-color:#8A3B2A; }
#questJournal .route[data-status=planned], #questJournal .route[data-status=skipped] { opacity:.62; }
#questJournal .ledger li { list-style:none; margin-left:-20px; display:flex; justify-content:space-between; gap:12px; }
#missionJournal { padding:6px 9px; font-weight:600; color:#322b24; border-color:#b8a283; background:#fff6e7; }
#missionJournal:hover, #missionJournal:focus-visible { background:#322b24; color:#fff6e7; }
#questJournal .close { float:right; font:inherit; font-size:13px; border:1px solid #C9BEA6; background:#EDE6D6;
  border-radius:4px; padding:0 8px; cursor:pointer; }
`;

export function createQuestJournal() {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const panel = document.createElement("aside");
  panel.id = "questJournal";
  panel.hidden = true;
  panel.setAttribute("aria-label", "任务簿");
  document.body.appendChild(panel);
  let last = "";

  function render(state) {
    const stage = stageOf(state.phase);
    const routes = TEA_QUEST.solutions.map(solution => {
      const status = solutionStatus(solution, state);
      const cost = solution.cost ? ` · 花费 ${solution.cost} 文` : "";
      return `<div class="route" data-status="${status}">
        <strong>${solution.title}</strong><span class="tag" data-status="${status}">${statusLabel[status]}</span>
        <ol>${solution.steps.map(step => `<li>${step}</li>`).join("")}</ol>
        <p>${solution.outcome}${cost}</p></div>`;
    }).join("");
    const log = state.log?.length
      ? state.log.map(({ text, delta }) =>
          `<li><span>${text}</span><span>${delta ? (delta > 0 ? "+" : "") + delta + " 文" : ""}</span></li>`).join("")
      : "<li><span>尚无记录</span></li>";
    return `<button class="close" type="button" data-close>收起 J</button>
      <h2>任务簿 · ${TEA_QUEST.title}</h2>
      <p>${TEA_QUEST.premise}</p>
      <h3>当前</h3><p><strong>${stage.title}</strong> · ${stage.objective}</p>
      <h3>可选路线</h3>${routes}
      <h3>账目 · 现有 ${state.coins} 文</h3><ul class="ledger">${log}</ul>
      <h3>规则</h3><ul>${TEA_QUEST.rules.map(rule => `<li>${rule}</li>`).join("")}</ul>`;
  }

  panel.addEventListener("click", e => { if (e.target.closest("[data-close]")) panel.hidden = true; });
  return {
    panel,
    update(state) {
      if (panel.hidden) return;
      const html = render(state);
      if (html !== last) { panel.innerHTML = html; last = html; }
    },
    toggle(state, force) {
      panel.hidden = force === undefined ? !panel.hidden : !force;
      last = "";
      this.update(state);
      return !panel.hidden;
    },
  };
}
