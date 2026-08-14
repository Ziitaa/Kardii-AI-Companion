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
const chatHtml = read("src/chat.html");
const chatJs = read("src/chat.js");
const agentHtml = read("src/agent.html");
const agentJs = read("src/agent.js");
const workbenchHtml = read("src/workbench.html");
const workbenchJs = read("src/workbench.js");
const capabilities = read("src/kardii-capabilities.js");
const readme = read("README.md");

assert(packageJson.version === "1.7.0" && tauriConfig.version === "1.7.0", "最终版本号未统一为 1.7.0");
assert(/version = "1\.7\.0"/.test(cargo), "Cargo.toml 未更新为 1.7.0");

for (const extension of [".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".txt", ".md", ".json"]) {
  assert(chatHtml.includes(extension), `普通聊天文件选择器缺少 ${extension}`);
  assert(agentHtml.includes(extension), `Agent 回答附件文件选择器缺少 ${extension}`);
}
for (const extension of ["pdf", "docx", "pptx", "xlsx", "csv", "txt", "md", "json", "png", "jpg", "jpeg", "webp"]) {
  assert(chatJs.includes(`"${extension}"`), `普通聊天白名单缺少 ${extension}`);
  assert(agentJs.includes(`"${extension}"`), `Agent 附件白名单缺少 ${extension}`);
}

assert(chatJs.includes("attachmentChunks") && chatJs.includes("relevantAttachmentText"), "普通聊天没有按问题选择长文档片段");
assert(agentJs.includes("relevantQuestionAttachmentText") && agentJs.includes("knowledgeChunks"), "Agent 回答附件没有按问题选择长文档片段");
assert(chatJs.includes("[相关片段") && agentJs.includes("[相关片段"), "长文档证据没有标注片段位置");

for (const command of ["analyze_agent_documents", "analyze_imported_knowledge_visual"]) {
  assert(rust.includes(`fn ${command}`), `OCR 后端命令缺失：${command}`);
  assert(rust.includes(`            ${command},`), `OCR 后端命令未注册：${command}`);
}
assert(rust.includes("office_embedded_image_count") && rust.includes("office_visual_parts"), "Office 文档内图片识别链路缺失");
assert(rust.includes('bytes.starts_with(b"%PDF-")') && rust.includes('bytes.starts_with(b"PK\\x03\\x04")'), "视觉文档缺少文件签名校验");
assert(rust.includes("needs_ocr") && rust.includes("embedded_image_count"), "附件结果没有标记 OCR 与文档内图片");
assert(rust.includes("x-goog-api-key") && rust.includes(":generateContent"), "Gemini 原生文档视觉请求未接通");
assert(rust.includes("20 * 1024 * 1024") && rust.includes("request.documents.len() > 6"), "文档视觉识别缺少大小或数量限制");

assert(workbenchHtml.includes('id="ocrBundleButton"'), "工作台缺少 OCR 按钮");
assert(workbenchJs.includes('invoke("analyze_imported_knowledge_visual"'), "工作台 OCR 按钮未接通后端");
assert(workbenchJs.includes("ocrToken") && rust.includes("imported_ocr_sources"), "工作台 OCR 没有使用临时授权令牌");
assert(capabilities.includes("扫描 PDF") && capabilities.includes("长文档"), "功能说明没有覆盖 OCR 或长文档");
assert(readme.includes("v1.5.1 全类型附件、OCR 与长文档"), "README 缺少 v1.5.1 说明");

console.log("Kardii v1.5.1 attachment, OCR, and long-document checks passed.");
