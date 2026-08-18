const {
  getCurrentWindow,
  getAllWindows,
  PhysicalPosition,
  LogicalPosition,
  LogicalSize,
} = window.__TAURI__.window;
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
const AI_SETTINGS_KEY = "kardii-ai-settings-v1";
const PROFILE_KEY = "kardii-profile-v1";
const BUSINESS_DATA_KEY = "kardii-business-data-v1";
const WECOM_HISTORY_KEY = "kardii-wecom-chat-history-v1";
const WECOM_HISTORY_EPOCH_KEY = "kardii-wecom-chat-history-epoch-v1";

const states = ["idle", "thinking", "talking", "happy", "loading", "sleep", "error"];
const BASE_WINDOW = { width: 440, height: 360 };
const MENU_PANEL_WIDTH = 316;
const TRANSIENT_STATE_DURATIONS = { happy: 1650 };
let currentState = "idle";
let scale = Number(localStorage.getItem("kardii-scale") || "1");
let lastInteraction = Date.now();
let clickTimer;
let stateReturnTimer;
let dragStart = null;
let didDrag = false;
let menuLayout = null;
let agentNoticeTaskId = "";
let agentNoticeCount = 0;
let agentNoticeTimer;
const wecomMessageQueues = new Map();

function storedJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function wecomAiConfig() {
  const settings = storedJson(AI_SETTINGS_KEY, {});
  const provider = ["deepseek", "gemini", "ollama", "codex"].includes(settings.provider) ? settings.provider : "deepseek";
  return {
    provider,
    model: provider === "deepseek"
      ? "deepseek-v4-flash"
      : provider === "gemini"
        ? (["gemini-3.1-flash-lite", "gemini-3.5-flash"].includes(settings.geminiModel) ? settings.geminiModel : "gemini-3.1-flash-lite")
        : provider === "codex" ? "codex-default" : String(settings.ollamaModel || "").slice(0, 120),
    ollamaBaseUrl: String(settings.ollamaBaseUrl || "http://127.0.0.1:11434").slice(0, 200),
  };
}

function wecomProfile() {
  const profile = storedJson(PROFILE_KEY, {});
  const business = storedJson(BUSINESS_DATA_KEY, {});
  const featureKnowledge = window.KardiiCapabilities?.knowledgeText({
    appVersion: window.KardiiCapabilities.version,
    providerName: wecomAiConfig().provider,
    modelName: wecomAiConfig().model,
    providerReady: true,
    agentRunning: 0,
    agentQueued: 0,
    wecomDocumentsAuthorized: business?.settings?.wecomDocumentsConnected === true,
    wecomBotConnected: business?.settings?.wecomBotEnabled === true,
  }) || "";
  return {
    userName: "",
    personality: typeof profile.personality === "string" ? profile.personality : "healing",
    customInstructions: "",
    memories: [],
    featureKnowledge,
  };
}

function loadWecomHistories() {
  const value = storedJson(WECOM_HISTORY_KEY, {});
  return value && !Array.isArray(value) && typeof value === "object" ? value : {};
}

function saveWecomTurn(conversationKey, userText, assistantText, expectedEpoch) {
  if ((localStorage.getItem(WECOM_HISTORY_EPOCH_KEY) || "") !== expectedEpoch) return;
  const histories = loadWecomHistories();
  const history = Array.isArray(histories[conversationKey]) ? histories[conversationKey] : [];
  history.push({ role: "user", content: String(userText).slice(0, 4_000) });
  history.push({ role: "assistant", content: String(assistantText).slice(0, 10_000) });
  histories[conversationKey] = history.slice(-20);
  const keys = Object.keys(histories);
  if (keys.length > 50) keys.slice(0, keys.length - 50).forEach((key) => delete histories[key]);
  try { localStorage.setItem(WECOM_HISTORY_KEY, JSON.stringify(histories)); } catch { /* history is optional */ }
}

async function handleWecomMessage(payload = {}) {
  const messageId = String(payload.messageId || "");
  const requestId = String(payload.requestId || "");
  const conversationKey = String(payload.conversationKey || "single:unknown").slice(0, 300);
  const text = String(payload.text || "").trim().slice(0, 4_000);
  if (!messageId || !requestId || !text) return;
  const historyEpoch = localStorage.getItem(WECOM_HISTORY_EPOCH_KEY) || "";
  const histories = loadWecomHistories();
  const history = (Array.isArray(histories[conversationKey]) ? histories[conversationKey] : []).slice(-12);
  let answer;
  try {
    const ai = wecomAiConfig();
    if (ai.provider === "ollama" && !ai.model) throw new Error("本机 Ollama 尚未选择模型");
    answer = await invoke("answer_wecom_message", {
      request: {
        text,
        history,
        profile: wecomProfile(),
        provider: ai.provider,
        model: ai.model,
        ollamaBaseUrl: ai.ollamaBaseUrl,
      },
    });
    saveWecomTurn(conversationKey, text, answer, historyEpoch);
  } catch (error) {
    answer = "Kardii 暂时无法生成回复。请打开桌面 Kardii 检查当前 AI 连接。";
  }
  await invoke("reply_wecom_message", { messageId, requestId, content: String(answer) });
}

function enqueueWecomMessage(payload = {}) {
  const conversationKey = String(payload.conversationKey || "unknown").slice(0, 300);
  const previous = wecomMessageQueues.get(conversationKey) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => handleWecomMessage(payload))
    .catch(() => {});
  wecomMessageQueues.set(conversationKey, current);
  void current.finally(() => {
    if (wecomMessageQueues.get(conversationKey) === current) wecomMessageQueues.delete(conversationKey);
  });
}

function configuredWecomBot() {
  const business = storedJson(BUSINESS_DATA_KEY, {});
  const settings = business?.settings || {};
  return settings.wecomBotEnabled === true && typeof settings.wecomBotId === "string" && settings.wecomBotId.trim()
    ? settings.wecomBotId.trim()
    : "";
}

async function restoreWecomBotConnection() {
  const botId = configuredWecomBot();
  if (!botId) return;
  try {
    if (await invoke("has_wecom_bot_secret")) await invoke("start_wecom_bot", { botId });
  } catch { /* workbench shows the actionable connection error */ }
}

function touch() {
  lastInteraction = Date.now();
}

function setState(state) {
  if (!states.includes(state)) return;
  clearTimeout(stateReturnTimer);
  currentState = state;
  petImage.src = `./assets/pet/${state}.webp`;
  petImage.alt = `Kardii ${state}`;
  void closeContextMenu();
  touch();

  const duration = TRANSIENT_STATE_DURATIONS[state];
  if (duration) {
    stateReturnTimer = setTimeout(() => setState("idle"), duration);
  }
}

async function setScale(nextScale) {
  scale = Math.max(0.6, Math.min(2.4, Number(nextScale.toFixed(2))));
  document.documentElement.style.setProperty("--pet-scale", scale);
  localStorage.setItem("kardii-scale", String(scale));
  await appWindow.setSize(new LogicalSize(
    Math.max(280, Math.round(BASE_WINDOW.width * scale)),
    Math.max(230, Math.round(BASE_WINDOW.height * scale)),
  ));
}

async function openContextMenu() {
  if (!menu.classList.contains("hidden")) return;

  const position = await appWindow.outerPosition();
  const size = await appWindow.outerSize();
  const pixelRatio = window.devicePixelRatio || 1;
  const menuPhysicalWidth = Math.round(MENU_PANEL_WIDTH * pixelRatio);
  const monitorLeft = Math.round((window.screen.availLeft || 0) * pixelRatio);
  const monitorRight = monitorLeft + Math.round(window.screen.availWidth * pixelRatio);
  const leftSpace = position.x - monitorLeft;
  const rightSpace = monitorRight - (position.x + size.width);
  const side = rightSpace >= menuPhysicalWidth || rightSpace >= leftSpace ? "right" : "left";
  const expandedX = side === "left"
    ? Math.max(monitorLeft, position.x - menuPhysicalWidth)
    : position.x;

  menuLayout = { position, side };
  document.body.classList.add("menu-open", `menu-side-${side}`);
  if (side === "left") {
    await appWindow.setPosition(new PhysicalPosition(expandedX, position.y));
  }
  await appWindow.setSize(new LogicalSize(
    Math.max(280, Math.round(BASE_WINDOW.width * scale)) + MENU_PANEL_WIDTH,
    Math.max(230, Math.round(BASE_WINDOW.height * scale)),
  ));
  menu.classList.remove("hidden");
}

async function closeContextMenu() {
  if (!menuLayout && menu.classList.contains("hidden")) return;
  const layout = menuLayout;
  menu.classList.add("hidden");
  document.body.classList.remove("menu-open", "menu-side-left", "menu-side-right");
  menuLayout = null;
  await appWindow.setSize(new LogicalSize(
    Math.max(280, Math.round(BASE_WINDOW.width * scale)),
    Math.max(230, Math.round(BASE_WINDOW.height * scale)),
  ));
  if (layout?.position) {
    await appWindow.setPosition(new PhysicalPosition(layout.position.x, layout.position.y));
  }
}

async function restorePosition() {
  try {
    const saved = JSON.parse(localStorage.getItem("kardii-position") || "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
    }
  } catch {
    localStorage.removeItem("kardii-position");
  }
}

pet.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (event.detail > 1) return;
  touch();
  dragStart = { x: event.screenX, y: event.screenY };
  didDrag = false;
});

window.addEventListener("mousemove", (event) => {
  if (!dragStart || (event.buttons & 1) === 0) return;
  const distance = Math.hypot(
    event.screenX - dragStart.x,
    event.screenY - dragStart.y,
  );
  if (distance < 12) return;

  dragStart = null;
  didDrag = true;
  clearTimeout(clickTimer);
  void appWindow.startDragging();
});

window.addEventListener("mouseup", (event) => {
  if (event.button !== 0 || !dragStart) return;
  const distance = Math.hypot(
    event.screenX - dragStart.x,
    event.screenY - dragStart.y,
  );
  dragStart = null;

  if (!didDrag && distance < 12) {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => void toggleChat(), 240);
  }
});

pet.addEventListener("dblclick", () => {
  clearTimeout(clickTimer);
  const index = states.indexOf(currentState);
  setState(states[(index + 1) % states.length]);
});

async function toggleChat() {
  const chatWindow = (await getAllWindows()).find((window) => window.label === "chat");
  if (!chatWindow) return;

  if (await chatWindow.isVisible()) {
    await chatWindow.hide();
    return;
  }

  const petPosition = await appWindow.outerPosition();
  const petSize = await appWindow.outerSize();
  const chatSize = await chatWindow.outerSize();
  const gap = 12;
  const leftX = petPosition.x - chatSize.width - gap;
  const x = leftX >= 0 ? leftX : petPosition.x + petSize.width + gap;
  const y = Math.max(16, petPosition.y + petSize.height - chatSize.height - 18);

  await chatWindow.setPosition(new PhysicalPosition(x, y));
  await chatWindow.show();
  await chatWindow.setFocus();
}

async function openWorkbench() {
  const workbenchWindow = (await getAllWindows()).find((window) => window.label === "workbench");
  if (!workbenchWindow) return;
  await workbenchWindow.show();
  await workbenchWindow.unminimize();
  await workbenchWindow.setFocus();
}

async function openAgent(taskId = "") {
  const agentWindow = (await getAllWindows()).find((window) => window.label === "agent");
  if (!agentWindow) return;
  if (taskId) {
    localStorage.setItem("kardii-agent-open-target-v1", JSON.stringify({ taskId, autoStart: false }));
  }
  agentNotice.classList.add("hidden");
  agentNoticeCount = 0;
  clearTimeout(agentNoticeTimer);
  await agentWindow.show();
  await agentWindow.unminimize();
  await agentWindow.setFocus();
}

function showAgentNotice(payload = {}) {
  agentNoticeTaskId = String(payload.taskId || "");
  agentNoticeCount += 1;
  agentNoticeBadge.textContent = agentNoticeCount > 1 ? `AGENT · ${agentNoticeCount}` : "AGENT";
  agentNoticeTitle.textContent = String(payload.title || "Agent 有新进展").slice(0, 120);
  agentNoticeMessage.textContent = String(payload.message || "点击查看任务").slice(0, 180);
  agentNotice.classList.remove("hidden");
  clearTimeout(agentNoticeTimer);
  agentNoticeTimer = setTimeout(() => {
    agentNotice.classList.add("hidden");
    agentNoticeCount = 0;
  }, 12_000);
}

async function keepWindowOnScreen() {
  const margin = 8;
  const left = Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0;
  const top = Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0;
  const right = left + window.screen.availWidth;
  const bottom = top + window.screen.availHeight;
  const maxX = Math.max(left + margin, right - window.outerWidth - margin);
  const maxY = Math.max(top + margin, bottom - window.outerHeight - margin);
  const x = Math.min(Math.max(window.screenX, left + margin), maxX);
  const y = Math.min(Math.max(window.screenY, top + margin), maxY);

  if (Math.abs(x - window.screenX) > 1 || Math.abs(y - window.screenY) > 1) {
    await appWindow.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  }
}

document.addEventListener("contextmenu", async (event) => {
  event.preventDefault();
  if (menu.classList.contains("hidden")) await openContextMenu();
  else await closeContextMenu();
  touch();
});

document.addEventListener("click", async (event) => {
  const state = event.target?.dataset?.state;
  const action = event.target?.dataset?.action;

  if (state || action) await closeContextMenu();
  if (state) setState(state);
  if (action === "smaller") await setScale(scale - 0.1);
  if (action === "larger") await setScale(scale + 0.1);
  if (action === "reset") await setScale(1);
  if (action === "workbench") await openWorkbench();
  if (action === "chat") await toggleChat();
  if (action === "agent") await openAgent();
  if (action === "hide") await appWindow.hide();
  if (action === "quit") {
    await window.KardiiStorage.flush();
    await invoke("quit_app");
  }

  if (!menu.contains(event.target)) await closeContextMenu();
});

window.addEventListener("wheel", async (event) => {
  event.preventDefault();
  await closeContextMenu();
  await setScale(scale + (event.deltaY < 0 ? 0.1 : -0.1));
  touch();
}, { passive: false });

appWindow.onMoved(({ payload }) => {
  localStorage.setItem("kardii-position", JSON.stringify(payload));
});

listen("kardii-state", ({ payload }) => setState(payload));
listen("kardii-agent-notice", ({ payload }) => showAgentNotice(payload));
listen("kardii-wecom-message", ({ payload }) => enqueueWecomMessage(payload));

agentNotice.addEventListener("click", () => void openAgent(agentNoticeTaskId));

states.forEach((state) => {
  const image = new Image();
  image.src = `./assets/pet/${state}.webp`;
});

["mousemove", "keydown", "touchstart"].forEach((name) => {
  window.addEventListener(name, touch, { passive: true });
});

setInterval(() => {
  if (Date.now() - lastInteraction > 180_000 && currentState !== "sleep") {
    setState("sleep");
  }
}, 10_000);

void setScale(scale);
restorePosition();
void restoreWecomBotConnection();
