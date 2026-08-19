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
const libRs = read("src-tauri/src/lib.rs");
const wecomRs = read("src-tauri/src/wecom.rs");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauri.version, extension.version]) {
  assert(version === "2.1.0", `v2.1.0 版本号未统一：${version}`);
}
assert(/version = "2\.1\.0"/.test(cargo), "Cargo.toml 未更新为 2.1.0");
assert(capabilities.includes('const VERSION = "2.1.0"'), "共享功能清单未更新为 2.1.0");
assert(packageJson.scripts["test:v2.1"] === "node tools/check_v2_1.mjs", "v2.1 回归脚本未注册");

for (const id of [
  "wecomRemoteAgentEnabledInput", "wecomRemoteKnowledgeInput", "wecomRemoteDocumentsInput",
  "wecomRemoteFilesInput", "wecomRemoteFolderList", "addWecomRemoteFolderButton", "wecomRemoteMcpList",
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
assert(mainJs.includes("await handleWecomRemoteCommand(payload, text, ai)"), "企微远程命令没有在普通聊天前分流");
assert(mainJs.indexOf('settings.ownerUserId !== fromUserId') < mainJs.indexOf('await prepareWecomAttachments(payload, text, ai)', mainJs.indexOf('async function handleWecomRemoteCommand')), "远程命令附件在绑定账号校验前被处理");
assert(mainJs.includes("settings.ownerUserId !== fromUserId"), "企微远程命令没有绑定账号校验");
assert(mainJs.includes('String(payload.chatType || "single") === "single"'), "企微远程命令没有限制为私聊");
assert(mainJs.includes("Date.now() + 5 * 60_000"), "任务二次确认草稿没有 5 分钟有效期");
assert(mainJs.includes("wecomRemoteStreams") && mainJs.includes("/结果"), "远程结果回传或补取入口缺失");
assert(mainJs.includes("activeCount >= 3"), "远程任务没有并发数量上限");
assert(mainJs.includes("wecomModelOptionAvailable") && mainJs.includes("/模型 DeepSeek") && mainJs.includes("/模型 Codex"), "企微模型切换入口缺失");
assert(mainJs.includes("prepareWecomAttachments") && mainJs.includes("replyWecomFile"), "企微附件处理或文件回复入口缺失");
assert(mainJs.includes("attachmentImages: attachment.images") && libRs.includes('"type": "image"'), "企微图片没有通过安全图像输入传给 Codex");
assert(mainJs.includes("wecomAiFailure(error)"), "企微 AI 失败时没有返回可诊断的脱敏原因");

assert(agentJs.includes("disableSkills: true"), "企微远程任务可能自动套用桌面自定义技能");
assert(agentJs.includes("window.KardiiWecomRemote.actionViolation(task.remoteSource, action)"), "Agent 执行前没有强制远程白名单");
assert(agentJs.includes("远程动作被安全策略阻止"), "远程动作拦截没有记录原因");
assert(agentJs.includes("enforceWecomRemoteSettings()"), "关闭或变更桌面远程设置后没有立即收紧任务");
assert(agentJs.includes("task.remoteSource.allowKnowledge = settings.allowKnowledge"), "运行中的远程任务没有应用最新知识库范围");
assert(agentJs.includes("task.remoteSource.allowWecomDocuments = settings.allowWecomDocuments"), "运行中的远程任务没有应用最新企微文档范围");
assert(agentJs.includes("task.remoteSource.authorizedFolders = settings.authorizedFolders"), "运行中的远程任务没有应用最新授权目录范围");
assert(agentJs.includes("task.remoteSource.allowedMcpTools = settings.allowedMcpTools"), "运行中的远程任务没有应用最新 MCP 白名单");
assert(agentJs.includes('arguments: argumentsValue, allowWrite: false'), "远程 MCP 调用没有在后端强制只读");
assert(libRs.includes("validated_wecom_remote_relative_path") && libRs.includes("canonical.starts_with(&root)"), "授权目录读取缺少路径穿越或目录逃逸防护");
assert(wecomRs.includes("decrypt_wecom_attachment") && wecomRs.includes("reply_wecom_media"), "企微附件解密或媒体回复后端缺失");

const sandbox = { window: {}, Uint8Array };
vm.runInNewContext(remoteJs, sandbox, { filename: "kardii-wecom-remote.js" });
const remote = sandbox.window.KardiiWecomRemote;
assert(remote.parseCommand("普通聊天") === null, "普通聊天被错误识别为远程命令");
assert(remote.parseCommand("/任务 搜索公开资料").goal === "搜索公开资料", "/任务 解析失败");
assert(remote.parseCommand("／状态").type === "status", "全角斜杠命令解析失败");
assert(remote.parseCommand("/确认").type === "confirm", "简化的 /确认 解析失败");
assert(remote.parseCommand("/确认 A2B3C4").type === "confirm", "/确认 解析失败");
assert(remote.parseCommand("/模型 Codex").model === "Codex", "/模型 解析失败");
assert(remote.parseCommand("/回答 A2B3C4 继续比较第二份资料").answer === "继续比较第二份资料", "/回答 解析失败");
assert(remote.parseCommand("/结果 A2B3C4").type === "result", "/结果 解析失败");
assert(remote.parseCommand("/取消").type === "cancel", "取消待确认草稿解析失败");
assert(remote.parseCommand("/确认 123").type === "invalid", "无效验证码没有被拒绝");
const generated = remote.createCode({ getRandomValues(bytes) { bytes.set([1, 2, 3, 4, 5, 6]); return bytes; } });
assert(/^[2-9A-HJ-NP-Z]{6}$/.test(generated), "生成的绑定码格式不安全或难辨认");

const source = {
  taskCode: "A2B3C4",
  allowKnowledge: false,
  allowWecomDocuments: false,
  allowAuthorizedFiles: false,
  authorizedFolders: [],
  allowedMcpTools: [],
};
assert(remote.actionViolation(source, { tool: "web_search" }) === "", "公开搜索被错误阻止");
assert(remote.actionViolation(source, { tool: "knowledge_search" }).includes("没有获得"), "未授权知识库读取没有被阻止");
assert(remote.actionViolation({ ...source, allowKnowledge: true }, { tool: "knowledge_search" }) === "", "已授权知识库只读被错误阻止");
assert(remote.actionViolation({ ...source, allowWecomDocuments: true }, { tool: "wecom_document", arguments: { action: "read" } }) === "", "已授权企微文档读取被错误阻止");
assert(remote.actionViolation({ ...source, allowWecomDocuments: true }, { tool: "wecom_document", arguments: { action: "append" } }).includes("不允许"), "企微远程文档写入没有被阻止");
const fileSource = { ...source, allowAuthorizedFiles: true, authorizedFolders: [{ id: "folder-1", name: "Reports" }] };
assert(remote.actionViolation(fileSource, { tool: "authorized_file", arguments: { action: "search" } }) === "", "授权目录搜索被错误阻止");
assert(remote.actionViolation(fileSource, { tool: "authorized_file", arguments: { action: "read", folderId: "folder-1" } }) === "", "授权目录读取被错误阻止");
assert(remote.actionViolation(fileSource, { tool: "authorized_file", arguments: { action: "read", folderId: "folder-2" } }).includes("不在"), "未授权目录读取没有被阻止");
const mcpSource = { ...source, allowedMcpTools: ["server-1::lookup"] };
assert(remote.actionViolation(mcpSource, { tool: "mcp_call", arguments: { serverId: "server-1", toolName: "lookup" } }) === "", "白名单只读 MCP 被错误阻止");
assert(remote.actionViolation(mcpSource, { tool: "mcp_call", arguments: { serverId: "server-1", toolName: "write" } }).includes("白名单"), "非白名单 MCP 没有被阻止");
for (const tool of ["memory_search", "browser_read", "browser_action", "read_file", "read_clipboard", "write_clipboard", "open_url", "run_terminal"]) {
  assert(remote.actionViolation({ ...source, allowKnowledge: true, allowWecomDocuments: true }, { tool }), `高风险远程工具 ${tool} 没有被阻止`);
}

assert(readme.includes("v2.1 手机企微远程 Agent") && readme.includes("`/确认`") && readme.includes("`/模型 DeepSeek`") && readme.includes("授权目录只读") && readme.includes("只读 MCP"), "README 缺少 v2.1 远程使用说明");
assert(capabilities.includes("手机企微远程 Agent") && capabilities.includes("逐工具 MCP 只读白名单") && capabilities.includes("不带任务码的一次性 /确认"), "Kardii 功能认知缺少 v2.1 远程能力");

for (const file of ["src/kardii-wecom-remote.js", "src/main.js", "src/agent.js", "src/workbench.js", "src/kardii-capabilities.js", "tools/check_v2_1.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: "utf8" });
  assert(result.status === 0, `${file} 语法检查失败：${result.stderr}`);
}

console.log("Kardii v2.1 WeCom remote Agent checks passed.");
