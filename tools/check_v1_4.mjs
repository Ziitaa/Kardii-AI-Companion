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
const cargo = read("src-tauri/Cargo.toml");
const rust = read("src-tauri/src/lib.rs");
const oauth = read("src-tauri/src/oauth.rs");
const html = read("src/workbench.html");
const js = read("src/workbench.js");
const chatJs = read("src/chat.js");
const chatHtml = read("src/chat.html");
const chatCss = read("src/chat.css");
const agentHtml = read("src/agent.html");
const agentJs = read("src/agent.js");
const agentCss = read("src/agent.css");
const dialogJs = read("src/kardii-dialog.js");
const dialogCss = read("src/kardii-dialog.css");
const taskTitleJs = read("src/kardii-task-title.js");
const capabilityJs = read("src/kardii-capabilities.js");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauriConfig.version]) {
  assert(version === "1.6.0", `当前版本号未统一: ${version}`);
}
assert(/version = "1\.6\.0"/.test(cargo), "Cargo.toml 未更新到 v1.6.0");
assert(chatJs.includes('appVersion: "1.6.0"'), "完整备份版本号未更新到 v1.6.0");
assert(js.includes("version: 3") && js.includes("[1, 2, 3].includes(saved.version)"), "v3 工作台数据迁移缺失");
assert(chatJs.includes("[1, 2, 3].includes(saved?.version)"), "完整备份未接受 v3 工作台数据");
assert(chatJs.includes("...(saved.settings && typeof saved.settings === \"object\" ? saved.settings : {})"), "聊天自动记录会覆盖邮箱或云端连接设置");

for (const id of [
  "emailAccountSelect", "newEmailAccountButton", "pauseEmailButton", "clearEmailCacheButton",
  "removeEmailAccountButton", "emailSearchInput", "emailStatusFilter", "emailSyncWindowSelect",
  "emailSyncSinceInput", "cloudOverviewList", "cloudProviderFilter", "cloudServiceFilter",
]) {
  assert(html.includes(`id="${id}"`), `v1.3 多邮箱或筛选控件缺失: ${id}`);
  assert(js.includes(`getElementById("${id}")`), `v1.3 控件未绑定: ${id}`);
}
assert(js.includes("settings.emailAccounts") && js.includes("activeEmailAccountId"), "多邮箱账号模型缺失");
assert(js.includes("message.accountId === config.accountId") && js.includes("pendingEmailAccountId"), "邮件 UID 没有按账号隔离");
assert(js.includes("sourceDeletedAt") && js.includes("result.deletedUids"), "源邮箱删除标记缺失");
assert(js.includes("attachmentWarnings") && rust.includes("attachment_warnings"), "附件跳过告警缺失");
assert(js.includes('syncMode: emailSyncWindowSelect.value') && rust.includes("since_date"), "日期范围同步缺失");
assert(rust.includes('sync_mode == "new" && since_uid == 0') && js.includes("config.lastUid = uidValidityChanged"), "首次同步分页或 UIDVALIDITY 重置保护缺失");
assert(rust.includes("let tracked_uid_set: HashSet<u32> = if uid_validity_changed") && rust.includes("UID {uid} 的旧缓存不是安全的本地目录"), "UIDVALIDITY 变化时旧 UID 或旧附件缓存未隔离");
assert(rust.includes("fn clear_email_account_cache(") && rust.includes("canonical_account.parent()"), "账号缓存清理缺少安全边界");
assert(rust.includes('.examine("INBOX")') && rust.includes('"(UID BODY.PEEK[])"'), "IMAP 不再保持只读");

for (const id of [
  "googleClientIdInput", "googleClientSecretInput", "connectGoogleButton", "syncGoogleButton",
  "microsoftClientIdInput", "microsoftTenantInput", "microsoftSharePointInput",
  "connectMicrosoftButton", "syncMicrosoftButton",
]) {
  assert(html.includes(`id="${id}"`), `OAuth 控件缺失: ${id}`);
  assert(js.includes(`getElementById("${id}")`), `OAuth 控件未绑定: ${id}`);
}
for (const command of [
  "start_oauth_connection", "oauth_connection_status", "disconnect_oauth_connection", "sync_cloud_overview",
]) {
  assert(oauth.includes(`fn ${command}`), `OAuth 后端命令缺失: ${command}`);
  assert(rust.includes(`            ${command},`), `OAuth 后端命令未注册: ${command}`);
  assert(js.includes(`invoke("${command}"`), `前端未调用 OAuth 命令: ${command}`);
}
assert(oauth.includes("https://accounts.google.com/o/oauth2/v2/auth"), "Google 官方授权端点缺失");
assert(oauth.includes("https://oauth2.googleapis.com/token"), "Google 官方令牌端点缺失");
assert(oauth.includes("https://login.microsoftonline.com/") && oauth.includes("https://graph.microsoft.com/v1.0/"), "Microsoft 官方端点缺失");
assert(oauth.includes("/me/drive/root/children") && oauth.includes("microsoft_drive_children_url"), "OneDrive 稳定目录读取缺失");
assert(!oauth.includes("/me/drive/recent"), "OneDrive 不应继续使用即将停止返回数据的 recent 端点");
for (const scope of [
  "gmail.readonly", "calendar.readonly", "drive.readonly", "spreadsheets.readonly",
  "Mail.Read", "Calendars.Read", "Files.Read.All", "Sites.Read.All",
]) {
  assert(oauth.includes(scope), `只读 OAuth scope 缺失: ${scope}`);
}
assert(oauth.includes("code_challenge_method") && oauth.includes('append_pair("state"'), "OAuth PKCE 或 state 校验缺失");
assert(oauth.includes('TcpListener::bind("127.0.0.1:0")'), "OAuth 未使用随机本机回调端口");
assert(oauth.includes('oauth_entry("meta"') && oauth.includes('oauth_entry("refresh"') && oauth.includes("set_password"), "OAuth 授权未分项保存到系统凭据库");
assert(!oauth.includes("Mail.Send") && !oauth.includes("Calendars.ReadWrite") && !oauth.includes("Files.ReadWrite"), "v1.4 不应申请外部写入权限");
assert(!rust.includes("smtp::") && !rust.includes("send_email"), "v1.4 不应包含邮件发送能力");
assert(!js.includes("clientSecret: String(value.clientSecret"), "Google client secret 不应进入 localStorage 数据模型");

for (const id of [
  "questionDropZone", "questionAttachmentList", "questionAttachmentInput", "addQuestionAttachmentButton",
]) {
  assert(agentHtml.includes(`id="${id}"`), `Agent 附件控件缺失: ${id}`);
  assert(agentJs.includes(`getElementById("${id}")`), `Agent 附件控件未绑定: ${id}`);
}
for (const command of ["prepare_agent_attachment", "analyze_agent_images"]) {
  assert(rust.includes(`fn ${command}`), `Agent 附件后端命令缺失: ${command}`);
  assert(rust.includes(`            ${command},`), `Agent 附件命令未注册: ${command}`);
  assert(agentJs.includes(`invoke("${command}"`), `Agent 前端未调用附件命令: ${command}`);
}
assert(agentJs.includes('questionAnswer.addEventListener("paste"') && agentJs.includes('eventName === "drop"'), "Agent 附件粘贴或拖入缺失");
assert(agentJs.includes("data-remove-attachment") && agentCss.includes(".question-attachment-preview"), "Agent 附件预览或删除缺失");
assert(rust.includes('request.provider != "gemini"') && rust.includes("valid_agent_image_signature"), "Agent 图片识别模型限制或文件签名校验缺失");
const agentWindow = tauriConfig.app.windows.find((window) => window.label === "agent");
assert(agentWindow?.dragDropEnabled === false, "Agent 窗口未启用 HTML5 文件拖入");
const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main");
const chatWindow = tauriConfig.app.windows.find((window) => window.label === "chat");
assert(mainWindow?.alwaysOnTop === true, "桌宠本体应继续保持置顶");
assert(chatWindow?.alwaysOnTop === false, "聊天框仍然强制置顶并遮挡其他窗口");
assert(chatWindow?.dragDropEnabled === false, "聊天窗口未启用 HTML5 文件拖入");

for (const id of ["chatAttachmentTray", "chatAttachmentList", "chatAttachmentInput", "addChatAttachmentButton"]) {
  assert(chatHtml.includes(`id="${id}"`), `普通聊天附件控件缺失: ${id}`);
  assert(chatJs.includes(`getElementById("${id}")`), `普通聊天附件控件未绑定: ${id}`);
}
assert(chatJs.includes('input.addEventListener("paste"') && chatJs.includes('chatCard.addEventListener("drop"'), "普通聊天附件粘贴或拖入缺失");
assert(chatJs.includes('invoke("prepare_agent_attachment"') && chatJs.includes("attachmentImages"), "普通聊天附件没有传给后端或聊天模型");
assert(chatCss.includes(".chat-attachment-item") && chatCss.includes(".dragging-files::after"), "普通聊天附件预览或拖入样式缺失");
assert(rust.includes("attachment_images: Option<Vec<AgentImageInput>>") && rust.includes("validated_agent_image_data(image)?"), "普通聊天图片没有经过后端校验后传给 Gemini");

for (const id of [
  "helpButton", "helpPanel", "helpCloseButton", "helpStatusList", "helpFeatureList",
  "helpVersionHighlights", "refreshHelpStatusButton", "helpSearchInput", "helpSelfCheckList",
  "helpTroubleshootingList", "helpSearchEmpty", "startTourButton", "showWhatsNewButton",
  "welcomePanel", "welcomeVersionBadge", "welcomeHighlights", "dismissWelcomeButton",
  "startWelcomeTourButton", "tourOverlay", "tourSpotlight", "tourPopover", "tourProgress",
  "tourTitle", "tourDescription", "skipTourButton", "previousTourButton", "nextTourButton",
  "reopenOnboardingButton",
]) {
  assert(chatHtml.includes(`id="${id}"`), `帮助与使用说明控件缺失: ${id}`);
  assert(chatJs.includes(`getElementById("${id}")`), `帮助与使用说明控件未绑定: ${id}`);
}
assert(chatHtml.includes('src="./kardii-capabilities.js"'), "聊天页没有加载共享功能清单");
assert(chatHtml.includes('class="header-actions"'), "顶部图标没有统一到同一布局容器");
assert(chatCss.includes("scale(1.12)") && chatCss.includes("text-shadow") && chatCss.includes("prefers-reduced-motion"), "顶部图标缺少悬停放大、发光或减少动画保护");
assert(chatCss.includes(".help-feature-card") && chatCss.includes(".help-status-list"), "主题化帮助面板样式不完整");
assert(chatCss.includes(".welcome-card") && chatCss.includes(".tour-spotlight") && chatCss.includes(".chat-quick-start"), "版本介绍、新手引导或空聊天快捷入口样式缺失");
assert(chatJs.includes("ONBOARDING_SEEN_PREFIX") && chatJs.includes("const TOUR_STEPS") && chatJs.includes("function updateTourStep("), "一次性版本介绍或逐步高亮引导逻辑缺失");
assert(chatJs.includes("function filterHelpContent(") && chatJs.includes("function renderHelpTroubleshooting("), "帮助搜索或故障排查逻辑缺失");
assert(chatJs.includes("function renderQuickStart(") && chatJs.includes("renderQuickStart();"), "空聊天页快捷入口逻辑缺失");
assert(chatJs.includes("window.KardiiCapabilities.knowledgeText(currentCapabilityStatus())"), "Kardii 对话没有读取共享功能清单");
assert(chatJs.includes('invoke("has_email_password"') && chatJs.includes('invoke("oauth_connection_status"'), "功能状态没有核对邮箱或云端连接");
assert(rust.includes("feature_knowledge: String") && rust.includes("由当前 Kardii 应用提供的产品功能清单与状态"), "后端系统提示没有接入 Kardii 功能认知");

const capabilityContext = vm.createContext({ window: {} });
vm.runInContext(capabilityJs, capabilityContext);
const capabilityIds = vm.runInContext("window.KardiiCapabilities.features.map((item) => item.id)", capabilityContext);
for (const id of ["chat", "agent", "attachments", "desktop-context", "workbench", "connections", "tools", "voice", "personalization", "guidance"]) {
  assert(capabilityIds.includes(id), `共享功能清单缺少: ${id}`);
}
const troubleshootingCount = vm.runInContext("window.KardiiCapabilities.troubleshooting.length", capabilityContext);
assert(troubleshootingCount >= 8, "可搜索故障帮助条目不足");
const selfCheckRows = vm.runInContext(`window.KardiiCapabilities.selfCheckRows({
  providerName: "Codex",
  modelName: "ChatGPT",
  providerReady: false,
  autoAgentHandoff: false,
  voiceModelState: "missing",
  emailConfigured: 1,
  emailConnected: 0,
  cloudConfigured: 0,
  cloudConnected: 0,
  codexChecked: true,
  codexInstalled: true,
  codexAuthenticated: false,
})`, capabilityContext);
assert(selfCheckRows.length >= 6, "一键自检没有覆盖 AI、Codex、语音、邮箱、云端和 Agent");
assert(selfCheckRows.some((row) => row.id === "ai" && row.tone === "warning"), "一键自检没有标出未连接的聊天模型");
assert(selfCheckRows.some((row) => row.id === "email" && row.tone === "warning"), "一键自检没有标出失效的邮箱凭据");
const capabilityKnowledge = vm.runInContext(`window.KardiiCapabilities.knowledgeText({
  appVersion: "1.4.0",
  providerName: "Gemini",
  modelName: "gemini-3.5-flash",
  providerReady: true,
  autoAgentHandoff: true,
  voiceModelState: "ready",
  emailConfigured: 1,
  emailConnected: 1,
  cloudConfigured: 0,
  cloudConnected: 0,
  codexChecked: true,
  codexInstalled: true,
  codexAuthenticated: true,
  memoryCount: 4,
})`, capabilityContext);
assert(capabilityKnowledge.includes("Gemini") && capabilityKnowledge.includes("邮箱1 个已连接"), "共享功能清单没有包含动态连接状态");
assert(capabilityKnowledge.includes("不能发送邮件") && capabilityKnowledge.includes("仅 Gemini 能识别"), "共享功能清单没有准确说明关键限制");
assert(vm.runInContext('window.KardiiCapabilities.isCapabilityQuestion("Kardii 你会什么？")', capabilityContext), "Kardii 功能问题识别失败");
assert(vm.runInContext('window.KardiiCapabilities.isCapabilityQuestion("我的邮箱连接了吗？")', capabilityContext), "Kardii 连接状态问题识别失败");
assert(vm.runInContext('window.KardiiCapabilities.isCapabilityQuestion("怎么重新播放新手引导？")', capabilityContext), "Kardii 新手引导问题识别失败");

assert(chatJs.includes("function shouldAutoRouteToAgent(") && chatJs.includes("function buildAgentTaskGoal("), "聊天到 Agent 的智能衔接缺失");
assert(chatHtml.includes('id="autoAgentHandoffToggle"'), "自动衔接 Agent 开关缺失");
assert(chatHtml.includes('src="./kardii-task-title.js"') && agentHtml.includes('src="./kardii-task-title.js"'), "聊天或 Agent 页面没有加载任务标题摘要器");
const titleContext = vm.createContext({ window: {} });
vm.runInContext(taskTitleJs, titleContext);
const summarizedTitle = vm.runInContext(`window.summarizeAgentTaskTitle(
  "今天做合规的Daria过来找我聊了之前关于入驻target需要的美国独立商用地址的服务协议分付款事宜，然后协议上还有一些"
)`, titleContext);
assert(summarizedTitle.includes("Target 入驻") && !summarizedTitle.includes("Daria") && [...summarizedTitle].length <= 35, "Agent 任务标题没有根据用户话语生成简短摘要");
assert((chatHtml.match(/data-current-version/g) || []).length === 3, "设置页版本标识没有统一动态更新");
for (const staleVersion of [">v1.1<", ">v0.8.1<", ">v0.6<"]) {
  assert(!chatHtml.includes(staleVersion), `设置页仍显示旧版本标识: ${staleVersion}`);
}
for (const page of [chatHtml, html, agentHtml]) {
  assert(page.includes('href="./kardii-dialog.css"') && page.includes('src="./kardii-dialog.js"'), "页面没有加载 Kardii 主题确认框");
}
for (const pageJs of [chatJs, js, agentJs]) {
  assert(!pageJs.includes("window.confirm("), "仍有浏览器原生确认框没有替换");
  assert(pageJs.includes("window.kardiiConfirm("), "页面未使用 Kardii 主题确认框");
}
assert(dialogJs.includes('role="alertdialog"') && dialogJs.includes("aria-modal"), "主题确认框缺少可访问性语义");
assert(dialogCss.includes(".kardii-dialog-card") && dialogCss.includes('[data-tone="danger"]'), "主题确认框样式不完整");

const intentSource = chatJs.slice(
  chatJs.indexOf("function normalizedAgentHandoffText"),
  chatJs.indexOf("async function openWorkbench"),
);
const intentContext = vm.createContext({});
vm.runInContext('const CHAT_IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "webp"]); const aiSettings = { provider: "gemini" };', intentContext);
vm.runInContext(intentSource, intentContext);
const actionableHistory = [{ role: "assistant", content: "接下来分三步：修改窗口设置、统一弹窗，然后运行测试。" }];
intentContext.history = actionableHistory;
assert(vm.runInContext('shouldAutoRouteToAgent("好的 那你继续后面的步骤吧", history)', intentContext), "上下文执行请求没有自动衔接 Agent");
assert(vm.runInContext('shouldAutoRouteToAgent("打开官网并下载文件", [])', intentContext), "明确电脑操作没有自动衔接 Agent");
assert(vm.runInContext('shouldAutoRouteToAgent("ok，把1.3和1.4一起完成", history)', intentContext), "完成既定方案没有自动衔接 Agent");
assert(!vm.runInContext('shouldAutoRouteToAgent("这个功能要怎么做？", history)', intentContext), "普通问题被误判为 Agent 任务");
assert(!vm.runInContext('shouldAutoRouteToAgent("帮我写一段小红书文案", [])', intentContext), "可直接回答的内容创作被误判为电脑任务");
const contextualGoal = vm.runInContext('buildAgentTaskGoal("继续后面的步骤吧", history, true)', intentContext);
assert(contextualGoal.includes("此前聊天上下文") && contextualGoal.includes("修改窗口设置"), "自动衔接没有带入最近对话");
const attachmentGoal = vm.runInContext('buildAgentTaskGoal("整理这些资料", [], false, "[聊天附件 1] 报价.csv\\n产品,价格")', intentContext);
assert(attachmentGoal.includes("报价.csv") && attachmentGoal.includes("产品,价格"), "普通聊天附件没有带入 Agent 任务");
const tableEvidence = vm.runInContext('chatAttachmentEvidence([{ name: "报价.csv", fileType: "csv", size: 42, content: "产品,价格\\nA,99" }], "gemini")', intentContext);
assert(tableEvidence.includes("报价.csv") && tableEvidence.includes("A,99") && tableEvidence.includes("不可信数据"), "聊天表格没有作为受限资料传给模型");
const imageCount = vm.runInContext('chatAttachmentImages([{ name: "产品.png", fileType: "png", dataBase64: "AAAA" }]).length', intentContext);
assert(imageCount === 1, "Gemini 聊天图片没有进入多模态请求");

const legacyStorage = new Map([["kardii-business-data-v1", JSON.stringify({
  version: 2,
  settings: {
    autoCaptureEnabled: true,
    emailConnection: {
      accountId: "primary",
      preset: "163",
      label: "旧邮箱",
      address: "old@example.com",
      server: "imap.163.com",
      port: 993,
      username: "old@example.com",
      lastUid: 42,
    },
  },
  customers: [], contacts: [], projects: [], tasks: [], notes: [], captures: [], activities: [],
  intelligence: [], knowledge: [], reports: [],
  emailMessages: [{ uid: 42, subject: "旧邮件", sender: "sender@example.com" }],
})]]);
const context = vm.createContext({
  window: {
    __TAURI__: {
      window: { getCurrentWindow: () => ({}), getAllWindows: async () => [] },
      core: { invoke: async () => null },
    },
  },
  localStorage: {
    getItem: (key) => legacyStorage.get(key) ?? null,
    setItem: (key, value) => legacyStorage.set(key, String(value)),
  },
  crypto,
  structuredClone,
  Date,
  JSON,
  Set,
  Map,
  Object,
});
const prelude = js.slice(0, js.indexOf("const navItems"));
const migrationFunctions = js.slice(js.indexOf("function normalizeEmailAccount"), js.indexOf("function escapeHtml"));
vm.runInContext(`${prelude}\n${migrationFunctions}`, context);
const migrated = vm.runInContext("data", context);
assert(migrated.version === 3, "v2 数据没有迁移到 v3");
assert(migrated.settings.emailAccounts.length === 1 && migrated.settings.activeEmailAccountId === "primary", "旧单邮箱没有迁移为多邮箱");
assert(migrated.emailMessages[0].accountId === "primary" && migrated.emailMessages[0].uid === 42, "旧邮件没有保留账号归属");
assert(Array.isArray(migrated.cloudItems) && Object.keys(migrated.settings.cloudConnections).length === 0, "v3 云端集合初始化失败");

console.log("Kardii v1.4 connected workspace checks passed.");
