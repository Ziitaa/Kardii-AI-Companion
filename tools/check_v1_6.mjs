import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const rust = read("src-tauri/src/lib.rs");
const browserRust = read("src-tauri/src/browser.rs");
const mcpRust = read("src-tauri/src/mcp.rs");
const manifest = JSON.parse(read("src-tauri/browser-extension/manifest.json"));
const popupHtml = read("src-tauri/browser-extension/popup.html");
const popupJs = read("src-tauri/browser-extension/popup.js");
const agentJs = read("src/agent.js");
const workbenchJs = read("src/workbench.js");
const capabilities = read("src/kardii-capabilities.js");
const readme = read("README.md");

for (const version of [packageJson.version, lock.version, lock.packages[""].version, tauriConfig.version]) {
  assert(version === "1.6.0", `版本号未统一：${version}`);
}
assert(/version = "1\.6\.0"/.test(cargo), "Cargo.toml 未更新为 1.6.0");
assert(capabilities.includes('const VERSION = "1.6.0"'), "共享功能清单版本未更新");

assert(browserRust.includes("BrowserInteractiveElement") && browserRust.includes("targets: Vec<BrowserInteractiveElement>"), "网页快照缺少可交互目标");
assert(browserRust.includes("BrowserPendingAction") && browserRust.includes("execute_browser_action"), "受控浏览器操作队列缺失");
assert(browserRust.includes('request.path == "/action"') && browserRust.includes('request.path == "/action-result"'), "扩展操作领取或回传端点缺失");
for (const action of ["click", "fill", "select", "scroll", "navigate", "download"]) {
  assert(browserRust.includes(`"${action}"`) && popupJs.includes(`"${action}"`), `浏览器操作未双端支持：${action}`);
}
assert(browserRust.includes("contains_blocked_commerce_term") && popupJs.includes("blockedCommerce"), "支付和资金操作没有后端与扩展双重阻断");
assert(browserRust.includes("target_href") && popupJs.includes("targetHref"), "网页安全校验没有覆盖目标链接地址");
assert(browserRust.includes("contains_sensitive_input_term") && popupJs.includes("sensitive"), "敏感输入没有后端与扩展双重阻断");
assert(browserRust.includes("contains_blocked_account_action") && popupJs.includes("blockedAccount"), "登录与账户验证没有后端与扩展双重阻断");
assert(browserRust.includes("dangerous_download_url") && popupJs.includes("可执行文件下载已禁用"), "危险下载没有双重阻断");
assert(popupHtml.includes('id="runActionButton"') && popupHtml.includes('id="rejectActionButton"'), "扩展缺少执行与拒绝按钮");
assert(popupJs.includes("sameActionPage") && popupJs.includes("chrome.tabs.update"), "扩展没有核对页面或执行受控导航");
assert(JSON.stringify(manifest.permissions.sort()) === JSON.stringify(["activeTab", "scripting", "storage"].sort()), "扩展权限超出 activeTab/scripting/storage");
assert(!JSON.stringify(manifest).includes("<all_urls>"), "扩展不应申请全站持久权限");

assert(rust.includes('"browser_action"') && rust.includes('"mcp_call"'), "Agent 后端未暴露浏览器或 MCP 工具");
assert(agentJs.includes('action.tool === "mcp_call"') && agentJs.includes("connectedMcpTools"), "Agent 没有接入已验证 MCP 工具清单");
assert(agentJs.includes('tool.risk !== "read"') && agentJs.includes("actionRequiresPermission"), "MCP 只读自动 / 写入确认分流缺失");
assert(agentJs.includes('action.tool === "browser_action"') && agentJs.includes('invoke("execute_browser_action"'), "Agent 浏览器操作未接通");
assert(agentJs.includes("sanitizeHistoryArguments") && agentJs.includes("[已隐藏填写内容"), "Agent 历史没有隐藏敏感或填写内容");
assert(agentJs.includes("MCP_LOGS_KEY") && !agentJs.includes("resultArguments"), "Agent MCP 本机日志缺失或设计异常");

assert(mcpRust.includes("allow_write") && mcpRust.includes("mcp_tool_risk"), "MCP 后端没有独立执行写入授权策略");
assert(mcpRust.includes('risk == "blocked"') && mcpRust.includes('risk != "read" && !request.allow_write'), "MCP 后端没有阻断付款或未确认写入");
assert(mcpRust.includes("mcp_arguments_contain_secret"), "MCP 后端没有阻断敏感参数字段");
assert(mcpRust.includes('matches!(word, "pay" | "buy")'), "MCP 后端没有独立阻断 pay / buy 工具名");
assert(workbenchJs.includes("allowWrite: risk !== \"read\""), "连接中心没有向后端传递本次写入授权");

assert(capabilities.includes("扩展中再次点击执行") && capabilities.includes("服务器明确标注只读"), "功能说明没有准确覆盖 v1.6 权限边界");
assert(readme.includes("v1.6 受控浏览器与 Agent MCP"), "README 缺少 v1.6 说明");

console.log("Kardii v1.6 controlled browser and Agent MCP checks passed.");
