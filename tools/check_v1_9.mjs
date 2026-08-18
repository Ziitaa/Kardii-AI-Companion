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
const rust = read("src-tauri/src/lib.rs");
const agentHtml = read("src/agent.html");
const agentCss = read("src/agent.css");
const agentJs = read("src/agent.js");
const mainHtml = read("src/index.html");
const mainCss = read("src/style.css");
const mainJs = read("src/main.js");
const chatJs = read("src/chat.js");
const capabilities = read("src/kardii-capabilities.js");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauri.version, extension.version]) {
  assert(version === "2.1.0", `v1.9 版本号未统一：${version}`);
}
assert(/version = "2\.1\.0"/.test(cargo), "Cargo.toml 未更新为 2.1.0");
assert(capabilities.includes('const VERSION = "2.1.0"'), "共享功能清单未更新为 2.1.0");
assert(packageJson.scripts["test:v1.9"] === "node tools/check_v1_9.mjs", "v1.9 回归脚本未注册");

for (const id of ["parallelStatus", "taskWorkerBadge"]) {
  assert(agentHtml.includes(`id="${id}"`), `多 Agent 界面缺少 ${id}`);
  assert(agentJs.includes(`getElementById("${id}")`), `多 Agent 控件未绑定 ${id}`);
}
assert(agentJs.includes("const MAX_PARALLEL_AGENTS = 3") && agentJs.includes("const runningTaskIds = new Set()"), "三 Agent 并行执行器缺失");
for (const helper of ["claimAgentSlot", "releaseAgentSlot", "queueAgentTask", "nextQueuedTask", "drainAgentQueue"]) {
  assert(agentJs.includes(`function ${helper}`), `并行调度函数缺失：${helper}`);
}
assert(agentJs.includes('queued: "等待空闲 Agent"') && agentJs.includes('task.status = "queued"'), "Agent 排队状态缺失");
assert(!agentJs.includes("runningTaskId =") && !agentJs.includes("function blockingTask"), "仍残留单任务执行锁");
assert(agentCss.includes(".task-card.busy") && agentCss.includes(".parallel-status.busy") && agentCss.includes(".worker-badge"), "多 Agent 状态样式缺失");

assert(rust.includes("Emitter, Manager") && rust.includes("tokio::time::interval(Duration::from_secs(30))"), "Rust 后台定时器缺失");
assert(rust.includes('emit_to("agent", "kardii-background-tick"'), "Rust 没有唤醒隐藏 Agent 窗口");
assert(agentJs.includes('listen("kardii-background-tick"') && agentJs.includes("checkAutomations();\n  drainAgentQueue();"), "Agent 没有接收后台调度事件");
assert(agentJs.includes('createTask(automation.goal, 12, automation.skillId, { background: true })'), "自动化任务没有标记为后台执行");
assert(!agentJs.includes("surfaceAgentWindow"), "到期自动化不应抢占窗口焦点");

assert(mainHtml.includes('id="agentNotice"') && mainJs.includes('listen("kardii-agent-notice"'), "桌宠缺少后台 Agent 提醒");
assert(agentJs.includes('emitTo("main", "kardii-agent-notice"') && mainJs.includes("openAgent(agentNoticeTaskId)"), "提醒无法定位到对应任务");
assert(mainCss.includes(".agent-notice") && mainCss.includes("agent-notice-in"), "后台提醒缺少主题样式或动效");

assert(agentJs.includes('action.tool === "browser_action" || action.tool === "mcp_call"'), "浏览器或 MCP 写操作没有保持逐次确认");
assert(agentJs.includes('tool.risk !== "read"') && agentJs.includes("付款、购买、下单或资金转移类 MCP 工具已禁用"), "后台执行破坏了 MCP 安全边界");
assert(agentJs.includes('task.background && action.tool !== "mcp_call"'), "后台本机交互没有强制逐次确认");
assert(capabilities.includes('id: "parallel-agents"') && capabilities.includes("最多并行运行 3 个"), "帮助中心没有介绍 v1.9 多 Agent");
assert(capabilities.includes("完全退出 Kardii 或电脑关机后不会运行"), "功能认知没有说明后台运行边界");
assert(readme.includes("v1.9 多 Agent 并行与后台自动化") && readme.includes("第 4 个及之后的任务"), "README 缺少 v1.9 说明");
assert(!readme.includes("多 Agent 并行分工与真正的后台自动化执行端"), "README 路线图仍把 v1.9 列为未来功能");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name); else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.disabled = false;
    this.checked = false;
    this.options = [];
  }
  addEventListener() {}
  replaceChildren(...items) { this.options = items; }
  add(item) { this.options.push(item); }
  focus() {}
  closest() { return null; }
}

const referencedIds = [...agentJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const elements = new Map(referencedIds.map((id) => [id, new FakeElement()]));
const filters = ["active", "done", "all"].map((filter) => {
  const element = new FakeElement();
  element.dataset.filter = filter;
  return element;
});
const values = new Map();
const localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const never = new Promise(() => {});
const context = vm.createContext({
  window: {
    __TAURI__: {
      window: {
        getCurrentWindow: () => ({ show: async () => {}, unminimize: async () => {}, setFocus: async () => {}, minimize() {}, hide() {} }),
        getAllWindows: async () => [],
      },
      core: { invoke: async () => never },
      event: { emitTo: async () => {}, listen: async () => () => {} },
    },
    addEventListener() {},
  },
  document: {
    getElementById: (id) => elements.get(id) || new FakeElement(),
    querySelectorAll: (selector) => selector === ".task-filter" ? filters : [],
  },
  localStorage,
  crypto,
  console,
  Date,
  Intl,
  URL,
  JSON,
  Math,
  Number,
  String,
  Set,
  Map,
  Promise,
  Object,
  Array,
  Error,
  Option: class FakeOption { constructor(label, value) { this.label = label; this.value = value; } },
  setTimeout: () => 1,
  setInterval: () => 1,
  clearTimeout() {},
});
vm.runInContext(read("src/kardii-task-title.js"), context);
vm.runInContext(read("src/kardii-wecom-remote.js"), context);
vm.runInContext(agentJs, context);
const queueState = vm.runInContext(`(() => {
  tasks = [1, 2, 3, 4].map((number) => normalizeTask({
    id: "parallel-" + number,
    goal: "隔离任务 " + number,
    title: "隔离任务 " + number,
    status: "draft",
    plan: number === 4 ? [{ title: "继续", description: "保持独立记录", status: "pending" }] : [],
    history: [{ tool: "seed", title: "任务 " + number, result: "context-" + number }],
  }));
  const firstThree = tasks.slice(0, 3).map((task) => claimAgentSlot(task));
  const fourthClaim = claimAgentSlot(tasks[3]);
  queueAgentTask(tasks[3]);
  const queuedBeforeRelease = tasks[3].status;
  releaseAgentSlot(tasks[0]);
  drainAgentQueue();
  return {
    firstThree,
    fourthClaim,
    queuedBeforeRelease,
    activeCount: runningTaskIds.size,
    fourthStatus: tasks[3].status,
    fourthSlot: tasks[3].workerSlot,
    isolatedHistory: tasks.map((task) => task.history[0].result),
  };
})()`, context);
assert(queueState.firstThree.every(Boolean), "前三个 Agent 没有获得并行席位");
assert(queueState.fourthClaim === false && queueState.queuedBeforeRelease === "queued", "第四个任务没有进入队列");
assert(queueState.activeCount === 3 && queueState.fourthStatus === "running" && queueState.fourthSlot > 0, "释放席位后队列没有自动继续");
assert(new Set(queueState.isolatedHistory).size === 4, "并行任务的历史上下文发生串联");

for (const file of ["src/agent.js", "src/main.js", "src/chat.js", "src/kardii-capabilities.js"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: "utf8" });
  assert(result.status === 0, `${file} 语法检查失败：${result.stderr}`);
}

console.log("Kardii v1.9 parallel Agent and background automation checks passed.");
