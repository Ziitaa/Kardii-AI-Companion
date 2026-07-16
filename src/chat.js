const { getCurrentWindow } = window.__TAURI__.window;
const { emitTo } = window.__TAURI__.event;

const chatWindow = getCurrentWindow();
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const messages = document.getElementById("messages");
const closeButton = document.getElementById("closeButton");

function addMessage(text, sender) {
  const bubble = document.createElement("div");
  bubble.className = `message ${sender}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 72)}px`;
}

async function closeChat() {
  await chatWindow.hide();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, "user");
  input.value = "";
  resizeInput();
  await emitTo("main", "kardii-state", "loading");

  setTimeout(async () => {
    addMessage("收到啦！现在是聊天界面预览版。下一步连接 AI 后，我就能真正回答你。", "kardii");
    await emitTo("main", "kardii-state", "idle");
  }, 900);
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

closeButton.addEventListener("click", closeChat);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void closeChat();
});

window.addEventListener("focus", () => input.focus());
