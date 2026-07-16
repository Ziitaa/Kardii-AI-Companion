# Kardii AI Companion

Kardii 是一个使用 Tauri 2 制作的跨平台透明悬浮桌宠与 AI 聊天伙伴。

## v0.4 功能

### 桌宠

- 透明、无边框、始终置顶的悬浮窗口
- 待机、加载、睡觉、报错四种动画 WebP
- 单击 Kardii 打开或收起独立聊天窗口
- 拖动 Kardii 并自动保存窗口位置
- 双击依次切换动作
- 右键打开动作、大小和退出菜单
- 滚轮缩放至 0.6–2.4 倍，窗口同步扩展并保存大小
- 三分钟无操作后自动睡觉
- 系统托盘显示与退出

### AI 聊天

- 接入 DeepSeek `deepseek-v4-flash` 非思考模式
- 流式显示回答
- 等待回复时自动切换加载动画
- 支持停止生成、复制回答和重新回答
- 简短、标准、详细三档回答长度
- 本地保存最近 50 条聊天记录
- 请求时只携带最近 12 条消息以控制费用
- 二次确认清空聊天记录
- API Key、余额、网络、限流和服务异常的友好提示

### 个性与长期记忆

- 温柔治愈、黏人撒娇、元气小太阳、傲娇腹黑、毒舌吐槽、冷面管家六种性格
- 自定义 Kardii 对用户的称呼和相处方式
- 最多 20 条由用户确认保存的长期记忆
- 聊天中使用“记住：”“查看记忆”“忘记：”管理记忆
- 识别可能值得保存的信息并询问，未经确认绝不保存
- 使用迁移码在不同电脑之间复制个性和长期记忆
- 将个性、记忆和聊天记录导出或导入为完整 JSON 备份
- 迁移码和备份均不包含 API Key

### 安全与隐私

- DeepSeek API Key 不写入源码、配置文件或 GitHub
- Windows 使用系统凭据管理器保存 API Key
- macOS 使用系统钥匙串保存 API Key
- 聊天记录仅保存在当前电脑的 WebView 本地存储中
- 对话内容会发送至用户配置的 DeepSeek API 以生成回答

## 支持平台

| 平台 | 构建目标 | 产物 |
| --- | --- | --- |
| Intel Mac | `x86_64-apple-darwin` | macOS Universal 应用 |
| M1–M5 Mac | `aarch64-apple-darwin` | macOS Universal 应用 |
| Windows 10/11 x64 | `x86_64-pc-windows-msvc` | `.exe` / `.msi` |

macOS 使用 `universal-apple-darwin` 将 Intel 与 Apple Silicon 合并为同一个安装包。

## DeepSeek 设置

1. 在 DeepSeek 开放平台创建 API Key。
2. 单击 Kardii 打开聊天窗口。
3. 点击右上角齿轮，粘贴并保存 API Key。
4. 点击“测试连接”。
5. 连接成功后即可聊天。

不要把 API Key 提交到仓库、截图公开或发送给其他人。

## 动画资源

```text
src/assets/pet/
├── idle.webp
├── loading.webp
├── sleep.webp
└── error.webp
```

单帧源文件保存在 `src/assets/pet/frames/`。重新生成现有动画：

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

工作流会在 `main`、`codex/**` 分支和 Pull Request 上运行，也可以在 Actions 页面手动启动。

## 当前限制

- 当前只支持 DeepSeek，尚未加入 OpenAI、Claude、Gemini 或 Ollama。
- 语音和桌面工具尚未加入。
- Windows 与 macOS 安装包尚未进行正式代码签名。
- macOS 首次打开时可能需要在“隐私与安全性”中选择“仍要打开”。
