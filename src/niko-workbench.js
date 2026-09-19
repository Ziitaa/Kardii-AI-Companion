const {getCurrentWindow,getAllWindows}=window.__TAURI__.window;
const win=getCurrentWindow();
const KEYS={tasks:"kardii-agent-tasks-v1",skills:"kardii-agent-skills-v1",memories:"kardii-memories-v1",businesses:"niko-businesses-v1",experiments:"niko-experiments-v1",ledger:"niko-ledger-v1"};
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||"null")??fallback}catch{return fallback}};
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n)||0);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const empty=message=>`<div class="empty">${esc(message)}</div>`;
const activeStatuses=new Set(["queued","planning","running","waiting_input","waiting_authorization","waiting_permission","paused"]);

function render(){
  const tasks=read(KEYS.tasks,[]), skills=read(KEYS.skills,[]), memories=read(KEYS.memories,[]), businesses=read(KEYS.businesses,[]), experiments=read(KEYS.experiments,[]);
  const ledger=read(KEYS.ledger,{openingCapital:0,revenue:0,expenses:0,entries:[]});
  const active=tasks.filter(t=>activeStatuses.has(t?.status));
  const revenue=Number(ledger.revenue)||0, expenses=Number(ledger.expenses)||0, opening=Number(ledger.openingCapital)||0, balance=opening+revenue-expenses;
  $("activeAgents").textContent=active.length; $("revenue").textContent=money(revenue); $("treasury").textContent=money(balance);
  $("businessBadge").textContent=businesses.length; $("experimentBadge").textContent=experiments.filter(x=>x?.status!=="closed").length; $("activityBadge").textContent=active.length; $("memoryBadge").textContent=memories.length; $("skillsBadge").textContent=skills.filter(x=>x?.enabled!==false).length;
  $("nowList").innerHTML=active.length?active.slice(0,4).map(t=>`<div class="row"><strong>${esc(t.title||t.goal||"Agent 任务")}</strong><span>${esc(t.status||"active")}</span></div>`).join(""):empty("现在没有运行中的 Agent。");
  $("activityList").innerHTML=tasks.length?tasks.slice().reverse().slice(0,30).map(t=>`<article class="card"><small>${esc(t.status||"unknown")}</small><h3>${esc(t.title||"Agent 任务")}</h3><p>${esc(t.summary||t.goal||"")}</p></article>`).join(""):empty("还没有 Agent 执行记录。");
  $("skillsList").innerHTML=skills.length?skills.map(s=>`<article class="card"><small>${s.enabled===false?"disabled":"enabled"}</small><h3>${esc(s.name||"Skill")}</h3><p>${esc(s.description||"")}</p></article>`).join(""):empty("还没有保存 Skill。");
  $("memoryList").innerHTML=memories.length?memories.map((m,i)=>`<article class="card"><small>MEMORY ${i+1}</small><p>${esc(typeof m==="string"?m:(m.text||m.content||""))}</p></article>`).join(""):empty("还没有长期记忆。");
  $("businessList").innerHTML=businesses.length?businesses.map(b=>`<article class="card"><small>${esc(b.status||"active")}</small><h3>${esc(b.name||"Business")}</h3><p>${esc(b.summary||"")}</p></article>`).join(""):empty("还没有成立任何业务。先用实验验证需求，不为了填页面而造项目。");
  $("experimentList").innerHTML=experiments.length?experiments.map(x=>`<article class="card"><small>${esc(x.status||"draft")}</small><h3>${esc(x.name||x.hypothesis||"Experiment")}</h3><p>${esc(x.hypothesis||x.summary||"")}</p><div class="meta">Cost: ${money(x.cost||0)}</div></article>`).join(""):empty("还没有商业实验。Niko 会先研究，再建立最小可验证实验。");
  $("openingCapital").textContent=money(opening); $("treasuryRevenue").textContent=money(revenue); $("expenses").textContent=money(expenses); $("balance").textContent=money(balance);
  $("ledgerList").innerHTML=Array.isArray(ledger.entries)&&ledger.entries.length?ledger.entries.slice().reverse().map(e=>`<div class="row"><strong>${esc(e.description||e.type||"Entry")} · ${money(e.amount)}</strong><span>${esc(e.date||"")} · ${esc(e.type||"")}</span></div>`).join(""):empty("账本为空。真实资金能力尚未开启。");
}
function openView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===name+"View"));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("title").textContent=name==="today"?"今天":document.querySelector(`nav button[data-view="${name}"]`)?.childNodes[0]?.textContent?.trim()||name;
  render();
}
async function show(label){const target=(await getAllWindows()).find(x=>x.label===label);if(!target)return;await target.show();await target.unminimize();await target.setFocus()}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>openView(b.dataset.view));
$("date").textContent=new Intl.DateTimeFormat("zh-CN",{dateStyle:"full"}).format(new Date());
$("openChat").onclick=()=>show("chat"); $("openAgent").onclick=()=>show("agent"); $("activityAgent").onclick=()=>show("agent"); $("skillsAgent").onclick=()=>show("agent");
$("experimentTask").onclick=()=>{localStorage.setItem("kardii-agent-open-target-v1",JSON.stringify({goal:"为 Niko 研究并提出第一个低成本、可验证、合法的真实商业实验。先调查真实需求与竞争，再给出最小实验方案；不要付款、注册付费服务或进行不可逆操作。",autoStart:false}));show("agent")};
$("minimize").onclick=()=>win.minimize(); $("close").onclick=()=>win.hide();
window.addEventListener("storage",render); window.addEventListener("focus",render); setInterval(render,5000); render();