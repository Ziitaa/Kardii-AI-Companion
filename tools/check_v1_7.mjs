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
const html = read("src/workbench.html");
const js = read("src/workbench.js");
const css = read("src/workbench.css");
const chatJs = read("src/chat.js");
const capabilities = read("src/kardii-capabilities.js");
const rust = read("src-tauri/src/lib.rs");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauri.version, extension.version]) {
  assert(version === "1.8.0", `v1.8 版本号未统一：${version}`);
}
assert(/version = "1\.8\.0"/.test(cargo), "Cargo.toml 未更新为 1.8.0");
assert(capabilities.includes('const VERSION = "1.8.0"'), "共享功能清单未更新为 1.8.0");
assert(packageJson.scripts["test:v1.7"] === "node tools/check_v1_7.mjs", "v1.7 回归脚本未注册");

assert(js.includes("version: 4") && js.includes("[1, 2, 3, 4].includes(saved.version)"), "工作台 v4 数据迁移缺失");
assert(chatJs.includes("[1, 2, 3, 4].includes(saved?.version)") && chatJs.includes("[1, 2, 3, 4].includes(data.businessData?.version)"), "完整备份没有接受 v4 工作台数据");
for (const collection of ["enterpriseAnalyses: []", "websiteCollections: []"]) {
  assert(js.includes(collection), `v1.7 数据集合缺失：${collection}`);
}

for (const id of [
  "enterpriseAnalysisView", "analysisProjectSelect", "analysisRelationSelect", "analysisRangeSelect",
  "analysisObjective", "generateEnterpriseAnalysisButton", "enterpriseAnalysisDraft", "enterpriseAnalysisSourceList",
  "saveEnterpriseAnalysisButton", "saveEnterpriseTasksButton", "dailyBriefReminderToggle", "dailyBriefReminderTime",
  "importWebsiteButton", "websiteCollectionGrid", "siteCrawlBackdrop", "siteCrawlUrl", "siteCrawlCollectionTitle", "siteCrawlMaxPages",
  "siteCrawlMaxDepth", "siteCrawlConsent", "runSiteCrawlButton", "siteCrawlPageList", "saveSiteCrawlButton",
]) {
  assert(html.includes(`id="${id}"`), `v1.7 界面控件缺失：${id}`);
  assert(js.includes(`getElementById("${id}")`) || ["enterpriseAnalysisView"].includes(id), `v1.7 控件未绑定：${id}`);
}
assert(html.includes('data-view="analysis"') && html.includes('data-view-panel="analysis"'), "联合分析没有接入工作台导航");
assert(html.includes('data-analysis-source="email"') && html.includes('data-analysis-source="cloud"') && html.includes('data-analysis-source="knowledge"'), "联合分析来源选择不完整");
assert(js.includes("function buildEnterpriseAnalysisDocuments()") && js.includes('invoke("analyze_enterprise_bundle"'), "联合分析没有构造或调用资料包");
assert(js.includes("sourceRefs: documents.map") && js.includes("open-analysis-source-url"), "联合分析没有保留可核对来源");
assert(js.includes("saveEnterpriseAnalysis(createTasks = false)") && js.includes('source: "enterprise-analysis"'), "联合分析不能保存或生成待办");
assert(js.includes("function ensureDailyBriefReminder()") && js.includes("dailyBriefLastReminderDate"), "每日简报提醒没有去重或补建逻辑");
assert(html.includes("仅在 Kardii 运行或下次打开时建立本机待办"), "每日提醒没有说明本机运行边界");

for (const command of ["analyze_enterprise_bundle", "crawl_public_website"]) {
  assert(rust.includes(`async fn ${command}`), `Rust 命令缺失：${command}`);
  assert(rust.includes(`            ${command},`), `Rust 命令未注册：${command}`);
  assert(js.includes(`invoke("${command}"`), `工作台未调用命令：${command}`);
}
assert(rust.includes("每条可核验事实") && rust.includes("不得创造输入中不存在的编号"), "联合分析没有强制来源引用");
assert(rust.includes("推断必须明确") && rust.includes("邮件摘要和云端概览可能不完整"), "联合分析没有区分事实、推断或摘要边界");
for (const field of ["progress", "commitments", "risks", "next_actions", "daily_brief", "evidence"]) {
  assert(rust.includes(`${field}: String`), `联合分析结果字段缺失：${field}`);
}

assert(js.indexOf('invoke("crawl_public_website"') < js.indexOf("function saveSiteCrawl()"), "网站必须先预览抓取再保存");
assert(js.includes("pendingWebsiteCrawl?.pages") && html.includes("确认保存到知识库"), "网站预览结果没有二次确认保存");
assert(js.includes("data-crawl-page-index") && js.includes("selectedSiteCrawlPages()"), "网站预览不能逐页排除不需要的内容");
assert(js.includes("websiteCollectionId") && js.includes("重新抓取") && js.includes("deleteWebsiteCollection"), "网站集合不能更新或整组删除");
assert(js.includes("browserUrl: page.url") && js.includes('fileType: "web"'), "网页快照没有保留原始网址或接入知识库");
assert(html.includes("我确认有权读取并保存这些公开页面"), "网站导入缺少授权确认");

for (const safety of [
  "validate_public_crawl_url", "resolve_public_crawl_host", "is_public_crawl_ip", "address.set_port(0)", "resolve_to_addrs",
  ".no_proxy()", "Policy::none", "same_crawl_site", "parse_robots_disallow", "robots_allows", "max_pages.clamp(1, 20)",
  "max_depth.min(2)", "1_500_000", "1_200_000", "网址不能包含用户名或密码",
  "Duration::from_secs(90)", "localhost、内网或本机服务", "页面重定向到了其他域名", "不执行 JavaScript",
]) {
  assert(rust.includes(safety), `公开网站抓取安全边界缺失：${safety}`);
}
assert(!rust.includes("cookie_store(true)"), "网站抓取不应启用 Cookie 存储");

assert(css.includes(".analysis-control-grid") && css.includes(".analysis-history-grid"), "联合分析布局样式缺失");
assert(css.includes(".site-crawl-modal") && css.includes(".website-collection-grid"), "网站导入或集合样式缺失");
assert(capabilities.includes('id: "enterprise-analysis"') && capabilities.includes('id: "website-knowledge"'), "帮助中心没有介绍 v1.7 功能");
assert(readme.includes("v1.7 企业资料联合分析与多网页知识库"), "README 缺少 v1.7 说明");
assert(!readme.includes("v1.7 企业资料联合分析：跨邮件"), "README 路线图仍把已完成功能列为未来事项");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `HTML 出现重复 ID：${[...new Set(duplicates)].join(", ")}`);

for (const file of ["src/workbench.js", "src/chat.js", "src/agent.js", "src/kardii-capabilities.js"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: "utf8" });
  assert(result.status === 0, `${file} 语法检查失败：${result.stderr}`);
}

console.log("Kardii v1.7 enterprise analysis and multi-page knowledge checks passed.");
