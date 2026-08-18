import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = json("package.json");
const packageLock = json("package-lock.json");
const tauri = json("src-tauri/tauri.conf.json");
const extension = json("src-tauri/browser-extension/manifest.json");
const cargo = read("src-tauri/Cargo.toml");
const rust = read("src-tauri/src/lib.rs");
const wecom = read("src-tauri/src/wecom.rs");
const workbenchHtml = read("src/workbench.html");
const workbenchCss = read("src/workbench.css");
const workbenchJs = read("src/workbench.js");
const agentJs = read("src/agent.js");
const mainJs = read("src/main.js");
const capabilities = read("src/kardii-capabilities.js");
const prepare = read("tools/prepare-wecom-cli.mjs");
const wecomLicense = read("src-tauri/wecom-cli/LICENSE.wecom-cli");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauri.version, extension.version]) {
  assert(version === "2.1.0", `v2.0 版本号未统一：${version}`);
}
assert(/version = "2\.1\.0"/.test(cargo), "Cargo.toml 未更新为 2.1.0");
assert(capabilities.includes('const VERSION = "2.1.0"'), "共享功能清单未更新为 2.1.0");
assert(packageJson.scripts["test:v2.0"] === "node tools/check_v2_0.mjs", "v2.0 回归脚本未注册");

for (const id of [
  "wecomConnectionBadge", "authorizeWecomButton", "wecomQrImage", "disconnectWecomDocumentsButton",
  "wecomBotIdInput", "wecomBotSecretInput", "saveWecomBotButton", "stopWecomBotButton", "clearWecomChatHistoryButton",
  "wecomDocumentSearchInput", "wecomDocumentResults", "wecomDocumentPreview", "wecomDocumentPageSelect",
  "createWecomDocumentButton", "appendWecomDocumentButton", "overwriteWecomDocumentButton",
]) {
  assert(workbenchHtml.includes(`id="${id}"`), `企业微信界面缺少 ${id}`);
  assert(workbenchJs.includes(`getElementById("${id}")`), `企业微信控件未绑定 ${id}`);
}
assert(workbenchCss.includes(".wecom-connection-card") && workbenchCss.includes(".wecom-qr-panel"), "企业微信连接缺少主题样式");

for (const command of [
  "wecom_component_status", "wecom_authorization_status", "start_wecom_qr_authorization",
  "cancel_wecom_qr_authorization",
  "disconnect_wecom_documents", "search_wecom_documents", "read_wecom_document", "write_wecom_document",
  "save_wecom_bot_secret", "has_wecom_bot_secret", "delete_wecom_bot_secret", "start_wecom_bot", "stop_wecom_bot", "wecom_bot_status", "reply_wecom_message", "answer_wecom_message",
]) {
  assert(rust.includes(command), `Tauri 未注册企业微信命令：${command}`);
}
assert(cargo.includes("tokio-tungstenite") && wecom.includes("wss://openws.work.weixin.qq.com"), "企业微信 WebSocket 长连接缺失");
assert(wecom.includes('"aibot_subscribe"') && wecom.includes('"aibot_msg_callback"') && wecom.includes('"aibot_respond_msg"'), "企业微信机器人协议帧不完整");
assert(wecom.includes("Duration::from_secs(30)") && wecom.includes('"cmd": "ping"'), "企业微信机器人心跳缺失");
assert(mainJs.includes('listen("kardii-wecom-message"') && (mainJs.includes('invoke("answer_wecom_message"') || mainJs.includes('invoke("stream_wecom_message"')) && mainJs.includes('invoke("reply_wecom_message"'), "桌宠没有处理企微消息并回复");
assert(mainJs.includes("WECOM_HISTORY_KEY") && mainJs.includes("conversationKey"), "企业微信聊天没有隔离会话历史");
assert(mainJs.includes("wecomMessageQueues = new Map()") && wecom.includes("bot:{incoming_bot_id}:chat:"), "企业微信不同 Bot 与会话没有独立排队和隔离");
assert(mainJs.includes("memories: []") && mainJs.includes('customInstructions: ""'), "企业微信聊天不应带入桌面私人记忆或自定义指令");
assert(workbenchJs.includes("localStorage.removeItem(WECOM_HISTORY_KEY)"), "企业微信聊天历史缺少清空入口");
assert(rust.includes("这里只允许普通对话") && rust.includes("不得调用工具、执行 Agent、修改文档"), "企业微信远程聊天没有禁用外部动作");

assert(wecom.includes('["create" | "append" | "overwrite"]') || wecom.includes('"create" | "append" | "overwrite"'), "企业微信写入动作没有严格白名单");
assert(wecom.includes("validate_document_content") && wecom.includes('"<script"') && wecom.includes('"javascript:"'), "企业微信文档写入缺少脚本过滤");
assert(wecom.includes("read_document(") && wecom.includes("previous_version"), "企业微信修改前没有读取最新文档");
assert(wecom.includes('doc_id.starts_with("b1_")'), "发布态智能文档没有保持只读");
assert(wecom.includes("pending_replies") && wecom.includes("expected_request_id != request_id") && wecom.includes("expected_generation != state.bot_generation"), "企微回复没有绑定原始消息请求与连接代次");
assert(wecom.includes('starts_with("WECOM_CLI_")') && wecom.includes("installed: version == WECOM_CLI_VERSION"), "企业微信官方组件环境或版本校验不完整");
assert(wecom.includes("bot_generation.load(Ordering::SeqCst) != generation"), "企业微信旧机器人连接可能覆盖新连接");
assert(wecom.includes("keyring::Entry") && !workbenchJs.includes("wecomBotSecret:"), "Bot Secret 可能进入普通设置");

assert(agentJs.includes('action.tool === "wecom_document"'), "Agent 缺少企业微信文档工具");
assert(agentJs.includes('["create", "append", "overwrite"]') && agentJs.includes("企业微信文档写入必须先获得本次确认"), "企微文档写操作没有逐次确认");
assert(agentJs.includes("多于一个候选时必须请用户选择") && rust.includes("搜索返回多个候选时必须 ask_user"), "企微文档多候选没有禁止自动猜测");
assert(workbenchJs.includes("Kardii 会在写入前重新读取最新内容") && workbenchJs.includes("tone: action === \"overwrite\" ? \"danger\""), "工作台企微写入确认不完整");

assert(tauri.build.beforeBuildCommand.includes("prepare-wecom-cli.mjs") && tauri.bundle.resources.includes("wecom-cli/"), "正式构建没有打包企微官方组件");
for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
  assert(prepare.includes(`"${target}"`), `企微组件准备脚本缺少 ${target}`);
}
assert((prepare.match(/sha512-/g) || []).length >= 5 && prepare.includes("createHash(\"sha512\")"), "企微组件没有固定完整性校验");
assert(wecomLicense.includes("Copyright (c) 2026 WeCom") && wecomLicense.includes("MIT License"), "企微官方组件许可证未随包保留");
assert(readme.includes("v2.0 企业微信连接") && readme.includes("大圆或同事创建并分享"), "README 缺少企业微信连接边界");
assert(!readme.includes("Windows 签名、macOS 签名与公证"), "README 仍把系统签名与公证列为后续功能");
assert(capabilities.includes('id: "wecom"') && capabilities.includes("不能读取大圆的私有记忆"), "Kardii 功能认知缺少企业微信能力边界");

for (const file of ["src/main.js", "src/workbench.js", "src/agent.js", "src/kardii-capabilities.js", "tools/prepare-wecom-cli.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: "utf8" });
  assert(result.status === 0, `${file} 语法检查失败：${result.stderr}`);
}

console.log("Kardii v2.0 Enterprise WeChat connection checks passed.");
