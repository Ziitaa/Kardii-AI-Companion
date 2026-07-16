const { getCurrentWindow } = window.__TAURI__.window;
const { emitTo } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

const chatWindow = getCurrentWindow();
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const messagesElement = document.getElementById("messages");
const closeButton = document.getElementById("closeButton");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const settingsCloseButton = document.getElementById("settingsCloseButton");
const apiKeyInput = document.getElementById("apiKeyInput");
const settingsStatus = document.getElementById("settingsStatus");
const saveKeyButton = document.getElementById("saveKeyButton");
const testKeyButton = document.getElementById("testKeyButton");
const deleteKeyButton = document.getElementById("deleteKeyButton");

const conversation = [];
let sending = false;
let hasApiKey = false;

function addMessage(text, sender) {
  const bubble = document.createElement("div");
  bubble.className = `message ${sender}`;
  bubble.textContent = text;
  messagesElement.appendChild(bubble);
  messagesElement.scrollTop = messagesElement.scrollHeight;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || sending) return;
  if (!hasApiKey) {
    showSettings();
    setSettingsStatus("请先设置 DeepSeek API Key。", "error");
    return;
  }

  sending = true;
  input.disabled = true;
  addMessage(text, "user");
  conversation.push({ role: "user", content: text });
  input.value = "";
  resizeInput();
  await emitTo("main", "kardii-state", "loading");

  try {
    const reply = await invoke("send_ai_message", {
      messages: conversation.slice(-12),
    });
    addMessage(reply.text, "kardii");
    conversation.push({ role: "assistant", content: reply.text });
    await emitTo("main", "kardii-state", "idle");
  } catch (error) {
    addMessage(`出错了：${String(error)}`, "kardii");
    await emitTo("main", "kardii-state", "error");
  } finally {
    sending = false;
    input.disabled = false;
    input.focus();
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

refreshKeyState();
