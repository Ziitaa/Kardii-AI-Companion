import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = json("package.json");
const packageLock = json("package-lock.json");
const tauri = json("src-tauri/tauri.conf.json");
const extension = json("src-tauri/browser-extension/manifest.json");
const cargo = read("src-tauri/Cargo.toml");
const remoteJs = read("src/kardii-wecom-remote.js");
const mainJs = read("src/main.js");
const agentJs = read("src/agent.js");
const workbenchHtml = read("src/workbench.html");
const workbenchJs = read("src/workbench.js");
const workbenchCss = read("src/workbench.css");
const storageJs = read("src/kardii-storage.js");
const indexHtml = read("src/index.html");
const agentHtml = read("src/agent.html");
const capabilities = read("src/kardii-capabilities.js");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauri.version, extension.version]) {
  assert(version === "2.1.0", `v2.1.0 版本号未统一：${version}`);
}
assert(/version = "2\.1\.0"/.test(cargo), "Cargo.toml 未更新为 2.1.0");
assert(capabilities.includes('const VERSION = "2.1.0"'), "共享功能清单未更新为 2.1.0");
assert(packageJson.scripts["test:v2.1"] === "node tools/check_v2_1.mjs", "v2.1 回归脚本未注册");

for (const id of [
  "wecomRemoteAgentEnabledInput", "wecomRemoteKnowledgeInput", "wecomRemoteDocumentsInput",
  "wecomRemoteOwnerLabel", "wecomRemotePairingCode", "generateWecomRemotePairingButton",
  "copyWecomRemotePairingButton", "unbindWecomRemoteOwnerButton", "wecomRemoteAgentStatus",
]) {
  assert(workbenchHtml.includes(`id="${id}"`), `企微远程 Agent 界面缺少 ${id}`);
  assert(workbenchJs.includes(`getElementById("${id}")`), `企微远程 Agent 控件未绑定 ${id}`);
}
assert(workbenchCss.includes(".wecom-remote-panel") && workbenchCss.includes(".wecom-remote-scopes"), "企微远程 Agent 缺少主题样式");
for (const page of [indexHtml, agentHtml, workbenchHtml]) {
  assert(page.includes('src="./kardii-wecom-remote.js"'), "主窗口、Agent 或工作台没有加载共享远程策略");
}

assert(workbenchJs.includes("wecomRemoteAgentEnabled: false"), "远程 Agent 没有默认关闭");
assert(workbenchJs.includes("Date.now() + 10 * 60_000"), "电脑端绑定码没有 10 分钟有效期");
assert(workbenchJs.includes("wecomRemoteOwnerUserId = \"\"") && workbenchJs.includes("wecomRemoteAgentEnabled = false"), "解除绑定没有同时关闭远程通道");
assert(workbenchJs.includes("localStorage.removeItem(WECOM_REMOTE_PENDING_KEY)"), "关闭或解绑没有清理待确认任务");
assert(storageJs.includes('"kardii-wecom-remote-pairing-v1"') && storageJs.includes('"kardii-wecom-remote-pending-v1"'), "一次性绑定码或未确认草稿可能进入 SQLite 恢复点");
assert(!workbenchJs.includes("wecomRemotePairingCode: \"\""), "一次性绑定码不应保存在工作台持久设置中");

for (const event of ["kardii-wecom-remote-start", "kardii-wecom-remote-answer", "kardii-wecom-remote-cancel", "kardii-wecom-remote-update"]) {
  assert(mainJs.includes(event) || agentJs.includes(event), `企微远程事件缺少 ${event}`);
}
assert(mainJs.includes("await handleWecomRemoteCommand(payload, text)"), "企微远程命令没有在普通聊天前分流");
assert(mainJs.includes("settings.ownerUserId !== fromUserId"), "企微远程命令没有绑定账号校验");
assert(mainJs.includes('String(payload.chatType || "single") === "single"'), "企微远程命令没有限制为私聊");
assert(mainJs.includes("Date.now() + 5 * 60_000"), "任务二次确认码没有 5 分钟有效期");
assert(mainJs.includes("wecomRemoteStreams") && mainJs.includes("/结果"), "远程结果回传或补取入口缺失");
assert(mainJs.includes("activeCount >= 3"), "远程任务没有并发数量上限");

assert(agentJs.includes("disableSkills: true"), "企微远程任务可能自动套用桌面自定义技能");
assert(agentJs.includes("window.KardiiWecomRemote.actionViolation(task.remoteSource, action)"), "Agent 执行前没有强制远程白名单");
assert(agentJs.includes("远程动作被安全策略阻止"), "远程动作拦截没有记录原因");
assert(agentJs.includes("enforceWecomRemoteSettings()"), "关闭或变更桌面远程设置后没有立即收紧任务");
assert(agentJs.includes("task.remoteSource.allowKnowledge = settings.allowKnowledge"), "运行中的远程任务没有应用最新知识库范围");
assert(agentJs.includes("task.remoteSource.allowWecomDocuments = settings.allowWecomDocuments"), "运行中的远程任务没有应用最新企微文档范围");

const sandbox = { window: {}, Uint8Array };
vm.runInNewContext(remoteJs, sandbox, { filename: "kardii-wecom-remote.js" });
const remote = sandbox.window.KardiiWecomRemote;
assert(remote.parseCommand("普通聊天") === null, "普通聊天被错误识别为远程命令");
assert(remote.parseCommand("/任务 搜索公开资料").goal === "搜索公开资料", "/任务 解析失败");
assert(remote.parseCommand("／状态").type === "status", "全角斜杠命令解析失败");
assert(remote.parseCommand("/确认 A2B3C4").type === "confirm", "/确认 解析失败");
assert(remote.parseCommand("/回答 A2B3C4 继续比较第二份资料").answer === "继续比较第二份资料", "/回答 解析失败");
assert(remote.parseCommand("/结果 A2B3C4").type === "result", "/结果 解析失败");
assert(remote.parseCommand("/取消").type === "cancel", "取消待确认草稿解析失败");
assert(remote.parseCommand("/确认 123").type === "invalid", "无效验证码没有被拒绝");
const generated = remote.createCode({ getRandomValues(bytes) { bytes.set([1, 2, 3, 4, 5, 6]); return bytes; } });
assert(/^[2-9A-HJ-NP-Z]{6}$/.test(generated), "生成的绑定码格式不安全或难辨认");

const source = { taskCode: "A2B3C4", allowKnowledge: false, allowWecomDocuments: false };
assert(remote.actionViolation(source, { tool: "web_search" }) === "", "公开搜索被错误阻止");
assert(remote.actionViolation(source, { tool: "knowledge_search" }).includes("没有获得"), "未授权知识库读取没有被阻止");
assert(remote.actionViolation({ ...source, allowKnowledge: true }, { tool: "knowledge_search" }) === "", "已授权知识库只读被错误阻止");
assert(remote.actionViolation({ ...source, allowWecomDocuments: true }, { tool: "wecom_document", arguments: { action: "read" } }) === "", "已授权企微文档读取被错误阻止");
assert(remote.actionViolation({ ...source, allowWecomDocuments: true }, { tool: "wecom_document", arguments: { action: "append" } }).includes("不允许"), "企微远程文档写入没有被阻止");
for (const tool of ["memory_search", "browser_read", "browser_action", "mcp_call", "read_file", "read_clipboard", "write_clipboard", "open_url", "run_terminal"]) {
  assert(remote.actionViolation({ ...source, allowKnowledge: true, allowWecomDocuments: true }, { tool }), `高风险远程工具 ${tool} 没有被阻止`);
}

assert(readme.includes("v2.1 手机企微远程 Agent") && readme.includes("/确认") && readme.includes("/结果"), "README 缺少 v2.1 远程使用说明");
assert(capabilities.includes("手机企微远程 Agent") && capabilities.includes("固定只读白名单"), "Kardii 功能认知缺少 v2.1 远程能力");

for (const file of ["src/kardii-wecom-remote.js", "src/main.js", "src/agent.js", "src/workbench.js", "src/kardii-capabilities.js", "tools/check_v2_1.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: "utf8" });
  assert(result.status === 0, `${file} 语法检查失败：${result.stderr}`);
}

console.log("Kardii v2.1 WeCom remote Agent checks passed.");
