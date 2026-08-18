import fs from "node:fs";
import vm from "node:vm";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const workbenchHtml = read("src/workbench.html");
const workbenchJs = read("src/workbench.js");
const agentHtml = read("src/agent.html");
const agentJs = read("src/agent.js");
const chatJs = read("src/chat.js");
const rust = read("src-tauri/src/lib.rs");

assert(workbenchHtml.includes("关系库") && !workbenchHtml.includes(">客户库<"), "关系库命名未完成");
assert(workbenchJs.includes("version: 4") && workbenchJs.includes("[1, 2, 3, 4].includes(saved.version)"), "v1 到 v4 数据迁移缺失");
assert(workbenchJs.includes("contacts: []") && workbenchJs.includes("relationshipId"), "独立联系人模型缺失");
assert(workbenchJs.includes("primaryContactId") && workbenchJs.includes("contactName:${contact.id}"), "联系人不可独立编辑或设置主要联系人");
assert(workbenchJs.includes("reports: []") && workbenchJs.includes("projectWorkspacePanelMarkup"), "项目工作台成果模型缺失");
assert(workbenchHtml.includes('id="reportGrid"') && workbenchJs.includes("function renderReports()"), "独立分析成果库缺失");
assert(workbenchJs.includes('data-action="edit-report"'), "分析成果不可重新打开编辑");

const legacyRelationship = {
  id: "legacy-company",
  company: "旧版服务商",
  contact: "王经理",
  title: "商务负责人",
  email: "wang@example.com",
  phone: "+86 10000",
  linkedProjectIds: [],
};
const migrationStorage = new Map([["kardii-business-data-v1", JSON.stringify({
  version: 1,
  settings: { autoCaptureEnabled: true },
  customers: [legacyRelationship],
  projects: [],
  tasks: [],
  notes: [],
  captures: [],
  activities: [],
  intelligence: [],
  knowledge: [],
})]]);
const migrationContext = vm.createContext({
  window: {
    __TAURI__: {
      window: { getCurrentWindow: () => ({}), getAllWindows: async () => [] },
      core: { invoke: async () => null },
    },
  },
  localStorage: {
    getItem: (key) => migrationStorage.get(key) ?? null,
    setItem: (key, value) => migrationStorage.set(key, String(value)),
  },
  crypto,
  structuredClone,
  Date,
  JSON,
  Set,
  Object,
});
const migrationPrelude = workbenchJs.slice(0, workbenchJs.indexOf("const navItems"));
const migrationFunctions = workbenchJs.slice(
  workbenchJs.indexOf("function normalizeEmailAccount"),
  workbenchJs.indexOf("function escapeHtml"),
);
vm.runInContext(read("src/kardii-wecom-remote.js"), migrationContext);
vm.runInContext(`${migrationPrelude}\n${migrationFunctions}`, migrationContext);
const migrated = vm.runInContext("data", migrationContext);
assert(migrated.version === 4 && migrated.customers[0].company === "旧版服务商", "旧版关系数据迁移失败");
assert(migrated.contacts.length === 1 && migrated.contacts[0].name === "王经理", "旧版联系人没有拆分保存");
assert(migrated.settings.autoCaptureEnabled === true && migrated.reports.length === 0, "旧版设置或新集合迁移失败");

for (const id of [
  "bundleBackdrop", "bundleFileList", "bundleObjective", "bundleRelationSelect",
  "bundleProjectSelect", "bundleIncludeChat", "analyzeBundleButton", "saveBundleButton", "bundleDraftFields",
]) {
  assert(workbenchHtml.includes(`id="${id}"`), `多文件预览控件缺失: ${id}`);
  assert(workbenchJs.includes(`getElementById("${id}")`), `多文件预览绑定缺失: ${id}`);
}
for (const command of ["analyze_knowledge_bundle", "persist_knowledge_files", "delete_persisted_knowledge_file"]) {
  assert(rust.includes(`fn ${command}`) || rust.includes(`async fn ${command}`), `后端命令缺失: ${command}`);
  assert(rust.includes(`            ${command},`), `后端命令未注册: ${command}`);
  assert(workbenchJs.includes(`invoke("${command}"`), `工作台未调用命令: ${command}`);
}
assert(workbenchJs.indexOf("openBundlePreview(files)") < workbenchJs.indexOf("persist_knowledge_files"), "文件必须先预览再持久化");
assert(workbenchJs.includes("pendingBundleAnalysis") && workbenchJs.includes("bundleDraftValue"), "AI 分析草稿不可编辑或未保存");
assert(workbenchJs.includes("currentConversationDocument()") && workbenchJs.includes("CHAT_SESSIONS_KEY"), "当前聊天会话未接入多文件分析");

assert(agentHtml.includes('id="stepPermissionButton"'), "逐步确认按钮缺失");
assert(agentJs.includes('waiting_authorization: "等待任务授权"'), "任务授权状态缺失");
assert(agentJs.includes("taskAuthorizationCovers(task, action)"), "单任务授权没有接入执行循环");
assert(agentJs.includes("actionNeedsFreshConfirmation(action)"), "高风险动作没有二次确认");
assert(agentJs.includes("isReadOnlyTerminalCommand"), "终端只读范围检查缺失");
assert(rust.includes("permissions: Vec<String>") && rust.includes('"permissions":["read_file"]'), "Agent 计划没有声明权限范围");
const authorizationContext = vm.createContext({});
vm.runInContext(agentJs.slice(
  agentJs.indexOf("function isReadOnlyTerminalCommand"),
  agentJs.indexOf("function appendHistory"),
), authorizationContext);
assert(vm.runInContext('isReadOnlyTerminalCommand("git status")', authorizationContext), "只读终端命令没有被任务授权识别");
assert(!vm.runInContext('isReadOnlyTerminalCommand("git status && git push")', authorizationContext), "组合命令错误绕过了再次确认");
assert(!vm.runInContext('isReadOnlyTerminalCommand("rm notes.txt")', authorizationContext), "删除命令错误绕过了再次确认");
assert(vm.runInContext('taskAuthorizationCovers({ authorizationMode: "task", authorizedTools: ["read_file"] }, { tool: "read_file", arguments: {} })', authorizationContext), "计划内低风险工具未被单任务授权覆盖");
assert(!vm.runInContext('taskAuthorizationCovers({ authorizationMode: "task", authorizedTools: ["run_terminal"] }, { tool: "run_terminal", arguments: { command: "git push" } })', authorizationContext), "高风险终端操作错误继承了单任务授权");

assert(rust.includes('"app-server"') && rust.includes('"initialize"') && rust.includes('"thread/start"') && rust.includes('"turn/start"'), "Codex app-server 生命周期缺失");
assert(rust.includes('"sandbox": "readOnly"') && rust.includes('"approvalPolicy": "never"'), "Codex 常驻连接未保持只读边界");
assert(rust.includes('"ephemeral": true') && rust.includes('"thread/unsubscribe"'), "Codex 常驻聊天没有使用非持久临时线程");
for (const isolation of ['features.shell_tool=false', 'features.computer_use=false', 'features.browser_use=false', 'features.apps=false', 'mcp_servers={}', 'plugins={}', 'skills.config=[]', 'hooks={}', 'history.persistence=\\"none\\"']) {
  assert(rust.includes(isolation), `Codex 常驻隔离缺失: ${isolation}`);
}
assert(rust.includes(".current_dir(&server_work_dir.path)"), "Codex app-server 进程没有放进独立空目录");
assert(rust.includes("run_codex_exec_prompt") && rust.includes("CODEX_APP_SERVER_UNAVAILABLE"), "Codex exec 兼容回退缺失");
assert(rust.includes("item/agentMessage/delta") && rust.includes("turn/completed"), "Codex 流式事件处理缺失");
assert(chatJs.includes("codexThreadKey: activeCodexThreadScope()"), "聊天会话的 Codex 线程连续性键缺失");
assert(chatJs.includes('invoke("reset_codex_conversation"'), "清空聊天未清理 Codex 常驻线程");

console.log("Kardii v1.2 workspace, relationship, authorization, and app-server checks passed.");
