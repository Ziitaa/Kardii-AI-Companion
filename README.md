# Kardii AI Companion

Kardii 是一个使用 Tauri 2 制作的跨平台透明悬浮桌宠。

## v0.2 功能

- 透明无边框悬浮窗口
- 逐帧动画 WebP，而不是整张图片摇晃
- 待机、加载、睡觉、报错四种动作
- 左键拖动，自动保存窗口位置
- 双击依次切换动作
- 右键打开动作和大小菜单
- 滚轮缩放并保存大小
- 三分钟无操作后自动睡觉
- 系统托盘显示与退出
- Intel Mac、Apple Silicon Mac 和 Windows 10/11 构建

## 支持平台

| 平台 | 构建目标 | 产物 |
| --- | --- | --- |
| Intel Mac | `x86_64-apple-darwin` | macOS Universal 应用 |
| M1–M5 Mac | `aarch64-apple-darwin` | macOS Universal 应用 |
| Windows 10/11 x64 | `x86_64-pc-windows-msvc` | `.exe` / `.msi` |

macOS 使用 `universal-apple-darwin` 将 Intel 与 Apple Silicon 合并为同一个安装包。

## 动画资源

```text
src/assets/pet/
├── idle.webp
├── loading.webp
├── sleep.webp
└── error.webp
```

单帧源文件保存在 `src/assets/pet/frames/`。如需从设计稿重新生成动画：

```bash
python tools/build_animations.py
```

## 本地开发

需要 Node.js 20+、Rust stable，以及对应平台的 Tauri 系统依赖。

```bash
npm ci
npm run dev
```

本地打包：

```bash
npm run build
```

## GitHub Actions

- `Build Kardii macOS Universal App` 构建 Intel + Apple Silicon 通用包。
- `Build Kardii Windows App` 构建 Windows x64 安装包。

可在 GitHub 仓库的 **Actions** 页面手动运行，也会在相关分支和 Pull Request 上自动检查。

当前构建未进行 Apple 或 Windows 代码签名。首次打开时，系统可能显示开发者验证或安全提醒；正式发布前需要加入签名与 macOS 公证。
