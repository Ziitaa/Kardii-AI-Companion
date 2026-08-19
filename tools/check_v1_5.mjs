import fs from "node:fs";
import vm from "node:vm";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const rust = read("src-tauri/src/lib.rs");
const browserRust = read("src-tauri/src/browser.rs");
const mcpRust = read("src-tauri/src/mcp.rs");
const manifest = JSON.parse(read("src-tauri/browser-extension/manifest.json"));
const popupJs = read("src-tauri/browser-extension/popup.js");
const popupHtml = read("src-tauri/browser-extension/popup.html");
const workbenchHtml = read("src/workbench.html");
const workbenchJs = read("src/workbench.js");
const workbenchCss = read("src/workbench.css");
const chatJs = read("src/chat.js");
const agentJs = read("src/agent.js");
const capabilityJs = read("src/kardii-capabilities.js");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauriConfig.version]) {
  assert(version === "2.1.0", `当前版本号未统一: ${version}`);
}
assert(/version = "2\.1\.0"/.test(cargo), "Cargo.toml 未更新到 v2.1.0");
assert(chatJs.includes('appVersion: "2.1.0"'), "完整备份版本号未更新到 v2.1.0");
assert(capabilityJs.includes('const VERSION = "2.1.0"'), "功能清单版本未更新到 v2.1.0");

for (const command of [
  "start_browser_bridge", "stop_browser_bridge", "browser_bridge_status",
  "regenerate_browser_pairing", "get_browser_capture", "clear_browser_capture",
  "open_browser_extension_folder",
]) {
  assert(browserRust.includes(`fn ${command}`), `浏览器后端命令缺失: ${command}`);
  assert(rust.includes(`            ${command},`), `浏览器命令未注册: ${command}`);
}
assert(browserRust.includes('TcpListener::bind(("127.0.0.1", BRIDGE_PORT))'), "浏览器桥接没有限制为 IPv4 回环地址");
assert(browserRust.includes('strip_prefix("chrome-extension://")') && browserRust.includes("extension_id.len() == 32"), "浏览器桥接没有严格校验扩展来源");
assert(browserRust.includes('strip_prefix("Bearer ")'), "浏览器桥接没有校验 Bearer 凭据");
assert(browserRust.includes("MAX_REQUEST_BYTES") && browserRust.includes("MAX_PAGE_CHARS"), "浏览器桥接缺少请求与页面大小限制");
assert(browserRust.includes('matches!(url.scheme(), "http" | "https")'), "浏览器桥接没有限制页面 URL 协议");
assert(browserRust.includes("keyring::Entry::new") && browserRust.includes("save_token"), "浏览器随机凭据没有保存到系统安全凭据库");
assert(browserRust.includes("MAX_PAIRING_FAILURES") && browserRust.includes("pairing_locked_until"), "浏览器配对缺少失败次数限制");
assert(browserRust.includes('app_data_dir()') && browserRust.includes('join("browser-extension")'), "扩展没有复制到升级后仍稳定的应用数据目录");
assert(!browserRust.includes('TcpListener::bind(("0.0.0.0"') && !browserRust.includes("Access-Control-Allow-Origin: *"), "浏览器桥接意外暴露给局域网或任意来源");

assert(manifest.manifest_version === 3, "浏览器扩展不是 Manifest V3");
for (const permission of ["activeTab", "scripting", "storage"]) {
  assert(manifest.permissions.includes(permission), `浏览器扩展缺少权限: ${permission}`);
}
for (const forbidden of ["tabs", "cookies", "webRequest", "history", "downloads", "debugger", "nativeMessaging"]) {
  assert(!manifest.permissions.includes(forbidden), `浏览器扩展申请了不必要权限: ${forbidden}`);
}
assert(JSON.stringify(manifest.host_permissions) === JSON.stringify(["http://127.0.0.1:43198/*"]), "扩展 host_permissions 不是固定本机桥接地址");
assert(!JSON.stringify(manifest).includes("<all_urls>"), "浏览器扩展不应申请 all_urls");
assert(tauriConfig.bundle.resources.includes("browser-extension/"), "Tauri 安装包没有包含浏览器扩展资源");
assert(popupJs.includes("chrome.scripting.executeScript") && popupJs.includes("window.getSelection"), "扩展没有在点击后读取当前页或选中文字");
for (const excluded of ["form", "input", "textarea", "select", "button"]) {
  assert(popupJs.includes(excluded), `扩展没有排除 ${excluded} 内容`);
}
assert(!popupJs.includes("document.cookie") && !popupJs.includes("chrome.cookies"), "扩展不应读取 Cookie");
assert(popupHtml.includes("不会持续监控") && popupHtml.includes("不可信指令"), "扩展没有说明隐私或网页不可信边界");

for (const id of [
  "browserConnectionBadge", "browserPairingCode", "copyBrowserPairingButton",
  "startBrowserBridgeButton", "stopBrowserBridgeButton", "openBrowserExtensionButton",
  "browserPagePreview", "sendBrowserPageToChatButton", "sendBrowserPageToAgentButton",
  "saveBrowserPageButton", "clearBrowserPageButton",
]) {
  assert(workbenchHtml.includes(`id="${id}"`), `浏览器连接控件缺失: ${id}`);
  assert(workbenchJs.includes(`getElementById("${id}")`), `浏览器连接控件未绑定: ${id}`);
}
for (const command of ["start_browser_bridge", "browser_bridge_status", "get_browser_capture", "clear_browser_capture"]) {
  assert(workbenchJs.includes(`invoke("${command}"`), `工作台没有调用浏览器命令: ${command}`);
}
assert(workbenchJs.includes("BROWSER_CONTEXT_KEY") && chatJs.includes("consumeBrowserContext"), "网页没有进入普通聊天上下文");
assert(workbenchJs.includes("BROWSER_AGENT_REQUEST_KEY") && agentJs.includes("consumeBrowserAgentRequest"), "网页没有进入 Agent 任务");
assert(agentJs.includes('action.tool === "browser_read"') && rust.includes('"browser_read"'), "Agent browser_read 工具未接通");
assert(workbenchJs.includes('fileType: "web"') && workbenchHtml.includes('<option value="web">网页</option>'), "网页无法保存或筛选到知识库");
assert(workbenchJs.includes("browserUrl") && workbenchJs.includes('invoke("open_external_url"'), "网页知识没有保留原网址");
assert(workbenchCss.includes(".browser-connection-card") && workbenchCss.includes(".browser-page-preview"), "浏览器连接主题样式缺失");

for (const command of ["save_mcp_token", "has_mcp_token", "delete_mcp_token", "test_mcp_connection", "call_mcp_tool"]) {
  assert(mcpRust.includes(`fn ${command}`), `MCP 后端命令缺失: ${command}`);
  assert(rust.includes(`            ${command},`), `MCP 命令未注册: ${command}`);
}
assert(mcpRust.includes('url.scheme() != "https"') && mcpRust.includes('url.scheme() == "http" && is_loopback'), "MCP 地址没有要求远程 HTTPS / 本机回环 HTTP");
assert(mcpRust.includes("redirect(reqwest::redirect::Policy::none())"), "MCP 客户端不应自动跟随可能改变安全边界的重定向");
assert(mcpRust.includes('const MCP_PROTOCOL_VERSION: &str = "2025-11-25"'), "MCP 首批兼容版本不正确");
assert(mcpRust.includes("MAX_MCP_RESPONSE_BYTES") && mcpRust.includes("response.chunk().await") && mcpRust.includes("timeout(Duration::from_secs(20))"), "MCP 缺少流式响应大小或超时限制");
assert(mcpRust.includes("builder.no_proxy()"), "本机 MCP 不应经过系统代理");
assert(mcpRust.includes('"method": "initialize"') && mcpRust.includes('"method": "tools/list"') && mcpRust.includes('"method": "tools/call"'), "MCP 初始化、发现或调用流程不完整");
assert(mcpRust.includes("keyring::Entry::new") && mcpRust.includes("mcp-token-v1-"), "MCP Token 没有进入系统安全凭据库");
assert(mcpRust.includes("所选工具不在服务器刚刚返回的工具清单中"), "MCP 调用前没有重新核对工具清单");
assert(mcpRust.includes("close_mcp_session") && mcpRust.includes(".delete(session.url.clone())"), "MCP 会话没有在使用后主动关闭");

for (const id of [
  "mcpServerSelect", "newMcpServerButton", "mcpNameInput", "mcpUrlInput", "mcpTokenInput",
  "testMcpButton", "clearMcpTokenButton", "mcpToolSelect", "mcpArgumentsInput", "callMcpToolButton",
  "mcpToolOutput", "mcpExecutionLog", "clearMcpLogsButton",
]) {
  assert(workbenchHtml.includes(`id="${id}"`), `MCP 连接控件缺失: ${id}`);
  assert(workbenchJs.includes(`getElementById("${id}")`), `MCP 连接控件未绑定: ${id}`);
}
assert(workbenchJs.includes('invoke("test_mcp_connection"') && workbenchJs.includes('invoke("call_mcp_tool"'), "MCP 测试或工具调用未接通");
assert(workbenchJs.includes("window.kardiiConfirm") && workbenchJs.includes("mcpToolRisk"), "MCP 工具调用没有逐次确认或风险标记");
assert(workbenchJs.includes('risk === "blocked"') && workbenchJs.includes("资金转移类 MCP 工具"), "付款或资金类 MCP 工具没有直接禁用");
assert(workbenchJs.includes("validatedMcpUrl") && workbenchJs.includes('invoke("delete_mcp_token"'), "MCP 地址校验或更换地址时撤销旧 Token 缺失");
assert(workbenchJs.includes("MCP_LOGS_KEY") && workbenchJs.includes("durationMs") && workbenchJs.includes("toolName"), "MCP 本机调用日志缺失");
const normalizeMcpSource = workbenchJs.slice(workbenchJs.indexOf("function normalizeMcpServer"), workbenchJs.indexOf("function loadMcpLogs"));
assert(!/token\s*:/.test(normalizeMcpSource), "MCP Token 不应进入工作台服务器数据模型");
const agentAllowedTools = rust.slice(rust.indexOf("let allowed_tools = ["), rust.indexOf("if !allowed_tools.contains"));
assert(agentAllowedTools.includes("mcp_call"), "v1.6 应把受控 MCP 工具交给 Agent");

const capabilityContext = vm.createContext({ window: {} });
vm.runInContext(capabilityJs, capabilityContext);
const capabilityIds = vm.runInContext("window.KardiiCapabilities.features.map((item) => item.id)", capabilityContext);
assert(capabilityIds.includes("browser") && capabilityIds.includes("mcp"), "共享功能清单缺少浏览器或 MCP");
const knowledge = vm.runInContext(`window.KardiiCapabilities.knowledgeText({
  appVersion: "2.1.0", browserRunning: true, browserPaired: true,
  browserCaptureTitle: "测试网页", mcpConfigured: 1, mcpConnected: 1
})`, capabilityContext);
assert(knowledge.includes("浏览器已连接") && knowledge.includes("MCP1 个已连接"), "功能认知没有包含浏览器或 MCP 动态状态");
assert(knowledge.includes("不持续监控") && knowledge.includes("逐次确认"), "功能认知没有准确说明浏览器或 MCP 限制");
assert(readme.includes("v1.5 浏览器与 MCP 连接") && readme.includes("Streamable HTTP"), "README 缺少 v1.5 安装与安全说明");

console.log("Kardii v1.5 browser and MCP connection checks passed.");
