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

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauriConfig.version]) {
  assert(version === "1.4.0", `v1.4 版本号未统一: ${version}`);
}
assert(/version = "1\.4\.0"/.test(cargo), "Cargo.toml 未更新到 v1.4.0");
assert(chatJs.includes('appVersion: "1.4.0"'), "完整备份版本号未更新到 v1.4.0");
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
