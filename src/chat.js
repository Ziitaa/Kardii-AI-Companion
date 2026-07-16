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
const apiKeyInput = document.getElementById("apiKeyInput");
const settingsStatus = document.getElementById("settingsStatus");
const saveKeyButton = document.getElementById("saveKeyButton");
const testKeyButton = document.getElementById("testKeyButton");
const deleteKeyButton = document.getElementById("deleteKeyButton");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const replyActions = document.getElementById("replyActions");
const copyReplyButton = document.getElementById("copyReplyButton");
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

const HISTORY_KEY = "kardii-chat-history-v1";
const RESPONSE_LENGTH_KEY = "kardii-response-length";
const PROFILE_KEY = "kardii-profile-v1";
const MEMORIES_KEY = "kardii-memories-v1";
const MAX_SAVED_MESSAGES = 50;
const PERSONALITIES = {
  healing: "耐心温暖，擅长安慰，也会温和地给出实用建议。",
  clingy: "喜欢陪着你，会撒娇和轻微吃醋，但不会影响正常回答。",
  sunshine: "充满活力，喜欢鼓励你立刻迈出简单的第一步。",
  tsundere: "嘴上轻微嫌弃、偶尔逗你，实际上非常关心你。",
  sarcastic: "会吐槽摸鱼和拖延，但不攻击外貌、身份或真实弱点。",
  butler: "冷静克制、简洁可靠，偶尔带一点不伤人的冷幽默。",
};
let conversation = loadConversation();
let sending = false;
let hasApiKey = false;
let clearConfirmationTimer;
let activeRequestId = null;
let profile = loadProfile();
let memories = loadMemories();

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
      localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories));
      renderMemories();
      setProfileStatus("这条记忆已删除。", "success");
    });
    item.append(text, remove);
    memoryList.appendChild(item);
  });
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
  setTimeout(() => apiKeyInput.focus(), 0);
}

function hideSettings() {
  settingsPanel.classList.add("hidden");
  input.focus();
}

function setSettingsBusy(busy) {
  [saveKeyButton, testKeyButton, deleteKeyButton].forEach((button) => {
    button.disabled = busy;
  });
}

async function refreshKeyState() {
  hasApiKey = await invoke("has_deepseek_key");
  if (hasApiKey) {
    setSettingsStatus("API Key 已安全保存。", "success");
  } else {
    setSettingsStatus("请先粘贴并保存 DeepSeek API Key。", "error");
    showSettings();
  }
}

async function closeChat() {
  await chatWindow.hide();
}

function setSending(nextSending) {
  sending = nextSending;
  input.disabled = nextSending;
  sendButton.classList.toggle("hidden", nextSending);
  stopButton.classList.toggle("hidden", !nextSending);
  stopButton.disabled = false;
  updateReplyActions();
}

async function requestReply() {
  setSending(true);
  await emitTo("main", "kardii-state", "loading");

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
        await emitTo("main", "kardii-state", "idle");
      }
    }
    if (event.event === "stopped") {
      stopped = true;
    }
  };

  try {
    await invoke("stream_ai_message", {
      messages: conversation.slice(-12),
      profile: currentProfile(),
      requestId: activeRequestId,
      maxTokens: Number(responseLengthSelect.value),
      onEvent: channel,
    });
    if (replyText.trim()) {
      conversation.push({ role: "assistant", content: replyText.trim() });
      saveConversation();
    } else {
      replyBubble.textContent = stopped ? "已停止回答。" : "这次没有收到回复，请重试。";
    }
    await emitTo("main", "kardii-state", "idle");
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
  if (!hasApiKey) {
    showSettings();
    setSettingsStatus("请先设置 DeepSeek API Key。", "error");
    return;
  }

  addMessage(text, "user");
  conversation.push({ role: "user", content: text });
  saveConversation();
  input.value = "";
  resizeInput();
  await requestReply();
});

stopButton.addEventListener("click", async () => {
  if (!activeRequestId) return;
  stopButton.disabled = true;
  await invoke("stop_ai_message", { requestId: activeRequestId });
});

copyReplyButton.addEventListener("click", async () => {
  const reply = latestAssistantMessage();
  if (!reply) return;
  try {
    await navigator.clipboard.writeText(reply.content);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = reply.content;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  copyReplyButton.textContent = "已复制";
  setTimeout(() => { copyReplyButton.textContent = "复制回答"; }, 1200);
});

regenerateButton.addEventListener("click", async () => {
  if (sending || !hasApiKey) return;
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
  localStorage.setItem(MEMORIES_KEY, JSON.stringify(memories));
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
    await invoke("save_deepseek_key", { apiKey });
    apiKeyInput.value = "";
    hasApiKey = true;
    setSettingsStatus("保存成功，可以点击“测试连接”。", "success");
  } catch (error) {
    setSettingsStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

testKeyButton.addEventListener("click", async () => {
  if (!hasApiKey) {
    setSettingsStatus("请先保存 API Key。", "error");
    return;
  }
  setSettingsBusy(true);
  setSettingsStatus("正在连接 DeepSeek……");
  try {
    await invoke("test_deepseek_connection");
    setSettingsStatus("连接成功！Kardii 已经可以聊天了。", "success");
  } catch (error) {
    setSettingsStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

deleteKeyButton.addEventListener("click", async () => {
  setSettingsBusy(true);
  try {
    await invoke("delete_deepseek_key");
    hasApiKey = false;
    setSettingsStatus("API Key 已从电脑中删除。", "success");
  } catch (error) {
    setSettingsStatus(String(error), "error");
  } finally {
    setSettingsBusy(false);
  }
});

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
closeButton.addEventListener("click", closeChat);
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!profilePanel.classList.contains("hidden")) hideProfile();
  else if (!settingsPanel.classList.contains("hidden")) hideSettings();
  else void closeChat();
});

window.addEventListener("focus", () => {
  if (settingsPanel.classList.contains("hidden")) input.focus();
});

renderConversation();
refreshKeyState();
