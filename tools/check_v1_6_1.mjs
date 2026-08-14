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
const manifest = JSON.parse(read("src-tauri/browser-extension/manifest.json"));
const cargo = read("src-tauri/Cargo.toml");
const chatHtml = read("src/chat.html");
const chatCss = read("src/chat.css");
const chatJs = read("src/chat.js");
const agentHtml = read("src/agent.html");
const agentJs = read("src/agent.js");
const workbenchJs = read("src/workbench.js");
const capabilities = read("src/kardii-capabilities.js");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauriConfig.version, manifest.version]) {
  assert(version === "1.7.0", `v1.7.0 版本号未统一：${version}`);
}
assert(/version = "1\.7\.0"/.test(cargo), "Cargo.toml 未更新为 v1.7.0");
assert(capabilities.includes('const VERSION = "1.7.0"'), "共享功能说明没有更新为 v1.7.0");
assert(capabilities.includes("const LIMITATIONS") && capabilities.includes("多 Agent 并行分工") && capabilities.includes("SQLite 数据层"), "Kardii 没有掌握尚未实现的路线边界");

for (const id of ["chatSessionsButton", "chatSessionsPanel", "newChatSessionButton", "chatSessionList", "chatSessionTitle"]) {
  assert(chatHtml.includes(`id="${id}"`), `聊天会话界面缺少 ${id}`);
  assert(chatJs.includes(`getElementById("${id}")`), `聊天脚本没有连接 ${id}`);
}
for (const id of [...chatJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1])) {
  assert(chatHtml.includes(`id="${id}"`), `chat.js 引用了不存在的界面元素：${id}`);
}
assert(chatHtml.includes('src="./kardii-chat-sessions.js"'), "聊天页面没有加载会话数据模型");
assert(chatCss.includes(".chat-session-row.active") && chatCss.includes(".chat-session-agent-badge"), "聊天会话列表缺少当前项或 Agent 状态样式");

const context = vm.createContext({
  window: {},
  crypto: { randomUUID: (() => { let id = 0; return () => `session-${++id}`; })() },
  Date,
  Math,
});
vm.runInContext(read("src/kardii-chat-sessions.js"), context);
const sessionsApi = context.window.KardiiChatSessions;
assert(sessionsApi?.maxSessions === 30 && sessionsApi?.maxMessages === 50, "会话数量或单会话历史上限错误");

const legacy = [
  { role: "user", content: "帮我整理 Target 入驻协议，然后列出风险" },
  { role: "assistant", content: "好的。" },
];
const migrated = sessionsApi.normalizeStore(null, legacy);
assert(migrated.sessions.length === 1, "旧版聊天记录没有迁移成一个会话");
assert(migrated.sessions[0].messages.length === 2, "迁移时丢失了旧版聊天消息");
assert(migrated.sessions[0].title !== "新对话", "迁移后的会话没有自动生成标题");

const twoSessions = sessionsApi.normalizeStore({
  activeSessionId: "second",
  sessions: [
    { id: "first", title: "事项一", messages: [{ role: "user", content: "第一件事" }] },
    { id: "second", title: "事项二", messages: [{ role: "user", content: "第二件事" }], linkedAgentTaskId: "task-2" },
  ],
});
assert(twoSessions.activeSessionId === "second", "没有保留当前会话");
assert(twoSessions.sessions[0].messages[0].content === "第一件事", "不同会话的历史发生串联");
assert(twoSessions.sessions[1].linkedAgentTaskId === "task-2", "会话没有保留关联 Agent 任务");

const tooMany = sessionsApi.normalizeStore({
  sessions: Array.from({ length: 35 }, (_, index) => ({ id: `s-${index}`, title: `会话 ${index}` })),
});
assert(tooMany.sessions.length === 30, "会话上限没有生效");

assert(chatJs.includes("codexThreadKey: activeCodexThreadScope()"), "Codex 仍未使用独立会话线程");
assert(!chatJs.includes('codexThreadKey: "kardii-main-chat-v1"'), "仍残留全局 Codex 聊天线程");
assert(chatJs.includes("linkedAgentContext()") && chatJs.includes("sourceChatSessionId"), "普通聊天没有衔接关联 Agent 上下文");
assert(chatJs.includes('target: { autoStart: true, continuation: true }'), "同一会话没有继续原 Agent 任务");
assert(chatJs.includes('target: { resume: true }'), "聊天无法回答等待输入的 Agent 任务");
assert(agentJs.includes("target.resume && task.status === \"running\"") && agentJs.includes("sourceChatSessionTitle"), "Agent 没有恢复关联任务或显示来源会话");
assert(agentHtml.includes('id="taskChatBadge"'), "Agent 页面缺少来源会话标记");
assert(chatJs.includes("consumeChatSessionTarget()") && agentJs.includes("task.sourceChatSessionId"), "从 Agent 返回聊天时没有定位来源会话");
assert(chatJs.includes("chatSessions: chatSessionStore.sessions") && chatJs.includes("data.chatSessions"), "完整备份没有覆盖全部会话");
assert(workbenchJs.includes("CHAT_SESSIONS_KEY") && workbenchJs.includes("sessionStore.activeSessionId"), "工作台没有读取当前聊天会话");
assert(readme.includes("v1.6.1 多会话与 Agent 任务连续性"), "README 缺少 v1.6.1 说明");

console.log("Kardii v1.6.1 multi-session and Agent continuity checks passed.");
