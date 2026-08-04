const { getCurrentWindow, getAllWindows } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;

const appWindow = getCurrentWindow();
const AGENT_TASKS_KEY = "kardii-agent-tasks-v1";
const AGENT_TARGET_KEY = "kardii-agent-open-target-v1";
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
const toast = document.getElementById("toast");

let tasks = loadTasks();
let selectedTaskId = "";
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
    question: String(value?.question || "").slice(0, 4_000),
    finalAnswer: String(value?.finalAnswer || "").slice(0, 100_000),
    error: String(value?.error || "").slice(0, 4_000),
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
  return tasks.find((task) => task.id !== taskId && ["planning", "running", "waiting_permission", "waiting_input"].includes(task.status));
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
  const provider = ["deepseek", "gemini", "ollama"].includes(saved.provider) ? saved.provider : "deepseek";
  const model = provider === "deepseek"
    ? "deepseek-v4-flash"
    : provider === "gemini"
      ? (["gemini-3.1-flash-lite", "gemini-3.5-flash"].includes(saved.geminiModel) ? saved.geminiModel : "gemini-3.1-flash-lite")
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

function contextSummary() {
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
  return `本机知识库：${knowledgeCount} 份可检索资料；长期记忆：${memoryCount} 条。`;
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

function renderPermission(task) {
  const action = task?.status === "waiting_permission" ? task.pendingAction : null;
  permissionPanel.classList.toggle("hidden", !action);
  if (!action) return;
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
  createView.classList.toggle("hidden", Boolean(task));
  taskView.classList.toggle("hidden", !task);
  if (!task) {
    renderPermission(null);
    return;
  }
  taskStatusBadge.textContent = STATUS_LABELS[task.status];
  taskStatusBadge.className = `status-badge ${task.status}`;
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
  renderTask();
}

function createTask(goal, maxSteps = 12) {
  const cleanGoal = String(goal || "").trim().slice(0, 4_000);
  if (!cleanGoal) throw new Error("请先填写任务目标。");
  const task = normalizeTask({
    id: crypto.randomUUID(),
    goal: cleanGoal,
    title: clipText(cleanGoal.replace(/\s+/g, " "), 60),
    status: "draft",
    maxSteps,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  addActivity(task, "system", "任务已创建", "Kardii 将先制定计划，再逐步执行。涉及高权限工具时会等待你的确认。");
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
        context: contextSummary(),
        provider: ai.provider,
        model: ai.model,
        ollamaBaseUrl: ai.ollamaBaseUrl,
      },
    });
    task.aiCalls += 1;
    task.title = result.title || task.title;
    task.summary = result.summary || "";
    task.plan = (Array.isArray(result.steps) ? result.steps : []).map((step) => ({ ...step, status: "pending" }));
    task.currentAction = null;
    if (task.status === "planning") {
      task.status = "running";
      continueAfterPlan = true;
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
            plan: { title: task.title, summary: task.summary, steps: task.plan },
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
        task.pendingAction = action;
        task.status = "waiting_permission";
        addActivity(task, "permission", "等待操作确认", action.title || action.tool);
        saveTasks();
        break;
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
    const task = createTask(goalInput.value, Number(maxStepsInput.value));
    goalInput.value = "";
    void planTask(task.id);
  } catch (error) {
    showToast(String(error));
  } finally {
    startTaskButton.disabled = false;
  }
});

showCreateButton.addEventListener("click", () => {
  selectedTaskId = "";
  renderAll();
  goalInput.focus();
});

taskList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-id]");
  if (!button) return;
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

allowPermissionButton.addEventListener("click", () => void resolvePermission(true));
denyPermissionButton.addEventListener("click", () => void resolvePermission(false));

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
  if (event.key === AGENT_TARGET_KEY && event.newValue) consumeTarget();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !permissionPanel.classList.contains("hidden")) return;
  if (event.key === "Escape") appWindow.hide();
});

renderAll();
consumeTarget();
