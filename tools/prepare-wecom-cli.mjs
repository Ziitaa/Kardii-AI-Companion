import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "1.1.0";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_DIR = join(ROOT, "src-tauri", "wecom-cli");
const PACKAGES = {
  "darwin-arm64": {
    url: `https://registry.npmjs.org/@wecom/cli-darwin-arm64/-/cli-darwin-arm64-${VERSION}.tgz`,
    integrity: "sha512-+PsDu6GATKL0APVcdv8TCqAU4oMjtpCWAiWmB1gr0unhr7aBxybACcHtgepstkMXyax4omQ+jZK3ratNtzyoRQ==",
    source: "package/bin/wecom-cli",
    output: "wecom-cli-macos-aarch64",
  },
  "darwin-x64": {
    url: `https://registry.npmjs.org/@wecom/cli-darwin-x64/-/cli-darwin-x64-${VERSION}.tgz`,
    integrity: "sha512-ni5KKKj2RgSja2I0OGgBLbdsWtK81Act8QnK7TFo882GGFj/znpdDtWpDKgBXICZ5JZhu3vfg7PjDJFqaSTs6g==",
    source: "package/bin/wecom-cli",
    output: "wecom-cli-macos-x86_64",
  },
  "linux-arm64": {
    url: `https://registry.npmjs.org/@wecom/cli-linux-arm64/-/cli-linux-arm64-${VERSION}.tgz`,
    integrity: "sha512-HMxnPsTd9LnG9nN9X5jEvFXYoaeFOpiteTZdvyqbGp0W28PgtQsexCyRrvYByoeA4gAcSVM7Mex2pYiosZ37dA==",
    source: "package/bin/wecom-cli",
    output: "wecom-cli-linux-aarch64",
  },
  "linux-x64": {
    url: `https://registry.npmjs.org/@wecom/cli-linux-x64/-/cli-linux-x64-${VERSION}.tgz`,
    integrity: "sha512-MmU5ApbqO0VY+BubMuH95A9gVnibzyeoifvs6cjCrA5DB36ld9pOg03JiXqMooub6sypVsF3C//spxHQEXEduA==",
    source: "package/bin/wecom-cli",
    output: "wecom-cli-linux-x86_64",
  },
  "win32-x64": {
    url: `https://registry.npmjs.org/@wecom/cli-win32-x64/-/cli-win32-x64-${VERSION}.tgz`,
    integrity: "sha512-Sqo2TCHTk0GYu4BNtmzr7wTKL9Kez43DXzMGobUH5D0N4ypuCnSS7AkJ2iRgLpTT1IU80Wwb+Fwgbz95xI3DFQ==",
    source: "package/bin/wecom-cli.exe",
    output: "wecom-cli-windows-x86_64.exe",
  },
};

function download(url, redirects = 0) {
  return new Promise((resolveDownload, reject) => {
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        resolveDownload(download(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`下载企业微信组件失败：HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) response.destroy(new Error("企业微信组件压缩包异常过大。"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolveDownload(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

function targets() {
  const mode = process.argv.includes("--bundle") ? "bundle" : "current";
  if (process.platform === "darwin" && mode === "bundle") return ["darwin-arm64", "darwin-x64"];
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const arch = process.arch;
  const key = `${platform}-${arch}`;
  if (!PACKAGES[key]) throw new Error(`当前平台不受企业微信官方 CLI 支持：${key}`);
  return [key];
}

async function prepare(key) {
  const item = PACKAGES[key];
  const output = join(OUTPUT_DIR, item.output);
  if (!process.argv.includes("--bundle")) {
    try {
      const existing = await readFile(output);
      if (existing.length > 1024 * 1024) return;
    } catch { /* download below */ }
  }

  const archive = await download(item.url);
  const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (actual !== item.integrity) throw new Error(`企业微信官方组件完整性校验失败：${key}`);

  const temporary = await mkdtemp(join(tmpdir(), "kardii-wecom-cli-"));
  try {
    const archivePath = join(temporary, "package.tgz");
    await writeFile(archivePath, archive);
    const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", temporary, item.source], { encoding: "utf8" });
    if (extracted.status !== 0) throw new Error(`无法解压企业微信组件：${extracted.stderr || extracted.stdout}`);
    await copyFile(join(temporary, item.source), output);
    if (process.platform !== "win32") await chmod(output, 0o755);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const selectedTargets = targets();
await mkdir(OUTPUT_DIR, { recursive: true });
for (const key of selectedTargets) await prepare(key);
console.log(`WeCom CLI ${VERSION} prepared for ${selectedTargets.join(", ")}.`);
