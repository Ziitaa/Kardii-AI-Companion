const { getCurrentWindow, getAllWindows, LogicalSize } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const appWindow = getCurrentWindow();
const pet = document.getElementById("pet");
const petImage = document.getElementById("petImage");
const menu = document.getElementById("menu");
const agentNotice = document.getElementById("agentNotice");
const agentNoticeTitle = document.getElementById("agentNoticeTitle");
const agentNoticeMessage = document.getElementById("agentNoticeMessage");

const BASE_WINDOW = { width: 250, height: 220 };
let scale = Number(localStorage.getItem("kardii-scale") || "0.82");
let dragStart = null;
let didDrag = false;
let clickTimer;
let agentNoticeTaskId = "";

async function setScale(next){
  const value = Number(next);
  scale = Math.max(0.6, Math.min(1.25, Number.isFinite(value) ? value : 0.82));
  localStorage.setItem("kardii-scale", String(scale));
  await appWindow.setSize(new LogicalSize(
    Math.max(170, Math.round(BASE_WINDOW.width * scale)),
    Math.max(150, Math.round(BASE_WINDOW.height * scale)),
  ));
}

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

pet.addEventListener("mousedown",(event)=>{
  if(event.button!==0 || event.detail>1) return;
  dragStart={x:event.screenX,y:event.screenY};
  didDrag=false;
});
window.addEventListener("mousemove",(event)=>{
  if(!dragStart || (event.buttons & 1)===0) return;
  if(Math.hypot(event.screenX-dragStart.x,event.screenY-dragStart.y)<9) return;
  dragStart=null;
  didDrag=true;
  clearTimeout(clickTimer);
  menu.classList.add("hidden");
  void appWindow.startDragging();
});
window.addEventListener("mouseup",(event)=>{
  if(event.button!==0 || !dragStart) return;
  const distance=Math.hypot(event.screenX-dragStart.x,event.screenY-dragStart.y);
  dragStart=null;
  if(!didDrag && distance<9){
    clearTimeout(clickTimer);
    clickTimer=setTimeout(()=>void toggleWindow("chat"),200);
  }
});

document.addEventListener("contextmenu",(event)=>{
  event.preventDefault();
  menu.classList.toggle("hidden");
});
document.addEventListener("click",async(event)=>{
  const action=event.target?.dataset?.action;
  if(action==="workbench") await toggleWindow("workbench");
  if(action==="chat") await toggleWindow("chat");
  if(action==="agent") await openAgent();
  if(action==="smaller") await setScale(scale-0.1);
  if(action==="larger") await setScale(scale+0.1);
  if(action==="hide") await appWindow.hide();
  if(action==="quit"){ await window.KardiiStorage.flush(); await invoke("quit_app"); }
  if(action || !menu.contains(event.target)) menu.classList.add("hidden");
});

listen("kardii-agent-notice",({payload={}})=>{
  agentNoticeTaskId=String(payload.taskId||"");
  agentNoticeTitle.textContent=String(payload.title||"Niko 有新进展").slice(0,120);
  agentNoticeMessage.textContent=String(payload.message||"点击查看任务").slice(0,180);
  agentNotice.classList.remove("hidden");
});
agentNotice.addEventListener("click",()=>void openAgent(agentNoticeTaskId));
petImage.src="./assets/pet/idle.webp";
petImage.alt="Niko";
void setScale(scale);
