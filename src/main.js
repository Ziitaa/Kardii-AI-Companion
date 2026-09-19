const { getCurrentWindow, getAllWindows, LogicalSize } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const petImage = document.getElementById("petImage");
const menu = document.getElementById("menu");
const agentNotice = document.getElementById("agentNotice");
const agentNoticeBadge = document.getElementById("agentNoticeBadge");
const agentNoticeTitle = document.getElementById("agentNoticeTitle");
const agentNoticeMessage = document.getElementById("agentNoticeMessage");

const states = ["idle","thinking","talking","happy","loading","sleep","error"];
const BASE_WINDOW = { width: 300, height: 260 };
let currentState = "idle";
let scale = Number(localStorage.getItem("kardii-scale") || "0.82");
let lastInteraction = Date.now();
let clickTimer;
let dragStart = null;
let didDrag = false;
let agentNoticeTaskId = "";

function touch(){ lastInteraction = Date.now(); }

function setState(state){
  if(!states.includes(state)) return;
  currentState = state;
  petImage.src = `./assets/pet/${state}.webp`;
  petImage.alt = `Niko ${state}`;
  touch();
}

async function setScale(next){
  const numeric = Number(next);
  scale = Math.max(0.55, Math.min(1.35, Number.isFinite(numeric) ? numeric : 0.82));
  localStorage.setItem("kardii-scale", String(scale));
  await appWindow.setSize(new LogicalSize(
    Math.max(180, Math.round(BASE_WINDOW.width * scale)),
    Math.max(160, Math.round(BASE_WINDOW.height * scale)),
  ));
}

function openContextMenu(){ menu.classList.remove("hidden"); }
function closeContextMenu(){ menu.classList.add("hidden"); }

async function toggleWindow(label){
  const target = (await getAllWindows()).find((window) => window.label === label);
  if(!target) return;
  if(await target.isVisible()) return target.hide();
  await target.show();
  await target.unminimize();
  await target.setFocus();
}

async function openAgent(taskId=""){
  if(taskId) localStorage.setItem("kardii-agent-open-target-v1", JSON.stringify({taskId,autoStart:false}));
  agentNotice.classList.add("hidden");
  await toggleWindow("agent");
}

function showAgentNotice(payload={}){
  agentNoticeTaskId = String(payload.taskId || "");
  agentNoticeBadge.textContent = "NIKO";
  agentNoticeTitle.textContent = String(payload.title || "Niko 有新进展").slice(0,120);
  agentNoticeMessage.textContent = String(payload.message || "点击查看任务").slice(0,180);
  agentNotice.classList.remove("hidden");
}

pet.addEventListener("mousedown",(event)=>{
  if(event.button!==0 || event.detail>1) return;
  dragStart={x:event.screenX,y:event.screenY}; didDrag=false; touch();
});
window.addEventListener("mousemove",(event)=>{
  if(!dragStart || (event.buttons & 1)===0) return;
  if(Math.hypot(event.screenX-dragStart.x,event.screenY-dragStart.y)<10) return;
  dragStart=null; didDrag=true; clearTimeout(clickTimer); closeContextMenu(); void appWindow.startDragging();
});
window.addEventListener("mouseup",(event)=>{
  if(event.button!==0 || !dragStart) return;
  const distance=Math.hypot(event.screenX-dragStart.x,event.screenY-dragStart.y);
  dragStart=null;
  if(!didDrag && distance<10){
    clearTimeout(clickTimer);
    clickTimer=setTimeout(()=>void toggleWindow("chat"),220);
  }
});
pet.addEventListener("dblclick",()=>{
  clearTimeout(clickTimer);
  setState(states[(states.indexOf(currentState)+1)%states.length]);
});
document.addEventListener("contextmenu",(event)=>{
  event.preventDefault();
  if(menu.classList.contains("hidden")) openContextMenu(); else closeContextMenu();
});
document.addEventListener("click",async(event)=>{
  const state=event.target?.dataset?.state;
  const action=event.target?.dataset?.action;
  if(state) setState(state);
  if(action==="workbench") await toggleWindow("workbench");
  if(action==="chat") await toggleWindow("chat");
  if(action==="agent") await openAgent();
  if(action==="smaller") await setScale(scale-0.1);
  if(action==="larger") await setScale(scale+0.1);
  if(action==="reset-size") await setScale(0.82);
  if(action==="passthrough"){ closeContextMenu(); await appWindow.setIgnoreCursorEvents(true); }
  if(action==="hide") await appWindow.hide();
  if(action==="quit"){ await window.KardiiStorage.flush(); await invoke("quit_app"); }
  if(state||action||!menu.contains(event.target)) closeContextMenu();
});
listen("kardii-state",({payload})=>setState(payload));
listen("kardii-agent-notice",({payload})=>showAgentNotice(payload));
agentNotice.addEventListener("click",()=>void openAgent(agentNoticeTaskId));
setInterval(()=>{ if(Date.now()-lastInteraction>180000 && currentState!=="sleep") setState("sleep"); },10000);
void setScale(scale);
