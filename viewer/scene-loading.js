const front=document.querySelector("#scene-loading");
const background=document.querySelector("#scene-background");
const failure=front.querySelector("button");
const info=front.querySelector(".loading-note");
const groups={
  front:{element:front,tasks:[],samples:[],lastByte:0,bytes:0},
  background:{element:background,tasks:[],samples:[],lastByte:0,bytes:0},
};
const sizes=new Map();
const queue=[];
let inFlight=0,entered=false,failed=false,sealed=false;
const idleTimeout=45_000;
let frontReady;
const ready=new Promise(resolve=>{frontReady=resolve;});
const concurrency=16;
const started=performance.now();
const bytesText=value=>value>=1e6 ? `${(value/1e6).toFixed(1)} MB` : `${Math.round(value/1e3)} KB`;
const timeText=seconds=>seconds<=1 ? "不到 1 秒" :
  seconds<60 ? `约 ${Math.ceil(seconds)} 秒` :
  seconds<3600 ? `约 ${Math.floor(seconds/60)} 分 ${Math.ceil(seconds%60)} 秒` : "超过 1 小时";

function status(group, now) {
  const {element,tasks,samples,bytes}=group;
  if(!tasks.length) return;
  const bar=element.querySelector("progress"), detail=element.querySelector(".loading-metrics");
  const elapsed=element.querySelector(".loading-elapsed");
  if(element===front && !sealed) {
    bar.removeAttribute("value");
    detail.textContent="正在读取场景清单";
    return;
  }
  let totalBytes=0,completedBytes=0,done=0,errors=0,unknown=0;
  for(const task of tasks) {
    if(task.complete) {
      done++;
      errors+=Number(task.failed);
    }
    if(!task.complete && task.expected===null) unknown++;
    totalBytes+=task.failed ? task.loaded : Math.max(task.expected ?? 0,task.loaded);
    completedBytes+=task.loaded;
  }
  if(samples.length===0 || now-samples.at(-1)[0]>=280) samples.push([now,bytes]);
  while(samples.length>2 && now-samples[1][0]>4400) samples.shift();
  const [since,lastBytes]=samples[0];
  const rate=(bytes-lastBytes)/Math.max(.001,(now-since)/1000);
  const running=done<tasks.length;
  const readyToEstimate=rate>2048 && now-since>=540 && now-group.lastByte<2400;
  const percent=running ? Math.min(99,100*completedBytes/Math.max(1,totalBytes)) : 100;
  if(totalBytes>0 && unknown===0) bar.value=percent;
  else bar.removeAttribute("value");
  const data=totalBytes>0 && unknown===0 ? `${Math.floor(percent)}% · ${bytesText(completedBytes)} / ${bytesText(totalBytes)}` :
    `${done} / ${tasks.length} 项资源${completedBytes ? ` · 已读取 ${bytesText(completedBytes)}` : ""}`;
  const transfer=running && readyToEstimate ? ` · ${bytesText(rate)}/s` : "";
  const waiting=now-group.lastByte>3200 && group.lastByte>0 ? "等待网络响应" : "正在测算剩余时间";
  const timing=!running || (!unknown && completedBytes>=totalBytes) ? "正在整理画面" :
    readyToEstimate && !unknown ? `剩余 ${timeText((totalBytes-completedBytes)/rate)}` :
    readyToEstimate ? "部分资源大小未知" : waiting;
  detail.textContent=data+transfer;
  elapsed.textContent=timing;
  if(element===background && !running) {
    elapsed.textContent=errors ? `${errors} 项加载失败` : "下载完成";
    element.querySelector("button").hidden=errors===0;
    if(!errors) element.hidden=true;
  }
  if(element===front && sealed && !running) frontReady();
}

function paint(now=performance.now()) {
  if(failed) return;
  status(groups.front,now);
  if(entered && groups.background.tasks.length) {
    background.hidden=false;
    status(groups.background,now);
  }
}

export async function loadSceneSizes() {
  try {
    const response=await fetch("./scene-sizes.json?v=174",{signal:AbortSignal.timeout(12_000)});
    if(!response.ok) return;
    for(const [path,size] of Object.entries(await response.json())) {
      sizes.set(new URL(path,location.href).href,size);
    }
  } catch {
    // HTTP content lengths and completed item counts remain available.
  }
}

function progress(task, amount) {
  task.loaded+=amount;
  task.group.bytes+=amount;
  task.group.lastByte=performance.now();
}
async function download(task) {
  const network=new AbortController();
  let timer;
  const waitForBytes=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>network.abort(),idleTimeout);
  };
  waitForBytes();
  try {
    const response=await fetch(task.url,{signal:network.signal});
    if(!response.ok) {
      await response.body?.cancel().catch(()=>{});
      throw Object.assign(new Error("HTTP "+response.status),{status:response.status});
    }
    const declared=Number(response.headers.get("content-length"));
    if(task.expected===null && declared>0 && !response.headers.get("content-encoding")) task.expected=declared;
    const chunks=[];
    if(response.body) {
      const reader=response.body.getReader();
      for(;;) {
        const {value,done}=await reader.read();
        if(done) break;
        waitForBytes();
        progress(task,value.byteLength);
        chunks.push(value);
      }
    } else {
      const buffer=await response.arrayBuffer();
      progress(task,buffer.byteLength);
      chunks.push(buffer);
    }
    task.expected=task.loaded;
    return new Blob(chunks,{type:response.headers.get("content-type") || "application/octet-stream"});
  } finally {
    clearTimeout(timer);
  }
}

async function downloadWithRetry(task) {
  for(let attempt=0;;attempt++) {
    task.loaded=0;
    try {
      return await download(task);
    } catch(error) {
      const temporary=error instanceof TypeError || error.name==="AbortError" ||
        error.status===408 || error.status===429 || error.status>=500;
      if(failed || !temporary || attempt>=2) throw error;
      const delay=450*2**attempt+Math.random()*220;
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
}

function pump() {
  if(failed) return;
  while(inFlight<concurrency) {
    let next=queue.findIndex(task=>task.group===groups.front);
    if(next<0 && entered && queue.length) {
      next=queue.findIndex(task=>task.priority);
      if(next<0) next=0;
    }
    if(next<0) break;
    const [task]=queue.splice(next,1);
    inFlight++;
    downloadWithRetry(task).then(task.use).then(task.resolve,error=>{
      task.failed=true;
      task.reject(error);
    }).finally(()=>{
      task.complete=true;
      inFlight--;
      paint();
      pump();
    });
  }
}

export function sceneAsset(url,phase,use,{priority=false}={}) {
  const absolute=new URL(url,location.href).href, group=groups[phase];
  return new Promise((resolve,reject)=>{
    const task={url:absolute,group,use,resolve,reject,loaded:0,priority,
      expected:sizes.get(absolute) ?? null,complete:false,failed:false};
    group.tasks.push(task);
    queue.push(task);
    pump();
  });
}

export function sceneImage(url, phase, options) {
  return sceneAsset(url,phase,async blob=>{
    const src=URL.createObjectURL(blob);
    try {
      const image=new Image();
      image.src=src;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(src);
    }
  },options);
}

export function prepareFirstFrame() {
  sealed=true;
  paint();
  return ready;
}

export function showFirstFrame() {
  entered=true;
  front.hidden=true;
  document.body.classList.remove("scene-loading");
  const url=new URL(location.href);
  if(url.searchParams.has("_scene_retry")) {
    url.searchParams.delete("_scene_retry");
    history.replaceState(history.state,"",url);
  }
  if(groups.front.tasks.some(task=>task.failed)) {
    document.querySelector("#status").textContent+=" · 部分画面素材加载失败";
  }
  pump();
  paint();
}

export function failScene(message) {
  if(entered) return;
  failed=true;
  front.querySelector("h2").textContent="暂时无法打开画卷";
  front.querySelector("progress").hidden=true;
  front.querySelector(".loading-metrics").textContent="";
  front.querySelector(".loading-elapsed").textContent="";
  info.textContent=message;
  failure.hidden=false;
}

for(const element of [front,background]) element.querySelector("button").addEventListener("click",()=>location.reload());
window.addEventListener("error",()=>{
  if(!entered && !failed) failScene("画面初始化失败，请重试。");
});
window.addEventListener("unhandledrejection",()=>{
  if(!entered && !failed) failScene("资源加载中断，请重试。");
});
setInterval(()=>{
  if(!entered && !failed && !front.dataset.moduleFailed && !groups.front.tasks.length && performance.now()-started>5000) {
    info.textContent="正在连接服务器，请稍候。";
  }
  paint();
},340);
