const BRIDGE_URL = "http://127.0.0.1:43198";
const TOKEN_KEY = "kardiiBridgeTokenV1";

const pairPanel = document.getElementById("pairPanel");
const capturePanel = document.getElementById("capturePanel");
const pairingCode = document.getElementById("pairingCode");
const pairButton = document.getElementById("pairButton");
const captureButton = document.getElementById("captureButton");
const pageTitle = document.getElementById("pageTitle");
const pageUrl = document.getElementById("pageUrl");
const statusMessage = document.getElementById("statusMessage");
const statusDot = document.getElementById("statusDot");

let bridgeToken = "";
let activeTab = null;

function setStatus(message, kind = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message${kind ? ` ${kind}` : ""}`;
  statusDot.className = `status-dot${kind ? ` ${kind === "success" ? " ready" : kind === "error" ? " error" : ""}` : ""}`;
}

function showPaired(paired) {
  pairPanel.classList.toggle("hidden", paired);
  capturePanel.classList.toggle("hidden", !paired);
}

async function tokenFromStorage() {
  const value = await chrome.storage.local.get(TOKEN_KEY);
  return typeof value[TOKEN_KEY] === "string" ? value[TOKEN_KEY] : "";
}

async function bridgeFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (bridgeToken) headers.Authorization = `Bearer ${bridgeToken}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BRIDGE_URL}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Kardii 返回 ${response.status}`);
  return result;
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  const supported = Boolean(tab?.id && /^https?:\/\//i.test(tab.url || ""));
  pageTitle.textContent = tab?.title || "当前页面";
  pageUrl.textContent = tab?.url || "";
  captureButton.disabled = !supported;
  if (!supported) setStatus("浏览器内部页、扩展页和本地文件不能发送。", "error");
}

function extractReadablePage() {
  const selectedText = String(window.getSelection()?.toString() || "").trim().slice(0, 30_000);
  const root = document.querySelector("main, article, [role='main']") || document.body;
  const clone = root?.cloneNode(true);
  if (clone) {
    clone.querySelectorAll("script, style, noscript, svg, canvas, form, input, textarea, select, button, [aria-hidden='true']")
      .forEach((node) => node.remove());
  }
  const pageContent = String(clone?.innerText || document.body?.innerText || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 120_000);
  const description = document.querySelector("meta[name='description'], meta[property='og:description']")?.content || "";
  return {
    title: document.title || location.hostname,
    url: location.href,
    selectedText,
    content: selectedText ? "" : pageContent,
    description: String(description).slice(0, 1_000),
    language: document.documentElement.lang || "",
    capturedAt: new Date().toISOString(),
  };
}

async function checkBridge() {
  bridgeToken = await tokenFromStorage();
  try {
    const health = await bridgeFetch("/health");
    const paired = Boolean(bridgeToken && health.paired);
    showPaired(paired);
    if (paired) {
      setStatus("已连接到本机 Kardii。", "success");
      await readActiveTab();
    } else {
      if (bridgeToken) await chrome.storage.local.remove(TOKEN_KEY);
      bridgeToken = "";
      setStatus("Kardii 已运行，请输入配对码。", "");
    }
  } catch {
    showPaired(false);
    setStatus("连接不到 Kardii。请先打开应用与“外部连接”。", "error");
  }
}

pairButton.addEventListener("click", async () => {
  const code = pairingCode.value.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    setStatus("请输入 Kardii 显示的 6 位配对码。", "error");
    return;
  }
  pairButton.disabled = true;
  setStatus("正在配对…");
  try {
    const result = await bridgeFetch("/pair", { method: "POST", body: JSON.stringify({ code }) });
    bridgeToken = String(result.token || "");
    if (!bridgeToken) throw new Error("Kardii 没有返回连接凭据。");
    await chrome.storage.local.set({ [TOKEN_KEY]: bridgeToken });
    showPaired(true);
    await readActiveTab();
    setStatus("配对成功。现在可以发送当前网页。", "success");
  } catch (error) {
    setStatus(String(error.message || error), "error");
  } finally {
    pairButton.disabled = false;
  }
});

pairingCode.addEventListener("input", () => {
  pairingCode.value = pairingCode.value.replace(/\D/g, "").slice(0, 6);
});

pairingCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") pairButton.click();
});

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  setStatus("正在提取当前页可读文字…");
  try {
    if (!activeTab?.id) await readActiveTab();
    if (!activeTab?.id || !/^https?:\/\//i.test(activeTab.url || "")) throw new Error("当前标签页不支持发送。");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: extractReadablePage,
    });
    if (!result?.content && !result?.selectedText) throw new Error("当前页面没有提取到可读文字。");
    await bridgeFetch("/capture", { method: "POST", body: JSON.stringify(result) });
    setStatus(result.selectedText ? "已把选中文字发送给 Kardii。" : "已把当前网页发送给 Kardii。", "success");
    captureButton.textContent = "已发送 · 再次发送";
  } catch (error) {
    const message = String(error.message || error);
    if (/401|失效|Unauthorized/i.test(message)) {
      await chrome.storage.local.remove(TOKEN_KEY);
      bridgeToken = "";
      showPaired(false);
    }
    setStatus(message, "error");
  } finally {
    captureButton.disabled = false;
  }
});

void checkBridge();
