const { getCurrentWindow, getAllWindows } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;

const appWindow = getCurrentWindow();
const AGENT_TASKS_KEY = "kardii-agent-tasks-v1";
const AGENT_TARGET_KEY = "kardii-agent-open-target-v1";
const AGENT_SKILLS_KEY = "kardii-agent-skills-v1";
const AUTOMATIONS_KEY = "kardii-automations-v1";
const AI_SETTINGS_KEY = "kardii-ai-settings-v1";
const BUSINESS_DATA_KEY = "kardii-business-data-v1";
const MEMORIES_KEY = "kardii-memories-v1";
const MAX_TASKS = 100;
const PERMISSION_TOOLS = new Set(["read_file", "read_clipboard", "write_clipboard", "open_url", "run_terminal"]);
const FINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const STATUS_LABELS = {
  draft: "等待开始",
  planning: "制定计划",
  running: "执行中",
  paused: "已暂停",
  waiting_authorization: "等待任务授权",
  waiting_permission: "等待确认",
  waiting_input: "等待回答",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const createView = document.getElementById("createView");
const taskView = document.getElementById("taskView");
const createTaskForm = document.getElementById("createTaskForm");
const goalInput = document.getElementById("goalInput");
const maxStepsInput = document.getElementById("maxStepsInput");
const startTaskButton = document.getElementById("startTaskButton");
const showCreateButton = document.getElementById("showCreateButton");
const taskList = document.getElementById("taskList");
const taskStatusBadge = document.getElementById("taskStatusBadge");
const taskTitle = document.getElementById("taskTitle");
const taskGoal = document.getElementById("taskGoal");
const taskSkillBadge = document.getElementById("taskSkillBadge");
const stepMetric = document.getElementById("stepMetric");
const aiMetric = document.getElementById("aiMetric");
const toolMetric = document.getElementById("toolMetric");
const updatedMetric = document.getElementById("updatedMetric");
const planSummary = document.getElementById("planSummary");
const planList = document.getElementById("planList");
const currentActionPanel = document.getElementById("currentActionPanel");
const currentActionTitle = document.getElementById("currentActionTitle");
const currentActionExplanation = document.getElementById("currentActionExplanation");
const questionPanel = document.getElementById("questionPanel");
const questionText = document.getElementById("questionText");
const questionAnswer = document.getElementById("questionAnswer");
const submitAnswerButton = document.getElementById("submitAnswerButton");
const resultPanel = document.getElementById("resultPanel");
const finalAnswer = document.getElementById("finalAnswer");
const activityList = document.getElementById("activityList");
const pauseButton = document.getElementById("pauseButton");
const resumeButton = document.getElementById("resumeButton");
const retryButton = document.getElementById("retryButton");
const cancelButton = document.getElementById("cancelButton");
const permissionPanel = document.getElementById("permissionPanel");
const permissionBadge = document.getElementById("permissionBadge");
const permissionTitle = document.getElementById("permissionTitle");
const permissionDescription = document.getElementById("permissionDescription");
const permissionDetail = document.getElementById("permissionDetail");
const allowPermissionButton = document.getElementById("allowPermissionButton");
const denyPermissionButton = document.getElementById("denyPermissionButton");
const stepPermissionButton = document.getElementById("stepPermissionButton");
const toast = document.getElementById("toast");
const skillsButton = document.getElementById("skillsButton");
const skillsView = document.getElementById("skillsView");
const taskSkillSelect = document.getElementById("taskSkillSelect");
const skillList = document.getElementById("skillList");
const skillForm = document.getElementById("skillForm");
const skillIdInput = document.getElementById("skillIdInput");
const skillNameInput = document.getElementById("skillNameInput");
const skillDescriptionInput = document.getElementById("skillDescriptionInput");
const skillTriggersInput = document.getElementById("skillTriggersInput");
const skillInstructionsInput = document.getElementById("skillInstructionsInput");
const skillEnabledInput = document.getElementById("skillEnabledInput");
const newSkillButton = document.getElementById("newSkillButton");
const restoreSkillButton = document.getElementById("restoreSkillButton");
const deleteSkillButton = document.getElementById("deleteSkillButton");
const saveAsSkillButton = document.getElementById("saveAsSkillButton");
const automationsButton = document.getElementById("automationsButton");
const automationsView = document.getElementById("automationsView");
const automationList = document.getElementById("automationList");
const automationForm = document.getElementById("automationForm");
const automationIdInput = document.getElementById("automationIdInput");
const automationNameInput = document.getElementById("automationNameInput");
const automationGoalInput = document.getElementById("automationGoalInput");
const automationScheduleSelect = document.getElementById("automationScheduleSelect");
const automationOnceRow = document.getElementById("automationOnceRow");
const automationDailyRow = document.getElementById("automationDailyRow");
const automationWeeklyRow = document.getElementById("automationWeeklyRow");
const automationDateInput = document.getElementById("automationDateInput");
const automationOnceTimeInput = document.getElementById("automationOnceTimeInput");
const automationDailyTimeInput = document.getElementById("automationDailyTimeInput");
const automationWeekdaySelect = document.getElementById("automationWeekdaySelect");
const automationWeeklyTimeInput = document.getElementById("automationWeeklyTimeInput");
const automationSkillSelect = document.getElementById("automationSkillSelect");
const automationAutoStartInput = document.getElementById("automationAutoStartInput");
const automationEnabledInput = document.getElementById("automationEnabledInput");
const automationNextRun = document.getElementById("automationNextRun");
const newAutomationButton = document.getElementById("newAutomationButton");
const deleteAutomationButton = document.getElementById("deleteAutomationButton");
const runAutomationNowButton = document.getElementById("runAutomationNowButton");

let tasks = loadTasks();
let skills = loadSkills();
let automations = loadAutomations();
let selectedTaskId = "";
let selectedSkillId = "";
let showingSkills = false;
let showingAutomations = false;
let selectedAutomationId = "";
let activeFilter = "active";
let runningTaskId = "";
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clipText(value, limit = 10_000) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}\n…（内容已截取）` : text;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSkill(value) {
  return {
    id: String(value?.id || crypto.randomUUID()),
    name: String(value?.name || "未命名技能").trim().slice(0, 80) || "未命名技能",
    description: String(value?.description || "").trim().slice(0, 500),
    triggers: String(value?.triggers || "").trim().slice(0, 300),
    instructions: String(value?.instructions || "").trim().slice(0, 12_000),
    enabled: value?.enabled !== false,
    runCount: Math.max(0, Number(value?.runCount) || 0),
    lastUsedAt: String(value?.lastUsedAt || ""),
    versions: Array.isArray(value?.versions) ? value.versions.slice(-10).map((version) => ({
      name: String(version?.name || "").slice(0, 80),
      description: String(version?.description || "").slice(0, 500),
      triggers: String(version?.triggers || "").slice(0, 300),
      instructions: String(version?.instructions || "").slice(0, 12_000),
      enabled: version?.enabled !== false,
      savedAt: String(version?.savedAt || nowIso()),
    })) : [],
    createdAt: String(value?.createdAt || nowIso()),
    updatedAt: String(value?.updatedAt || nowIso()),
  };
}

function loadSkills() {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_SKILLS_KEY) || "[]");
    return Array.isArray(saved) ? saved.map(normalizeSkill).slice(0, 100) : [];
  } catch {
    return [];
  }
}

function saveSkills() {
  skills = skills.map(normalizeSkill).slice(0, 100);
  localStorage.setItem(AGENT_SKILLS_KEY, JSON.stringify(skills));
  renderSkillOptions();
  renderSkills();
}

function localDateValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function nextAutomationRun(value, after = new Date()) {
  const schedule = ["once", "daily", "weekly"].includes(value?.schedule) ? value.schedule : "once";
  if (schedule === "once") {
    const date = String(value?.date || "");
    const time = String(value?.time || "09:00");
    const result = new Date(`${date}T${time}:00`);
    return Number.isNaN(result.getTime()) ? "" : result.toISOString();
  }
  const [hours, minutes] = String(value?.time || "09:00").split(":").map(Number);
  const next = new Date(after);
  next.setSeconds(0, 0);
  next.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  if (schedule === "daily") {
    if (next <= after) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const weekday = Math.min(6, Math.max(0, Number(value?.weekday) || 0));
  let daysAhead = (weekday - next.getDay() + 7) % 7;
  if (daysAhead === 0 && next <= after) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next.toISOString();
}

function normalizeAutomation(value) {
  const schedule = ["once", "daily", "weekly"].includes(value?.schedule) ? value.schedule : "once";
  const date = String(value?.date || localDateValue(new Date(Date.now() + 86_400_000))).slice(0, 10);
  const time = /^\d{2}:\d{2}$/.test(String(value?.time || "")) ? String(value.time) : "09:00";
  const normalized = {
    id: String(value?.id || crypto.randomUUID()),
    name: String(value?.name || "未命名自动化").trim().slice(0, 80) || "未命名自动化",
    goal: String(value?.goal || "").trim().slice(0, 4_000),
    schedule,
    date,
    time,
    weekday: Math.min(6, Math.max(0, Number(value?.weekday) || 0)),
    skillId: String(value?.skillId || ""),
    autoStart: value?.autoStart !== false,
    enabled: value?.enabled !== false,
    lastRunAt: String(value?.lastRunAt || ""),
    nextRunAt: String(value?.nextRunAt || ""),
    runCount: Math.max(0, Number(value?.runCount) || 0),
    createdAt: String(value?.createdAt || nowIso()),
    updatedAt: String(value?.updatedAt || nowIso()),
  };
  if (!normalized.nextRunAt) normalized.nextRunAt = nextAutomationRun(normalized);
  return normalized;
}

function loadAutomations() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOMATIONS_KEY) || "[]");
    return Array.isArray(saved) ? saved.map(normalizeAutomation).slice(0, 100) : [];
  } catch {
    return [];
  }
}

function saveAutomations() {
  automations = automations.map(normalizeAutomation).slice(0, 100);
  localStorage.setItem(AUTOMATIONS_KEY, JSON.stringify(automations));
  renderAutomations();
}

function skillTriggerTerms(skill) {
  return String(skill?.triggers || "")
    .split(/[，,、\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2);
}

function matchedSkill(goal) {
  const text = String(goal || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  skills.filter((skill) => skill.enabled && skill.instructions).forEach((skill) => {
    const score = skillTriggerTerms(skill).reduce((sum, term) => sum + (text.includes(term) ? term.length : 0), 0);
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  });
  return best;
}

function normalizeTask(value) {
  const status = Object.hasOwn(STATUS_LABELS, value?.status) ? value.status : "draft";
  return {
    id: String(value?.id || crypto.randomUUID()),
    goal: String(value?.goal || "").slice(0, 4_000),
    title: String(value?.title || "Agent 任务").slice(0, 120),
    summary: String(value?.summary || "").slice(0, 800),
    status,
    plan: Array.isArray(value?.plan) ? value.plan.slice(0, 8).map((step) => ({
      title: String(step?.title || "").slice(0, 160),
      description: String(step?.description || "").slice(0, 500),
      status: ["pending", "active", "completed"].includes(step?.status) ? step.status : "pending",
    })).filter((step) => step.title) : [],
    history: Array.isArray(value?.history) ? value.history.slice(-30) : [],
    activities: Array.isArray(value?.activities) ? value.activities.slice(-80) : [],
    currentAction: value?.currentAction && typeof value.currentAction === "object" ? value.currentAction : null,
    pendingAction: value?.pendingAction && typeof value.pendingAction === "object" ? value.pendingAction : null,
    requestedPermissions: Array.isArray(value?.requestedPermissions) ? value.requestedPermissions.filter((tool) => PERMISSION_TOOLS.has(tool)) : [],
    authorizedTools: Array.isArray(value?.authorizedTools) ? value.authorizedTools.filter((tool) => PERMISSION_TOOLS.has(tool)) : [],
    authorizationMode: ["task", "step"].includes(value?.authorizationMode) ? value.authorizationMode : "",
    authorizationGrantedAt: String(value?.authorizationGrantedAt || ""),
    question: String(value?.question || "").slice(0, 4_000),
    finalAnswer: String(value?.finalAnswer || "").slice(0, 100_000),
    error: String(value?.error || "").slice(0, 4_000),
    skillId: String(value?.skillId || ""),
    skillName: String(value?.skillName || "").slice(0, 80),
    skillSnapshot: String(value?.skillSnapshot || "").slice(0, 12_000),
    automationId: String(value?.automationId || ""),
    automationName: String(value?.automationName || "").slice(0, 80),
    maxSteps: Math.min(20, Math.max(3, Number(value?.maxSteps) || 12)),
    stepCount: Math.max(0, Number(value?.stepCount) || 0),
    aiCalls: Math.max(0, Number(value?.aiCalls) || 0),
    toolCalls: Math.max(0, Number(value?.toolCalls) || 0),
    createdAt: String(value?.createdAt || nowIso()),
    updatedAt: String(value?.updatedAt || nowIso()),
  };
}

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_TASKS_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    let changed = false;
    const normalized = saved.map(normalizeTask).slice(0, MAX_TASKS);
    normalized.forEach((task) => {
      if (["planning", "running"].includes(task.status)) {
        task.status = "paused";
        task.currentAction = null;
        task.activities.push({
          id: crypto.randomUUID(),
          kind: "system",
          title: "任务已安全暂停",
          detail: "Kardii 上次在执行中退出。你可以检查记录后继续。",
          createdAt: nowIso(),
        });
        changed = true;
      }
    });
    if (changed) localStorage.setItem(AGENT_TASKS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return [];
  }
}

function saveTasks() {
  tasks = tasks.slice(0, MAX_TASKS);
  localStorage.setItem(AGENT_TASKS_KEY, JSON.stringify(tasks));
  renderAll();
}

function selectedTask() {
  return tasks.find((task) => task.id === selectedTaskId) || null;
}

function blockingTask(taskId) {
  return tasks.find((task) => task.id !== taskId && ["planning", "running", "waiting_authorization", "waiting_permission", "waiting_input"].includes(task.status));
}

function showToast(text) {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function currentAiConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || "{}"); } catch { saved = {}; }
  const provider = ["deepseek", "gemini", "ollama", "codex"].includes(saved.provider) ? saved.provider : "deepseek";
  const model = provider === "deepseek"
    ? "deepseek-v4-flash"
    : provider === "gemini"
      ? (["gemini-3.1-flash-lite", "gemini-3.5-flash"].includes(saved.geminiModel) ? saved.geminiModel : "gemini-3.1-flash-lite")
      : provider === "codex"
        ? "codex-default"
        : String(saved.ollamaModel || "").slice(0, 120);
  return {
    provider,
    model,
    ollamaBaseUrl: String(saved.ollamaBaseUrl || "http://127.0.0.1:11434").slice(0, 200),
  };
}

function addActivity(task, kind, title, detail = "") {
  task.activities.push({
    id: crypto.randomUUID(),
    kind,
    title: String(title || "Agent 更新").slice(0, 180),
    detail: clipText(detail, 12_000),
    createdAt: nowIso(),
  });
  task.activities = task.activities.slice(-80);
  task.updatedAt = nowIso();
}

function contextSummary(task = null) {
  let knowledgeCount = 0;
  try {
    const data = JSON.parse(localStorage.getItem(BUSINESS_DATA_KEY) || "null");
    knowledgeCount = Array.isArray(data?.knowledge) ? data.knowledge.filter((item) => item.status !== "archived").length : 0;
  } catch { knowledgeCount = 0; }
  let memoryCount = 0;
  try {
    const memories = JSON.parse(localStorage.getItem(MEMORIES_KEY) || "[]");
    memoryCount = Array.isArray(memories) ? memories.length : 0;
  } catch { memoryCount = 0; }
  const skillContext = task?.skillSnapshot
    ? `\n\n本次必须遵循的已确认技能「${task.skillName}」：\n${task.skillSnapshot}`
    : "";
  return `本机知识库：${knowledgeCount} 份可检索资料；长期记忆：${memoryCount} 条。${skillContext}`;
}

function renderTaskList() {
  const visible = tasks.filter((task) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "done") return FINAL_STATUSES.has(task.status);
    return !FINAL_STATUSES.has(task.status);
  });
  taskList.innerHTML = visible.map((task) => `
    <button class="task-card ${task.id === selectedTaskId ? "active" : ""}" type="button" data-task-id="${escapeHtml(task.id)}">
      <strong>${escapeHtml(task.title || task.goal || "Agent 任务")}</strong>
      <span>${escapeHtml(clipText(task.goal, 58))}</span>
      <footer><b>${escapeHtml(STATUS_LABELS[task.status])}</b><span>${escapeHtml(formatTime(task.updatedAt))}</span></footer>
    </button>
  `).join("") || '<div class="task-list-empty">这里还没有任务。</div>';
}

function renderSkillOptions() {
  const current = taskSkillSelect.value;
  taskSkillSelect.replaceChildren(new Option("自动匹配或不使用", ""));
  skills.filter((skill) => skill.enabled && skill.instructions).forEach((skill) => {
    taskSkillSelect.add(new Option(skill.name, skill.id));
  });
  taskSkillSelect.value = skills.some((skill) => skill.id === current && skill.enabled) ? current : "";
}

function clearSkillForm() {
  selectedSkillId = "";
  skillIdInput.value = "";
  skillNameInput.value = "";
  skillDescriptionInput.value = "";
  skillTriggersInput.value = "";
  skillInstructionsInput.value = "";
  skillEnabledInput.checked = true;
  restoreSkillButton.classList.add("hidden");
  deleteSkillButton.classList.add("hidden");
  renderSkills();
  skillNameInput.focus();
}

function fillSkillForm(skill) {
  if (!skill) return clearSkillForm();
  selectedSkillId = skill.id;
  skillIdInput.value = skill.id;
  skillNameInput.value = skill.name;
  skillDescriptionInput.value = skill.description;
  skillTriggersInput.value = skill.triggers;
  skillInstructionsInput.value = skill.instructions;
  skillEnabledInput.checked = skill.enabled;
  restoreSkillButton.classList.toggle("hidden", !skill.versions.length);
  deleteSkillButton.classList.remove("hidden");
  renderSkills();
}

function renderSkills() {
  if (!skillList) return;
  skillList.innerHTML = skills.map((skill) => `
    <button class="skill-card ${skill.id === selectedSkillId ? "active" : ""} ${skill.enabled ? "" : "disabled"}" type="button" data-skill-id="${escapeHtml(skill.id)}">
      <strong>${escapeHtml(skill.name)}</strong>
      <span>${escapeHtml(skill.description || "尚未填写用途说明")}</span>
      <footer><b>${skill.enabled ? "已启用" : "已停用"}</b><span>运行 ${skill.runCount} 次 · ${skill.versions.length} 个旧版本</span></footer>
    </button>
  `).join("") || '<div class="task-list-empty">还没有技能。完成一个 Agent 任务后可以保存，也可以直接新建。</div>';
}

function showSkillsView(skillId = "") {
  showingSkills = true;
  showingAutomations = false;
  selectedTaskId = "";
  createView.classList.add("hidden");
  taskView.classList.add("hidden");
  skillsView.classList.remove("hidden");
  automationsView.classList.add("hidden");
  automationsButton.classList.remove("active");
  skillsButton.classList.add("active");
  if (skillId) fillSkillForm(skills.find((skill) => skill.id === skillId));
  else if (!selectedSkillId) clearSkillForm();
  renderSkills();
}

function hideSkillsView() {
  showingSkills = false;
  skillsView.classList.add("hidden");
  skillsButton.classList.remove("active");
}

function renderAutomationScheduleRows() {
  const schedule = automationScheduleSelect.value;
  automationOnceRow.classList.toggle("hidden", schedule !== "once");
  automationDailyRow.classList.toggle("hidden", schedule !== "daily");
  automationWeeklyRow.classList.toggle("hidden", schedule !== "weekly");
  const preview = nextAutomationRun({
    schedule,
    date: automationDateInput.value,
    time: schedule === "once" ? automationOnceTimeInput.value : schedule === "daily" ? automationDailyTimeInput.value : automationWeeklyTimeInput.value,
    weekday: Number(automationWeekdaySelect.value),
  });
  automationNextRun.textContent = preview ? `预计下次：${new Date(preview).toLocaleString("zh-CN")}` : "请填写有效的执行时间。";
}

function renderAutomationSkillOptions() {
  const current = automationSkillSelect.value;
  automationSkillSelect.replaceChildren(new Option("自动匹配或不使用", ""));
  skills.filter((skill) => skill.enabled && skill.instructions).forEach((skill) => {
    automationSkillSelect.add(new Option(skill.name, skill.id));
  });
  automationSkillSelect.value = skills.some((skill) => skill.id === current && skill.enabled) ? current : "";
}

function clearAutomationForm() {
  selectedAutomationId = "";
  automationIdInput.value = "";
  automationNameInput.value = "";
  automationGoalInput.value = "";
  automationScheduleSelect.value = "once";
  automationDateInput.value = localDateValue(new Date(Date.now() + 86_400_000));
  automationOnceTimeInput.value = "09:00";
  automationDailyTimeInput.value = "09:00";
  automationWeekdaySelect.value = "1";
  automationWeeklyTimeInput.value = "09:00";
  automationSkillSelect.value = "";
  automationAutoStartInput.checked = true;
  automationEnabledInput.checked = true;
  deleteAutomationButton.classList.add("hidden");
  runAutomationNowButton.classList.add("hidden");
  renderAutomationScheduleRows();
  renderAutomations();
  automationNameInput.focus();
}

function fillAutomationForm(automation) {
  if (!automation) return clearAutomationForm();
  selectedAutomationId = automation.id;
  automationIdInput.value = automation.id;
  automationNameInput.value = automation.name;
  automationGoalInput.value = automation.goal;
  automationScheduleSelect.value = automation.schedule;
  automationDateInput.value = automation.date;
  automationOnceTimeInput.value = automation.schedule === "once" ? automation.time : "09:00";
  automationDailyTimeInput.value = automation.schedule === "daily" ? automation.time : "09:00";
  automationWeekdaySelect.value = String(automation.weekday);
  automationWeeklyTimeInput.value = automation.schedule === "weekly" ? automation.time : "09:00";
  automationSkillSelect.value = automation.skillId;
  automationAutoStartInput.checked = automation.autoStart;
  automationEnabledInput.checked = automation.enabled;
  deleteAutomationButton.classList.remove("hidden");
  runAutomationNowButton.classList.remove("hidden");
  renderAutomationScheduleRows();
  renderAutomations();
}

function renderAutomations() {
  if (!automationList) return;
  renderAutomationSkillOptions();
  automationList.innerHTML = automations.map((automation) => {
    const next = automation.nextRunAt ? new Date(automation.nextRunAt) : null;
    const nextText = next && !Number.isNaN(next.getTime()) ? next.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未安排";
    return `
      <button class="skill-card ${automation.id === selectedAutomationId ? "active" : ""} ${automation.enabled ? "" : "disabled"}" type="button" data-automation-id="${escapeHtml(automation.id)}">
        <strong>${escapeHtml(automation.name)}</strong>
        <span>${escapeHtml(clipText(automation.goal, 100))}</span>
        <footer><b>${automation.enabled ? "已启用" : "已停用"}</b><span>下次 ${escapeHtml(nextText)}</span></footer>
      </button>
    `;
  }).join("") || '<div class="task-list-empty">还没有自动化。这里的任务只会在 Kardii 正在运行时触发。</div>';
}

function showAutomationsView(automationId = "") {
  showingAutomations = true;
  showingSkills = false;
  selectedTaskId = "";
  createView.classList.add("hidden");
  taskView.classList.add("hidden");
  skillsView.classList.add("hidden");
  automationsView.classList.remove("hidden");
  skillsButton.classList.remove("active");
  automationsButton.classList.add("active");
  if (automationId) fillAutomationForm(automations.find((item) => item.id === automationId));
  else if (!selectedAutomationId) clearAutomationForm();
  renderAutomations();
}

function hideAutomationsView() {
  showingAutomations = false;
  automationsView.classList.add("hidden");
  automationsButton.classList.remove("active");
}

function renderPermission(task) {
  if (task?.status === "waiting_authorization") {
    const permissionLabels = {
      read_file: "选择并读取文件",
      read_clipboard: "读取剪贴板文字",
      write_clipboard: "写入剪贴板",
      open_url: "在默认浏览器打开网页",
      run_terminal: "运行计划范围内的只读终端命令",
    };
    const permissions = (task.requestedPermissions || []).map((tool) => `• ${permissionLabels[tool] || tool}`);
    permissionPanel.classList.remove("hidden");
    permissionTitle.textContent = "确认本任务的执行范围";
    permissionDescription.textContent = "允许后，计划内且低风险的同类操作不再重复询问；超出计划或高风险操作仍会停下来确认。";
    permissionDetail.textContent = ["执行计划：", ...task.plan.map((step, index) => `${index + 1}. ${step.title}`), "", "本任务可能需要：", ...permissions].join("\n");
    permissionBadge.textContent = "一次确认本任务";
    permissionBadge.classList.remove("danger");
    denyPermissionButton.textContent = "取消任务";
    stepPermissionButton.classList.remove("hidden");
    allowPermissionButton.textContent = "允许本任务执行";
    return;
  }
  const action = task?.status === "waiting_permission" ? task.pendingAction : null;
  permissionPanel.classList.toggle("hidden", !action);
  if (!action) return;
  denyPermissionButton.textContent = "拒绝";
  stepPermissionButton.classList.add("hidden");
  allowPermissionButton.textContent = "允许这一次";
  const args = action.arguments || {};
  const details = {
    read_file: {
      title: "允许选择并读取一个文本文件？",
      description: "系统会打开文件选择器，只读取你亲自选择的一个文件。",
      detail: "允许范围：一个不超过 256 KB 的 UTF-8 文本或代码文件\n不会修改、移动或删除文件",
    },
    read_clipboard: {
      title: "允许读取一次剪贴板文字？",
      description: "Kardii 不会持续监控剪贴板。读取结果会用于当前 Agent 任务。",
      detail: "只读取文字，不读取图片或文件\n每次读取都必须重新允许",
    },
    write_clipboard: {
      title: "允许改写系统剪贴板？",
      description: "确认后，当前剪贴板内容会被 Agent 生成的文字替换。",
      detail: clipText(args.text, 2_000),
    },
    open_url: {
      title: "允许打开这个网页？",
      description: "Kardii 会调用系统默认浏览器，不会在后台静默操作网页。",
      detail: clipText(args.url, 2_000),
    },
    run_terminal: {
      title: "确认运行这条终端命令？",
      description: "命令可能读取或修改电脑内容。请逐字检查，只允许你理解并信任的命令。",
      detail: clipText(args.command, 2_000),
      danger: true,
    },
  }[action.tool];
  permissionTitle.textContent = details?.title || "确认 Agent 操作";
  permissionDescription.textContent = details?.description || action.explanation || "这一步需要你的确认。";
  permissionDetail.textContent = details?.detail || JSON.stringify(args, null, 2);
  permissionBadge.textContent = details?.danger ? "高权限操作 · 请仔细检查" : "需要你的允许";
  permissionBadge.classList.toggle("danger", Boolean(details?.danger));
}

function renderTask() {
  const task = selectedTask();
  createView.classList.toggle("hidden", showingSkills || showingAutomations || Boolean(task));
  taskView.classList.toggle("hidden", showingSkills || showingAutomations || !task);
  skillsView.classList.toggle("hidden", !showingSkills);
  automationsView.classList.toggle("hidden", !showingAutomations);
  if (!task) {
    renderPermission(null);
    return;
  }
  taskStatusBadge.textContent = STATUS_LABELS[task.status];
  taskStatusBadge.className = `status-badge ${task.status}`;
  taskSkillBadge.textContent = task.skillName ? `技能 · ${task.skillName}` : "";
  taskSkillBadge.classList.toggle("hidden", !task.skillName);
  taskTitle.textContent = task.title || "Agent 任务";
  taskGoal.textContent = task.goal;
  stepMetric.textContent = `${task.stepCount} / ${task.maxSteps}`;
  aiMetric.textContent = String(task.aiCalls);
  toolMetric.textContent = String(task.toolCalls);
  updatedMetric.textContent = formatTime(task.updatedAt);
  planSummary.textContent = task.summary || (task.status === "planning" ? "Kardii 正在制定计划。" : "尚未生成计划");
  planList.innerHTML = task.plan.map((step, index) => `
    <div class="plan-step ${escapeHtml(step.status)}">
      <span class="plan-step-index">${step.status === "completed" ? "✓" : index + 1}</span>
      <div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.description)}</p></div>
    </div>
  `).join("") || '<div class="task-list-empty">计划生成后会显示在这里。</div>';

  const showCurrent = Boolean(task.currentAction) && !FINAL_STATUSES.has(task.status);
  currentActionPanel.classList.toggle("hidden", !showCurrent);
  if (showCurrent) {
    currentActionTitle.textContent = task.currentAction.title || "正在判断下一步";
    currentActionExplanation.textContent = task.currentAction.explanation || "";
  }
  const waitingForInput = task.status === "waiting_input";
  questionPanel.classList.toggle("hidden", !waitingForInput);
  if (waitingForInput) questionText.textContent = task.question;
  const hasResult = task.status === "completed" && task.finalAnswer;
  resultPanel.classList.toggle("hidden", !hasResult);
  finalAnswer.textContent = hasResult ? task.finalAnswer : "";

  const activities = [...task.activities].reverse();
  activityList.innerHTML = activities.map((item) => `
    <div class="activity-item ${item.kind === "error" ? "error" : ""}">
      <time>${escapeHtml(formatTime(item.createdAt))}</time>
      <div><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}</div>
    </div>
  `).join("") || '<div class="task-list-empty">任务开始后会保留每一步记录。</div>';

  pauseButton.classList.toggle("hidden", !["planning", "running"].includes(task.status));
  resumeButton.classList.toggle("hidden", !["draft", "paused"].includes(task.status));
  resumeButton.textContent = task.status === "draft" ? "开始执行" : "继续";
  retryButton.classList.toggle("hidden", task.status !== "failed" || task.stepCount >= task.maxSteps);
  cancelButton.classList.toggle("hidden", FINAL_STATUSES.has(task.status));
  renderPermission(task);
}

function renderAll() {
  document.querySelectorAll(".task-filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === activeFilter));
  renderTaskList();
  renderSkillOptions();
  renderSkills();
  renderAutomations();
  renderTask();
}

function createTask(goal, maxSteps = 12, requestedSkillId = "") {
  const cleanGoal = String(goal || "").trim().slice(0, 4_000);
  if (!cleanGoal) throw new Error("请先填写任务目标。");
  const selectedSkill = skills.find((skill) => skill.id === requestedSkillId && skill.enabled)
    || (!requestedSkillId ? matchedSkill(cleanGoal) : null);
  const task = normalizeTask({
    id: crypto.randomUUID(),
    goal: cleanGoal,
    title: clipText(cleanGoal.replace(/\s+/g, " "), 60),
    status: "draft",
    maxSteps,
    skillId: selectedSkill?.id || "",
    skillName: selectedSkill?.name || "",
    skillSnapshot: selectedSkill?.instructions || "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (selectedSkill) {
    selectedSkill.runCount += 1;
    selectedSkill.lastUsedAt = nowIso();
    selectedSkill.updatedAt = nowIso();
    saveSkills();
  }
  addActivity(
    task,
    "system",
    "任务已创建",
    selectedSkill
      ? `已使用技能「${selectedSkill.name}」。Kardii 将按已保存规则制定计划；高权限操作仍会等待确认。`
      : "Kardii 将先制定计划，再逐步执行。涉及高权限工具时会等待你的确认。",
  );
  tasks.unshift(task);
  selectedTaskId = task.id;
  saveTasks();
  return task;
}

function compactHistory(task) {
  return task.history.slice(-16).map((entry) => ({
    tool: String(entry.tool || ""),
    title: String(entry.title || ""),
    arguments: entry.arguments && typeof entry.arguments === "object" ? entry.arguments : {},
    success: entry.success !== false,
    result: clipText(entry.result, 10_000),
    createdAt: entry.createdAt,
  }));
}

function markPlanStep(task, stepIndex) {
  if (!task.plan.length) return;
  const current = Math.max(0, Math.min(task.plan.length - 1, Number(stepIndex) || 0));
  task.plan.forEach((step, index) => {
    if (index < current) step.status = "completed";
    else if (index === current) step.status = "active";
    else if (step.status !== "completed") step.status = "pending";
  });
}

async function planTask(taskId) {
  if (runningTaskId) {
    showToast("另一个 Agent 任务正在执行，请稍后再开始。");
    return;
  }
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  const blocker = blockingTask(taskId);
  if (blocker) {
    showToast(`请先处理“${blocker.title}”。`);
    return;
  }
  runningTaskId = taskId;
  task.status = "planning";
  task.error = "";
  task.currentAction = { title: "正在制定计划", explanation: "Kardii 正在理解目标并选择合适的工具。" };
  addActivity(task, "ai", "开始制定计划", task.goal);
  saveTasks();
  let continueAfterPlan = false;
  try {
    const ai = currentAiConfig();
    if (!ai.model) throw new Error("当前 Ollama 还没有选择模型，请先在聊天窗口的 AI 设置中选择模型。");
    const result = await invoke("create_agent_plan", {
      request: {
        goal: task.goal,
        context: contextSummary(task),
        provider: ai.provider,
        model: ai.model,
        ollamaBaseUrl: ai.ollamaBaseUrl,
      },
    });
    task.aiCalls += 1;
    task.title = result.title || task.title;
    task.summary = result.summary || "";
    task.plan = (Array.isArray(result.steps) ? result.steps : []).map((step) => ({ ...step, status: "pending" }));
    task.requestedPermissions = (Array.isArray(result.permissions) ? result.permissions : []).filter((tool) => PERMISSION_TOOLS.has(tool));
    task.authorizedTools = [];
    task.authorizationMode = "";
    task.authorizationGrantedAt = "";
    task.currentAction = null;
    if (task.status === "planning") {
      if (task.requestedPermissions.length) {
        task.status = "waiting_authorization";
        addActivity(task, "permission", "等待任务范围确认", `计划可能使用：${task.requestedPermissions.join("、")}`);
      } else {
        task.status = "running";
        continueAfterPlan = true;
      }
    }
    addActivity(task, "ai", "计划已生成", `${task.plan.length} 个步骤`);
  } catch (error) {
    task.status = "failed";
    task.error = String(error);
    task.currentAction = null;
    addActivity(task, "error", "计划生成失败", String(error));
  } finally {
    runningTaskId = "";
    saveTasks();
  }
  if (continueAfterPlan) void executeLoop(taskId);
}

function keywordTerms(text) {
  const lower = String(text || "").toLowerCase();
  const terms = new Set(lower.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []);
  (lower.match(/[\u3400-\u9fff]{2,}/g) || []).forEach((run) => {
    if (run.length <= 8) terms.add(run);
    for (let index = 0; index < run.length - 1; index += 1) terms.add(run.slice(index, index + 2));
  });
  return [...terms].filter((term) => term.length > 1).slice(0, 40);
}

function knowledgeChunks(content, size = 1_500, overlap = 160) {
  const text = String(content || "").trim();
  const chunks = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
    if (start + size >= text.length) break;
  }
  return chunks;
}

function searchKnowledge(query, citationGroup = 1) {
  let knowledge = [];
  try {
    const data = JSON.parse(localStorage.getItem(BUSINESS_DATA_KEY) || "null");
    knowledge = Array.isArray(data?.knowledge) ? data.knowledge.filter((item) => item.status !== "archived") : [];
  } catch { knowledge = []; }
  if (!knowledge.length) return "本机知识库中没有可检索资料。";
  const terms = keywordTerms(query);
  const candidates = [];
  knowledge.forEach((item) => {
    const title = `${item.title || ""} ${item.fileName || ""} ${item.tags || ""}`.toLowerCase();
    knowledgeChunks(item.content).forEach((content, chunkIndex) => {
      const lower = content.toLowerCase();
      let score = chunkIndex === 0 ? 0.1 : 0;
      terms.forEach((term) => {
        if (title.includes(term)) score += 8;
        if (lower.includes(term)) score += term.length > 3 ? 4 : 2;
      });
      candidates.push({ item, content, chunkIndex, score });
    });
  });
  const ranked = candidates.sort((a, b) => b.score - a.score);
  const selected = (ranked.some((item) => item.score > 0) ? ranked.filter((item) => item.score > 0) : ranked).slice(0, 6);
  if (!selected.length) return "没有找到与当前问题相关的知识库片段。";
  return selected.map((entry, index) => (
    `[K${citationGroup}.${index + 1}] 资料：${entry.item.title || entry.item.fileName}，片段 ${entry.chunkIndex + 1}\n${entry.content}`
  )).join("\n\n");
}

function searchMemories(query) {
  let memories = [];
  try {
    const saved = JSON.parse(localStorage.getItem(MEMORIES_KEY) || "[]");
    memories = Array.isArray(saved) ? saved.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch { memories = []; }
  if (!memories.length) return "Kardii 还没有用户确认保存的长期记忆。";
  const terms = keywordTerms(query);
  const ranked = memories.map((memory) => ({
    memory,
    score: terms.reduce((sum, term) => sum + (memory.toLowerCase().includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  const selected = (ranked.some((item) => item.score > 0) ? ranked.filter((item) => item.score > 0) : ranked).slice(0, 10);
  return selected.map((item, index) => `${index + 1}. ${item.memory}`).join("\n");
}

async function executeAutomaticTool(action, citationGroup = 1) {
  const args = action.arguments || {};
  if (action.tool === "web_search") {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Agent 没有给出搜索词。");
    const sources = await invoke("run_web_search", { request: { query } });
    return (Array.isArray(sources) ? sources : []).map((source, index) => (
      `[W${citationGroup}.${index + 1}] ${source.title || "公开来源"}\n${source.url}\n${source.snippet || ""}${source.publishedAt ? `\n日期：${source.publishedAt}` : ""}`
    )).join("\n\n") || "没有找到公开搜索结果。";
  }
  if (action.tool === "knowledge_search") return searchKnowledge(String(args.query || ""), citationGroup);
  if (action.tool === "memory_search") return searchMemories(String(args.query || ""));
  throw new Error("这不是可以自动执行的工具。");
}

function isReadOnlyTerminalCommand(command) {
  const clean = String(command || "").trim();
  if (!clean || /[;&|><`\r\n]/.test(clean)) return false;
  if (/\b(?:rm|del|erase|move|mv|cp|copy|ren|rename|mkdir|rmdir|rd|touch|tee|setx|reg|shutdown|format|diskpart|git\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|clean))\b/i.test(clean)) return false;
  return /^(?:whoami|pwd|cd|dir|ls|where(?:\.exe)?|which|uname|hostname|type|cat|head|tail|wc|stat|rg|findstr|Get-ChildItem|Get-Location|Test-Path|git\s+(?:status|log|diff|show|branch))(?:\s|$)/i.test(clean);
}

function actionNeedsFreshConfirmation(action) {
  if (action.tool === "run_terminal") return !isReadOnlyTerminalCommand(action.arguments?.command);
  return false;
}

function taskAuthorizationCovers(task, action) {
  return task.authorizationMode === "task"
    && (task.authorizedTools || []).includes(action.tool)
    && !actionNeedsFreshConfirmation(action);
}

function appendHistory(task, action, success, result) {
  task.history.push({
    tool: action.tool,
    title: action.title,
    arguments: action.arguments || {},
    success,
    result: clipText(result, 20_000),
    createdAt: nowIso(),
  });
  task.history = task.history.slice(-30);
}

async function executeLoop(taskId) {
  if (runningTaskId) return;
  runningTaskId = taskId;
  const loopStartedAt = Date.now();
  try {
    while (true) {
      const task = tasks.find((item) => item.id === taskId);
      if (!task || task.status !== "running") break;
      if (Date.now() - loopStartedAt > 10 * 60_000) {
        task.status = "paused";
        task.currentAction = null;
        addActivity(task, "system", "已达到连续运行时间上限", "Kardii 连续执行 10 分钟后自动暂停。检查记录后可以继续。");
        saveTasks();
        break;
      }
      if (task.stepCount >= task.maxSteps) {
        task.status = "failed";
        task.error = `已达到 ${task.maxSteps} 步安全上限。`;
        task.currentAction = null;
        addActivity(task, "error", "达到执行上限", "请检查记录后重试，或新建一个更聚焦的任务。");
        saveTasks();
        break;
      }
      task.currentAction = { title: "正在判断下一步", explanation: "Kardii 正在检查已有结果。" };
      saveTasks();
      let action;
      try {
        const ai = currentAiConfig();
        if (!ai.model) throw new Error("当前 Ollama 还没有选择模型，请先在聊天窗口的 AI 设置中选择模型。");
        action = await invoke("decide_agent_action", {
          request: {
            goal: task.goal,
            plan: {
              title: task.title,
              summary: task.summary,
              steps: task.plan,
              skill: task.skillSnapshot ? { name: task.skillName, instructions: task.skillSnapshot } : null,
            },
            history: compactHistory(task),
            provider: ai.provider,
            model: ai.model,
            ollamaBaseUrl: ai.ollamaBaseUrl,
          },
        });
        task.aiCalls += 1;
      } catch (error) {
        task.status = "failed";
        task.error = String(error);
        task.currentAction = null;
        addActivity(task, "error", "无法判断下一步", String(error));
        saveTasks();
        break;
      }
      if (task.status !== "running") {
        task.currentAction = null;
        saveTasks();
        break;
      }
      task.stepCount += 1;
      task.currentAction = action;
      markPlanStep(task, action.stepIndex);
      addActivity(task, "ai", action.title || "选择下一步", action.explanation || action.tool);

      if (action.tool === "finish") {
        task.status = "completed";
        task.finalAnswer = String(action.finalAnswer || "").trim();
        task.currentAction = null;
        task.plan.forEach((step) => { step.status = "completed"; });
        appendHistory(task, action, true, task.finalAnswer);
        addActivity(task, "system", "任务已完成", "最终结果已经生成并保存在本机任务记录中。");
        saveTasks();
        break;
      }
      if (action.tool === "ask_user") {
        const question = String(action.arguments?.question || "").trim();
        if (!question) {
          appendHistory(task, action, false, "Agent 没有给出需要用户回答的问题。");
          addActivity(task, "error", "提问格式不完整", "Kardii 将重新判断下一步。");
          saveTasks();
          continue;
        }
        task.question = question.slice(0, 4_000);
        task.status = "waiting_input";
        addActivity(task, "system", "等待你的回答", task.question);
        saveTasks();
        break;
      }
      if (PERMISSION_TOOLS.has(action.tool)) {
        if (!taskAuthorizationCovers(task, action)) {
          task.pendingAction = action;
          task.status = "waiting_permission";
          addActivity(task, "permission", actionNeedsFreshConfirmation(action) ? "高风险操作需要重新确认" : "等待操作确认", action.title || action.tool);
          saveTasks();
          break;
        }
        task.toolCalls += 1;
        addActivity(task, "permission", "已按本任务授权执行", action.title || action.tool);
        try {
          const result = await executePermissionTool(action);
          appendHistory(task, action, true, result);
          addActivity(task, "tool", `${action.title || action.tool}完成`, clipText(result, 1_200));
        } catch (error) {
          appendHistory(task, action, false, String(error));
          addActivity(task, "error", `${action.title || action.tool}失败`, String(error));
        }
        task.currentAction = null;
        saveTasks();
        continue;
      }

      task.toolCalls += 1;
      try {
        const result = await executeAutomaticTool(action, task.stepCount);
        appendHistory(task, action, true, result);
        addActivity(task, "tool", `${action.title || action.tool}完成`, clipText(result, 1_200));
      } catch (error) {
        appendHistory(task, action, false, String(error));
        addActivity(task, "error", `${action.title || action.tool}失败`, String(error));
      }
      task.currentAction = null;
      saveTasks();
    }
  } finally {
    runningTaskId = "";
  }
}

async function executePermissionTool(action) {
  const args = action.arguments || {};
  if (action.tool === "read_file") {
    const result = await invoke("read_text_file");
    if (!result) return "用户取消了文件选择。";
    return `文件：${result.name}\n路径：${result.path}\n\n${result.content}`;
  }
  if (action.tool === "read_clipboard") return invoke("read_clipboard_text");
  if (action.tool === "write_clipboard") {
    const text = String(args.text || "").trim();
    if (!text) throw new Error("Agent 没有提供要写入剪贴板的文字。");
    await invoke("write_clipboard_text", { text });
    return `已向剪贴板写入 ${text.length} 个字符。`;
  }
  if (action.tool === "open_url") {
    const url = new URL(String(args.url || ""));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Agent 提供的网址不是 http 或 https。");
    await invoke("open_external_url", { url: url.href });
    return `已在系统默认浏览器打开：${url.href}`;
  }
  if (action.tool === "run_terminal") {
    const command = String(args.command || "").trim();
    if (!command) throw new Error("Agent 没有提供终端命令。");
    const result = await invoke("run_terminal_command", { command });
    return [
      `命令：${result.command}`,
      `退出码：${result.exitCode}`,
      result.stdout ? `标准输出：\n${result.stdout}` : "",
      result.stderr ? `错误输出：\n${result.stderr}` : "",
    ].filter(Boolean).join("\n\n");
  }
  throw new Error("Kardii 不支持这个需要确认的工具。");
}

function resolveTaskAuthorization(mode) {
  const task = selectedTask();
  if (!task || task.status !== "waiting_authorization") return;
  if (mode === "cancel") {
    task.status = "cancelled";
    task.currentAction = null;
    addActivity(task, "permission", "任务授权已取消", "计划与记录仍保留。 ");
    saveTasks();
    return;
  }
  task.authorizationMode = mode === "task" ? "task" : "step";
  task.authorizedTools = mode === "task" ? [...task.requestedPermissions] : [];
  task.authorizationGrantedAt = nowIso();
  task.status = "running";
  addActivity(
    task,
    "permission",
    mode === "task" ? "已允许本任务执行" : "已选择逐步确认",
    mode === "task"
      ? "计划内低风险操作不再重复询问；超出计划和高风险终端命令仍会再次确认。"
      : "涉及文件、剪贴板、浏览器或终端时仍会逐次确认。",
  );
  saveTasks();
  void executeLoop(task.id);
}

async function resolvePermission(allowed) {
  const task = selectedTask();
  const action = task?.pendingAction;
  if (!task || !action || task.status !== "waiting_permission") return;
  task.pendingAction = null;
  task.currentAction = null;
  permissionPanel.classList.add("hidden");
  if (!allowed) {
    appendHistory(task, action, false, "用户拒绝了这次操作。请使用其他方式继续，或说明无法完成。 ");
    addActivity(task, "permission", "操作已拒绝", action.title || action.tool);
    task.status = "running";
    saveTasks();
    void executeLoop(task.id);
    return;
  }
  task.status = "running";
  task.toolCalls += 1;
  addActivity(task, "permission", "已允许这一次", action.title || action.tool);
  saveTasks();
  try {
    const result = await executePermissionTool(action);
    appendHistory(task, action, true, result);
    addActivity(task, "tool", `${action.title || action.tool}完成`, clipText(result, 1_200));
  } catch (error) {
    appendHistory(task, action, false, String(error));
    addActivity(task, "error", `${action.title || action.tool}失败`, String(error));
  }
  saveTasks();
  void executeLoop(task.id);
}

function consumeTarget() {
  let target = null;
  try { target = JSON.parse(localStorage.getItem(AGENT_TARGET_KEY) || "null"); } catch { target = null; }
  localStorage.removeItem(AGENT_TARGET_KEY);
  if (!target?.taskId) return;
  const task = tasks.find((item) => item.id === target.taskId);
  if (!task) return;
  selectedTaskId = task.id;
  renderAll();
  if (target.autoStart && task.status === "draft") void planTask(task.id);
}

createTaskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startTaskButton.disabled = true;
  try {
    const task = createTask(goalInput.value, Number(maxStepsInput.value), taskSkillSelect.value);
    goalInput.value = "";
    taskSkillSelect.value = "";
    void planTask(task.id);
  } catch (error) {
    showToast(String(error));
  } finally {
    startTaskButton.disabled = false;
  }
});

showCreateButton.addEventListener("click", () => {
  hideSkillsView();
  hideAutomationsView();
  selectedTaskId = "";
  renderAll();
  goalInput.focus();
});

taskList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-id]");
  if (!button) return;
  hideSkillsView();
  hideAutomationsView();
  selectedTaskId = button.dataset.taskId;
  renderAll();
});

document.querySelectorAll(".task-filter").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  renderAll();
}));

pauseButton.addEventListener("click", () => {
  const task = selectedTask();
  if (!task || !["planning", "running"].includes(task.status)) return;
  task.status = "paused";
  task.currentAction = null;
  addActivity(task, "system", "任务已暂停", "正在进行的 AI 请求或工具调用结束后不会继续下一步。");
  saveTasks();
});

resumeButton.addEventListener("click", () => {
  const task = selectedTask();
  if (!task || !["draft", "paused"].includes(task.status)) return;
  const blocker = blockingTask(task.id);
  if (blocker) {
    showToast(`请先处理“${blocker.title}”。`);
    return;
  }
  if (!task.plan.length) void planTask(task.id);
  else {
    task.status = "running";
    addActivity(task, "system", "继续执行", "Kardii 将从现有记录重新判断下一步。");
    saveTasks();
    void executeLoop(task.id);
  }
});

retryButton.addEventListener("click", () => {
  const task = selectedTask();
  if (!task || task.status !== "failed") return;
  const blocker = blockingTask(task.id);
  if (blocker) {
    showToast(`请先处理“${blocker.title}”。`);
    return;
  }
  task.error = "";
  task.currentAction = null;
  if (!task.plan.length) void planTask(task.id);
  else {
    task.status = "running";
    addActivity(task, "system", "重新尝试", "保留已有结果，从失败位置重新判断。");
    saveTasks();
    void executeLoop(task.id);
  }
});

cancelButton.addEventListener("click", () => {
  const task = selectedTask();
  if (!task || FINAL_STATUSES.has(task.status)) return;
  if (!window.confirm("确定取消这个 Agent 任务吗？已有执行记录会保留。")) return;
  task.status = "cancelled";
  task.pendingAction = null;
  task.currentAction = null;
  addActivity(task, "system", "任务已取消");
  saveTasks();
});

document.getElementById("deleteTaskButton").addEventListener("click", () => {
  const task = selectedTask();
  if (!task || !window.confirm(`确定永久删除“${task.title}”及其全部执行记录吗？`)) return;
  tasks = tasks.filter((item) => item.id !== task.id);
  selectedTaskId = "";
  saveTasks();
  showToast("任务已删除");
});

submitAnswerButton.addEventListener("click", () => {
  const task = selectedTask();
  const answer = questionAnswer.value.trim();
  if (!task || task.status !== "waiting_input" || !answer) return;
  const action = task.currentAction || { tool: "ask_user", title: "询问用户", arguments: { question: task.question } };
  appendHistory(task, action, true, `用户回答：${answer.slice(0, 4_000)}`);
  addActivity(task, "user", "你已回答", answer.slice(0, 1_200));
  task.question = "";
  task.currentAction = null;
  task.status = "running";
  questionAnswer.value = "";
  saveTasks();
  void executeLoop(task.id);
});

allowPermissionButton.addEventListener("click", () => {
  const task = selectedTask();
  if (task?.status === "waiting_authorization") resolveTaskAuthorization("task");
  else void resolvePermission(true);
});
stepPermissionButton.addEventListener("click", () => resolveTaskAuthorization("step"));
denyPermissionButton.addEventListener("click", () => {
  const task = selectedTask();
  if (task?.status === "waiting_authorization") resolveTaskAuthorization("cancel");
  else void resolvePermission(false);
});

document.getElementById("copyResultButton").addEventListener("click", async () => {
  const task = selectedTask();
  if (!task?.finalAnswer) return;
  await invoke("write_clipboard_text", { text: task.finalAnswer });
  showToast("结果已复制");
});

document.getElementById("toggleLogsButton").addEventListener("click", (event) => {
  const hidden = activityList.classList.toggle("hidden");
  event.currentTarget.textContent = hidden ? "展开" : "收起";
});

skillsButton.addEventListener("click", () => {
  if (showingSkills) {
    hideSkillsView();
    renderAll();
  } else {
    showSkillsView(selectedSkillId);
  }
});

newSkillButton.addEventListener("click", clearSkillForm);

skillList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-skill-id]");
  if (!button) return;
  fillSkillForm(skills.find((skill) => skill.id === button.dataset.skillId));
});

skillForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = skillNameInput.value.trim();
  const instructions = skillInstructionsInput.value.trim();
  if (!name || !instructions) {
    showToast("请填写技能名称和执行规则。");
    return;
  }
  const existing = skills.find((skill) => skill.id === skillIdInput.value);
  if (existing) {
    existing.versions.push({
      name: existing.name,
      description: existing.description,
      triggers: existing.triggers,
      instructions: existing.instructions,
      enabled: existing.enabled,
      savedAt: existing.updatedAt,
    });
    existing.versions = existing.versions.slice(-10);
    Object.assign(existing, {
      name: name.slice(0, 80),
      description: skillDescriptionInput.value.trim().slice(0, 500),
      triggers: skillTriggersInput.value.trim().slice(0, 300),
      instructions: instructions.slice(0, 12_000),
      enabled: skillEnabledInput.checked,
      updatedAt: nowIso(),
    });
    saveSkills();
    fillSkillForm(existing);
    showToast("技能已保存，并保留上一版");
    return;
  }
  const skill = normalizeSkill({
    id: crypto.randomUUID(),
    name,
    description: skillDescriptionInput.value,
    triggers: skillTriggersInput.value,
    instructions,
    enabled: skillEnabledInput.checked,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  skills.unshift(skill);
  saveSkills();
  fillSkillForm(skill);
  showToast("技能已创建");
});

restoreSkillButton.addEventListener("click", () => {
  const skill = skills.find((item) => item.id === selectedSkillId);
  const previous = skill?.versions.pop();
  if (!skill || !previous) return;
  const current = {
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers,
    instructions: skill.instructions,
    enabled: skill.enabled,
    savedAt: skill.updatedAt,
  };
  Object.assign(skill, previous, { updatedAt: nowIso() });
  skill.versions.push(current);
  skill.versions = skill.versions.slice(-10);
  saveSkills();
  fillSkillForm(skill);
  showToast("已恢复上一版；刚才的版本仍可再次恢复");
});

deleteSkillButton.addEventListener("click", () => {
  const skill = skills.find((item) => item.id === selectedSkillId);
  if (!skill || !window.confirm(`确定永久删除技能“${skill.name}”吗？已有 Agent 任务中的技能快照不会被删除。`)) return;
  skills = skills.filter((item) => item.id !== skill.id);
  saveSkills();
  clearSkillForm();
  showToast("技能已删除");
});

saveAsSkillButton.addEventListener("click", () => {
  const task = selectedTask();
  if (!task || task.status !== "completed") return;
  const steps = task.plan.map((step, index) => `${index + 1}. ${step.title}${step.description ? `：${step.description}` : ""}`).join("\n");
  const skill = normalizeSkill({
    id: crypto.randomUUID(),
    name: task.title,
    description: task.summary || `由 Agent 任务“${task.title}”保存`,
    triggers: "",
    instructions: [
      "先理解用户当前目标，不要假设它与保存技能时的对象完全相同。",
      "按以下成熟流程执行；如果当前目标不适合某一步，可以说明原因并调整，但不得降低安全确认要求。",
      steps,
      "所有文件、剪贴板、网页、终端与外部写入仍遵循 Kardii 的逐次权限确认。",
      "完成后汇总结果、依据、未完成项和下一步。",
    ].filter(Boolean).join("\n\n"),
    enabled: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  skills.unshift(skill);
  saveSkills();
  showSkillsView(skill.id);
  showToast("已从任务生成技能草稿，可以继续修改");
});

automationsButton.addEventListener("click", () => {
  if (showingAutomations) {
    hideAutomationsView();
    renderAll();
  } else {
    showAutomationsView(selectedAutomationId);
  }
});

newAutomationButton.addEventListener("click", clearAutomationForm);

automationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-automation-id]");
  if (!button) return;
  fillAutomationForm(automations.find((item) => item.id === button.dataset.automationId));
});

[
  automationScheduleSelect,
  automationDateInput,
  automationOnceTimeInput,
  automationDailyTimeInput,
  automationWeekdaySelect,
  automationWeeklyTimeInput,
].forEach((element) => element.addEventListener("change", renderAutomationScheduleRows));

automationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = automationNameInput.value.trim();
  const goal = automationGoalInput.value.trim();
  if (!name || !goal) {
    showToast("请填写自动化名称和 Agent 任务目标。");
    return;
  }
  const schedule = automationScheduleSelect.value;
  const time = schedule === "once"
    ? automationOnceTimeInput.value
    : schedule === "daily"
      ? automationDailyTimeInput.value
      : automationWeeklyTimeInput.value;
  const draft = {
    name,
    goal,
    schedule,
    date: automationDateInput.value,
    time,
    weekday: Number(automationWeekdaySelect.value),
    skillId: automationSkillSelect.value,
    autoStart: automationAutoStartInput.checked,
    enabled: automationEnabledInput.checked,
  };
  const nextRunAt = nextAutomationRun(draft);
  if (!nextRunAt) {
    showToast("请填写有效的执行日期和时间。");
    return;
  }
  if (schedule === "once" && new Date(nextRunAt) <= new Date() && draft.enabled) {
    showToast("仅一次的执行时间必须晚于现在。");
    return;
  }
  const existing = automations.find((item) => item.id === automationIdInput.value);
  if (existing) {
    Object.assign(existing, draft, { nextRunAt, updatedAt: nowIso() });
    saveAutomations();
    fillAutomationForm(existing);
    showToast("自动化已保存");
    return;
  }
  const automation = normalizeAutomation({
    id: crypto.randomUUID(),
    ...draft,
    nextRunAt,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  automations.unshift(automation);
  saveAutomations();
  fillAutomationForm(automation);
  showToast("自动化已创建");
});

deleteAutomationButton.addEventListener("click", () => {
  const automation = automations.find((item) => item.id === selectedAutomationId);
  if (!automation || !window.confirm(`确定永久删除自动化“${automation.name}”吗？已经创建的 Agent 任务会保留。`)) return;
  automations = automations.filter((item) => item.id !== automation.id);
  saveAutomations();
  clearAutomationForm();
  showToast("自动化已删除");
});

async function surfaceAgentWindow() {
  try {
    await appWindow.show();
    await appWindow.unminimize();
    await appWindow.setFocus();
  } catch {
    // The task remains saved even if the operating system refuses to focus the window.
  }
}

function runAutomation(automation, advanceSchedule = false) {
  if (!automation?.goal) return;
  const ranAt = nowIso();
  automation.lastRunAt = ranAt;
  automation.runCount += 1;
  automation.updatedAt = ranAt;
  if (advanceSchedule) {
    if (automation.schedule === "once") {
      automation.enabled = false;
    } else {
      automation.nextRunAt = nextAutomationRun(automation, new Date(Date.now() + 1_000));
    }
  }
  saveAutomations();
  try {
    const task = createTask(automation.goal, 12, automation.skillId);
    task.automationId = automation.id;
    task.automationName = automation.name;
    addActivity(task, "system", `由自动化“${automation.name}”创建`, automation.autoStart ? "任务将自动开始；高权限操作仍会等待确认。" : "任务已创建为草稿，等待你手动开始。");
    saveTasks();
    if (advanceSchedule) void surfaceAgentWindow();
    if (automation.autoStart) void planTask(task.id);
  } catch (error) {
    showToast(`自动化未能创建任务：${String(error)}`);
  }
}

runAutomationNowButton.addEventListener("click", () => {
  const automation = automations.find((item) => item.id === selectedAutomationId);
  if (!automation) return;
  runAutomation(automation, false);
  showToast("已创建一次 Agent 任务");
});

function checkAutomations() {
  const now = Date.now();
  const dueIds = automations
    .filter((automation) => automation.enabled && automation.nextRunAt)
    .filter((automation) => {
      const dueAt = new Date(automation.nextRunAt).getTime();
      return Number.isFinite(dueAt) && dueAt <= now;
    })
    .map((automation) => automation.id);
  dueIds.forEach((id) => {
    const automation = automations.find((item) => item.id === id);
    if (automation) runAutomation(automation, true);
  });
}

document.getElementById("openChatButton").addEventListener("click", async () => {
  const window = (await getAllWindows()).find((item) => item.label === "chat");
  if (!window) return;
  await window.show();
  await window.setFocus();
});
document.getElementById("minimizeButton").addEventListener("click", () => appWindow.minimize());
document.getElementById("closeButton").addEventListener("click", () => appWindow.hide());

window.addEventListener("storage", (event) => {
  if (event.key === AGENT_TASKS_KEY) {
    try {
      const incoming = JSON.parse(event.newValue || "[]");
      if (Array.isArray(incoming)) tasks = incoming.map(normalizeTask).slice(0, MAX_TASKS);
    } catch { return; }
    renderAll();
  }
  if (event.key === AGENT_SKILLS_KEY) {
    try {
      const incoming = JSON.parse(event.newValue || "[]");
      if (Array.isArray(incoming)) skills = incoming.map(normalizeSkill).slice(0, 100);
    } catch { return; }
    renderAll();
  }
  if (event.key === AUTOMATIONS_KEY) {
    try {
      const incoming = JSON.parse(event.newValue || "[]");
      if (Array.isArray(incoming)) automations = incoming.map(normalizeAutomation).slice(0, 100);
    } catch { return; }
    renderAll();
  }
  if (event.key === AGENT_TARGET_KEY && event.newValue) consumeTarget();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !permissionPanel.classList.contains("hidden")) return;
  if (event.key === "Escape") appWindow.hide();
});

renderAll();
consumeTarget();
checkAutomations();
setInterval(checkAutomations, 30_000);
