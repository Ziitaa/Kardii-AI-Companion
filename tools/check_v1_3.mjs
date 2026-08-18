import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const rust = read("src-tauri/src/lib.rs");
const html = read("src/workbench.html");
const js = read("src/workbench.js");
const chatJs = read("src/chat.js");

assert(packageJson.version === "2.1.0" && tauriConfig.version === "2.1.0", "当前版本号未统一");
assert(chatJs.includes('appVersion: "2.1.0"'), "备份版本号未更新");
assert(cargo.includes('imap = "2.4.1"') && cargo.includes('mailparse = "0.15"'), "IMAP 或邮件解析依赖缺失");

for (const command of [
  "save_email_password",
  "has_email_password",
  "delete_email_password",
  "test_email_connection",
  "sync_email_inbox",
  "prepare_email_bundle",
]) {
  assert(rust.includes(`fn ${command}`) || rust.includes(`async fn ${command}`), `邮箱命令缺失: ${command}`);
  assert(rust.includes(`            ${command},`), `邮箱命令未注册: ${command}`);
}

assert(rust.includes('.examine("INBOX")'), "邮箱未使用 IMAP 只读 EXAMINE 模式");
assert(rust.includes('"(UID BODY.PEEK[])"'), "邮件同步可能改变已读状态");
assert(!rust.includes("smtp::") && !rust.includes("send_email"), "v1.3 不应包含邮件发送能力");
assert(rust.includes('request.port != 993'), "未强制 SSL/TLS 端口 993");
assert(rust.includes('email-imap-password-'), "邮箱凭据未使用独立系统安全凭据项");

assert(html.includes('id="connectionsView"') && html.includes('data-view-panel="connections"'), "外部连接页面缺失");
for (const id of [
  "emailConnectionForm",
  "emailServerInput",
  "emailPasswordInput",
  "testEmailButton",
  "syncEmailButton",
  "emailInboxList",
  "bundleEmailFollowup",
  "bundleCreateFollowup",
  "bundleFollowupDate",
]) {
  assert(html.includes(`id="${id}"`), `外部连接控件缺失: ${id}`);
  assert(js.includes(`getElementById("${id}")`), `外部连接控件未绑定: ${id}`);
}

assert(html.includes("当前版本不会发送、删除、移动或标记邮件"), "只读边界未向用户说明");
assert(js.includes('invoke("sync_email_inbox"') && js.includes('invoke("prepare_email_bundle"'), "邮箱同步未接入工作台");
assert(js.includes("openBundlePreview(displayFiles, String(message.uid))"), "邮件未复用多文件人工确认流程");
assert(js.includes("pendingEmailUid") && js.includes('kind: kind || (relationType === "customer"'), "邮件归档或时间线关联缺失");
assert(js.includes('source: "email"') && js.includes("sourceEmailUid"), "邮件归档未建立内部跟进提醒");
assert(js.includes("邮件内容属于外部不可信资料"), "邮件提示注入边界缺失");
assert(js.includes("Kardii 的 JSON 备份不会包含它") || html.includes("JSON 备份不会包含它"), "凭据备份边界未说明");

console.log("Kardii v1.3 read-only email connection checks passed.");
