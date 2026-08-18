const {
  getCurrentWindow,
  getAllWindows,
  PhysicalPosition,
  LogicalPosition,
  LogicalSize,
} = window.__TAURI__.window;
const { invoke, Channel } = window.__TAURI__.core;
const { listen, emitTo } = window.__TAURI__.event;

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
const WECOM_REMOTE_PAIRING_KEY = "kardii-wecom-remote-pairing-v1";
const WECOM_REMOTE_PENDING_KEY = "kardii-wecom-remote-pending-v1";
const AGENT_TASKS_KEY = "kardii-agent-tasks-v1";

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
const wecomRemoteStreams = new Map();

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
  const desktopProvider = ["deepseek", "gemini", "ollama", "codex"].includes(settings.provider) ? settings.provider : "deepseek";
  const desktop = {
    provider: desktopProvider,
    model: desktopProvider === "deepseek"
      ? "deepseek-v4-flash"
      : desktopProvider === "gemini"
        ? (["gemini-3.1-flash-lite", "gemini-3.5-flash"].includes(settings.geminiModel) ? settings.geminiModel : "gemini-3.1-flash-lite")
        : desktopProvider === "codex" ? "codex-default" : String(settings.ollamaModel || "").slice(0, 120),
    ollamaBaseUrl: String(settings.ollamaBaseUrl || "http://127.0.0.1:11434").slice(0, 200),
  };
  const business = storedJson(BUSINESS_DATA_KEY, {});
  const selected = String(business?.settings?.wecomBotModel || "inherit");
  const dedicated = {
    "deepseek-flash": { provider: "deepseek", model: "deepseek-v4-flash" },
    "gemini-flash-lite": { provider: "gemini", model: "gemini-3.1-flash-lite" },
    "gemini-flash": { provider: "gemini", model: "gemini-3.5-flash" },
    codex: { provider: "codex", model: "codex-default" },
    "ollama-current": { provider: "ollama", model: String(settings.ollamaModel || "").slice(0, 120) },
  }[selected];
  return dedicated ? {
    ...dedicated,
    ollamaBaseUrl: desktop.ollamaBaseUrl,
  } : desktop;
}

function wecomResponseConfig() {
  const business = storedJson(BUSINESS_DATA_KEY, {});
  const mode = business?.settings?.wecomBotResponseMode === "complete" ? "complete" : "fast";
  return {
    mode,
    historyLimit: mode === "fast" ? 6 : 12,
    maxTokens: mode === "fast" ? 700 : 2_000,
  };
}

function wecomProfile(ai = wecomAiConfig()) {
  const profile = storedJson(PROFILE_KEY, {});
  const business = storedJson(BUSINESS_DATA_KEY, {});
  const featureKnowledge = window.KardiiCapabilities?.knowledgeText({
    appVersion: window.KardiiCapabilities.version,
    providerName: ai.provider,
    modelName: ai.model,
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

function wecomBusinessData() {
  const value = storedJson(BUSINESS_DATA_KEY, {});
  return value && !Array.isArray(value) && typeof value === "object" ? value : {};
}

function wecomRemoteSettings() {
  const pairing = storedJson(WECOM_REMOTE_PAIRING_KEY, {});
  return window.KardiiWecomRemote.normalizeSettings({
    ...(wecomBusinessData()?.settings || {}),
    ...(pairing && !Array.isArray(pairing) && typeof pairing === "object" ? pairing : {}),
  });
}

function updateWecomBusinessSettings(updates) {
  const business = wecomBusinessData();
  business.settings = { ...(business.settings || {}), ...updates };
  localStorage.setItem(BUSINESS_DATA_KEY, JSON.stringify(business));
}

function loadWecomRemoteDrafts() {
  const value = storedJson(WECOM_REMOTE_PENDING_KEY, {});
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const now = Date.now();
  return Object.fromEntries(Object.entries(value).filter(([, draft]) => (
    draft && typeof draft === "object" && Number(draft.expiresAt) > now
  )));
}

function saveWecomRemoteDrafts(drafts) {
  try { localStorage.setItem(WECOM_REMOTE_PENDING_KEY, JSON.stringify(drafts)); } catch { /* a draft can be recreated */ }
}

function wecomRemoteDraftKey(payload = {}) {
  return `${String(payload.fromUserId || "").slice(0, 256)}:${String(payload.conversationKey || "").slice(0, 300)}`;
}

function wecomRemoteTasks() {
  const saved = storedJson(AGENT_TASKS_KEY, []);
  return Array.isArray(saved) ? saved.filter((task) => task?.remoteSource?.taskCode) : [];
}

function findWecomRemoteTask(code, fromUserId, conversationKey = "") {
  const clean = window.KardiiWecomRemote.cleanCode(code);
  return wecomRemoteTasks().find((task) => (
    window.KardiiWecomRemote.cleanCode(task?.remoteSource?.taskCode) === clean
      && String(task?.remoteSource?.fromUserId || "") === String(fromUserId || "")
      && (!conversationKey || String(task?.remoteSource?.conversationKey || "") === String(conversationKey))
  )) || null;
}

function remoteStatusLabel(status) {
  return {
    draft: "等待开始", queued: "排队中", planning: "制定计划", running: "执行中",
    waiting_input: "等待回答", waiting_authorization: "等待桌面授权",
    waiting_permission: "等待桌面确认", paused: "已暂停", completed: "已完成",
    failed: "失败", cancelled: "已取消",
  }[status] || "未知状态";
}

function wecomRemoteHelp() {
  return [
    "Kardii 手机远程 Agent 命令：",
    "/绑定 6位码 — 首次绑定本人账号",
    "/任务 要完成的事 — 生成待确认任务",
    "/确认 6位码 — 二次确认并开始",
    "/状态 — 查看电脑在线和最近任务",
    "/结果 任务码 — 取回任务结果",
    "/回答 任务码 补充内容 — 回答 Agent 的问题",
    "/取消 任务码 — 取消任务；不带任务码则取消待确认草稿",
    "",
    "远程任务只使用安全只读白名单。终端、剪贴板、桌面浏览器、MCP、私人长期记忆和外部写入始终不能从企微执行。",
  ].join("\n");
}

async function replyWecomPayload(payload, content, { streamId = null, finish = true } = {}) {
  return invoke("reply_wecom_message", {
    messageId: String(payload.messageId || ""),
    requestId: String(payload.requestId || ""),
    content: String(content || "").trim().slice(0, 19_000),
    streamId,
    finish,
  });
}

function activeWecomRemoteStream(taskCode) {
  return [...wecomRemoteStreams.entries()].find(([, stream]) => stream.taskCode === taskCode) || null;
}

async function closeWecomRemoteStream(taskCode, content) {
  const active = activeWecomRemoteStream(taskCode);
  if (!active) return;
  const [requestId, stream] = active;
  wecomRemoteStreams.delete(requestId);
  try {
    await replyWecomPayload(stream, content, { streamId: stream.streamId, finish: true });
  } catch { /* the original WeCom response window may already be closed */ }
}

async function startWecomRemoteStream(payload, command, task = null) {
  const remoteRequestId = crypto.randomUUID();
  const streamId = await replyWecomPayload(payload, task
    ? `已收到补充，Kardii 正在继续远程任务 ${command.code}…`
    : `任务 ${command.code} 已确认，Kardii 正在这台电脑上制定安全只读计划…`, { finish: false });
  const stream = {
    messageId: String(payload.messageId || ""),
    requestId: String(payload.requestId || ""),
    conversationKey: String(payload.conversationKey || ""),
    fromUserId: String(payload.fromUserId || ""),
    taskCode: command.code,
    streamId,
  };
  wecomRemoteStreams.set(remoteRequestId, stream);
  try {
    if (task) {
      await emitTo("agent", "kardii-wecom-remote-answer", {
        taskId: task.id,
        answer: command.answer,
        remoteRequestId,
        conversationKey: stream.conversationKey,
        fromUserId: stream.fromUserId,
      });
    } else {
      const settings = wecomRemoteSettings();
      await emitTo("agent", "kardii-wecom-remote-start", {
        goal: command.goal,
        taskCode: command.code,
        remoteRequestId,
        conversationKey: stream.conversationKey,
        fromUserId: stream.fromUserId,
        allowKnowledge: settings.allowKnowledge,
        allowWecomDocuments: settings.allowWecomDocuments,
        ai: wecomAiConfig(),
      });
    }
  } catch (error) {
    wecomRemoteStreams.delete(remoteRequestId);
    await replyWecomPayload(stream, `无法启动远程 Agent：${String(error)}`, { streamId, finish: true }).catch(() => {});
  }
}

async function handleWecomRemoteCommand(payload, text) {
  const command = window.KardiiWecomRemote.parseCommand(text);
  if (!command) return false;
  const settings = wecomRemoteSettings();
  const fromUserId = String(payload.fromUserId || "").trim();
  const singleChat = String(payload.chatType || "single") === "single";
  if (command.type === "invalid") {
    await replyWecomPayload(payload, `${command.error}\n\n${wecomRemoteHelp()}`);
    return true;
  }
  if (command.type === "help") {
    await replyWecomPayload(payload, wecomRemoteHelp());
    return true;
  }
  if (!singleChat || !fromUserId) {
    await replyWecomPayload(payload, "远程 Agent 命令只接受企业微信私聊，群聊中不会绑定、显示任务或执行操作。");
    return true;
  }
  if (command.type === "bind") {
    if (!settings.enabled) {
      await replyWecomPayload(payload, "请先在电脑 Kardii 的“外部连接 → 企业微信 → 手机远程 Agent”中开启功能并生成绑定码。");
      return true;
    }
    if (settings.ownerUserId && settings.ownerUserId !== fromUserId) {
      await replyWecomPayload(payload, "这台 Kardii 已绑定另一个企微账号。必须先在电脑端解除绑定，不能从企微覆盖。");
      return true;
    }
    if (!settings.pairingCode || settings.pairingExpiresAt <= Date.now() || command.code !== settings.pairingCode) {
      await replyWecomPayload(payload, "绑定码无效或已过期。请回到电脑 Kardii 重新生成 6 位绑定码。");
      return true;
    }
    updateWecomBusinessSettings({
      wecomRemoteOwnerUserId: fromUserId,
    });
    localStorage.removeItem(WECOM_REMOTE_PAIRING_KEY);
    await replyWecomPayload(payload, "绑定完成。只有这个企微账号的私聊可以发起远程任务；普通聊天仍不会自动执行。发送 /帮助 查看命令。");
    return true;
  }
  if (!settings.enabled || !settings.ownerUserId) {
    await replyWecomPayload(payload, "手机远程 Agent 尚未在电脑端开启并完成绑定。普通聊天仍可继续使用。");
    return true;
  }
  if (settings.ownerUserId !== fromUserId) {
    await replyWecomPayload(payload, "这个账号没有绑定到此 Kardii，远程命令已拒绝。");
    return true;
  }

  if (command.type === "status") {
    const tasks = wecomRemoteTasks().filter((task) => (
      task?.remoteSource?.fromUserId === fromUserId
        && task?.remoteSource?.conversationKey === String(payload.conversationKey || "")
    )).slice(0, 3);
    const taskLines = tasks.length ? tasks.map((task) => (
      `${task.remoteSource.taskCode} · ${remoteStatusLabel(task.status)} · ${String(task.title || task.goal || "远程任务").slice(0, 48)}`
    )) : ["暂无远程任务"];
    await replyWecomPayload(payload, [
      "Kardii 电脑在线，企业微信连接正常。",
      `安全范围：公开网页${settings.allowKnowledge ? "、Kardii 知识库只读" : ""}${settings.allowWecomDocuments ? "、企微文档只读" : ""}`,
      "",
      ...taskLines,
    ].join("\n"));
    return true;
  }

  if (command.type === "task") {
    const activeCount = wecomRemoteTasks().filter((task) => (
      task?.remoteSource?.fromUserId === fromUserId && window.KardiiWecomRemote.isActiveStatus(task.status)
    )).length;
    if (activeCount >= 3) {
      await replyWecomPayload(payload, "当前已有 3 个未结束的远程任务。请先发送 /状态 查看，并完成或取消其中一个。");
      return true;
    }
    const drafts = loadWecomRemoteDrafts();
    const code = window.KardiiWecomRemote.createCode();
    drafts[wecomRemoteDraftKey(payload)] = {
      code,
      goal: command.goal,
      fromUserId,
      conversationKey: String(payload.conversationKey || ""),
      expiresAt: Date.now() + 5 * 60_000,
    };
    saveWecomRemoteDrafts(drafts);
    const scopes = ["公开网页搜索"];
    if (settings.allowKnowledge) scopes.push("Kardii 知识库只读");
    if (settings.allowWecomDocuments) scopes.push("企微文档只读");
    await replyWecomPayload(payload, [
      "远程任务尚未开始，请核对：",
      command.goal,
      "",
      `允许范围：${scopes.join("、")}`,
      "禁止：终端、剪贴板、浏览器控制、MCP、私人记忆和任何写入。",
      `5 分钟内发送：/确认 ${code}`,
    ].join("\n"));
    return true;
  }

  if (command.type === "confirm") {
    const drafts = loadWecomRemoteDrafts();
    const key = wecomRemoteDraftKey(payload);
    const draft = drafts[key];
    if (!draft || draft.code !== command.code || draft.fromUserId !== fromUserId || draft.expiresAt <= Date.now()) {
      await replyWecomPayload(payload, "没有找到对应的待确认任务，验证码可能已过期或已使用。请重新发送 /任务 任务内容。");
      return true;
    }
    delete drafts[key];
    saveWecomRemoteDrafts(drafts);
    await startWecomRemoteStream(payload, { ...command, goal: String(draft.goal || "").slice(0, 2_000) });
    return true;
  }

  if (command.type === "answer") {
    const task = findWecomRemoteTask(command.code, fromUserId, payload.conversationKey);
    if (!task || task.status !== "waiting_input") {
      await replyWecomPayload(payload, "这个任务当前没有等待回答。请先发送 /状态，或用 /结果 任务码 查看结果。");
      return true;
    }
    await startWecomRemoteStream(payload, command, task);
    return true;
  }

  if (command.type === "result") {
    const task = findWecomRemoteTask(command.code, fromUserId, payload.conversationKey);
    if (!task) {
      await replyWecomPayload(payload, "没有找到这个任务码对应的本人远程任务。");
      return true;
    }
    const detail = task.status === "completed"
      ? String(task.finalAnswer || "任务已完成，但没有可显示的文字结果。")
      : task.status === "failed"
        ? String(task.error || "任务执行失败。")
        : task.status === "cancelled"
          ? "任务已取消，没有继续执行。"
        : task.status === "waiting_input"
          ? `需要你的回答：${String(task.question || "请在桌面查看问题。")}`
          : String(task.currentAction?.explanation || task.summary || "任务仍在处理中。");
    await replyWecomPayload(payload, `任务 ${command.code} · ${remoteStatusLabel(task.status)}\n\n${detail}`);
    return true;
  }

  if (command.type === "cancel") {
    if (!command.code) {
      const drafts = loadWecomRemoteDrafts();
      const key = wecomRemoteDraftKey(payload);
      if (!drafts[key]) {
        await replyWecomPayload(payload, "当前没有待确认的远程任务。取消已开始的任务请发送：/取消 任务码");
        return true;
      }
      delete drafts[key];
      saveWecomRemoteDrafts(drafts);
      await replyWecomPayload(payload, "待确认的远程任务已取消，没有开始执行。");
      return true;
    }
    const task = findWecomRemoteTask(command.code, fromUserId, payload.conversationKey);
    if (!task || !window.KardiiWecomRemote.isActiveStatus(task.status)) {
      await replyWecomPayload(payload, "没有找到可取消的本人进行中任务。");
      return true;
    }
    await closeWecomRemoteStream(command.code, `任务 ${command.code} 已由手机取消。`);
    await emitTo("agent", "kardii-wecom-remote-cancel", {
      taskId: task.id,
      fromUserId,
      conversationKey: String(payload.conversationKey || ""),
    }).catch(() => {});
    await replyWecomPayload(payload, `已发送取消指令：${command.code}。Kardii 会在当前安全步骤结束后停止。`);
    return true;
  }
  return false;
}

async function handleWecomRemoteUpdate(payload = {}) {
  const remoteRequestId = String(payload.remoteRequestId || "");
  const stream = wecomRemoteStreams.get(remoteRequestId);
  if (!stream) return;
  const status = String(payload.status || "");
  const taskCode = window.KardiiWecomRemote.cleanCode(payload.taskCode) || stream.taskCode;
  let finish = false;
  let content = `任务 ${taskCode} · ${remoteStatusLabel(status)}`;
  if (status === "queued") content += "\n当前 Agent 席位已满，任务会在有空闲位置后自动开始。";
  else if (status === "waiting_input") {
    finish = true;
    content += `\n\n需要你的回答：${String(payload.question || payload.message || "请补充信息。")}\n\n请发送：/回答 ${taskCode} 你的补充内容`;
  } else if (status === "completed") {
    finish = true;
    content += `\n\n${String(payload.finalAnswer || "任务已经完成。")}\n\n如需再次获取，可发送：/结果 ${taskCode}`;
  } else if (["failed", "cancelled", "paused", "waiting_authorization", "waiting_permission"].includes(status)) {
    finish = true;
    content += `\n\n${String(payload.error || payload.message || "任务已停止。")}\n\n安全范围外的操作只能回到桌面 Kardii 处理。`;
  } else {
    content += `\n${String(payload.message || "Kardii 正在处理…")}`;
  }
  if (finish) wecomRemoteStreams.delete(remoteRequestId);
  try {
    await replyWecomPayload(stream, content, { streamId: stream.streamId, finish });
  } catch {
    if (finish) wecomRemoteStreams.delete(remoteRequestId);
  }
}

async function handleWecomMessage(payload = {}) {
  const messageId = String(payload.messageId || "");
  const requestId = String(payload.requestId || "");
  const conversationKey = String(payload.conversationKey || "single:unknown").slice(0, 300);
  const text = String(payload.text || "").trim().slice(0, 4_000);
  if (!messageId || !requestId || !text) return;
  if (await handleWecomRemoteCommand(payload, text)) return;
  const historyEpoch = localStorage.getItem(WECOM_HISTORY_EPOCH_KEY) || "";
  const histories = loadWecomHistories();
  const response = wecomResponseConfig();
  const history = (Array.isArray(histories[conversationKey]) ? histories[conversationKey] : []).slice(-response.historyLimit);
  let answer = "";
  let streamId = "";
  let streamQueue = Promise.resolve();
  let lastIntermediate = "";
  let lastIntermediateAt = 0;

  const queueIntermediate = (content) => {
    const snapshot = String(content || "").trim();
    if (!streamId || !snapshot || snapshot === lastIntermediate) return;
    lastIntermediate = snapshot;
    streamQueue = streamQueue
      .catch(() => {})
      .then(() => invoke("reply_wecom_message", {
        messageId,
        requestId,
        content: snapshot,
        streamId,
        finish: false,
      }));
  };

  try {
    streamId = await invoke("reply_wecom_message", {
      messageId,
      requestId,
      content: "Kardii 正在思考…",
      streamId: null,
      finish: false,
    });
    lastIntermediateAt = Date.now();
    const ai = wecomAiConfig();
    if (ai.provider === "ollama" && !ai.model) throw new Error("本机 Ollama 尚未选择模型");
    const channel = new Channel();
    channel.onmessage = (event) => {
      if (event.event !== "delta" || !event.data) return;
      answer += String(event.data);
      const now = Date.now();
      if (now - lastIntermediateAt >= 350) {
        lastIntermediateAt = now;
        queueIntermediate(answer);
      }
    };
    await invoke("stream_wecom_message", {
      request: {
        text,
        history,
        profile: wecomProfile(ai),
        provider: ai.provider,
        model: ai.model,
        ollamaBaseUrl: ai.ollamaBaseUrl,
        conversationKey,
        historyLimit: response.historyLimit,
        maxTokens: response.maxTokens,
        responseMode: response.mode,
      },
      onEvent: channel,
    });
    answer = answer.trim();
    if (!answer) throw new Error("Kardii 没有生成可发送到企业微信的回复");
    await streamQueue;
    await invoke("reply_wecom_message", {
      messageId,
      requestId,
      content: answer,
      streamId,
      finish: true,
    });
    saveWecomTurn(conversationKey, text, answer, historyEpoch);
  } catch (error) {
    await streamQueue.catch(() => {});
    const failure = answer.trim()
      ? `${answer.trim()}\n\n（回复中断，请稍后重试。）`
      : "Kardii 暂时无法生成回复。请打开桌面 Kardii 检查当前 AI 连接。";
    try {
      await invoke("reply_wecom_message", {
        messageId,
        requestId,
        content: failure,
        streamId: streamId || null,
        finish: true,
      });
    } catch { /* the bot connection already reports its own status */ }
  }
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
listen("kardii-wecom-remote-update", ({ payload }) => void handleWecomRemoteUpdate(payload));

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
