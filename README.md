# Kardii AI Companion macOS v1.2

这是 macOS 版悬浮桌宠项目。

## 功能

- 透明无边框悬浮窗口
- 始终置顶
- 左键拖动
- 双击切换 Loading / Sleep / Error
- 右键菜单
- 滚轮缩放
- 3 分钟无操作自动睡觉

## 用 GitHub Actions 生成 Mac 应用

仓库根目录必须直接包含：

```text
.github
src
src-tauri
package.json
README.md
```

`.github/workflows/` 中应有：

```text
build-macos.yml
```

上传后：

1. 打开 GitHub 仓库的 Actions。
2. 选择 `Build Kardii macOS App`。
3. 点击 `Run workflow`。
4. 等待构建完成。
5. 在 Artifacts 下载 `Kardii-AI-Companion-macOS`。
6. 解压后获得 `.dmg` 或 `.app`。

## 在 Mac 本地开发

需要安装 Node.js、Rust 和 Xcode Command Line Tools。

```bash
xcode-select --install
npm install
npm run dev
```

本地打包：

```bash
npm run build
```

生成位置：

```text
src-tauri/target/release/bundle/dmg/
src-tauri/target/release/bundle/macos/
```

## 首次打开提示“无法验证开发者”

由于当前应用没有 Apple 开发者签名，第一次打开时：

1. Finder 中右键应用。
2. 选择“打开”。
3. 再点一次“打开”。

或者进入：

系统设置 → 隐私与安全性 → 仍要打开
