const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();
const invokeCore = window.__TAURI__?.core?.invoke;
const STATE_KEY = "kardii-trading-state-v1";
const AGENT_KEY = "kardii-agent-tasks-v1";
const state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (saved && saved.version === 1) return saved;
  } catch {}
  return {
    version: 1,
    market: { connected: false },
    scanner: { running: false },
    opportunities: [],
    strategies: [],
    riskRules: { configured: false },
    ledger: [],
    research: [],
  };
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

const titles = { overview: "运行状态", remote: "远程全状态", ledger: "真实账本", research: "研究日志" };
document.querySelectorAll(".nav").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.dataset.panel === button.dataset.view));
    document.getElementById("title").textContent = titles[button.dataset.view];
    render();
  };
});

document.getElementById("minBtn").onclick = () => appWindow.minimize();
document.getElementById("closeBtn").onclick = () => appWindow.hide();
document.getElementById("workbenchDragHeader").addEventListener("mousedown", (event) => {
  if (event.button === 0 && !event.target.closest("button")) void appWindow.startDragging();
});

const modal = document.getElementById("modal");
const form = document.getElementById("modalForm");
const fields = document.getElementById("modalFields");
const modalEyebrow = document.getElementById("modalEyebrow");
const modalTitle = document.getElementById("modalTitle");
const modalClose = document.getElementById("modalClose");
const modalCancel = document.getElementById("modalCancel");
const addLedgerBtn = document.getElementById("addLedgerBtn");
const addResearchBtn = document.getElementById("addResearchBtn");
const binanceConnectBtn = document.getElementById("binanceConnectBtn");
const binanceDisconnectBtn = document.getElementById("binanceDisconnectBtn");
const binanceConnectionStatus = document.getElementById("binanceConnectionStatus");
const binanceConnectionDetail = document.getElementById("binanceConnectionDetail");
const remoteViewerStatus = document.getElementById("remoteViewerStatus");
const remoteViewerDetail = document.getElementById("remoteViewerDetail");
const remoteViewerConnectBtn = document.getElementById("remoteViewerConnectBtn");
const remoteViewerDisconnectBtn = document.getElementById("remoteViewerDisconnectBtn");
const agentCount = document.getElementById("agentCount");
const agentDetail = document.getElementById("agentDetail");
const approvalCount = document.getElementById("approvalCount");
const marketStatus = document.getElementById("marketStatus");
const scanStatus = document.getElementById("scanStatus");
const ledgerCount = document.getElementById("ledgerCount");
const ledgerLatest = document.getElementById("ledgerLatest");
const ledgerList = document.getElementById("ledgerList");
const researchList = document.getElementById("researchList");
const remoteMode = document.getElementById("remoteMode");
const remoteModeDetail = document.getElementById("remoteModeDetail");
const remoteResearchCount = document.getElementById("remoteResearchCount");
const remoteLedgerCount = document.getElementById("remoteLedgerCount");
const remoteKillSwitch = document.getElementById("remoteKillSwitch");
const remoteKillDetail = document.getElementById("remoteKillDetail");
const remoteRuntimeDetail = document.getElementById("remoteRuntimeDetail");
const remoteBalanceList = document.getElementById("remoteBalanceList");
const remoteResearchList = document.getElementById("remoteResearchList");
const remoteExperimentList = document.getElementById("remoteExperimentList");
const remoteShadowList = document.getElementById("remoteShadowList");
const remoteLedgerEventList = document.getElementById("remoteLedgerEventList");
const remoteTradeIntentList = document.getElementById("remoteTradeIntentList");
let remoteSnapshot = null;
let mode = "";

function openModal(nextMode) {
  mode = nextMode;
  modal.classList.remove("hidden");
  if (nextMode === "ledger") {
    modalEyebrow.textContent = "REAL LEDGER";
    modalTitle.textContent = "记录真实资金变动";
    fields.innerHTML = '<div class="field"><label>类型</label><select name="type"><option value="deposit">转入</option><option value="withdrawal">转出</option><option value="trade">真实成交</option><option value="fee">手续费</option><option value="realized_pnl">已实现损益</option><option value="adjustment">其他真实调整</option></select></div><div class="field"><label>资产</label><input name="asset" required placeholder="USDT"></div><div class="field"><label>数量</label><input name="amount" type="number" step="any" required></div><div class="field"><label>平台 / 钱包</label><input name="venue" placeholder="例如 Binance"></div><div class="field full"><label>真实凭证 / 备注</label><textarea name="note" placeholder="只记录真实发生的资金或成交；模拟结果不要填这里"></textarea></div>';
  } else if (nextMode === "binance") {
    modalEyebrow.textContent = "READ ONLY";
    modalTitle.textContent = "连接 Binance 只读 API";
    fields.innerHTML = '<div class="field full"><label>API Key</label><input name="apiKey" type="password" autocomplete="off" spellcheck="false" required></div><div class="field full"><label>API Secret</label><input name="apiSecret" type="password" autocomplete="off" spellcheck="false" required></div><div class="field full credential-warning">只允许严格只读权限。Kardii 会先在线验证权限，再保存到 macOS Keychain；不会写进聊天记录或 localStorage。</div>';
  } else {
    modalEyebrow.textContent = "RESEARCH LOG";
    modalTitle.textContent = "记录研究";
    fields.innerHTML = '<div class="field full"><label>主题</label><input name="title" required></div><div class="field full"><label>来源 / 证据</label><textarea name="sources"></textarea></div><div class="field full"><label>结论 / 下一步</label><textarea name="conclusion" required></textarea></div>';
  }
}

function closeModal() {
  modal.classList.add("hidden");
  form.reset();
  mode = "";
}

modalClose.onclick = closeModal;
modalCancel.onclick = closeModal;
addLedgerBtn.onclick = () => openModal("ledger");
addResearchBtn.onclick = () => openModal("research");
if (binanceConnectBtn) binanceConnectBtn.onclick = () => openModal("binance");

if (remoteViewerConnectBtn) {
  remoteViewerConnectBtn.onclick = async () => {
    if (!invokeCore) return;
    const pairingLink = window.prompt("粘贴个人 Kardii 生成的 HTTPS 只读配对链接：");
    if (!pairingLink) return;
    try {
      await invokeCore("save_remote_viewer_connection", { pairingLink: pairingLink.trim() });
      await refreshRemoteViewerConnection();
    } catch (error) {
      window.alert(String(error));
    }
  };
}
if (remoteViewerDisconnectBtn) {
  remoteViewerDisconnectBtn.onclick = async () => {
    if (!invokeCore) return;
    try {
      await invokeCore("delete_remote_viewer_connection");
      await refreshRemoteViewerConnection();
    } catch (error) {
      window.alert(String(error));
    }
  };
}

if (binanceDisconnectBtn) {
  binanceDisconnectBtn.onclick = async () => {
    if (!invokeCore) return;
    if (!window.confirm("断开后需要重新输入 API Key 才能再次读取账户。确定断开吗？")) return;
    try {
      await invokeCore("delete_binance_readonly_credentials");
      await refreshBinanceConnection();
    } catch (error) {
      window.alert(String(error));
    }
  };
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const now = new Date().toISOString();

  if (mode === "binance") {
    if (!invokeCore) return;
    const apiKey = String(data.get("apiKey") || "").trim();
    const apiSecret = String(data.get("apiSecret") || "").trim();
    try {
      await invokeCore("save_binance_readonly_credentials", { apiKey, apiSecret });
      await invokeCore("sync_binance_readonly_ledger");
      closeModal();
      await refreshBinanceConnection();
    } catch (error) {
      window.alert(String(error));
    }
    return;
  }

  if (mode === "ledger") {
    state.ledger.unshift({
      id: crypto.randomUUID(),
      type: String(data.get("type")),
      asset: String(data.get("asset")).trim().toUpperCase(),
      amount: Number(data.get("amount")),
      venue: String(data.get("venue")).trim(),
      note: String(data.get("note")).trim(),
      createdAt: now,
    });
  } else {
    state.research.unshift({
      id: crypto.randomUUID(),
      title: String(data.get("title")).trim(),
      sources: String(data.get("sources")).trim(),
      conclusion: String(data.get("conclusion")).trim(),
      createdAt: now,
    });
  }
  saveState();
  closeModal();
  render();
};

async function refreshBinanceConnection() {
  if (!invokeCore || !binanceConnectionStatus || !binanceConnectionDetail) return;
  try {
    const status = await invokeCore("get_binance_readonly_status");
    if (!status.configured) {
      binanceConnectionStatus.textContent = "未连接";
      binanceConnectionDetail.textContent = "以后注册好账户后再连接即可。";
      binanceConnectBtn?.classList.remove("hidden");
      binanceDisconnectBtn?.classList.add("hidden");
      return;
    }
    if (status.safeReadOnly) {
      binanceConnectionStatus.textContent = "已安全连接";
      binanceConnectionDetail.textContent = "严格只读 · 非零余额资产 " + (status.nonzeroBalances?.length || 0) + " 个";
      binanceConnectBtn?.classList.add("hidden");
      binanceDisconnectBtn?.classList.remove("hidden");
    } else {
      binanceConnectionStatus.textContent = "权限不安全";
      binanceConnectionDetail.textContent = status.error || "请重新创建严格只读 API Key。";
      binanceConnectBtn?.classList.remove("hidden");
      binanceDisconnectBtn?.classList.remove("hidden");
    }
  } catch (error) {
    binanceConnectionStatus.textContent = "暂不可用";
    binanceConnectionDetail.textContent = String(error);
  }
}

void refreshBinanceConnection();

async function refreshRemoteViewerConnection() {
  if (!invokeCore || !remoteViewerStatus || !remoteViewerDetail) return;
  try {
    const status = await invokeCore("get_remote_viewer_connection_status");
    if (!status.configured) {
      remoteViewerStatus.textContent = "未连接";
      remoteViewerDetail.textContent = "公司电脑只保存远程配对凭据，不保存交易所 API。";
      remoteSnapshot = null;
      renderRemoteSnapshot(null);
      remoteViewerConnectBtn?.classList.remove("hidden");
      remoteViewerDisconnectBtn?.classList.add("hidden");
      return;
    }
    remoteViewerStatus.textContent = status.reachable ? "已连接 · 全状态" : "暂时离线";
    remoteViewerDetail.textContent = status.reachable
      ? "全状态镜像正常 · " + status.baseUrl
      : (status.error || "远程 Kardii 暂时不可达");
    remoteSnapshot = status.snapshot || null;
    renderRemoteSnapshot(remoteSnapshot);
    remoteViewerConnectBtn?.classList.toggle("hidden", status.reachable);
    remoteViewerDisconnectBtn?.classList.remove("hidden");
  } catch (error) {
    remoteViewerStatus.textContent = "连接异常";
    remoteViewerDetail.textContent = String(error);
  }
}
void refreshRemoteViewerConnection();
setInterval(() => void refreshRemoteViewerConnection(), 10 * 1000);

function remoteEmpty(target, message) {
  if (target) target.innerHTML = '<div class="empty">' + esc(message) + '</div>';
}

function renderRemoteSnapshot(snapshot) {
  if (!remoteMode) return;
  if (!snapshot) {
    remoteMode.textContent = "未连接";
    remoteModeDetail.textContent = "等待远程 Kardii";
    remoteResearchCount.textContent = "0";
    remoteLedgerCount.textContent = "0";
    remoteKillSwitch.textContent = "—";
    remoteKillDetail.textContent = "等待状态";
    [remoteRuntimeDetail, remoteBalanceList, remoteResearchList, remoteExperimentList, remoteShadowList, remoteLedgerEventList, remoteTradeIntentList]
      .forEach((node) => remoteEmpty(node, "连接个人 Kardii 后显示。"));
    return;
  }

  const gate = snapshot.executionGate || {};
  const kill = snapshot.killSwitch || {};
  const rec = snapshot.reconciliation || {};
  const shadow = snapshot.shadowExperiments || {};
  remoteMode.textContent = gate.realExecutionEnabled ? "真实执行已启用" : (gate.mode || "研究 / 观察");
  remoteModeDetail.textContent = snapshot.remoteControlEnabled ? "远程控制已启用" : "全状态可见 · 远程执行关闭";
  remoteResearchCount.textContent = String(snapshot.researchCount ?? 0);
  remoteLedgerCount.textContent = String(snapshot.realLedgerEventCount ?? 0);
  remoteKillSwitch.textContent = kill.latched ? "已锁定" : "正常";
  remoteKillDetail.textContent = kill.latched ? (kill.reason || "执行已停止") : "未触发";

  remoteRuntimeDetail.innerHTML = [
    ["对账", rec.status || "未知", rec.detail || "暂无"],
    ["真实执行", gate.realExecutionEnabled ? "已启用" : "关闭", gate.note || ""],
    ["单笔上限", gate.maxOrderNotionalUsdt ?? 0, "USDT"],
    ["单日亏损上限", gate.maxDailyLossUsdt ?? 0, "USDT"],
    ["最大持仓数", gate.maxOpenPositions ?? 0, "确定性风控"],
    ["提现", gate.withdrawalEnabled ? "已启用" : "关闭", "镜像端不可发起"],
    ["杠杆", gate.leverageEnabled ? "已启用" : "关闭", "镜像端不可发起"],
    ["Shadow", (shadow.open ?? 0) + " open / " + (shadow.closed ?? 0) + " closed", "平均 " + Number(shadow.averageReturnPercent || 0).toFixed(3) + "%"]
  ].map(([name,value,note]) => '<div><strong>'+esc(name)+'</strong><span>'+esc(value)+(note?' · '+esc(note):'')+'</span></div>').join("");

  const balances = Array.isArray(snapshot.latestBalances) ? snapshot.latestBalances : [];
  remoteBalanceList.innerHTML = balances.length ? balances.map(x =>
    '<div class="row"><strong>'+esc(x.asset)+'</strong><span>余额</span><div><span class="amount">'+esc(x.total)+'</span><small>可用 '+esc(x.free)+' · 锁定 '+esc(x.locked)+'</small></div><small>'+esc(x.capturedAt||"")+'</small></div>'
  ).join("") : '<div class="empty">暂无余额快照。</div>';

  const research = Array.isArray(snapshot.recentResearch) ? snapshot.recentResearch : [];
  remoteResearchList.innerHTML = research.length ? research.map(x =>
    '<div class="row"><strong>'+esc(x.symbol)+'</strong><span>'+esc(x.signal||"研究")+'</span><div><span>Score '+esc(Number(x.attentionScore||0).toFixed(2))+'</span><small>1h '+esc(Number(x.return1hPercent||0).toFixed(2))+'% · 4h '+esc(Number(x.return4hPercent||0).toFixed(2))+'%</small></div><small>'+esc(x.scannedAt||"")+'</small></div>'
  ).join("") : '<div class="empty">暂无研究记录。</div>';

  const experiments = Array.isArray(snapshot.strategyExperiments) ? snapshot.strategyExperiments : [];
  remoteExperimentList.innerHTML = experiments.length ? experiments.map(x =>
    '<div class="row"><strong>'+esc(x.symbol)+'</strong><span>'+esc(x.status)+'</span><div><span>'+esc(x.hypothesis||"")+'</span><small>观察 '+esc(x.observationCount)+' · miss '+esc(x.missCount)+'</small></div><small>'+esc(x.updatedAt||"")+'</small></div>'
  ).join("") : '<div class="empty">暂无策略实验。</div>';

  const trials = Array.isArray(snapshot.shadowTrials) ? snapshot.shadowTrials : [];
  remoteShadowList.innerHTML = trials.length ? trials.map(x =>
    '<div class="row"><strong>'+esc(x.symbol)+'</strong><span>'+esc(x.status)+'</span><div><span>'+esc(x.signal||"")+'</span><small>entry '+esc(x.entryPrice)+' · return '+esc(x.returnPercent==null?"—":Number(x.returnPercent).toFixed(3)+"%")+'</small></div><small>'+esc(x.horizonMinutes)+'m</small></div>'
  ).join("") : '<div class="empty">暂无 Shadow 实验。</div>';

  const events = Array.isArray(snapshot.ledgerEvents) ? snapshot.ledgerEvents : [];
  remoteLedgerEventList.innerHTML = events.length ? events.map(x =>
    '<div class="row"><strong>'+esc(x.eventType)+'</strong><span>'+esc(x.asset)+'</span><div><span class="amount">'+esc(x.amount)+'</span><small>'+esc(x.venue||"")+' · '+esc(x.source||"")+'</small></div><small>'+esc(x.occurredAt||"")+'</small></div>'
  ).join("") : '<div class="empty">暂无真实账本事件。</div>';

  const intents = Array.isArray(snapshot.tradeIntents) ? snapshot.tradeIntents : [];
  remoteTradeIntentList.innerHTML = intents.length ? intents.map(x =>
    '<div class="row"><strong>'+esc(x.symbol)+' '+esc(x.side)+'</strong><span>'+esc(x.status)+'</span><div><span>'+esc(x.notionalUsdt)+' USDT</span><small>'+esc(x.realExecutionAllowed?"risk passed":"blocked")+' · '+esc((x.riskReasons||[]).join(" / "))+'</small></div><small>'+esc(x.createdAt||"")+'</small></div>'
  ).join("") : '<div class="empty">暂无交易意图。</div>';
}

renderRemoteSnapshot(null);

function tasks(){try{return JSON.parse(localStorage.getItem(AGENT_KEY)||"[]")}catch{return[]}}function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}function typeLabel(t){return({deposit:"转入",withdrawal:"转出",trade:"真实成交",fee:"手续费",realized_pnl:"已实现损益",adjustment:"其他调整"})[t]||t}function render(){const t=tasks(),running=t.filter(x=>["running","queued"].includes(x.status)),approvals=t.filter(x=>["waiting_permission","waiting_input"].includes(x.status));agentCount.textContent=running.length;agentDetail.textContent=running.length?running.slice(0,2).map(x=>x.title||x.goal||"Agent 任务").join(" · "):"没有运行中的任务";approvalCount.textContent=approvals.length;marketStatus.textContent=state.market.connected?"已接入":"未接入";scanStatus.textContent=state.scanner.running?"运行中":"未运行";ledgerCount.textContent=state.ledger.length;ledgerLatest.textContent=state.ledger[0]?new Date(state.ledger[0].createdAt).toLocaleString("zh-CN"):"—";ledgerList.innerHTML=state.ledger.length?state.ledger.map(x=>'<div class="row"><strong>'+esc(typeLabel(x.type))+'</strong><span>'+esc(x.asset)+'</span><div><span class="amount">'+esc(x.amount)+'</span><small>'+esc(x.venue||"")+(x.note?" · "+esc(x.note):"")+'</small></div><small>'+new Date(x.createdAt).toLocaleString("zh-CN")+'</small></div>').join(""):'<div class="empty">还没有真实资金记录。模拟交易不会出现在这里。</div>';researchList.innerHTML=state.research.length?state.research.map(x=>'<div class="row"><strong>'+esc(x.title)+'</strong><span>研究</span><div><span>'+esc(x.conclusion)+'</span><small>'+esc(x.sources||"")+'</small></div><small>'+new Date(x.createdAt).toLocaleString("zh-CN")+'</small></div>').join(""):'<div class="empty">还没有研究日志。</div>'}render();
async function syncRuntimeStatus(){
  const invoke=window.__TAURI__?.core?.invoke;
  if(!invoke)return;
  try{
    const runtime=await invoke("get_trading_runtime_status");
    state.market={
      connected:Boolean(runtime.lastScanAt) && !runtime.lastError,
      lastUpdated:runtime.lastScanAt,
      source:runtime.marketSource,
      symbolCount:runtime.candidateCount
    };
    state.scanner={
      running:Boolean(runtime.refreshing),
      lastRun:runtime.lastScanAt,
      candidateCount:runtime.candidateCount,
      lastError:runtime.lastError||""
    };
    state.opportunities=Array.isArray(runtime.candidates)?runtime.candidates:[];
    state.runtimeResearch=Array.isArray(runtime.research)?runtime.research:[];
    saveState();
    marketStatus.textContent=runtime.refreshing?"读取中":runtime.lastError?"暂不可用":runtime.lastScanAt?"已连接":"等待首次扫描";
    scanStatus.textContent=runtime.refreshing?"扫描中":runtime.lastError?"等待数据":runtime.candidateCount+" 个候选";
  }catch(error){
    marketStatus.textContent="暂不可用";
    scanStatus.textContent="等待数据";
  }
}
void syncRuntimeStatus();
setInterval(()=>void syncRuntimeStatus(),30*1000);
