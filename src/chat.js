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

const HISTORY_KEY = "kardii-chat-history-v1";
const RESPONSE_LENGTH_KEY = "kardii-response-length";
const MAX_SAVED_MESSAGES = 50;
let conversation = loadConversation();
let sending = false;
let hasApiKey = false;
let clearConfirmationTimer;
let activeRequestId = null;

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
closeButton.addEventListener("click", closeChat);
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!settingsPanel.classList.contains("hidden")) hideSettings();
  else void closeChat();
});

window.addEventListener("focus", () => {
  if (settingsPanel.classList.contains("hidden")) input.focus();
});

renderConversation();
refreshKeyState();
