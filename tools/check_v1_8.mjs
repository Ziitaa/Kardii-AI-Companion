import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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
const storageRust = read("src-tauri/src/storage.rs");
const storageJs = read("src/kardii-storage.js");
const mainJs = read("src/main.js");
const chatHtml = read("src/chat.html");
const chatCss = read("src/chat.css");
const chatJs = read("src/chat.js");
const capabilities = read("src/kardii-capabilities.js");
const readme = read("README.md");

for (const version of [packageJson.version, packageLock.version, packageLock.packages[""].version, tauri.version, extension.version]) {
  assert(version === "2.0.0", `当前版本号未统一：${version}`);
}
assert(/version = "2\.0\.0"/.test(cargo), "Cargo.toml 未更新为 2.0.0");
assert(capabilities.includes('const VERSION = "2.0.0"'), "共享功能清单未更新为 2.0.0");
assert(packageJson.scripts["test:v1.8"] === "node tools/check_v1_8.mjs", "v1.8 回归脚本未注册");
assert(/rusqlite\s*=\s*\{[^}]*version = "0\.40\.2"[^}]*"bundled"[^}]*"backup"/.test(cargo), "SQLite bundled/backup 依赖缺失");

assert(rust.includes("mod storage;") && rust.includes("StorageState"), "Rust 主程序没有接入 SQLite 模块");
assert(rust.includes("StorageState::new(&app_data_dir)") && rust.includes("app.manage(storage_state)"), "SQLite 状态没有在应用启动时初始化");
for (const command of [
  "storage_bootstrap", "storage_set", "storage_remove", "storage_clear", "storage_status",
  "storage_create_snapshot", "storage_restore_snapshot",
]) {
  assert(storageRust.includes(`pub fn ${command}`), `SQLite 命令缺失：${command}`);
  assert(rust.includes(`            ${command},`), `SQLite 命令未注册：${command}`);
}

for (const schema of ["CREATE TABLE IF NOT EXISTS app_meta", "CREATE TABLE IF NOT EXISTS app_state", "CREATE TABLE IF NOT EXISTS state_revisions"]) {
  assert(storageRust.includes(schema), `SQLite 表结构缺失：${schema}`);
}
for (const safety of [
  "PRAGMA journal_mode = WAL", "PRAGMA quick_check", "busy_timeout", "MAX_STORAGE_VALUE_BYTES",
  "MAX_REVISIONS_PER_KEY", "MAX_TOTAL_REVISIONS", "MAX_SNAPSHOTS", "AUTO_SNAPSHOT_INTERVAL_MS",
  "webview_migration_completed", "migrated_item_count", "create_snapshot_locked", "pre-restore",
  ".backup(MAIN_DB", ".restore(", "valid_snapshot_id", "密码、API Key 和登录凭据不能写入 SQLite",
]) {
  assert(storageRust.includes(safety), `SQLite 数据保护缺失：${safety}`);
}
for (const key of [
  "kardii-workbench-open-target-v1", "kardii-agent-open-target-v1", "kardii-chat-open-target-v1",
  "kardii-browser-context-v1", "kardii-browser-agent-request-v1", "kardii-browser-capture-seen-v1",
]) {
  assert(storageRust.includes(`"${key}"`) && storageJs.includes(`"${key}"`), `临时跨窗口状态不应持久化：${key}`);
}

for (const page of ["src/index.html", "src/chat.html", "src/workbench.html", "src/agent.html"]) {
  const html = read(page);
  assert(html.includes('src="./kardii-storage.js"'), `${page} 没有加载 SQLite 启动桥`);
  assert(/data-main="\.\/(?:main|chat|workbench|agent)\.js"/.test(html), `${page} 没有等待 SQLite 恢复后再启动主脚本`);
}
assert(storageJs.includes("const ready = bootstrap()") && storageJs.includes("ready.finally"), "页面主脚本没有等待 SQLite 启动迁移");
assert(storageJs.includes("Storage.prototype.setItem") && storageJs.includes('enqueue("storage_set"'), "localStorage 写入没有镜像到 SQLite");
assert(storageJs.includes("Storage.prototype.removeItem") && storageJs.includes('enqueue("storage_remove"'), "localStorage 删除没有镜像到 SQLite");
assert(storageJs.includes("Storage.prototype.clear") && storageJs.includes('enqueue("storage_clear"'), "localStorage 清空没有镜像到 SQLite");
assert(storageJs.includes("applyEntries(result?.entries)") && storageJs.includes("readLegacyEntries()"), "SQLite 启动恢复或旧数据迁移桥缺失");
assert(storageJs.includes("writeQueue") && storageJs.includes("async function flush()"), "SQLite 写入没有排队或退出前刷新能力");
assert(mainJs.indexOf("KardiiStorage.flush()") < mainJs.indexOf('invoke("quit_app")'), "正常退出前没有等待 SQLite 写入");

class FakeStorage {
  constructor(entries = []) { this.values = new Map(entries); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}
const storageCalls = [];
const fakeLocalStorage = new FakeStorage([
  ["kardii-profile-v1", "legacy-profile"],
  ["kardii-agent-open-target-v1", "ephemeral"],
]);
const storageContext = vm.createContext({
  Storage: FakeStorage,
  localStorage: fakeLocalStorage,
  document: { currentScript: { dataset: {} }, body: { append() {} }, createElement() { return {}; } },
  CustomEvent: class CustomEvent { constructor(name, options) { this.type = name; this.detail = options?.detail; } },
  console,
  Promise,
});
storageContext.window = {
  __TAURI__: {
    core: {
      invoke: async (command, args = {}) => {
        storageCalls.push({ command, args });
        if (command === "storage_bootstrap") return {
          entries: [{ key: "kardii-profile-v1", value: "database-profile" }],
          status: { ready: true, integrity: "ok", itemCount: 1, snapshotCount: 0 },
        };
        if (command === "storage_status") return { ready: true, integrity: "ok", itemCount: 1, snapshotCount: 0 };
        return null;
      },
    },
    event: { emitTo: async () => {}, listen: async () => () => {} },
  },
  dispatchEvent() {},
  location: { reload() {} },
};
vm.runInContext(storageJs, storageContext);
await storageContext.window.KardiiStorage.ready;
assert(fakeLocalStorage.getItem("kardii-profile-v1") === "database-profile", "SQLite 启动数据没有覆盖兼容缓存");
assert(fakeLocalStorage.getItem("kardii-agent-open-target-v1") === "ephemeral", "SQLite 启动不应删除临时跨窗口状态");
fakeLocalStorage.setItem("kardii-scale", "1.2");
fakeLocalStorage.setItem("kardii-agent-open-target-v1", "next-task");
fakeLocalStorage.removeItem("kardii-profile-v1");
await storageContext.window.KardiiStorage.flush();
assert(storageCalls.some((call) => call.command === "storage_set" && call.args.key === "kardii-scale"), "持久化键没有进入 SQLite 写入队列");
assert(storageCalls.some((call) => call.command === "storage_remove" && call.args.key === "kardii-profile-v1"), "持久化键删除没有进入 SQLite 队列");
assert(!storageCalls.some((call) => call.command === "storage_set" && call.args.key === "kardii-agent-open-target-v1"), "临时目标被错误持久化");

for (const id of [
  "storageDataLabel", "storageDataStatus", "checkStorageButton", "restoreStorageButton", "createStorageSnapshotButton",
]) {
  assert(chatHtml.includes(`id="${id}"`), `本机数据界面缺少 ${id}`);
  assert(chatJs.includes(`getElementById("${id}")`), `本机数据控件未绑定 ${id}`);
}
assert(chatJs.includes("function refreshStorageStatus()") && chatJs.includes("function createStorageSnapshot()") && chatJs.includes("function restoreStorageSnapshot()"), "SQLite 检查、恢复点或恢复操作未接通");
assert(chatJs.includes("KardiiStorage.reloadAllWindows()"), "恢复数据后没有重新载入所有 Kardii 窗口");
assert(chatCss.includes(".storage-card") && chatCss.includes(".storage-note"), "本机数据卡片样式缺失");

assert(capabilities.includes('id: "local-storage"') && capabilities.includes("SQLite 本机数据与恢复"), "帮助中心没有介绍 v1.8 SQLite");
assert(capabilities.includes("WebView 本机存储仍保留为兼容缓存") && capabilities.includes("网页端、iOS 与跨设备同步尚未加入"), "功能认知没有准确说明 SQLite 与同步边界");
assert(readme.includes("v1.8 SQLite 本机数据与恢复") && readme.includes("只保留最近 5 个"), "README 缺少 v1.8 数据层说明");
assert(!readme.includes("本机 SQLite 数据层与跨设备产品：逐步替换"), "README 路线图仍把已完成的 SQLite 列为未来功能");

const ids = [...chatHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `聊天页面出现重复 ID：${[...new Set(duplicates)].join(", ")}`);

for (const file of ["src/kardii-storage.js", "src/main.js", "src/chat.js", "src/workbench.js", "src/agent.js", "src/kardii-capabilities.js"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: "utf8" });
  assert(result.status === 0, `${file} 语法检查失败：${result.stderr}`);
}

console.log("Kardii v1.8 SQLite storage, migration, and recovery checks passed.");
