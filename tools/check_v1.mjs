import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const file of ["src/agent.js", "src/chat.js", "src/workbench.js", "src/kardii-dialog.js", "src/kardii-task-title.js"]) {
  execFileSync(process.execPath, ["--check", new URL(`../${file}`, import.meta.url).pathname], { stdio: "pipe" });
}

const agentHtml = read("src/agent.html");
const agentJs = read("src/agent.js");
const taskTitleJs = read("src/kardii-task-title.js");
const rust = read("src-tauri/src/lib.rs");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
const packageJson = JSON.parse(read("package.json"));
const cargo = read("src-tauri/Cargo.toml");
const workbenchJs = read("src/workbench.js");
const chatHtml = read("src/chat.html");
const workbenchHtml = read("src/workbench.html");

const referencedIds = [...agentJs.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
for (const id of referencedIds) {
  assert(agentHtml.includes(`id="${id}"`), `agent.js references missing HTML id: ${id}`);
}

for (const command of ["create_agent_plan", "decide_agent_action", "run_web_search"]) {
  assert(rust.includes(`async fn ${command}`), `missing Rust Agent command: ${command}`);
  assert(rust.includes(`            ${command},`), `Agent command not registered: ${command}`);
  assert(agentJs.includes(`invoke("${command}"`), `Agent UI does not call command: ${command}`);
}

assert(config.version === "1.6.0", "tauri.conf.json version is not 1.6.0");
assert(packageJson.version === "1.6.0", "package.json version is not 1.6.0");
assert(/version = "1\.6\.0"/.test(cargo), "Cargo.toml version is not 1.6.0");
assert(config.app.windows.some((window) => window.label === "agent" && window.url === "agent.html"), "Agent window is missing from Tauri config");
assert(capability.windows.includes("agent"), "Agent window is missing from capabilities");
assert(chatHtml.includes('id="agentModeButton"') && chatHtml.includes('id="agentCenterButton"'), "Chat Agent entry points are missing");
assert(workbenchHtml.includes('id="autoCaptureToggle"'), "Business auto-capture toggle is missing");

for (const seededText of ["Target 入驻", "欧洲市场启动", "分销合作体系", "整理本周最优先的 BD 下一步"]) {
  assert(!workbenchJs.includes(seededText), `business-specific seed remains: ${seededText}`);
}
const fieldMarkup = workbenchJs.slice(workbenchJs.indexOf("function fieldMarkup"), workbenchJs.indexOf("function currentResearchAiConfig"));
assert(!fieldMarkup.includes("placeholder="), "Workbench modal fields still render placeholder text");
assert(/settings:\s*\{\s*autoCaptureEnabled: false,/.test(workbenchJs), "Business auto-capture is not opt-in for new users");
assert(read("src/chat.js").includes("businessData.settings?.autoCaptureEnabled !== true"), "Chat does not respect the business auto-capture toggle");

class FakeClassList {
  values = new Set();
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
  classList = new FakeClassList();
  dataset = {};
  value = "";
  textContent = "";
  innerHTML = "";
  className = "";
  disabled = false;
  checked = false;
  options = [];
  addEventListener() {}
  replaceChildren(...items) { this.options = items; }
  add(item) { this.options.push(item); }
  focus() {}
  closest() { return null; }
}
const elements = new Map(referencedIds.map((id) => [id, new FakeElement()]));
elements.get("maxStepsInput").value = "12";
const filterElements = ["active", "done", "all"].map((filter) => {
  const element = new FakeElement();
  element.dataset.filter = filter;
  return element;
});
const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const fakeWindow = {
  __TAURI__: {
    window: {
      getCurrentWindow: () => ({ minimize() {}, hide() {} }),
      getAllWindows: async () => [],
    },
    core: { invoke: async () => null },
  },
  addEventListener() {},
  confirm: () => false,
};
const runtimeContext = vm.createContext({
  window: fakeWindow,
  document: {
    getElementById: (id) => elements.get(id) || new FakeElement(),
    querySelectorAll: (selector) => selector === ".task-filter" ? filterElements : [],
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
  Option: class FakeOption { constructor(label, value) { this.label = label; this.value = value; } },
  Array,
  Object,
  Error,
  setTimeout: () => 1,
  setInterval: () => 1,
  clearTimeout() {},
});
vm.runInContext(taskTitleJs, runtimeContext);
const summarizedTitle = vm.runInContext(`window.summarizeAgentTaskTitle(
  "今天做合规的Daria过来找我聊了之前关于入驻target需要的美国独立商用地址的服务协议分付款事宜，然后协议上还有一些"
)`, runtimeContext);
assert(
  summarizedTitle.includes("Target 入驻") && summarizedTitle.includes("付款事宜") && !summarizedTitle.includes("Daria") && [...summarizedTitle].length <= 35,
  `Agent task title was not summarized: ${summarizedTitle}`,
);
vm.runInContext(agentJs, runtimeContext);
const createdTaskId = vm.runInContext('createTask("整理一份旅行清单", 7).id', runtimeContext);
const storedTasks = JSON.parse(localStorage.getItem("kardii-agent-tasks-v1"));
assert(storedTasks.length === 1 && storedTasks[0].id === createdTaskId, "Agent task creation did not persist");
assert(storedTasks[0].status === "draft" && storedTasks[0].maxSteps === 7, "Agent task limits were not normalized");
const boundedTaskId = vm.runInContext('createTask("测试执行上限", 99).id', runtimeContext);
const boundedTask = JSON.parse(localStorage.getItem("kardii-agent-tasks-v1")).find((task) => task.id === boundedTaskId);
assert(boundedTask.maxSteps === 20, "Agent maximum step bound is not enforced");
localStorage.setItem("kardii-agent-tasks-v1", JSON.stringify([{ id: "interrupted", goal: "test", status: "running" }]));
const interruptedStatus = vm.runInContext('loadTasks()[0].status', runtimeContext);
assert(interruptedStatus === "paused", "Interrupted Agent tasks do not recover in a safe paused state");

localStorage.setItem("kardii-business-data-v1", JSON.stringify({
  version: 1,
  knowledge: [{ title: "Packing notes", status: "active", content: "Remember to pack a passport and charger." }],
}));
const knowledgeResult = vm.runInContext('searchKnowledge("passport")', runtimeContext);
assert(knowledgeResult.includes("[K1.1]") && knowledgeResult.includes("passport"), "Agent knowledge retrieval smoke test failed");
localStorage.setItem("kardii-memories-v1", JSON.stringify(["用户喜欢靠窗座位", "用户不喜欢红眼航班"]));
const memoryResult = vm.runInContext('searchMemories("座位")', runtimeContext);
assert(memoryResult.includes("靠窗座位"), "Agent memory retrieval smoke test failed");

const skillTaskId = vm.runInContext(`(() => {
  skills = [normalizeSkill({ id: "skill-1", name: "整理技能", triggers: "整理", instructions: "先分类，再汇总。", enabled: true })];
  saveSkills();
  return createTask("请整理这些资料", 8, "skill-1").id;
})()`, runtimeContext);
const skillTask = JSON.parse(localStorage.getItem("kardii-agent-tasks-v1")).find((task) => task.id === skillTaskId);
assert(skillTask.skillId === "skill-1" && skillTask.skillSnapshot.includes("先分类"), "Agent skill snapshot was not attached to task");
const dailyNext = vm.runInContext(`nextAutomationRun({ schedule: "daily", time: "09:00" }, new Date("2026-08-04T10:00:00"))`, runtimeContext);
assert(new Date(dailyNext).getTime() > new Date("2026-08-04T10:00:00").getTime(), "Daily automation did not advance to a future run");
const attachmentEvidence = vm.runInContext(`questionAttachmentEvidence([
  { name: "brief.pdf", fileType: "pdf", size: 1200, content: "产品要求：保留原有结构。" },
  { name: "product.png", fileType: "png", size: 2400, content: "" }
], "图片中可见一个黑色储物箱。")`, runtimeContext);
assert(attachmentEvidence.includes("brief.pdf") && attachmentEvidence.includes("保留原有结构"), "Agent file attachment content was not preserved");
assert(attachmentEvidence.includes("product.png") && attachmentEvidence.includes("图片识别结果"), "Agent image attachment analysis was not preserved");

console.log(`Kardii v1.1 checks passed (${referencedIds.length} Agent UI bindings).`);
