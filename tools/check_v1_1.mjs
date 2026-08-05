import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

execFileSync(process.execPath, [new URL("./check_v1.mjs", import.meta.url).pathname], { stdio: "inherit" });

const rust = read("src-tauri/src/lib.rs");
const cargo = read("src-tauri/Cargo.toml");
const chatHtml = read("src/chat.html");
const chatJs = read("src/chat.js");
const agentHtml = read("src/agent.html");
const agentJs = read("src/agent.js");
const readme = read("README.md");

for (const command of ["get_codex_status", "start_codex_login", "logout_codex"]) {
  assert(rust.includes(`async fn ${command}`), `missing Codex command: ${command}`);
  assert(rust.includes(`            ${command},`), `Codex command not registered: ${command}`);
}
for (const command of ["get_codex_status", "start_codex_login", "logout_codex", "test_ai_connection"]) {
  assert(chatJs.includes(`invoke("${command}"`), `Codex UI does not invoke: ${command}`);
}
assert(chatHtml.includes('<option value="codex">'), "Codex provider option is missing");
assert(chatHtml.includes('id="codexStatusRow"'), "Codex status panel is missing");
assert(rust.includes('"--sandbox".to_string()') && rust.includes('"read-only".to_string()'), "Codex is not constrained to read-only sandbox");
assert(rust.includes('"--ignore-user-config".to_string()') && rust.includes('"--ignore-rules".to_string()'), "Codex provider does not isolate user config and rules");
for (const control of [
  'web_search=\\"disabled\\"',
  'agents.enabled=false',
  'tools.view_image=false',
  'apps._default.enabled=false',
  'shell_environment_policy.inherit=\\"none\\"',
]) {
  assert(rust.includes(control), `Codex isolation control is missing: ${control}`);
}
assert(rust.includes("CodexWorkDir::create()"), "Codex does not use a private temporary workspace");
assert(!rust.includes('auth.json'), "Kardii must not read or copy Codex auth.json");
assert(cargo.includes('features = ["io-util", "process", "time"]'), "Tokio process I/O support is missing");

for (const id of [
  "skillsButton", "skillsView", "skillForm", "taskSkillSelect", "saveAsSkillButton",
  "automationsButton", "automationsView", "automationForm", "automationList",
]) {
  assert(agentHtml.includes(`id="${id}"`), `missing Agent v1.1 UI id: ${id}`);
}
assert(agentJs.includes('const AGENT_SKILLS_KEY = "kardii-agent-skills-v1"'), "Skill persistence key is missing");
assert(agentJs.includes('const AUTOMATIONS_KEY = "kardii-automations-v1"'), "Automation persistence key is missing");
assert(agentJs.includes('skillSnapshot'), "Tasks do not preserve skill snapshots");
assert(agentJs.includes('setInterval(checkAutomations, 30_000)'), "Local automation scheduler is missing");
assert(agentJs.includes('if (automation.autoStart) void planTask(task.id)'), "Automations cannot start Agent tasks");
assert(agentJs.includes('if (advanceSchedule) void surfaceAgentWindow()'), "Due automations do not surface their saved task");
assert(agentJs.includes('PERMISSION_TOOLS.has(action.tool)'), "Automation path lost per-step permission gating");
assert(chatJs.includes("agentSkills") && chatJs.includes("automations"), "Full backup does not include skills and automations");
assert(chatHtml.includes("API Key 与 Codex 登录永远不会导出"), "Backup UI does not disclose credential exclusion");
assert(readme.includes("## v1.1 Codex、技能与自动化"), "README does not document v1.1");

console.log("Kardii v1.1 Codex, skills, and automation checks passed.");
