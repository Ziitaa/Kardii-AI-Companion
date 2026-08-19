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
assert(/version = "2\.1\.0"/.test(cargo), "Cargo.toml 未更新到 v2.1.0");
assert(chatJs.includes('appVersion: "2.1.0"'), "备份版本号未更新到 v2.1.0");

assert(html.includes('<option value="163">163 邮箱</option>'), "163 邮箱快捷选项缺失");
assert(html.includes('<option value="gmail">Gmail</option>'), "Gmail 快捷选项缺失");
assert(js.includes('"163": { server: "imap.163.com", port: 993 }'), "163 IMAP 快捷配置缺失");
assert(js.includes('gmail: { server: "imap.gmail.com", port: 993 }'), "Gmail IMAP 快捷配置缺失");

for (const id of [
  "bundleNewRelationButton",
  "bundleNewRelationPanel",
  "bundleNewRelationName",
  "bundleNewRelationType",
  "bundleNewRelationSaveButton",
]) {
  assert(html.includes(`id="${id}"`), `归档新建关系控件缺失: ${id}`);
  assert(js.includes(`getElementById("${id}")`), `归档新建关系控件未绑定: ${id}`);
}
assert(js.includes("function createBundleRelationship()"), "归档窗口不能直接创建关系对象");
assert(js.includes("refreshBundleRelationshipOptions(relationship.id)"), "新建关系对象后没有立即选中");

assert(html.includes("当前版本不会发送、删除、移动或标记邮件"), "邮箱只读边界说明缺失");
assert(js.includes('data-action="delete-local-email"'), "本地邮件删除入口缺失");
assert(js.includes("async function deleteLocalEmailMessage(uid)"), "本地邮件删除流程缺失");
assert(js.includes('invoke("delete_local_email_cache"'), "前端未清理对应邮件缓存");
assert(rust.includes("fn delete_local_email_cache("), "本地邮件缓存删除命令缺失");
assert(rust.includes("std::fs::symlink_metadata(&message_dir)"), "邮件缓存删除未拒绝符号链接");
assert(rust.includes("if !message_dir.starts_with(&root) || !message_dir.is_dir()"), "邮件缓存删除缺少路径边界检查");
assert(rust.includes("std::fs::remove_dir_all(&message_dir)"), "邮件缓存目录未被清理");
assert(rust.includes("            delete_local_email_cache,"), "本地邮件缓存删除命令未注册");

assert(rust.includes('.examine("INBOX")'), "v1.3.1 仍应使用 IMAP 只读 EXAMINE");
assert(rust.includes('"(UID BODY.PEEK[])"'), "v1.3.1 同步可能改变邮件已读状态");
assert(!rust.includes("smtp::") && !rust.includes("send_email"), "v1.3.1 不应包含邮件发送能力");

console.log("Kardii v1.3.1 email polish checks passed.");
