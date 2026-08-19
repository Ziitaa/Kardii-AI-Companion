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
const actionPanel = document.getElementById("actionPanel");
const actionTitle = document.getElementById("actionTitle");
const actionDescription = document.getElementById("actionDescription");
const runActionButton = document.getElementById("runActionButton");
const rejectActionButton = document.getElementById("rejectActionButton");

let bridgeToken = "";
let activeTab = null;
let pendingAction = null;

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

function actionDescriptionText(action) {
  const target = action.targetLabel ? `“${action.targetLabel}”` : "当前页面";
  if (action.actionType === "click") return `点击 ${target}`;
  if (action.actionType === "fill") return `在 ${target} 填写：${String(action.value || "").slice(0, 160)}`;
  if (action.actionType === "select") return `在 ${target} 选择：${String(action.value || "").slice(0, 160)}`;
  if (action.actionType === "scroll") return `${action.direction === "up" ? "向上" : "向下"}滚动页面`;
  if (action.actionType === "navigate") return `前往：${action.url}`;
  if (action.actionType === "download") return `点击下载链接 ${target}`;
  return "未知操作";
}

async function loadPendingAction() {
  try {
    const result = await bridgeFetch("/action");
    pendingAction = result.action || null;
  } catch {
    pendingAction = null;
  }
  actionPanel.classList.toggle("hidden", !pendingAction);
  if (!pendingAction) return;
  actionTitle.textContent = pendingAction.pageTitle || "当前网页操作";
  actionDescription.textContent = actionDescriptionText(pendingAction);
  setStatus("Kardii 已在应用内获得确认；请核对上面的页面与动作。", "");
}

function sameActionPage(tabUrl, expectedUrl) {
  try {
    const current = new URL(tabUrl);
    const expected = new URL(expectedUrl);
    return `${current.origin}${current.pathname}${current.search}` === `${expected.origin}${expected.pathname}${expected.search}`;
  } catch {
    return false;
  }
}

async function sendActionResult(action, success, message) {
  await bridgeFetch("/action-result", {
    method: "POST",
    body: JSON.stringify({ actionId: action.id, success, message }),
  });
  pendingAction = null;
  actionPanel.classList.add("hidden");
}

function extractReadablePage() {
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const labelFor = (element) => String(
    element.getAttribute("aria-label")
      || element.getAttribute("title")
      || element.innerText
      || element.getAttribute("placeholder")
      || element.getAttribute("name")
      || element.getAttribute("alt")
      || "未命名目标"
  ).replace(/\s+/g, " ").trim().slice(0, 300);
  const targets = [];
  const nodes = document.querySelectorAll("a[href], button, input, textarea, select, [role='button'], [role='link']");
  for (const element of nodes) {
    if (targets.length >= 120 || !visible(element)) continue;
    const tag = element.tagName.toLowerCase();
    const inputType = tag === "input" ? String(element.type || "text").toLowerCase() : "";
    if (["hidden", "password", "file"].includes(inputType)) continue;
    let role = String(element.getAttribute("role") || "").toLowerCase();
    if (!role) {
      if (tag === "a") role = "link";
      else if (tag === "button") role = "button";
      else if (tag === "textarea") role = "textarea";
      else if (tag === "select") role = "select";
      else if (tag === "input" && ["checkbox", "radio"].includes(inputType)) role = inputType;
      else if (tag === "input") role = "input";
    }
    if (!["link", "button", "input", "textarea", "select", "checkbox", "radio"].includes(role)) continue;
    const id = `k${targets.length + 1}`;
    element.setAttribute("data-kardii-target", id);
    let href = "";
    if (tag === "a" && element.href && /^https?:\/\//i.test(element.href)) href = element.href.slice(0, 2_000);
    targets.push({
      id,
      role,
      label: labelFor(element),
      inputType,
      href,
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
    });
  }
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
    targets,
  };
}

function performKardiiAction(action) {
  const blockedCommerce = /purchase|payment|\bpay(?: now)?\b|checkout|(?:place|submit)[_ -]?order|\bbuy\b|add[_ -]?to[_ -]?cart|transfer[_ -]?(?:funds?|money)|wire[_ -]?transfer|withdraw|refund|charge card|支付|购买|付款|退款|结账|下单|提交订单|加入购物车|转账|汇款|提现/i;
  const blockedAccount = /sign in|signin|log in|login|sign up|register|登录|登入|注册/i;
  const sensitive = /password|passcode|one.?time|otp|verification code|cvv|cvc|credit card|card number|security code|api key|token|密码|验证码|信用卡|银行卡|安全码|密钥/i;
  const target = action.targetId
    ? document.querySelector(`[data-kardii-target="${CSS.escape(action.targetId)}"]`)
    : null;
  if (blockedAccount.test(location.href)) {
    return { success: false, message: "当前页面属于登录、注册或账户验证流程，已拒绝操作。" };
  }
  const targetHref = target instanceof HTMLAnchorElement ? target.href : "";
  const commerceText = `${action.targetLabel || ""} ${targetHref} ${action.url || ""} ${action.value || ""}`;
  if (blockedCommerce.test(commerceText) || String(action.targetLabel || "").trim().toLowerCase() === "buy") {
    return { success: false, message: "页面目标涉及付款、购买、下单或资金转移，已拒绝。" };
  }
  if (action.actionType === "scroll") {
    const amount = Math.min(2000, Math.max(200, Number(action.amount) || 700));
    window.scrollBy({ top: action.direction === "up" ? -amount : amount, behavior: "smooth" });
    return { success: true, message: `已向${action.direction === "up" ? "上" : "下"}滚动页面。` };
  }
  if (!target) return { success: false, message: "页面已经变化，找不到 Kardii 计划操作的目标。请重新发送网页。" };
  const label = String(target.getAttribute("aria-label") || target.getAttribute("title") || target.innerText || target.getAttribute("placeholder") || "");
  if (blockedCommerce.test(label) || label.trim().toLowerCase() === "buy") return { success: false, message: "页面目标涉及付款、购买、下单或资金转移，已拒绝。" };
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (action.actionType === "fill") {
    const inputType = String(target.type || "text").toLowerCase();
    if (sensitive.test(`${label} ${target.name || ""} ${inputType}`) || ["password", "hidden", "file"].includes(inputType)) {
      return { success: false, message: "Kardii 不填写密码、验证码、支付卡、Token 或文件输入框。" };
    }
    const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return { success: false, message: "这个输入框不支持受控填写。" };
    setter.call(target, String(action.value || "").slice(0, 2000));
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.focus();
    return { success: true, message: "已填写内容，但没有提交表单。" };
  }
  if (action.actionType === "select") {
    if (!(target instanceof HTMLSelectElement)) return { success: false, message: "目标不再是下拉选择框。" };
    const wanted = String(action.value || "");
    const option = [...target.options].find((item) => item.value === wanted || item.text.trim() === wanted);
    if (!option) return { success: false, message: "下拉框中找不到计划选择的选项。" };
    target.value = option.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, message: `已选择“${option.text.trim()}”。` };
  }
  if (action.actionType === "download") {
    if (!(target instanceof HTMLAnchorElement) || !/^https?:\/\//i.test(target.href)) return { success: false, message: "下载目标不再是安全链接。" };
    if (/\.(?:exe|msi|dmg|pkg|sh|bat|cmd|ps1|scr|com|jar)(?:[?#]|$)/i.test(target.href)) return { success: false, message: "可执行文件下载已禁用。" };
    target.click();
    return { success: true, message: "已点击下载链接；请在浏览器下载栏检查文件。" };
  }
  if (action.actionType === "click") {
    if (blockedAccount.test(`${label} ${targetHref}`)) return { success: false, message: "Kardii 不会执行登录、注册或账户验证步骤。" };
    target.click();
    return { success: true, message: "已点击页面目标。" };
  }
  return { success: false, message: "不支持这项浏览器操作。" };
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
      await loadPendingAction();
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

rejectActionButton.addEventListener("click", async () => {
  if (!pendingAction) return;
  const action = pendingAction;
  runActionButton.disabled = true;
  rejectActionButton.disabled = true;
  try {
    await sendActionResult(action, false, "用户在浏览器扩展中拒绝了这一步操作。");
    setStatus("已拒绝这一步，Kardii 会改用其他方式。", "success");
  } catch (error) {
    setStatus(String(error.message || error), "error");
  } finally {
    runActionButton.disabled = false;
    rejectActionButton.disabled = false;
  }
});

runActionButton.addEventListener("click", async () => {
  if (!pendingAction) return;
  const action = pendingAction;
  runActionButton.disabled = true;
  rejectActionButton.disabled = true;
  setStatus("正在执行这一项受控操作…");
  let outcome = { success: false, message: "浏览器操作没有返回结果。" };
  try {
    await readActiveTab();
    if (!activeTab?.id || !sameActionPage(activeTab.url || "", action.pageUrl || "")) {
      throw new Error("当前标签页与 Kardii 确认的网页不一致，已拒绝执行。请切回目标页面并重新发送。");
    }
    if (action.actionType === "navigate") {
      if (!/^https?:\/\//i.test(action.url || "")) throw new Error("导航地址无效。");
      await chrome.tabs.update(activeTab.id, { url: action.url });
      outcome = { success: true, message: `已导航到 ${action.url}。跨站后请重新打开扩展发送页面。` };
    } else {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: performKardiiAction,
        args: [action],
      });
      outcome = result || outcome;
    }
    if (!outcome.success) throw new Error(outcome.message || "浏览器拒绝了这一步。");
    if (action.actionType !== "navigate") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const [{ result: capture }] = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: extractReadablePage,
        });
        if (capture?.content || capture?.selectedText) {
          await bridgeFetch("/capture", { method: "POST", body: JSON.stringify(capture) });
        }
      } catch {
        // 页面跳转会撤销 activeTab；下一步由用户重新打开扩展并发送。
      }
    }
    await sendActionResult(action, true, outcome.message || "操作完成。");
    setStatus(outcome.message || "操作完成。", "success");
  } catch (error) {
    const message = String(error.message || error);
    if (pendingAction?.id === action.id) {
      await sendActionResult(action, false, message).catch(() => {});
    }
    setStatus(message, "error");
  } finally {
    runActionButton.disabled = false;
    rejectActionButton.disabled = false;
  }
});

void checkBridge();
