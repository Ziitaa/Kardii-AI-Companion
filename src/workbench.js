const { getCurrentWindow, getAllWindows } = window.__TAURI__.window;

const appWindow = getCurrentWindow();
const BUSINESS_DATA_KEY = "kardii-business-data-v1";
const STAGES = {
  lead: "潜在线索",
  contacted: "已联系",
  negotiating: "洽谈中",
  partner: "合作中",
  paused: "暂缓",
};

const viewMeta = {
  dashboard: ["BUSINESS WORKBENCH", "今日工作台"],
  customers: ["CUSTOMER MANAGEMENT", "客户库"],
  projects: ["PROJECT MANAGEMENT", "项目库"],
  intelligence: ["BUSINESS INTELLIGENCE", "商业情报"],
  knowledge: ["KNOWLEDGE & MEMORY", "知识库"],
};

const seedData = {
  version: 1,
  customers: [],
  projects: [
    {
      id: crypto.randomUUID(),
      name: "Target 入驻",
      goal: "完成美国地址、资料审核与平台入驻验证。",
      status: "active",
      progress: 68,
      nextAction: "确认预审表与地址材料最终清单",
      dueDate: "",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "欧洲市场启动",
      goal: "建立欧洲渠道网络，筛选分销商与长期合作伙伴。",
      status: "active",
      progress: 24,
      nextAction: "建立首批目标渠道名单",
      dueDate: "",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "分销合作体系",
      goal: "明确采购、分销与深度合作的分层对接机制。",
      status: "active",
      progress: 42,
      nextAction: "整理合作分级与跟进话术",
      dueDate: "",
      createdAt: new Date().toISOString(),
    },
  ],
  tasks: [
    {
      id: crypto.randomUUID(),
      title: "整理本周最优先的 BD 下一步",
      relation: "Kardii v0.9",
      dueDate: dateInputValue(new Date()),
      completed: false,
      createdAt: new Date().toISOString(),
    },
  ],
  notes: [],
};

let data = loadData();
let activeView = "dashboard";
let modalType = "";
let toastTimer;

const navItems = [...document.querySelectorAll(".nav-item")];
const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
const viewEyebrow = document.getElementById("viewEyebrow");
const viewTitle = document.getElementById("viewTitle");
const customerNavCount = document.getElementById("customerNavCount");
const projectNavCount = document.getElementById("projectNavCount");
const customerGrid = document.getElementById("customerGrid");
const projectGrid = document.getElementById("projectGrid");
const taskList = document.getElementById("taskList");
const dashboardProjects = document.getElementById("dashboardProjects");
const dashboardFollowups = document.getElementById("dashboardFollowups");
const recentNotes = document.getElementById("recentNotes");
const customerSearch = document.getElementById("customerSearch");
const customerStageFilter = document.getElementById("customerStageFilter");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalEyebrow = document.getElementById("modalEyebrow");
const modalTitle = document.getElementById("modalTitle");
const modalSubmitButton = document.getElementById("modalSubmitButton");
const entityForm = document.getElementById("entityForm");
const formFields = document.getElementById("formFields");
const toast = document.getElementById("toast");

function dateInputValue(date) {
  const value = new Date(date);
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(BUSINESS_DATA_KEY) || "null");
    if (!saved || saved.version !== 1) {
      const initialData = structuredClone(seedData);
      localStorage.setItem(BUSINESS_DATA_KEY, JSON.stringify(initialData));
      return initialData;
    }
    return {
      version: 1,
      customers: Array.isArray(saved.customers) ? saved.customers : [],
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
      notes: Array.isArray(saved.notes) ? saved.notes : [],
    };
  } catch {
    const initialData = structuredClone(seedData);
    localStorage.setItem(BUSINESS_DATA_KEY, JSON.stringify(initialData));
    return initialData;
  }
}

function saveData() {
  localStorage.setItem(BUSINESS_DATA_KEY, JSON.stringify(data));
  renderAll();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value, fallback = "未设置") {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function isDueTodayOrEarlier(value) {
  return value && value <= dateInputValue(new Date());
}

function startOfWeek() {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - day + 1);
  return now;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function navigate(view) {
  activeView = viewMeta[view] ? view : "dashboard";
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === activeView));
  viewPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === activeView));
  [viewEyebrow.textContent, viewTitle.textContent] = viewMeta[activeView];
}

function renderDashboard() {
  const today = dateInputValue(new Date());
  const openTasks = data.tasks.filter((task) => !task.completed);
  const dueTasks = openTasks.filter((task) => isDueTodayOrEarlier(task.dueDate));
  const overdueTasks = openTasks.filter((task) => task.dueDate && task.dueDate < today);
  const followups = data.customers.filter((customer) => customer.nextAction);
  const activeProjects = data.projects.filter((project) => project.status === "active");
  const weeklyNotes = data.notes.filter((note) => new Date(note.createdAt) >= startOfWeek());

  document.getElementById("todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  }).format(new Date());
  document.getElementById("todayTaskCount").textContent = String(dueTasks.length);
  document.getElementById("overdueTaskCount").textContent = `${overdueTasks.length} 项已逾期`;
  document.getElementById("followupCount").textContent = String(followups.length);
  document.getElementById("activeProjectCount").textContent = String(activeProjects.length);
  document.getElementById("weeklyNoteCount").textContent = String(weeklyNotes.length);

  const tasks = [...openTasks.filter((task) => isDueTodayOrEarlier(task.dueDate)), ...openTasks.filter((task) => !isDueTodayOrEarlier(task.dueDate))]
    .slice(0, 5);
  taskList.innerHTML = tasks.length ? tasks.map((task) => `
    <label class="task-item ${task.completed ? "done" : ""}">
      <input class="task-check" type="checkbox" data-task-id="${task.id}" ${task.completed ? "checked" : ""}>
      <span class="task-copy"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.relation || "独立任务")}</span></span>
      <span class="tag">${formatDate(task.dueDate)}</span>
    </label>
  `).join("") : emptyMarkup("今天还没有任务，先添加一件最重要的事。");

  dashboardProjects.innerHTML = activeProjects.slice(0, 4).map((project) => compactMarkup(
    project.name,
    project.nextAction || project.goal,
    `${Math.min(100, Math.max(0, Number(project.progress) || 0))}%`,
  )).join("") || emptyMarkup("还没有进行中的项目。");

  dashboardFollowups.innerHTML = [...followups]
    .sort((a, b) => String(a.followupDate || "9999").localeCompare(String(b.followupDate || "9999")))
    .slice(0, 4)
    .map((customer) => compactMarkup(customer.company, customer.nextAction, formatDate(customer.followupDate)))
    .join("") || emptyMarkup("添加客户后，下一步行动会出现在这里。");

  recentNotes.innerHTML = [...data.notes].reverse().slice(0, 4)
    .map((note) => compactMarkup(note.title || "快速记录", note.content, new Date(note.createdAt).toLocaleDateString("zh-CN")))
    .join("") || emptyMarkup("随手记录电话要点、客户反馈或灵感。");
}

function compactMarkup(title, detail, meta) {
  return `<div class="compact-item"><span class="compact-dot"></span><span class="compact-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail || "暂无下一步")}</span></span><span class="compact-meta">${escapeHtml(meta)}</span></div>`;
}

function emptyMarkup(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderCustomers() {
  const query = customerSearch.value.trim().toLowerCase();
  const stage = customerStageFilter.value;
  const customers = data.customers.filter((customer) => {
    const haystack = [customer.company, customer.contact, customer.country, customer.channel].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!stage || customer.stage === stage);
  });

  customerGrid.innerHTML = customers.map((customer) => `
    <article class="customer-card">
      <div class="card-top">
        <div class="company-avatar">${escapeHtml((customer.company || "?").slice(0, 1).toUpperCase())}</div>
        <span class="stage-badge">${STAGES[customer.stage] || "潜在线索"}</span>
      </div>
      <h3>${escapeHtml(customer.company)}</h3>
      <p class="contact">${escapeHtml(customer.contact || "未填写联系人")}</p>
      <div class="card-facts">
        ${customer.country ? `<span>${escapeHtml(customer.country)}</span>` : ""}
        ${customer.channel ? `<span>${escapeHtml(customer.channel)}</span>` : ""}
      </div>
      <div class="next-action">
        <span>下一步行动</span>
        <strong>${escapeHtml(customer.nextAction || "等待安排")}</strong>
        <time>${formatDate(customer.followupDate)}</time>
      </div>
    </article>
  `).join("") || emptyMarkup(query || stage ? "没有符合筛选条件的客户。" : "客户库还是空的。点击“新建客户”建立第一张客户卡片。");
}

function renderProjects() {
  document.getElementById("projectSummary").textContent = `${data.projects.length} 个项目`;
  projectGrid.innerHTML = data.projects.map((project) => {
    const progress = Math.min(100, Math.max(0, Number(project.progress) || 0));
    return `
      <article class="project-card">
        <div class="project-header">
          <h3>${escapeHtml(project.name)}</h3>
          <span class="project-status">${project.status === "active" ? "● 进行中" : "○ 已归档"}</span>
        </div>
        <p class="project-goal">${escapeHtml(project.goal || "尚未填写项目目标")}</p>
        <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
        <div class="project-foot"><span>进度 ${progress}%</span><span>下一步：${escapeHtml(project.nextAction || "待安排")}</span></div>
      </article>
    `;
  }).join("") || emptyMarkup("还没有项目。创建一个真实项目，让 Kardii 从目标和下一步开始陪你推进。");
}

function renderAll() {
  customerNavCount.textContent = String(data.customers.length);
  projectNavCount.textContent = String(data.projects.length);
  renderDashboard();
  renderCustomers();
  renderProjects();
}

function fieldMarkup({ name, label, type = "text", required = false, full = false, options = [], placeholder = "", value = "" }) {
  const control = type === "textarea"
    ? `<textarea name="${name}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
    : type === "select"
      ? `<select name="${name}">${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}">${optionLabel}</option>`).join("")}</select>`
      : `<input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""}>`;
  return `<div class="form-field ${full ? "full" : ""}"><label>${label}${required ? " *" : ""}</label>${control}</div>`;
}

function openModal(type) {
  modalType = type;
  const configs = {
    customer: {
      eyebrow: "CUSTOMER MANAGEMENT",
      title: "新建客户",
      button: "保存客户",
      fields: [
        { name: "company", label: "公司名称", required: true, placeholder: "例如：ABC Outdoor" },
        { name: "contact", label: "联系人", placeholder: "姓名与职位" },
        { name: "country", label: "国家 / 地区", placeholder: "例如：德国" },
        { name: "channel", label: "渠道 / 主营业务", placeholder: "例如：花园家具分销" },
        { name: "stage", label: "合作阶段", type: "select", options: Object.entries(STAGES) },
        { name: "followupDate", label: "下次跟进", type: "date" },
        { name: "nextAction", label: "下一步行动", full: true, placeholder: "下一次要做什么" },
      ],
    },
    project: {
      eyebrow: "PROJECT MANAGEMENT",
      title: "新建项目",
      button: "保存项目",
      fields: [
        { name: "name", label: "项目名称", required: true, placeholder: "例如：德国分销商开发" },
        { name: "progress", label: "当前进度（0–100）", type: "number", value: "0" },
        { name: "goal", label: "项目目标", type: "textarea", full: true, placeholder: "这个项目最终要达成什么结果" },
        { name: "nextAction", label: "下一步行动", full: true, placeholder: "现在最该推进的一步" },
        { name: "dueDate", label: "目标日期", type: "date" },
      ],
    },
    task: {
      eyebrow: "NEXT ACTION",
      title: "添加任务",
      button: "添加任务",
      fields: [
        { name: "title", label: "任务", required: true, full: true, placeholder: "只写一个清晰、可执行的动作" },
        { name: "relation", label: "关联客户 / 项目", placeholder: "可选" },
        { name: "dueDate", label: "截止日期", type: "date", value: dateInputValue(new Date()) },
      ],
    },
    note: {
      eyebrow: "QUICK CAPTURE",
      title: "快速记录",
      button: "保存记录",
      fields: [
        { name: "title", label: "标题", full: true, placeholder: "例如：与欧洲客户电话纪要" },
        { name: "content", label: "内容", type: "textarea", required: true, full: true, placeholder: "客户反馈、沟通要点、想法或待确认事项" },
      ],
    },
  };
  const config = configs[type];
  if (!config) return;
  modalEyebrow.textContent = config.eyebrow;
  modalTitle.textContent = config.title;
  modalSubmitButton.textContent = config.button;
  formFields.innerHTML = config.fields.map(fieldMarkup).join("");
  modalBackdrop.classList.remove("hidden");
  formFields.querySelector("input, textarea, select")?.focus();
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  entityForm.reset();
  modalType = "";
}

function formValue(formData, key) {
  return String(formData.get(key) || "").trim();
}

function submitEntity(event) {
  event.preventDefault();
  const formData = new FormData(entityForm);
  const now = new Date().toISOString();
  if (modalType === "customer") {
    data.customers.unshift({
      id: crypto.randomUUID(),
      company: formValue(formData, "company"),
      contact: formValue(formData, "contact"),
      country: formValue(formData, "country"),
      channel: formValue(formData, "channel"),
      stage: formValue(formData, "stage") || "lead",
      followupDate: formValue(formData, "followupDate"),
      nextAction: formValue(formData, "nextAction"),
      createdAt: now,
    });
    showToast("客户卡片已创建");
  } else if (modalType === "project") {
    data.projects.unshift({
      id: crypto.randomUUID(),
      name: formValue(formData, "name"),
      goal: formValue(formData, "goal"),
      progress: Number(formValue(formData, "progress")) || 0,
      nextAction: formValue(formData, "nextAction"),
      dueDate: formValue(formData, "dueDate"),
      status: "active",
      createdAt: now,
    });
    showToast("项目已创建");
  } else if (modalType === "task") {
    data.tasks.unshift({
      id: crypto.randomUUID(),
      title: formValue(formData, "title"),
      relation: formValue(formData, "relation"),
      dueDate: formValue(formData, "dueDate"),
      completed: false,
      createdAt: now,
    });
    showToast("任务已添加");
  } else if (modalType === "note") {
    data.notes.push({
      id: crypto.randomUUID(),
      title: formValue(formData, "title"),
      content: formValue(formData, "content"),
      createdAt: now,
    });
    showToast("记录已保存");
  }
  closeModal();
  saveData();
}

async function openChat() {
  const chatWindow = (await getAllWindows()).find((item) => item.label === "chat");
  if (!chatWindow) return;
  await chatWindow.show();
  await chatWindow.setFocus();
}

navItems.forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  const navigateTo = event.target.closest("[data-navigate]")?.dataset.navigate;
  if (navigateTo) navigate(navigateTo);
  if (action === "add-customer") openModal("customer");
  if (action === "add-project") openModal("project");
  if (action === "add-task") openModal("task");
  if (action === "add-note") openModal("note");
});

taskList.addEventListener("change", (event) => {
  const id = event.target.dataset.taskId;
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = event.target.checked;
  saveData();
});

customerSearch.addEventListener("input", renderCustomers);
customerStageFilter.addEventListener("change", renderCustomers);
document.getElementById("quickAddButton").addEventListener("click", () => openModal("note"));
document.getElementById("globalSearchButton").addEventListener("click", () => {
  navigate("customers");
  customerSearch.focus();
});
document.getElementById("openChatButton").addEventListener("click", openChat);
document.getElementById("minimizeButton").addEventListener("click", () => appWindow.minimize());
document.getElementById("closeButton").addEventListener("click", () => appWindow.hide());
document.getElementById("modalCloseButton").addEventListener("click", closeModal);
document.getElementById("modalCancelButton").addEventListener("click", closeModal);
modalBackdrop.addEventListener("mousedown", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
entityForm.addEventListener("submit", submitEntity);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.classList.contains("hidden")) closeModal();
  else if (event.key === "Escape") appWindow.hide();
});
window.addEventListener("storage", (event) => {
  if (event.key !== BUSINESS_DATA_KEY) return;
  data = loadData();
  renderAll();
});

navigate("dashboard");
renderAll();
