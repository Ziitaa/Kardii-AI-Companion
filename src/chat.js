const { getCurrentWindow } = window.__TAURI__.window;
const { emitTo } = window.__TAURI__.event;
const { invoke, Channel } = window.__TAURI__.core;

const chatWindow = getCurrentWindow();
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const messagesElement = document.getElementById("messages");
const closeButton = document.getElementById("closeButton");
const sendButton = document.getElementById("sendButton");
const stopButton = document.getElementById("stopButton");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const settingsCloseButton = document.getElementById("settingsCloseButton");
const providerSelect = document.getElementById("providerSelect");
const providerDescription = document.getElementById("providerDescription");
const aiModelSelect = document.getElementById("aiModelSelect");
const apiKeySection = document.getElementById("apiKeySection");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const apiKeyInput = document.getElementById("apiKeyInput");
const settingsStatus = document.getElementById("settingsStatus");
const saveKeyButton = document.getElementById("saveKeyButton");
const testKeyButton = document.getElementById("testKeyButton");
const deleteKeyButton = document.getElementById("deleteKeyButton");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const replyActions = document.getElementById("replyActions");
const copyReplyButton = document.getElementById("copyReplyButton");
const readReplyButton = document.getElementById("readReplyButton");
const regenerateButton = document.getElementById("regenerateButton");
const responseLengthSelect = document.getElementById("responseLengthSelect");
const profileButton = document.getElementById("profileButton");
const profilePanel = document.getElementById("profilePanel");
const profileCloseButton = document.getElementById("profileCloseButton");
const userNameInput = document.getElementById("userNameInput");
const personalitySelect = document.getElementById("personalitySelect");
const customInstructionsInput = document.getElementById("customInstructionsInput");
const saveProfileButton = document.getElementById("saveProfileButton");
const memoryInput = document.getElementById("memoryInput");
const addMemoryButton = document.getElementById("addMemoryButton");
const memoryList = document.getElementById("memoryList");
const memoryCount = document.getElementById("memoryCount");
const profileStatus = document.getElementById("profileStatus");
const personalityDescription = document.getElementById("personalityDescription");
const memorySuggestion = document.getElementById("memorySuggestion");
const memorySuggestionText = document.getElementById("memorySuggestionText");
const confirmMemoryButton = document.getElementById("confirmMemoryButton");
const dismissMemoryButton = document.getElementById("dismissMemoryButton");
const copyMigrationButton = document.getElementById("copyMigrationButton");
const showImportCodeButton = document.getElementById("showImportCodeButton");
const migrationImportBox = document.getElementById("migrationImportBox");
const migrationCodeInput = document.getElementById("migrationCodeInput");
const importMigrationButton = document.getElementById("importMigrationButton");
const exportBackupButton = document.getElementById("exportBackupButton");
const importBackupButton = document.getElementById("importBackupButton");
const toolsButton = document.getElementById("toolsButton");
const toolsPanel = document.getElementById("toolsPanel");
const toolsCloseButton = document.getElementById("toolsCloseButton");
const readFileButton = document.getElementById("readFileButton");
const readClipboardButton = document.getElementById("readClipboardButton");
const clipboardTextInput = document.getElementById("clipboardTextInput");
const writeClipboardButton = document.getElementById("writeClipboardButton");
const urlInput = document.getElementById("urlInput");
const openUrlButton = document.getElementById("openUrlButton");
const terminalCommandInput = document.getElementById("terminalCommandInput");
const runCommandButton = document.getElementById("runCommandButton");
const toolStatus = document.getElementById("toolStatus");
const toolLogList = document.getElementById("toolLogList");
const clearToolLogsButton = document.getElementById("clearToolLogsButton");
const permissionPanel = document.getElementById("permissionPanel");
const permissionBadge = document.getElementById("permissionBadge");
const permissionTitle = document.getElementById("permissionTitle");
const permissionDescription = document.getElementById("permissionDescription");
const permissionDetail = document.getElementById("permissionDetail");
const denyPermissionButton = document.getElementById("denyPermissionButton");
const allowPermissionButton = document.getElementById("allowPermissionButton");
const micButton = document.getElementById("micButton");
const chatHint = document.getElementById("chatHint");
const voiceModelLabel = document.getElementById("voiceModelLabel");
const voiceModelDetail = document.getElementById("voiceModelDetail");
const voiceProgressTrack = document.getElementById("voiceProgressTrack");
const voiceProgressBar = document.getElementById("voiceProgressBar");
const downloadVoiceModelButton = document.getElementById("downloadVoiceModelButton");
const deleteVoiceModelButton = document.getElementById("deleteVoiceModelButton");
const autoReadToggle = document.getElementById("autoReadToggle");
const systemVoiceSelect = document.getElementById("systemVoiceSelect");
const voiceRateRange = document.getElementById("voiceRateRange");
const voiceRateValue = document.getElementById("voiceRateValue");
const testVoiceButton = document.getElementById("testVoiceButton");
const ollamaSettings = document.getElementById("ollamaSettings");
const ollamaBaseUrlInput = document.getElementById("ollamaBaseUrlInput");
const refreshOllamaButton = document.getElementById("refreshOllamaButton");
const ollamaStatusRow = document.getElementById("ollamaStatusRow");
const ollamaStatus = document.getElementById("ollamaStatus");
const testOllamaButton = document.getElementById("testOllamaButton");
const activeModelBadge = document.getElementById("activeModelBadge");

const HISTORY_KEY = "kardii-chat-history-v1";
const RESPONSE_LENGTH_KEY = "kardii-response-length";
const PROFILE_KEY = "kardii-profile-v1";
const MEMORIES_KEY = "kardii-memories-v1";
const TOOL_LOGS_KEY = "kardii-tool-logs-v1";
const VOICE_SETTINGS_KEY = "kardii-voice-settings-v1";
const AI_SETTINGS_KEY = "kardii-ai-settings-v1";
const MAX_SAVED_MESSAGES = 50;
const PERSONALITIES = {
  healing: "耐心温暖，擅长安慰，也会温和地给出实用建议。",
  clingy: "喜欢陪着你，会撒娇和轻微吃醋，但不会影响正常回答。",
  sunshine: "充满活力，喜欢鼓励你立刻迈出简单的第一步。",
  tsundere: "嘴上轻微嫌弃、偶尔逗你，实际上非常关心你。",
  sarcastic: "会吐槽摸鱼和拖延，但不攻击外貌、身份或真实弱点。",
  butler: "冷静克制、简洁可靠，偶尔带一点不伤人的冷幽默。",
};
const AI_PROVIDERS = {
  deepseek: {
    name: "DeepSeek",
    description: "继续使用现有的 DeepSeek V4 Flash，速度快、价格较低，关闭思考模式。",
    models: [{ value: "deepseek-v4-flash", label: "DeepSeek V4 Flash · 非思考模式" }],
  },
  gemini: {
    name: "Gemini",
    description: "Google 云端模型。Flash-Lite 价格更低；Flash 更强，复杂问题表现更好。",
    models: [
      { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite · 低成本" },
      { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash · 更强" },
    ],
  },
  ollama: {
    name: "Ollama",
    description: "模型在这台电脑上运行，不按次数收费；速度取决于电脑配置和本机模型大小。",
    models: [],
  },
};
let conversation = loadConversation();
let sending = false;
let providerReady = false;
let clearConfirmationTimer;
let activeRequestId = null;
let profile = loadProfile();
let memories = loadMemories();
let suggestedMemory = null;
let toolLogs = loadToolLogs();
let pendingToolContext = null;
let permissionResolver = null;
let voiceModelState = "missing";
let voiceRecordingPhase = "idle";
let voicePollTimer = null;
let activeUtterance = null;
let systemVoices = [];
let voiceSettings = loadVoiceSettings();
let aiSettings = loadAiSettings();
let ollamaModels = [];

function loadAiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || "{}");
    return {
      provider: Object.hasOwn(AI_PROVIDERS, saved.provider) ? saved.provider : "deepseek",
      geminiModel: AI_PROVIDERS.gemini.models.some((item) => item.value === saved.geminiModel)
        ? saved.geminiModel
        : "gemini-3.1-flash-lite",
      ollamaBaseUrl: typeof saved.ollamaBaseUrl === "string" && saved.ollamaBaseUrl.trim()
        ? saved.ollamaBaseUrl.trim().slice(0, 200)
        : "http://127.0.0.1:11434",
      ollamaModel: typeof saved.ollamaModel === "string" ? saved.ollamaModel.slice(0, 120) : "",
    };
  } catch {
    return {
      provider: "deepseek",
      geminiModel: "gemini-3.1-flash-lite",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
    };
  }
}

function saveAiSettings() {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
}

function currentAiConfig() {
  const provider = aiSettings.provider;
  const model = provider === "deepseek"
    ? "deepseek-v4-flash"
    : provider === "gemini"
      ? aiSettings.geminiModel
      : aiSettings.ollamaModel;
  return {
    provider,
    model,
    ollamaBaseUrl: aiSettings.ollamaBaseUrl,
  };
}

function loadVoiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || "{}");
    return {
      autoRead: saved.autoRead === true,
      voiceUri: typeof saved.voiceUri === "string" ? saved.voiceUri : "",
      rate: Number.isFinite(Number(saved.rate)) ? Math.min(1.3, Math.max(0.7, Number(saved.rate))) : 1,
    };
  } catch {
    return { autoRead: false, voiceUri: "", rate: 1 };
  }
}

function saveVoiceSettings() {
  localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(voiceSettings));
}

function loadProfile() {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    return {
      userName: typeof value.userName === "string" ? value.userName.slice(0, 30) : "",
      personality: Object.hasOwn(PERSONALITIES, value.personality) ? value.personality : "healing",
      customInstructions: typeof value.customInstructions === "string" ? value.customInstructions.slice(0, 300) : "",
    };
  } catch {
    return { userName: "", personality: "healing", customInstructions: "" };
  }
}

function loadMemories() {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORIES_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 160)).slice(-20);
  } catch {
    return [];
  }
}

function currentProfile() {
  return { ...profile, memories };
}

function setProfileStatus(text, type = "") {
  profileStatus.textContent = text;
  profileStatus.className = `settings-status ${type}`.trim();
}

function loadToolLogs() {
  try {
    const value = JSON.parse(localStorage.getItem(TOOL_LOGS_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => typeof item?.action === "string" && typeof item?.time === "string")
      .slice(-30);
  } catch {
    return [];
  }
}

function renderToolLogs() {
  toolLogList.replaceChildren();
  if (toolLogs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tool-log-empty";
    empty.textContent = "还没有执行记录";
    toolLogList.appendChild(empty);
    return;
  }
  [...toolLogs].reverse().forEach((log) => {
    const item = document.createElement("div");
    item.className = `tool-log-item${log.success ? "" : " error"}`;
    const title = document.createElement("strong");
    title.textContent = `${log.success ? "✓" : "!"} ${log.action}`;
    const detail = document.createElement("span");
    detail.textContent = log.detail || "";
    const time = document.createElement("time");
    time.textContent = new Date(log.time).toLocaleString();
    item.append(title, detail, time);
    toolLogList.appendChild(item);
  });
}

function recordToolLog(action, detail, success = true) {
  toolLogs.push({
    action: String(action).slice(0, 60),
    detail: String(detail || "").replace(/\s+/g, " ").slice(0, 220),
    success,
    time: new Date().toISOString(),
  });
  toolLogs = toolLogs.slice(-30);
  localStorage.setItem(TOOL_LOGS_KEY, JSON.stringify(toolLogs));
  renderToolLogs();
}

function setToolStatus(text, type = "") {
  toolStatus.textContent = text;
  toolStatus.className = `settings-status ${type}`.trim();
}

function showTools() {
  renderToolLogs();
  toolsPanel.classList.remove("hidden");
}

function hideTools() {
  toolsPanel.classList.add("hidden");
  input.focus();
}

function finishPermission(allowed) {
  if (!permissionResolver) return;
  const resolve = permissionResolver;
  permissionResolver = null;
  permissionPanel.classList.add("hidden");
  resolve(allowed);
}

function requestToolPermission({ title, description, detail, danger = false }) {
  if (permissionResolver) finishPermission(false);
  permissionTitle.textContent = title;
  permissionDescription.textContent = description;
  permissionDetail.textContent = detail;
  permissionBadge.textContent = danger ? "高权限操作 · 请仔细检查" : "需要你的允许";
  permissionBadge.classList.toggle("danger", danger);
  allowPermissionButton.classList.toggle("terminal-button", danger);
  permissionPanel.classList.remove("hidden");
  return new Promise((resolve) => {
    permissionResolver = resolve;
  });
}

function setPendingToolContext(label, content) {
  const clean = String(content || "");
  const clipped = clean.length > 12_000
    ? `${clean.slice(0, 12_000)}\n…（传给 AI 的内容已截断）`
    : clean;
  pendingToolContext = { label, content: clipped };
  setToolStatus(`${label}已准备好。关闭工具面板后直接提问，内容才会发送给当前选择的 AI。`, "success");
}

function addToolNotice(text) {
  addMessage(text, "kardii");
}

function messagesWithToolContext() {
  const recent = conversation.slice(-12).map((message) => ({ ...message }));
  if (!pendingToolContext || recent.length === 0) return recent;
  const lastIndex = recent.length - 1;
  if (recent[lastIndex].role !== "user") return recent;
  recent[lastIndex].content = [
    `[用户明确授权的本地工具资料：${pendingToolContext.label}]`,
    pendingToolContext.content,
    "",
    `[用户当前问题] ${recent[lastIndex].content}`,
  ].join("\n");
  return recent;
}

function renderMemories() {
  memoryList.replaceChildren();
  memoryCount.textContent = `${memories.length}/20`;
  if (memories.length === 0) {
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = "还没有长期记忆";
    memoryList.appendChild(empty);
    return;
  }
  memories.forEach((memory, index) => {
    const item = document.createElement("div");
    item.className = "memory-item";
    const text = document.createElement("span");
    text.textContent = memory;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      memories.splice(index, 1);
      saveMemories();
      renderMemories();
      setProfileStatus("这条记忆已删除。", "success");
    });
    item.append(text, remove);
    memoryList.appendChild(item);
  });
}

function saveMemories() {
  localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

function encodeMigrationCode(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `KARDII-V05:${btoa(binary)}`;
}

function decodeMigrationCode(code) {
  const clean = code.trim();
  const prefix = clean.startsWith("KARDII-V05:")
    ? "KARDII-V05:"
    : clean.startsWith("KARDII-V04:") ? "KARDII-V04:" : null;
  if (!prefix) throw new Error("这不是有效的 Kardii 迁移码。");
  const binary = atob(clean.slice(prefix.length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function normalizeImportedProfile(value) {
  return {
    userName: typeof value?.userName === "string" ? value.userName.trim().slice(0, 30) : "",
    personality: Object.hasOwn(PERSONALITIES, value?.personality) ? value.personality : "healing",
    customInstructions: typeof value?.customInstructions === "string" ? value.customInstructions.trim().slice(0, 300) : "",
  };
}

function normalizeImportedMemories(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 160)).slice(-20);
}

function applyImportedPersonalization(data) {
  profile = normalizeImportedProfile(data?.profile);
  memories = normalizeImportedMemories(data?.memories);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  saveMemories();
  userNameInput.value = profile.userName;
  personalitySelect.value = profile.personality;
  customInstructionsInput.value = profile.customInstructions;
  personalityDescription.textContent = PERSONALITIES[profile.personality];
  renderMemories();
}

function createFullBackup() {
  return {
    format: "kardii-backup",
    version: 1,
    appVersion: "0.7.0",
    createdAt: new Date().toISOString(),
    profile,
    memories,
    conversation,
    responseLength: responseLengthSelect.value,
    aiSettings,
  };
}

function applyFullBackup(data) {
  if (data?.format !== "kardii-backup" || data?.version !== 1) {
    throw new Error("无法识别这个备份文件。请选择 Kardii 导出的 JSON 文件。");
  }
  applyImportedPersonalization(data);
  conversation = Array.isArray(data.conversation)
    ? data.conversation
      .filter((message) => ["user", "assistant"].includes(message?.role) && typeof message?.content === "string" && message.content.trim())
      .map((message) => ({ role: message.role, content: message.content.slice(0, 8000) }))
      .slice(-MAX_SAVED_MESSAGES)
    : [];
  saveConversation();
  const responseLength = ["250", "500", "900"].includes(String(data.responseLength)) ? String(data.responseLength) : "500";
  responseLengthSelect.value = responseLength;
  localStorage.setItem(RESPONSE_LENGTH_KEY, responseLength);
  if (data.aiSettings && Object.hasOwn(AI_PROVIDERS, data.aiSettings.provider)) {
    const imported = data.aiSettings;
    aiSettings.provider = imported.provider;
    if (AI_PROVIDERS.gemini.models.some((item) => item.value === imported.geminiModel)) {
      aiSettings.geminiModel = imported.geminiModel;
    }
    if (typeof imported.ollamaBaseUrl === "string" && imported.ollamaBaseUrl.trim()) {
      aiSettings.ollamaBaseUrl = imported.ollamaBaseUrl.trim().slice(0, 200);
    }
    if (typeof imported.ollamaModel === "string") {
      aiSettings.ollamaModel = imported.ollamaModel.slice(0, 120);
    }
    saveAiSettings();
    renderProviderSettings();
    void refreshProviderState();
  }
  renderConversation();
}

function addLocalExchange(userText, replyText) {
  addMessage(userText, "user");
  addMessage(replyText, "kardii");
  conversation.push({ role: "user", content: userText });
  conversation.push({ role: "assistant", content: replyText });
  saveConversation();
  updateReplyActions();
}

function handleMemoryCommand(text) {
  const rememberMatch = text.match(/^记住\s*[：:]\s*(.+)$/s);
  if (rememberMatch) {
    const memory = rememberMatch[1].trim().slice(0, 160);
    if (!memory) return false;
    if (memories.includes(memory)) {
      addLocalExchange(text, `这件事我已经记住啦：${memory}`);
      return true;
    }
    if (memories.length >= 20) {
      addLocalExchange(text, "长期记忆已经有 20 条啦。请点击爱心打开记忆列表，删除一条不需要的记忆后再试。");
      return true;
    }
    memories.push(memory);
    saveMemories();
    addLocalExchange(text, `好，我记住了：${memory}`);
    return true;
  }

  if (/^查看(?:长期)?记忆[。！!？?\s]*$/.test(text)) {
    const reply = memories.length
      ? `我目前记得这些：\n${memories.map((memory, index) => `${index + 1}. ${memory}`).join("\n")}`
      : "我还没有保存长期记忆。你可以输入“记住：……”告诉我。";
    addLocalExchange(text, reply);
    return true;
  }

  const forgetMatch = text.match(/^忘记\s*[：:]\s*(.+)$/s);
  if (forgetMatch) {
    const rawKeyword = forgetMatch[1].trim();
    if (!rawKeyword) return false;
    const keyword = rawKeyword.toLowerCase();
    const matches = memories
      .map((memory, index) => ({ memory, index }))
      .filter(({ memory }) => memory.toLowerCase().includes(keyword));

    if (matches.length === 1) {
      const [match] = matches;
      memories.splice(match.index, 1);
      saveMemories();
      addLocalExchange(text, `好，我已经忘记了：${match.memory}`);
    } else if (matches.length > 1) {
      addLocalExchange(text, `找到了 ${matches.length} 条相关记忆。为了避免删错，请点击爱心，在记忆列表里选择要删除的那一条。`);
    } else {
      addLocalExchange(text, `没有找到包含“${rawKeyword}”的记忆。`);
    }
    return true;
  }

  return false;
}

function hideMemorySuggestion() {
  suggestedMemory = null;
  memorySuggestion.classList.add("hidden");
}

function maybeSuggestMemory(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length < 4 || clean.length > 160 || memories.includes(clean)) {
    hideMemorySuggestion();
    return;
  }
  const looksMemorable = /(?:我(?:很|最|特别)?(?:喜欢|不喜欢|讨厌|爱吃|不吃|习惯|希望|叫|是|来自|住在|生日|过敏|不能)|以后(?:叫我|提醒我)|请叫我)/.test(clean);
  if (!looksMemorable) {
    hideMemorySuggestion();
    return;
  }
  suggestedMemory = clean;
  memorySuggestionText.textContent = `要让 Kardii 记住“${clean}”吗？`;
  memorySuggestion.classList.remove("hidden");
}

function showProfile() {
  userNameInput.value = profile.userName;
  personalitySelect.value = profile.personality;
  customInstructionsInput.value = profile.customInstructions;
  personalityDescription.textContent = PERSONALITIES[personalitySelect.value];
  renderMemories();
  profilePanel.classList.remove("hidden");
}

personalitySelect.addEventListener("change", () => {
  personalityDescription.textContent = PERSONALITIES[personalitySelect.value];
  profile.personality = personalitySelect.value;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  setProfileStatus("性格已自动保存，下一次回答立即生效。", "success");
});

function hideProfile() {
  profilePanel.classList.add("hidden");
  input.focus();
}

function loadConversation() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((message) =>
        ["user", "assistant"].includes(message?.role)
        && typeof message?.content === "string"
        && message.content.trim(),
      )
      .slice(-MAX_SAVED_MESSAGES);
  } catch {
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }
}

function saveConversation() {
  conversation = conversation.slice(-MAX_SAVED_MESSAGES);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(conversation));
}

function latestAssistantMessage() {
  return [...conversation].reverse().find((message) => message.role === "assistant") || null;
}

function updateReplyActions() {
  replyActions.classList.toggle("hidden", sending || !latestAssistantMessage());
}

function addMessage(text, sender) {
  const bubble = document.createElement("div");
  bubble.className = `message ${sender}`;
  bubble.textContent = text;
  messagesElement.appendChild(bubble);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return bubble;
}

function renderConversation() {
  messagesElement.replaceChildren();
  if (conversation.length === 0) {
    addMessage("嗨！今天需要我帮你做什么？", "kardii");
    updateReplyActions();
    return;
  }
  conversation.forEach((message) => {
    addMessage(message.content, message.role === "assistant" ? "kardii" : "user");
  });
  updateReplyActions();
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 72)}px`;
}

function setSettingsStatus(text, type = "") {
  settingsStatus.textContent = text;
  settingsStatus.className = `settings-status ${type}`.trim();
}

function showSettings() {
  settingsPanel.classList.remove("hidden");
  void refreshVoiceModelStatus();
  setTimeout(() => {
    if (aiSettings.provider === "ollama") ollamaBaseUrlInput.focus();
    else apiKeyInput.focus();
  }, 0);
}

function hideSettings() {
  settingsPanel.classList.add("hidden");
  input.focus();
}

function setSettingsBusy(busy) {
  [saveKeyButton, testKeyButton, deleteKeyButton, refreshOllamaButton, testOllamaButton].forEach((button) => {
    button.disabled = busy;
  });
}

function setOllamaStatus(text, type = "") {
  ollamaStatus.textContent = text;
  ollamaStatus.className = `settings-status ${type}`.trim();
}

function updateActiveModelBadge() {
  const { provider, model } = currentAiConfig();
  if (provider === "deepseek") activeModelBadge.textContent = "DeepSeek · V4 Flash";
  else if (provider === "gemini") activeModelBadge.textContent = model.includes("lite") ? "Gemini · Flash-Lite" : "Gemini · Flash";
  else activeModelBadge.textContent = model ? `Ollama · ${model}` : "Ollama · 未选模型";
  activeModelBadge.title = `${AI_PROVIDERS[provider].name} · ${model || "未选择模型"}`;
}

function populateAiModels() {
  const provider = aiSettings.provider;
  const models = provider === "ollama"
    ? ollamaModels.map((name) => ({ value: name, label: name }))
    : AI_PROVIDERS[provider].models;
  aiModelSelect.replaceChildren();
  if (models.length === 0) {
    aiModelSelect.add(new Option("没有发现本机模型，请点击刷新", ""));
    aiModelSelect.disabled = true;
  } else {
    models.forEach((item) => aiModelSelect.add(new Option(item.label, item.value)));
    aiModelSelect.disabled = false;
  }

  const preferred = provider === "deepseek"
    ? "deepseek-v4-flash"
    : provider === "gemini"
      ? aiSettings.geminiModel
      : aiSettings.ollamaModel;
  aiModelSelect.value = models.some((item) => item.value === preferred)
    ? preferred
    : models[0]?.value || "";
  if (provider === "ollama" && aiModelSelect.value !== aiSettings.ollamaModel) {
    aiSettings.ollamaModel = aiModelSelect.value;
    saveAiSettings();
  }
  updateActiveModelBadge();
}

function renderProviderSettings() {
  const provider = aiSettings.provider;
  providerSelect.value = provider;
  providerDescription.textContent = AI_PROVIDERS[provider].description;
  ollamaSettings.classList.toggle("hidden", provider !== "ollama");
  ollamaStatusRow.classList.toggle("hidden", provider !== "ollama");
  apiKeySection.classList.toggle("hidden", provider === "ollama");
  ollamaBaseUrlInput.value = aiSettings.ollamaBaseUrl;
  if (provider !== "ollama") {
    const label = AI_PROVIDERS[provider].name;
    apiKeyLabel.textContent = `${label} API Key`;
    apiKeyInput.placeholder = `粘贴 ${label} API Key`;
    apiKeyInput.value = "";
  }
  populateAiModels();
}

async function refreshOllamaModels(showSuccess = true) {
  setSettingsBusy(true);
  setOllamaStatus("正在连接本机 Ollama……");
  try {
    const models = await invoke("list_ollama_models", {
      ollamaBaseUrl: aiSettings.ollamaBaseUrl,
    });
    ollamaModels = Array.isArray(models) ? models : [];
    populateAiModels();
    providerReady = ollamaModels.length > 0;
    if (providerReady) {
      setOllamaStatus(`已连接，找到 ${ollamaModels.length} 个本机模型。`, "success");
    } else {
      setOllamaStatus("Ollama 已连接，但还没有下载任何模型。", "error");
    }
    if (showSuccess) updateActiveModelBadge();
  } catch (error) {
    ollamaModels = [];
    providerReady = false;
    populateAiModels();
    setOllamaStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
}

async function refreshProviderState(showPanelIfMissing = false) {
  const provider = aiSettings.provider;
  if (provider === "ollama") {
    await refreshOllamaModels(false);
    if (!providerReady && showPanelIfMissing) showSettings();
    return;
  }
  providerReady = await invoke("has_provider_key", { provider });
  const label = AI_PROVIDERS[provider].name;
  if (providerReady) {
    setSettingsStatus(`${label} API Key 已安全保存。`, "success");
  } else {
    setSettingsStatus(`请粘贴并保存 ${label} API Key。`, "error");
    if (showPanelIfMissing) showSettings();
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function setVoiceModelUi(status) {
  voiceModelState = status.state;
  const downloaded = Number(status.downloadedBytes || 0);
  const total = Number(status.totalBytes || 0);
  const percent = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
  downloadVoiceModelButton.disabled = status.state === "downloading" || status.state === "loading";
  deleteVoiceModelButton.disabled = status.state === "downloading" || status.state === "loading";
  deleteVoiceModelButton.classList.toggle("hidden", !status.installed);
  voiceProgressTrack.classList.toggle("hidden", status.state !== "downloading");
  voiceProgressBar.style.width = `${percent}%`;

  if (status.state === "ready") {
    voiceModelLabel.textContent = "离线语音已准备好";
    voiceModelDetail.textContent = "支持普通话、粤语、英语、日语和韩语 · 录音不上传";
    downloadVoiceModelButton.classList.add("hidden");
  } else if (status.state === "downloading") {
    voiceModelLabel.textContent = `正在下载 ${percent ? `${percent.toFixed(0)}%` : ""}`.trim();
    voiceModelDetail.textContent = total
      ? `${formatBytes(downloaded)} / ${formatBytes(total)} · 请不要退出 Kardii`
      : `${formatBytes(downloaded)} · 请不要退出 Kardii`;
    downloadVoiceModelButton.classList.remove("hidden");
    downloadVoiceModelButton.textContent = "正在下载……";
  } else if (status.state === "loading") {
    voiceModelLabel.textContent = "正在加载离线语音";
    voiceModelDetail.textContent = "通常只需要几秒钟";
    downloadVoiceModelButton.classList.add("hidden");
  } else if (status.state === "error") {
    voiceModelLabel.textContent = "语音模型没有准备好";
    voiceModelDetail.textContent = status.error || "请重新下载模型";
    downloadVoiceModelButton.classList.remove("hidden");
    downloadVoiceModelButton.textContent = "重新下载";
  } else {
    voiceModelLabel.textContent = "尚未下载离线语音模型";
    voiceModelDetail.textContent = "下载一次后，语音转文字可以完全离线使用";
    downloadVoiceModelButton.classList.remove("hidden");
    downloadVoiceModelButton.textContent = "下载离线模型";
  }
}

async function refreshVoiceModelStatus() {
  try {
    const status = await invoke("get_voice_model_status");
    setVoiceModelUi(status);
    if (["loading", "downloading"].includes(status.state)) {
      setTimeout(refreshVoiceModelStatus, 700);
    }
  } catch (error) {
    setVoiceModelUi({ state: "error", error: String(error), installed: false });
  }
}

function setMicPhase(phase, elapsed = 0) {
  voiceRecordingPhase = phase;
  micButton.classList.toggle("recording", phase === "recording");
  micButton.classList.toggle("transcribing", phase === "transcribing");
  micButton.disabled = sending || phase === "transcribing";
  if (phase === "recording") {
    micButton.textContent = "■";
    micButton.setAttribute("aria-label", "停止录音");
    chatHint.textContent = `正在录音 ${Math.floor(elapsed)} 秒 · 再点一次停止 · 最长 60 秒`;
  } else if (phase === "transcribing") {
    micButton.textContent = "…";
    micButton.setAttribute("aria-label", "正在离线识别");
    chatHint.textContent = "正在本机识别，不会上传录音……";
  } else {
    micButton.textContent = "🎙";
    micButton.setAttribute("aria-label", "开始语音输入");
    chatHint.textContent = "Enter 发送 · Shift + Enter 换行 · Esc 收起";
  }
}

function stopVoicePolling() {
  clearInterval(voicePollTimer);
  voicePollTimer = null;
}

function cleanTranscript(text) {
  return String(text || "")
    .replace(/<\|[^|]+\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function pollVoiceRecording() {
  try {
    const state = await invoke("get_voice_recording_state");
    if (state.phase === "recording") {
      setMicPhase("recording", state.elapsedSecs);
      return;
    }
    if (state.phase === "transcribing") {
      setMicPhase("transcribing");
      return;
    }
    stopVoicePolling();
    setMicPhase("idle");
    if (state.phase === "done") {
      const text = cleanTranscript(state.text);
      if (text) {
        input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text;
        resizeInput();
        chatHint.textContent = "识别完成，请检查文字后再发送";
        setTimeout(() => {
          if (voiceRecordingPhase === "idle") chatHint.textContent = "Enter 发送 · Shift + Enter 换行 · Esc 收起";
        }, 2800);
      }
      await invoke("clear_voice_recording_result");
      input.focus();
    } else if (state.phase === "error") {
      chatHint.textContent = state.error || "语音识别失败，请重试";
      await emitTo("main", "kardii-state", "error");
      await invoke("clear_voice_recording_result");
    }
  } catch (error) {
    stopVoicePolling();
    setMicPhase("idle");
    chatHint.textContent = String(error);
  }
}

async function toggleVoiceRecording() {
  if (voiceRecordingPhase === "recording") {
    try {
      await invoke("stop_voice_recording");
      setMicPhase("transcribing");
    } catch (error) {
      chatHint.textContent = String(error);
    }
    return;
  }
  if (voiceRecordingPhase === "transcribing" || sending) return;
  if (voiceModelState !== "ready") {
    showSettings();
    await refreshVoiceModelStatus();
    voiceModelDetail.textContent = "请先点击“下载离线模型”，下载完成后再使用麦克风。";
    return;
  }
  stopSpeaking();
  try {
    await invoke("start_voice_recording");
    setMicPhase("recording", 0);
    stopVoicePolling();
    voicePollTimer = setInterval(pollVoiceRecording, 220);
  } catch (error) {
    setMicPhase("idle");
    chatHint.textContent = String(error);
  }
}

function loadSystemVoices() {
  if (!("speechSynthesis" in window)) {
    systemVoiceSelect.disabled = true;
    autoReadToggle.disabled = true;
    testVoiceButton.disabled = true;
    testVoiceButton.textContent = "当前系统不支持朗读";
    return;
  }
  systemVoices = window.speechSynthesis.getVoices();
  const previous = voiceSettings.voiceUri;
  systemVoiceSelect.replaceChildren(new Option("系统默认声音", ""));
  [...systemVoices]
    .sort((a, b) => {
      const aChinese = /^zh/i.test(a.lang) ? 0 : 1;
      const bChinese = /^zh/i.test(b.lang) ? 0 : 1;
      return aChinese - bChinese || a.name.localeCompare(b.name);
    })
    .forEach((voice) => {
      systemVoiceSelect.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI));
    });
  systemVoiceSelect.value = systemVoices.some((voice) => voice.voiceURI === previous) ? previous : "";
}

function speechText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "代码内容")
    .replace(/[*_#>`~\[\]()]/g, "")
    .replace(/https?:\/\/\S+/g, "链接")
    .trim();
}

function stopSpeaking() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
  readReplyButton.textContent = "朗读回答";
}

function speakText(text, force = false) {
  if (!("speechSynthesis" in window) || (!force && !voiceSettings.autoRead)) return false;
  const clean = speechText(text);
  if (!clean) return false;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(clean);
  const voice = systemVoices.find((item) => item.voiceURI === voiceSettings.voiceUri);
  if (voice) utterance.voice = voice;
  utterance.rate = voiceSettings.rate;
  utterance.onstart = async () => {
    activeUtterance = utterance;
    readReplyButton.textContent = "停止朗读";
    await emitTo("main", "kardii-state", "talking");
  };
  utterance.onend = async () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    readReplyButton.textContent = "朗读回答";
    await emitTo("main", "kardii-state", "happy");
  };
  utterance.onerror = async () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    readReplyButton.textContent = "朗读回答";
    await emitTo("main", "kardii-state", "idle");
  };
  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  return true;
}

async function closeChat() {
  if (voiceRecordingPhase === "recording") {
    await invoke("stop_voice_recording").catch(() => {});
  }
  await chatWindow.hide();
}

function setSending(nextSending) {
  sending = nextSending;
  input.disabled = nextSending;
  sendButton.classList.toggle("hidden", nextSending);
  stopButton.classList.toggle("hidden", !nextSending);
  stopButton.disabled = false;
  micButton.disabled = nextSending || voiceRecordingPhase === "transcribing";
  updateReplyActions();
}

async function requestReply() {
  stopSpeaking();
  setSending(true);
  await emitTo("main", "kardii-state", "thinking");
  const usingToolContext = Boolean(pendingToolContext);

  const replyBubble = addMessage("", "kardii");
  activeRequestId = crypto.randomUUID();
  let replyText = "";
  let receivedText = false;
  let stopped = false;
  const channel = new Channel();

  channel.onmessage = async (event) => {
    if (event.event === "delta" && event.data) {
      replyText += event.data;
      replyBubble.textContent = replyText;
      messagesElement.scrollTop = messagesElement.scrollHeight;
      if (!receivedText) {
        receivedText = true;
        await emitTo("main", "kardii-state", "talking");
      }
    }
    if (event.event === "stopped") {
      stopped = true;
    }
  };

  try {
    const ai = currentAiConfig();
    await invoke("stream_ai_message", {
      messages: messagesWithToolContext(),
      profile: currentProfile(),
      provider: ai.provider,
      model: ai.model,
      ollamaBaseUrl: ai.ollamaBaseUrl,
      requestId: activeRequestId,
      maxTokens: Number(responseLengthSelect.value),
      onEvent: channel,
    });
    if (replyText.trim()) {
      conversation.push({ role: "assistant", content: replyText.trim() });
      saveConversation();
      if (usingToolContext) {
        pendingToolContext = null;
        setToolStatus("工具资料已用于本次回答，不会在下一次提问中重复发送。", "success");
      }
    } else {
      replyBubble.textContent = stopped ? "已停止回答。" : "这次没有收到回复，请重试。";
    }
    const shouldCelebrate = replyText.trim() && !stopped;
    if (!shouldCelebrate || !speakText(replyText)) {
      await emitTo("main", "kardii-state", shouldCelebrate ? "happy" : "idle");
    }
  } catch (error) {
    replyBubble.textContent = String(error);
    await emitTo("main", "kardii-state", "error");
  } finally {
    activeRequestId = null;
    setSending(false);
    input.focus();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || sending) return;
  if (handleMemoryCommand(text)) {
    input.value = "";
    resizeInput();
    return;
  }
  if (!providerReady) {
    showSettings();
    if (aiSettings.provider === "ollama") {
      setOllamaStatus("请先启动 Ollama、下载模型并刷新列表。", "error");
    } else {
      setSettingsStatus(`请先设置 ${AI_PROVIDERS[aiSettings.provider].name} API Key。`, "error");
    }
    return;
  }

  addMessage(text, "user");
  conversation.push({ role: "user", content: text });
  saveConversation();
  maybeSuggestMemory(text);
  input.value = "";
  resizeInput();
  await requestReply();
});

stopButton.addEventListener("click", async () => {
  if (!activeRequestId) return;
  stopButton.disabled = true;
  await invoke("stop_ai_message", { requestId: activeRequestId });
});

denyPermissionButton.addEventListener("click", () => finishPermission(false));
allowPermissionButton.addEventListener("click", () => finishPermission(true));

readFileButton.addEventListener("click", async () => {
  const allowed = await requestToolPermission({
    title: "允许读取一个文本文件？",
    description: "接下来会打开系统文件选择器，Kardii 只能读取你亲自选中的一个文件。内容仅在你下一次提问时发送给当前选择的 AI。",
    detail: "允许范围：一个 UTF-8 文本或代码文件\n大小上限：256 KB\n不会修改、移动或删除文件",
  });
  if (!allowed) return;
  readFileButton.disabled = true;
  try {
    const result = await invoke("read_text_file");
    if (!result) {
      setToolStatus("你取消了文件选择。", "");
      return;
    }
    setPendingToolContext(`文件 ${result.name}`, result.content);
    addToolNotice(`已经读取“${result.name}”。现在直接问我“总结这个文件”或其他问题就可以。`);
    recordToolLog("读取文本文件", result.path, true);
  } catch (error) {
    setToolStatus(String(error), "error");
    recordToolLog("读取文本文件", String(error), false);
  } finally {
    readFileButton.disabled = false;
  }
});

readClipboardButton.addEventListener("click", async () => {
  const allowed = await requestToolPermission({
    title: "允许读取剪贴板文字？",
    description: "Kardii 会读取你当前复制的文字。内容仅在你下一次提问时发送给当前选择的 AI。",
    detail: "只读取文字，不读取图片或文件\n不会持续监控剪贴板\n每次读取都必须重新允许",
  });
  if (!allowed) return;
  readClipboardButton.disabled = true;
  try {
    const text = await invoke("read_clipboard_text");
    setPendingToolContext("剪贴板文字", text);
    addToolNotice("已经读取剪贴板文字。现在可以问我总结、翻译或改写。 ");
    recordToolLog("读取剪贴板", `${text.length} 个字符`, true);
  } catch (error) {
    setToolStatus(String(error), "error");
    recordToolLog("读取剪贴板", String(error), false);
  } finally {
    readClipboardButton.disabled = false;
  }
});

writeClipboardButton.addEventListener("click", async () => {
  const text = clipboardTextInput.value.trim();
  if (!text) {
    setToolStatus("请先输入要复制的文字。", "error");
    return;
  }
  const allowed = await requestToolPermission({
    title: "允许改写系统剪贴板？",
    description: "确认后，当前剪贴板内容会被下面的文字替换。这个操作不会把文字发送给任何 AI。",
    detail: text.slice(0, 800),
  });
  if (!allowed) return;
  writeClipboardButton.disabled = true;
  try {
    await invoke("write_clipboard_text", { text });
    clipboardTextInput.value = "";
    setToolStatus("文字已复制到剪贴板。", "success");
    recordToolLog("写入剪贴板", `${text.length} 个字符`, true);
  } catch (error) {
    setToolStatus(String(error), "error");
    recordToolLog("写入剪贴板", String(error), false);
  } finally {
    writeClipboardButton.disabled = false;
  }
});

openUrlButton.addEventListener("click", async () => {
  const value = urlInput.value.trim();
  let url;
  try {
    url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    setToolStatus("请输入以 http:// 或 https:// 开头的完整网址。", "error");
    return;
  }
  const allowed = await requestToolPermission({
    title: "允许打开这个网页？",
    description: "Kardii 会调用系统默认浏览器。网页不会在桌宠内部静默打开。",
    detail: url.href,
  });
  if (!allowed) return;
  openUrlButton.disabled = true;
  try {
    await invoke("open_external_url", { url: url.href });
    setToolStatus("网页已交给默认浏览器打开。", "success");
    recordToolLog("打开网页", url.href, true);
  } catch (error) {
    setToolStatus(String(error), "error");
    recordToolLog("打开网页", String(error), false);
  } finally {
    openUrlButton.disabled = false;
  }
});

runCommandButton.addEventListener("click", async () => {
  const command = terminalCommandInput.value.trim();
  if (!command) {
    setToolStatus("请先输入要运行的命令。", "error");
    return;
  }
  const allowed = await requestToolPermission({
    title: "确认运行这条终端命令？",
    description: "终端命令可能读取或修改电脑内容。请逐字检查，只允许你完全理解并信任的命令。Kardii 不会替 AI 自动点击允许。",
    detail: command,
    danger: true,
  });
  if (!allowed) return;
  runCommandButton.disabled = true;
  setToolStatus("命令正在运行，最长等待 20 秒……");
  try {
    const result = await invoke("run_terminal_command", { command });
    const output = [
      `命令：${result.command}`,
      `退出码：${result.exitCode}`,
      result.stdout ? `标准输出：\n${result.stdout}` : "",
      result.stderr ? `错误输出：\n${result.stderr}` : "",
    ].filter(Boolean).join("\n\n");
    setPendingToolContext("终端运行结果", output || "命令已结束，没有输出。");
    addToolNotice(result.success
      ? "命令运行完成。你可以继续问我解释运行结果。"
      : `命令已结束，退出码是 ${result.exitCode}。你可以让我分析报错。`);
    setToolStatus(result.success ? "命令运行成功，结果已准备好。" : "命令运行结束，但返回了错误。", result.success ? "success" : "error");
    recordToolLog("运行终端命令", command, result.success);
  } catch (error) {
    setToolStatus(String(error), "error");
    recordToolLog("运行终端命令", `${command} · ${String(error)}`, false);
  } finally {
    runCommandButton.disabled = false;
  }
});

clearToolLogsButton.addEventListener("click", () => {
  toolLogs = [];
  localStorage.removeItem(TOOL_LOGS_KEY);
  renderToolLogs();
  setToolStatus("本机工具记录已清空。", "success");
});

confirmMemoryButton.addEventListener("click", () => {
  if (!suggestedMemory) return;
  if (memories.length >= 20) {
    memorySuggestionText.textContent = "长期记忆已满，请先在爱心设置中删除一条。";
    return;
  }
  if (!memories.includes(suggestedMemory)) {
    memories.push(suggestedMemory);
    saveMemories();
  }
  memorySuggestionText.textContent = "记住啦！";
  suggestedMemory = null;
  setTimeout(() => memorySuggestion.classList.add("hidden"), 900);
});

dismissMemoryButton.addEventListener("click", hideMemorySuggestion);

copyMigrationButton.addEventListener("click", async () => {
  const code = encodeMigrationCode({ version: 1, profile, memories });
  await copyText(code);
  setProfileStatus("迁移码已复制，可以粘贴到另一台电脑。", "success");
});

showImportCodeButton.addEventListener("click", () => {
  migrationImportBox.classList.toggle("hidden");
  if (!migrationImportBox.classList.contains("hidden")) migrationCodeInput.focus();
});

importMigrationButton.addEventListener("click", () => {
  try {
    const data = decodeMigrationCode(migrationCodeInput.value);
    applyImportedPersonalization(data);
    migrationCodeInput.value = "";
    migrationImportBox.classList.add("hidden");
    setProfileStatus("个性和长期记忆导入成功。", "success");
  } catch (error) {
    setProfileStatus(String(error), "error");
  }
});

exportBackupButton.addEventListener("click", async () => {
  try {
    const path = await invoke("export_backup_file", {
      contents: JSON.stringify(createFullBackup(), null, 2),
    });
    if (path) setProfileStatus("完整备份已保存。", "success");
  } catch (error) {
    setProfileStatus(String(error), "error");
  }
});

importBackupButton.addEventListener("click", async () => {
  try {
    const contents = await invoke("import_backup_file");
    if (!contents) return;
    const data = JSON.parse(contents);
    if (!window.confirm("导入会替换当前个性、记忆和聊天记录，是否继续？")) return;
    applyFullBackup(data);
    setProfileStatus("完整备份导入成功。API Key 未被修改。", "success");
  } catch (error) {
    setProfileStatus(`导入失败：${String(error)}`, "error");
  }
});

copyReplyButton.addEventListener("click", async () => {
  const reply = latestAssistantMessage();
  if (!reply) return;
  await copyText(reply.content);
  copyReplyButton.textContent = "已复制";
  setTimeout(() => { copyReplyButton.textContent = "复制回答"; }, 1200);
});

readReplyButton.addEventListener("click", () => {
  if (activeUtterance) {
    stopSpeaking();
    void emitTo("main", "kardii-state", "idle");
    return;
  }
  const reply = latestAssistantMessage();
  if (reply) speakText(reply.content, true);
});

regenerateButton.addEventListener("click", async () => {
  if (sending || !providerReady) return;
  const lastIndex = conversation.length - 1;
  if (lastIndex < 1 || conversation[lastIndex].role !== "assistant") return;
  conversation.splice(lastIndex, 1);
  saveConversation();
  renderConversation();
  await requestReply();
});

saveProfileButton.addEventListener("click", () => {
  profile = {
    userName: userNameInput.value.trim().slice(0, 30),
    personality: personalitySelect.value,
    customInstructions: customInstructionsInput.value.trim().slice(0, 300),
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  setProfileStatus("个性设置已保存，下一次回答开始生效。", "success");
});

addMemoryButton.addEventListener("click", () => {
  const memory = memoryInput.value.trim();
  if (!memory) {
    setProfileStatus("请先输入需要记住的事情。", "error");
    return;
  }
  if (memories.length >= 20) {
    setProfileStatus("最多保存 20 条，请先删除不需要的记忆。", "error");
    return;
  }
  memories.push(memory.slice(0, 160));
  saveMemories();
  memoryInput.value = "";
  renderMemories();
  setProfileStatus("Kardii 已经记住了。", "success");
});

memoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addMemoryButton.click();
  }
});

saveKeyButton.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setSettingsStatus("请先粘贴 API Key。", "error");
    return;
  }
  setSettingsBusy(true);
  try {
    await invoke("save_provider_key", { provider: aiSettings.provider, apiKey });
    apiKeyInput.value = "";
    providerReady = true;
    setSettingsStatus(`${AI_PROVIDERS[aiSettings.provider].name} Key 已保存，可以点击“测试连接”。`, "success");
  } catch (error) {
    setSettingsStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

testKeyButton.addEventListener("click", async () => {
  if (!providerReady) {
    setSettingsStatus("请先保存 API Key。", "error");
    return;
  }
  setSettingsBusy(true);
  const ai = currentAiConfig();
  setSettingsStatus(`正在连接 ${AI_PROVIDERS[ai.provider].name}……`);
  try {
    await invoke("test_ai_connection", {
      provider: ai.provider,
      model: ai.model,
      ollamaBaseUrl: ai.ollamaBaseUrl,
    });
    setSettingsStatus(`${AI_PROVIDERS[ai.provider].name} 连接成功！`, "success");
  } catch (error) {
    setSettingsStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

deleteKeyButton.addEventListener("click", async () => {
  setSettingsBusy(true);
  try {
    await invoke("delete_provider_key", { provider: aiSettings.provider });
    providerReady = false;
    setSettingsStatus(`${AI_PROVIDERS[aiSettings.provider].name} API Key 已从电脑中删除。`, "success");
  } catch (error) {
    setSettingsStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

providerSelect.addEventListener("change", async () => {
  if (sending) {
    providerSelect.value = aiSettings.provider;
    setSettingsStatus("请等当前回答结束后再切换 AI。", "error");
    return;
  }
  stopSpeaking();
  aiSettings.provider = providerSelect.value;
  saveAiSettings();
  providerReady = false;
  renderProviderSettings();
  await refreshProviderState();
});

aiModelSelect.addEventListener("change", () => {
  if (aiSettings.provider === "gemini") aiSettings.geminiModel = aiModelSelect.value;
  if (aiSettings.provider === "ollama") {
    aiSettings.ollamaModel = aiModelSelect.value;
    providerReady = Boolean(aiModelSelect.value);
  }
  saveAiSettings();
  updateActiveModelBadge();
});

ollamaBaseUrlInput.addEventListener("change", async () => {
  aiSettings.ollamaBaseUrl = ollamaBaseUrlInput.value.trim().slice(0, 200);
  saveAiSettings();
  providerReady = false;
  await refreshOllamaModels(false);
});

refreshOllamaButton.addEventListener("click", async () => {
  aiSettings.ollamaBaseUrl = ollamaBaseUrlInput.value.trim().slice(0, 200);
  saveAiSettings();
  await refreshOllamaModels();
});

testOllamaButton.addEventListener("click", async () => {
  const ai = currentAiConfig();
  if (!ai.model) {
    setOllamaStatus("请先刷新并选择一个本机模型。", "error");
    return;
  }
  setSettingsBusy(true);
  setOllamaStatus("正在测试本机 Ollama……");
  try {
    await invoke("test_ai_connection", {
      provider: ai.provider,
      model: ai.model,
      ollamaBaseUrl: ai.ollamaBaseUrl,
    });
    providerReady = true;
    setOllamaStatus("Ollama 与模型都已准备好。", "success");
  } catch (error) {
    providerReady = false;
    setOllamaStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

downloadVoiceModelButton.addEventListener("click", async () => {
  downloadVoiceModelButton.disabled = true;
  deleteVoiceModelButton.disabled = true;
  voiceProgressTrack.classList.remove("hidden");
  voiceProgressBar.style.width = "0%";
  const channel = new Channel();
  channel.onmessage = (event) => {
    if (["starting", "progress", "extracting"].includes(event.event)) {
      setVoiceModelUi({
        state: event.event === "extracting" ? "loading" : "downloading",
        downloadedBytes: event.downloadedBytes,
        totalBytes: event.totalBytes,
        installed: event.event === "extracting",
      });
      if (event.event === "extracting") {
        voiceModelLabel.textContent = "正在安装离线语音";
        voiceModelDetail.textContent = event.message;
      }
    }
  };
  try {
    await invoke("download_voice_model", { onEvent: channel });
    await refreshVoiceModelStatus();
  } catch (error) {
    setVoiceModelUi({ state: "error", error: String(error), installed: false });
  } finally {
    downloadVoiceModelButton.disabled = false;
    deleteVoiceModelButton.disabled = false;
  }
});

deleteVoiceModelButton.addEventListener("click", async () => {
  if (!window.confirm("删除后语音转文字将不可用，需要重新下载约 160 MB。确定删除吗？")) return;
  deleteVoiceModelButton.disabled = true;
  try {
    await invoke("delete_voice_model");
    await refreshVoiceModelStatus();
  } catch (error) {
    voiceModelDetail.textContent = String(error);
  } finally {
    deleteVoiceModelButton.disabled = false;
  }
});

autoReadToggle.checked = voiceSettings.autoRead;
systemVoiceSelect.value = voiceSettings.voiceUri;
voiceRateRange.value = String(voiceSettings.rate);
voiceRateValue.textContent = `${voiceSettings.rate.toFixed(1)}×`;

autoReadToggle.addEventListener("change", () => {
  voiceSettings.autoRead = autoReadToggle.checked;
  saveVoiceSettings();
  if (!voiceSettings.autoRead) stopSpeaking();
});

systemVoiceSelect.addEventListener("change", () => {
  voiceSettings.voiceUri = systemVoiceSelect.value;
  saveVoiceSettings();
});

voiceRateRange.addEventListener("input", () => {
  voiceSettings.rate = Number(voiceRateRange.value);
  voiceRateValue.textContent = `${voiceSettings.rate.toFixed(1)}×`;
  saveVoiceSettings();
});

testVoiceButton.addEventListener("click", () => {
  if (activeUtterance) {
    stopSpeaking();
    return;
  }
  speakText("你好，我是 Kardii。以后也可以直接对我说话啦！", true);
});

micButton.addEventListener("click", toggleVoiceRecording);

clearHistoryButton.addEventListener("click", () => {
  if (!clearHistoryButton.classList.contains("confirming")) {
    clearHistoryButton.classList.add("confirming");
    clearHistoryButton.textContent = "再点一次，确认清空";
    clearTimeout(clearConfirmationTimer);
    clearConfirmationTimer = setTimeout(() => {
      clearHistoryButton.classList.remove("confirming");
      clearHistoryButton.textContent = "清空聊天记录";
    }, 4000);
    return;
  }

  clearTimeout(clearConfirmationTimer);
  conversation = [];
  localStorage.removeItem(HISTORY_KEY);
  renderConversation();
  clearHistoryButton.classList.remove("confirming");
  clearHistoryButton.textContent = "清空聊天记录";
  setSettingsStatus("聊天记录已清空。", "success");
});

responseLengthSelect.value = localStorage.getItem(RESPONSE_LENGTH_KEY) || "500";
responseLengthSelect.addEventListener("change", () => {
  localStorage.setItem(RESPONSE_LENGTH_KEY, responseLengthSelect.value);
  setSettingsStatus("回答长度已保存。", "success");
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

settingsButton.addEventListener("click", showSettings);
settingsCloseButton.addEventListener("click", hideSettings);
profileButton.addEventListener("click", showProfile);
profileCloseButton.addEventListener("click", hideProfile);
toolsButton.addEventListener("click", showTools);
toolsCloseButton.addEventListener("click", hideTools);
closeButton.addEventListener("click", closeChat);
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!permissionPanel.classList.contains("hidden")) finishPermission(false);
  else if (!toolsPanel.classList.contains("hidden")) hideTools();
  else if (!profilePanel.classList.contains("hidden")) hideProfile();
  else if (!settingsPanel.classList.contains("hidden")) hideSettings();
  else void closeChat();
});

window.addEventListener("focus", () => {
  if (
    settingsPanel.classList.contains("hidden")
    && profilePanel.classList.contains("hidden")
    && toolsPanel.classList.contains("hidden")
    && permissionPanel.classList.contains("hidden")
  ) input.focus();
});

renderConversation();
renderToolLogs();
renderProviderSettings();
void refreshProviderState(true);
loadSystemVoices();
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", loadSystemVoices);
}
refreshVoiceModelStatus();
setMicPhase("idle");
