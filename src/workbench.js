const { getCurrentWindow, getAllWindows } = window.__TAURI__.window;

const appWindow = getCurrentWindow();
const BUSINESS_DATA_KEY = "kardii-business-data-v1";
const WORKBENCH_TARGET_KEY = "kardii-workbench-open-target-v1";
const STAGES = {
  lead: "潜在线索",
  contacted: "已联系",
  negotiating: "洽谈中",
  partner: "合作中",
  paused: "暂缓",
};
const PRIORITIES = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};
const PROJECT_STATUSES = {
  planned: "计划中",
  active: "进行中",
  on_hold: "暂缓",
  completed: "已完成",
  archived: "已归档",
};
const ACTIVITY_TYPES = {
  call: "电话",
  email: "邮件",
  meeting: "会议",
  message: "消息",
  note: "备注",
  customer: "客户记录",
  project: "项目进展",
  decision: "重要决定",
  task: "待办线索",
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
  captures: [],
  activities: [],
};

let data = loadData();
let activeView = "dashboard";
let modalType = "";
let editingId = "";
let toastTimer;

const navItems = [...document.querySelectorAll(".nav-item")];
const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
const viewEyebrow = document.getElementById("viewEyebrow");
const viewTitle = document.getElementById("viewTitle");
const customerNavCount = document.getElementById("customerNavCount");
const projectNavCount = document.getElementById("projectNavCount");
const customerGrid = document.getElementById("customerGrid");
const projectGrid = document.getElementById("projectGrid");
const projectSearch = document.getElementById("projectSearch");
const projectStatusFilter = document.getElementById("projectStatusFilter");
const taskList = document.getElementById("taskList");
const dashboardProjects = document.getElementById("dashboardProjects");
const dashboardFollowups = document.getElementById("dashboardFollowups");
const recentNotes = document.getElementById("recentNotes");
const captureInbox = document.getElementById("captureInbox");
const captureInboxCount = document.getElementById("captureInboxCount");
const customerSearch = document.getElementById("customerSearch");
const customerStageFilter = document.getElementById("customerStageFilter");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalEyebrow = document.getElementById("modalEyebrow");
const modalTitle = document.getElementById("modalTitle");
const modalSubmitButton = document.getElementById("modalSubmitButton");
const entityForm = document.getElementById("entityForm");
const formFields = document.getElementById("formFields");
const entityRelations = document.getElementById("entityRelations");
const entityTimeline = document.getElementById("entityTimeline");
const modalArchiveButton = document.getElementById("modalArchiveButton");
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
    const normalized = {
      version: 1,
      customers: Array.isArray(saved.customers) ? saved.customers.map((customer) => ({
        priority: "medium",
        tags: "",
        website: "",
        email: "",
        phone: "",
        title: "",
        source: "",
        notes: "",
        linkedProjectIds: [],
        ...customer,
        linkedProjectIds: Array.isArray(customer.linkedProjectIds) ? customer.linkedProjectIds : [],
      })) : [],
      projects: Array.isArray(saved.projects) ? saved.projects.map((project) => ({
        priority: "medium",
        owner: "",
        linkedCustomerIds: [],
        ...project,
        linkedCustomerIds: Array.isArray(project.linkedCustomerIds) ? project.linkedCustomerIds : [],
      })) : [],
      tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
      notes: Array.isArray(saved.notes) ? saved.notes : [],
      captures: Array.isArray(saved.captures) ? saved.captures : [],
      activities: Array.isArray(saved.activities) ? saved.activities : [],
    };
    syncRelations(normalized);
    return normalized;
  } catch {
    const initialData = structuredClone(seedData);
    localStorage.setItem(BUSINESS_DATA_KEY, JSON.stringify(initialData));
    return initialData;
  }
}

function syncRelations(target = data) {
  const customerIds = new Set(target.customers.map((customer) => customer.id));
  const projectIds = new Set(target.projects.map((project) => project.id));
  target.customers.forEach((customer) => {
    customer.linkedProjectIds = [...new Set((customer.linkedProjectIds || []).filter((id) => projectIds.has(id)))];
  });
  target.projects.forEach((project) => {
    project.linkedCustomerIds = [...new Set((project.linkedCustomerIds || []).filter((id) => customerIds.has(id)))];
    project.linkedCustomerIds.forEach((customerId) => {
      const customer = target.customers.find((item) => item.id === customerId);
      if (customer && !customer.linkedProjectIds.includes(project.id)) customer.linkedProjectIds.push(project.id);
    });
  });
  target.customers.forEach((customer) => {
    customer.linkedProjectIds.forEach((projectId) => {
      const project = target.projects.find((item) => item.id === projectId);
      if (project && !project.linkedCustomerIds.includes(customer.id)) project.linkedCustomerIds.push(customer.id);
    });
  });
}

function saveData() {
  syncRelations();
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

  renderCaptureInbox();
}

function captureTypeLabel(type) {
  return {
    decision: "重要决定",
    task: "待办线索",
    customer: "客户信息",
    project: "项目动态",
  }[type] || "商务记录";
}

function renderCaptureInbox() {
  const pending = data.captures.filter((capture) => capture.status === "inbox");
  captureInboxCount.textContent = `${pending.length} 条待整理`;
  captureInbox.innerHTML = pending.slice(0, 5).map((capture) => `
    <div class="capture-item">
      <span class="capture-type">${captureTypeLabel(capture.type)}</span>
      <span class="capture-copy">
        <strong>${escapeHtml(capture.relationName || "未关联")}</strong>
        <span>${escapeHtml(capture.content)}</span>
      </span>
      <time>${new Date(capture.createdAt).toLocaleDateString("zh-CN")}</time>
      <div class="capture-actions">
        ${capture.generatedTaskId
          ? `<button type="button" disabled>已生成任务</button>`
          : `<button type="button" data-capture-action="task" data-capture-id="${capture.id}">转为任务</button>`}
        <button type="button" data-capture-action="archive" data-capture-id="${capture.id}">归档</button>
      </div>
    </div>
  `).join("") || `<div class="capture-empty">聊天里出现新的客户、项目、决定或下一步时，Kardii 会自动记录在这里。</div>`;
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
    const haystack = [
      customer.company, customer.contact, customer.title, customer.country, customer.channel,
      customer.email, customer.source, customer.tags,
    ].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!stage || customer.stage === stage);
  });

  customerGrid.innerHTML = customers.map((customer) => `
    <article class="customer-card" data-action="edit-customer" data-entity-id="${customer.id}">
      <div class="card-top">
        <div class="company-avatar">${escapeHtml((customer.company || "?").slice(0, 1).toUpperCase())}</div>
        <div class="card-badges">
          <span class="priority-badge ${escapeHtml(customer.priority || "medium")}">${PRIORITIES[customer.priority] || "中优先级"}</span>
          <span class="stage-badge">${STAGES[customer.stage] || "潜在线索"}</span>
        </div>
      </div>
      <h3>${escapeHtml(customer.company)}</h3>
      <p class="contact">${escapeHtml(customer.contact || "未填写联系人")}${customer.title ? ` · ${escapeHtml(customer.title)}` : ""}</p>
      <div class="card-facts">
        ${customer.country ? `<span>${escapeHtml(customer.country)}</span>` : ""}
        ${customer.channel ? `<span>${escapeHtml(customer.channel)}</span>` : ""}
        ${(customer.linkedProjectIds || []).length ? `<span>${customer.linkedProjectIds.length} 个关联项目</span>` : ""}
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
  const query = projectSearch.value.trim().toLowerCase();
  const status = projectStatusFilter.value;
  const projects = data.projects.filter((project) => {
    const linkedNames = (project.linkedCustomerIds || [])
      .map((id) => data.customers.find((customer) => customer.id === id)?.company || "");
    const haystack = [project.name, project.goal, project.nextAction, project.owner, ...linkedNames].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || project.status === status);
  });
  document.getElementById("projectSummary").textContent = `${projects.length} / ${data.projects.length} 个项目`;
  projectGrid.innerHTML = projects.map((project) => {
    const progress = Math.min(100, Math.max(0, Number(project.progress) || 0));
    const linkedCustomers = (project.linkedCustomerIds || [])
      .map((id) => data.customers.find((customer) => customer.id === id))
      .filter(Boolean);
    return `
      <article class="project-card" data-action="edit-project" data-entity-id="${project.id}">
        <div class="project-header">
          <div>
            <span class="priority-label ${escapeHtml(project.priority || "medium")}">${PRIORITIES[project.priority] || "中优先级"}</span>
            <h3>${escapeHtml(project.name)}</h3>
          </div>
          <span class="project-status status-${escapeHtml(project.status || "active")}">● ${PROJECT_STATUSES[project.status] || "进行中"}</span>
        </div>
        <p class="project-goal">${escapeHtml(project.goal || "尚未填写项目目标")}</p>
        <div class="linked-preview">
          ${linkedCustomers.length
            ? linkedCustomers.slice(0, 3).map((customer) => `<span>${escapeHtml(customer.company)}</span>`).join("")
            : "<span>暂未关联客户</span>"}
          ${linkedCustomers.length > 3 ? `<span>＋${linkedCustomers.length - 3}</span>` : ""}
        </div>
        <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
        <div class="project-foot"><span>进度 ${progress}%${project.owner ? ` · ${escapeHtml(project.owner)}` : ""}</span><span>下一步：${escapeHtml(project.nextAction || "待安排")}</span></div>
      </article>
    `;
  }).join("") || emptyMarkup(query || status ? "没有符合筛选条件的项目。" : "还没有项目。创建一个真实项目，让 Kardii 从目标和下一步开始陪你推进。");
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
      ? `<select name="${name}">${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select>`
      : `<input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""} ${type === "number" ? 'min="0" max="100"' : ""}>`;
  return `<div class="form-field ${full ? "full" : ""}"><label>${label}${required ? " *" : ""}</label>${control}</div>`;
}

function timelineMarkup(relationType, relationId) {
  const activities = data.activities
    .filter((activity) => activity.relationType === relationType && activity.relationId === relationId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!activities.length) return `<div class="timeline-empty">还没有沟通或进展记录。保存下方的新记录后会出现在这里。</div>`;
  return activities.map((activity) => `
    <div class="timeline-item">
      <span class="timeline-dot"></span>
      <div><strong>${escapeHtml(ACTIVITY_TYPES[activity.kind] || captureTypeLabel(activity.kind))}</strong><p>${escapeHtml(activity.content)}</p></div>
      <time>${new Date(activity.createdAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  `).join("");
}

function relationPickerMarkup(type, entity) {
  const options = type === "customer"
    ? data.projects.map((project) => ({ id: project.id, label: project.name }))
    : data.customers.map((customer) => ({ id: customer.id, label: customer.company }));
  const selected = new Set(type === "customer" ? entity?.linkedProjectIds || [] : entity?.linkedCustomerIds || []);
  const name = type === "customer" ? "linkedProjectIds" : "linkedCustomerIds";
  const title = type === "customer" ? "关联项目" : "关联客户";
  const empty = type === "customer" ? "还没有项目可关联" : "还没有客户可关联";
  return `
    <div class="relation-heading">
      <div><strong>${title}</strong><span>保存后两边会自动同步</span></div>
      <span>${selected.size} 个已关联</span>
    </div>
    <div class="relation-options">
      ${options.length ? options.map((option) => `
        <div class="relation-option">
          <label>
            <input type="checkbox" name="${name}" value="${option.id}" ${selected.has(option.id) ? "checked" : ""}>
            <span>${escapeHtml(option.label)}</span>
          </label>
          ${entity ? `<button type="button" data-open-related="true" data-related-type="${type === "customer" ? "project" : "customer"}" data-related-id="${option.id}">打开</button>` : ""}
        </div>
      `).join("") : `<div class="relation-empty">${empty}</div>`}
    </div>
  `;
}

function openModal(type, entityId = "") {
  modalType = type;
  editingId = entityId;
  const customer = type === "customer" && entityId ? data.customers.find((item) => item.id === entityId) : null;
  const project = type === "project" && entityId ? data.projects.find((item) => item.id === entityId) : null;
  const taskRelations = [
    ["", "不关联"],
    ...data.projects.map((item) => [`project:${item.id}`, `项目 · ${item.name}`]),
    ...data.customers.map((item) => [`customer:${item.id}`, `客户 · ${item.company}`]),
  ];
  const configs = {
    customer: {
      eyebrow: "CUSTOMER MANAGEMENT",
      title: customer ? customer.company : "新建客户",
      button: customer ? "保存修改" : "保存客户",
      fields: [
        { name: "company", label: "公司名称", required: true, placeholder: "例如：ABC Outdoor", value: customer?.company || "" },
        { name: "priority", label: "优先级", type: "select", options: Object.entries(PRIORITIES), value: customer?.priority || "medium" },
        { name: "contact", label: "联系人", placeholder: "姓名", value: customer?.contact || "" },
        { name: "title", label: "职位", placeholder: "例如：采购总监", value: customer?.title || "" },
        { name: "email", label: "邮箱", type: "email", placeholder: "name@company.com", value: customer?.email || "" },
        { name: "phone", label: "电话 / WhatsApp", placeholder: "含国家区号", value: customer?.phone || "" },
        { name: "website", label: "官网", type: "url", placeholder: "https://", value: customer?.website || "" },
        { name: "country", label: "国家 / 地区", placeholder: "例如：德国", value: customer?.country || "" },
        { name: "channel", label: "渠道 / 主营业务", placeholder: "例如：花园家具分销", value: customer?.channel || "" },
        { name: "source", label: "客户来源", placeholder: "例如：展会 / LinkedIn / 转介绍", value: customer?.source || "" },
        { name: "stage", label: "合作阶段", type: "select", options: Object.entries(STAGES), value: customer?.stage || "lead" },
        { name: "followupDate", label: "下次跟进", type: "date", value: customer?.followupDate || "" },
        { name: "tags", label: "标签", placeholder: "多个标签用逗号分隔", value: customer?.tags || "" },
        { name: "nextAction", label: "下一步行动", full: true, placeholder: "下一次要做什么", value: customer?.nextAction || "" },
        { name: "notes", label: "客户备注", type: "textarea", full: true, placeholder: "客户偏好、合作机会、风险或其他长期信息", value: customer?.notes || "" },
        ...(customer ? [
          { name: "activityKind", label: "本次沟通方式", type: "select", options: [["call", "电话"], ["email", "邮件"], ["meeting", "会议"], ["message", "消息"], ["note", "备注"]], value: "message" },
          { name: "activity", label: "新增沟通记录", type: "textarea", full: true, placeholder: "例如：今天电话确认了样品需求，客户希望周五前收到报价。" },
        ] : []),
      ],
    },
    project: {
      eyebrow: "PROJECT MANAGEMENT",
      title: project ? project.name : "新建项目",
      button: project ? "保存修改" : "保存项目",
      fields: [
        { name: "name", label: "项目名称", required: true, placeholder: "例如：德国分销商开发", value: project?.name || "" },
        { name: "status", label: "项目状态", type: "select", options: Object.entries(PROJECT_STATUSES), value: project?.status || "active" },
        { name: "priority", label: "优先级", type: "select", options: Object.entries(PRIORITIES), value: project?.priority || "medium" },
        { name: "progress", label: "当前进度（0–100）", type: "number", value: String(project?.progress ?? 0) },
        { name: "owner", label: "负责人 / 参与人", placeholder: "例如：我、分销负责人", value: project?.owner || "" },
        { name: "dueDate", label: "目标日期", type: "date", value: project?.dueDate || "" },
        { name: "goal", label: "项目目标", type: "textarea", full: true, placeholder: "这个项目最终要达成什么结果", value: project?.goal || "" },
        { name: "nextAction", label: "下一步行动", full: true, placeholder: "现在最该推进的一步", value: project?.nextAction || "" },
        ...(project ? [
          { name: "activityKind", label: "本次记录类型", type: "select", options: [["project", "项目进展"], ["decision", "重要决定"], ["meeting", "会议"], ["note", "备注"]], value: "project" },
          { name: "activity", label: "新增进展记录", type: "textarea", full: true, placeholder: "例如：资料清单已确认，下一步等待地址账单。" },
        ] : []),
      ],
    },
    task: {
      eyebrow: "NEXT ACTION",
      title: "添加任务",
      button: "添加任务",
      fields: [
        { name: "title", label: "任务", required: true, full: true, placeholder: "只写一个清晰、可执行的动作" },
        { name: "relationKey", label: "关联客户 / 项目", type: "select", options: taskRelations, value: "" },
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
  if (type === "customer" || type === "project") {
    entityRelations.innerHTML = relationPickerMarkup(type, customer || project);
    entityRelations.classList.remove("hidden");
  } else {
    entityRelations.classList.add("hidden");
    entityRelations.innerHTML = "";
  }
  modalArchiveButton.classList.toggle("hidden", !customer && !project);
  modalArchiveButton.textContent = customer
    ? (customer.stage === "paused" ? "恢复为潜在线索" : "暂缓客户")
    : (project?.status === "archived" ? "恢复项目" : "归档项目");
  if (customer || project) {
    const relationType = customer ? "customer" : "project";
    entityTimeline.innerHTML = `<div class="timeline-heading"><strong>${customer ? "沟通时间线" : "项目进展"}</strong><span>聊天自动记录与手动记录都会保留在这里</span></div>${timelineMarkup(relationType, entityId)}`;
    entityTimeline.classList.remove("hidden");
  } else {
    entityTimeline.classList.add("hidden");
    entityTimeline.innerHTML = "";
  }
  modalBackdrop.classList.remove("hidden");
  formFields.querySelector("input, textarea, select")?.focus();
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  entityForm.reset();
  modalType = "";
  editingId = "";
  entityRelations.classList.add("hidden");
  entityRelations.innerHTML = "";
  entityTimeline.classList.add("hidden");
  modalArchiveButton.classList.add("hidden");
}

function formValue(formData, key) {
  return String(formData.get(key) || "").trim();
}

function updateEntityLinks(type, entityId, selectedIds) {
  const selected = new Set(selectedIds);
  if (type === "customer") {
    const customer = data.customers.find((item) => item.id === entityId);
    if (!customer) return;
    customer.linkedProjectIds = [...selected];
    data.projects.forEach((project) => {
      const links = new Set(project.linkedCustomerIds || []);
      if (selected.has(project.id)) links.add(entityId);
      else links.delete(entityId);
      project.linkedCustomerIds = [...links];
    });
  } else {
    const project = data.projects.find((item) => item.id === entityId);
    if (!project) return;
    project.linkedCustomerIds = [...selected];
    data.customers.forEach((customer) => {
      const links = new Set(customer.linkedProjectIds || []);
      if (selected.has(customer.id)) links.add(entityId);
      else links.delete(entityId);
      customer.linkedProjectIds = [...links];
    });
  }
}

function submitEntity(event) {
  event.preventDefault();
  const formData = new FormData(entityForm);
  const now = new Date().toISOString();
  if (modalType === "customer") {
    const values = {
      company: formValue(formData, "company"),
      contact: formValue(formData, "contact"),
      title: formValue(formData, "title"),
      email: formValue(formData, "email"),
      phone: formValue(formData, "phone"),
      website: formValue(formData, "website"),
      country: formValue(formData, "country"),
      channel: formValue(formData, "channel"),
      source: formValue(formData, "source"),
      stage: formValue(formData, "stage") || "lead",
      priority: formValue(formData, "priority") || "medium",
      followupDate: formValue(formData, "followupDate"),
      tags: formValue(formData, "tags"),
      nextAction: formValue(formData, "nextAction"),
      notes: formValue(formData, "notes"),
    };
    let customerId = editingId;
    if (editingId) {
      const customer = data.customers.find((item) => item.id === editingId);
      if (customer) Object.assign(customer, values, { updatedAt: now });
      addManualActivity("customer", editingId, formValue(formData, "activity"), now, formValue(formData, "activityKind"));
      showToast("客户卡片已更新");
    } else {
      customerId = crypto.randomUUID();
      data.customers.unshift({ id: customerId, ...values, linkedProjectIds: [], createdAt: now });
      showToast("客户卡片已创建");
    }
    updateEntityLinks("customer", customerId, formData.getAll("linkedProjectIds").map(String));
  } else if (modalType === "project") {
    const values = {
      name: formValue(formData, "name"),
      goal: formValue(formData, "goal"),
      progress: Number(formValue(formData, "progress")) || 0,
      nextAction: formValue(formData, "nextAction"),
      dueDate: formValue(formData, "dueDate"),
      owner: formValue(formData, "owner"),
      status: formValue(formData, "status") || "active",
      priority: formValue(formData, "priority") || "medium",
    };
    let projectId = editingId;
    if (editingId) {
      const project = data.projects.find((item) => item.id === editingId);
      if (project) Object.assign(project, values, { updatedAt: now });
      addManualActivity("project", editingId, formValue(formData, "activity"), now, formValue(formData, "activityKind"));
      showToast("项目已更新");
    } else {
      projectId = crypto.randomUUID();
      data.projects.unshift({ id: projectId, ...values, linkedCustomerIds: [], createdAt: now });
      showToast("项目已创建");
    }
    updateEntityLinks("project", projectId, formData.getAll("linkedCustomerIds").map(String));
  } else if (modalType === "task") {
    const [relationType = "", relationId = ""] = formValue(formData, "relationKey").split(":");
    const relationEntity = relationType === "project"
      ? data.projects.find((item) => item.id === relationId)
      : data.customers.find((item) => item.id === relationId);
    data.tasks.unshift({
      id: crypto.randomUUID(),
      title: formValue(formData, "title"),
      relation: relationEntity?.name || relationEntity?.company || "",
      relationType,
      relationId,
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

function addManualActivity(relationType, relationId, content, createdAt, kind = "") {
  if (!content) return;
  data.activities.unshift({
    id: crypto.randomUUID(),
    relationType,
    relationId,
    content,
    kind: kind || (relationType === "customer" ? "customer" : "project"),
    source: "manual",
    createdAt,
  });
}

function handleCaptureAction(captureId, action) {
  const capture = data.captures.find((item) => item.id === captureId);
  if (!capture) return;
  if (action === "task") {
    data.tasks.unshift({
      id: crypto.randomUUID(),
      title: capture.content.slice(0, 120),
      relation: capture.relationName || "",
      dueDate: dateInputValue(new Date()),
      completed: false,
      createdAt: new Date().toISOString(),
    });
    capture.status = "converted";
    showToast("已转为今日任务");
  } else if (action === "archive") {
    capture.status = "archived";
    showToast("记录已归档");
  }
  saveData();
}

function toggleEntityArchive() {
  if (!editingId) return;
  if (modalType === "customer") {
    const customer = data.customers.find((item) => item.id === editingId);
    if (!customer) return;
    customer.stage = customer.stage === "paused" ? "lead" : "paused";
    customer.updatedAt = new Date().toISOString();
    showToast(customer.stage === "paused" ? "客户已暂缓" : "客户已恢复");
  } else if (modalType === "project") {
    const project = data.projects.find((item) => item.id === editingId);
    if (!project) return;
    project.status = project.status === "archived" ? "active" : "archived";
    project.updatedAt = new Date().toISOString();
    showToast(project.status === "archived" ? "项目已归档" : "项目已恢复");
  }
  closeModal();
  saveData();
}

function consumeWorkbenchTarget() {
  let target = null;
  try {
    target = JSON.parse(localStorage.getItem(WORKBENCH_TARGET_KEY) || "null");
  } catch {
    target = null;
  }
  localStorage.removeItem(WORKBENCH_TARGET_KEY);
  if (!target || typeof target !== "object") return;
  navigate(target.view || "dashboard");
  if (target.type === "customer" && target.id && data.customers.some((item) => item.id === target.id)) {
    openModal("customer", target.id);
  } else if (target.type === "project" && target.id && data.projects.some((item) => item.id === target.id)) {
    openModal("project", target.id);
  }
}

async function openChat() {
  const chatWindow = (await getAllWindows()).find((item) => item.label === "chat");
  if (!chatWindow) return;
  await chatWindow.show();
  await chatWindow.setFocus();
}

navItems.forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
document.addEventListener("click", (event) => {
  const relatedTarget = event.target.closest("[data-open-related]");
  if (relatedTarget) {
    event.preventDefault();
    const relatedType = relatedTarget.dataset.relatedType;
    const relatedId = relatedTarget.dataset.relatedId;
    openModal(relatedType, relatedId);
    navigate(relatedType === "customer" ? "customers" : "projects");
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  const action = actionTarget?.dataset.action;
  const navigateTo = event.target.closest("[data-navigate]")?.dataset.navigate;
  if (navigateTo) navigate(navigateTo);
  if (action === "add-customer") openModal("customer");
  if (action === "add-project") openModal("project");
  if (action === "add-task") openModal("task");
  if (action === "add-note") openModal("note");
  if (action === "edit-customer") openModal("customer", actionTarget.dataset.entityId);
  if (action === "edit-project") openModal("project", actionTarget.dataset.entityId);
  const captureActionTarget = event.target.closest("[data-capture-action]");
  if (captureActionTarget) {
    handleCaptureAction(captureActionTarget.dataset.captureId, captureActionTarget.dataset.captureAction);
  }
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
projectSearch.addEventListener("input", renderProjects);
projectStatusFilter.addEventListener("change", renderProjects);
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
modalArchiveButton.addEventListener("click", toggleEntityArchive);
modalBackdrop.addEventListener("mousedown", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
entityForm.addEventListener("submit", submitEntity);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.classList.contains("hidden")) closeModal();
  else if (event.key === "Escape") appWindow.hide();
});
window.addEventListener("storage", (event) => {
  if (event.key === BUSINESS_DATA_KEY) {
    data = loadData();
    renderAll();
  }
  if (event.key === WORKBENCH_TARGET_KEY && event.newValue) {
    consumeWorkbenchTarget();
  }
});

navigate("dashboard");
renderAll();
consumeWorkbenchTarget();
