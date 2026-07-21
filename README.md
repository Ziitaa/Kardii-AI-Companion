# Kardii AI Companion

Kardii 是一个使用 Tauri 2 制作的跨平台透明悬浮桌宠与 AI 聊天伙伴。

## v0.7 功能

> v0.7.2 修复 Gemini 测试请求的输出额度过小而误报“没有返回可读取文字”的问题；同时包含 v0.7.1 的系统代理修复，Ollama 本机请求始终绕过代理。

### 多 AI 切换

- 在设置中随时切换 DeepSeek、Google Gemini 和本机 Ollama
- DeepSeek 继续使用 `deepseek-v4-flash` 非思考模式
- Gemini 提供低成本的 `gemini-3.1-flash-lite` 和更强的 `gemini-3.5-flash`
- Ollama 自动读取这台电脑中已经下载的模型，不需要 API Key
- 聊天窗口顶部显示当前 AI 与模型，避免误用不同计费服务
- 不同云端服务的 API Key 分开保存在系统安全凭据库中
- 切换 AI 不会清空聊天、个性、长期记忆或桌面工具结果
- 备份包含 AI 选择和模型设置，但仍然不包含任何 API Key

### 离线语音

- 单击麦克风开始录音，再次单击停止，最长录制 60 秒
- 使用 SenseVoice INT8 在本机把语音转换成文字，录音不会上传
- 识别结果先放入输入框，由用户检查后手动发送
- 支持普通话、粤语、英语、日语和韩语
- 第一次使用时按用户操作下载约 160 MB、安装后占用约 230 MB，之后断网也能语音转文字
- 可在设置中查看下载进度、重新下载或删除模型
- 使用 Windows/macOS 系统自带声音朗读回答
- 可选择系统声音、调整语速，自动朗读默认关闭
- Mac 安装包包含麦克风用途说明和音频输入权限

### 桌宠

- 透明、无边框、始终置顶的悬浮窗口
- 待机、思考、说话、开心、加载、睡觉、报错七种动画 WebP
- 单击 Kardii 打开或收起独立聊天窗口
- 拖动 Kardii 并自动保存窗口位置
- 双击依次切换动作
- 右键打开动作、大小和退出菜单
- 滚轮缩放至 0.6–2.4 倍，窗口同步扩展并保存大小
- 三分钟无操作后自动睡觉
- 系统托盘显示与退出

### AI 聊天

- 使用兼容的流式聊天接口连接当前选择的 AI
- 流式显示回答
- 等待首个字时显示思考动画，流式回答时显示说话动画
- 回答成功后播放一轮开心动画，再自动回到待机
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

### 用户授权的桌面工具

- 读取用户在系统选择器中亲自选中的 UTF-8 文本或代码文件
- 单次读取或写入系统剪贴板文字，不在后台持续监控
- 使用系统默认浏览器打开经过检查的 `http` / `https` 地址
- 在 Windows `cmd` 或 macOS `zsh` 中运行用户输入并再次确认的单行命令
- 每次工具操作都显示具体内容，仅允许一次，不提供永久授权
- 拒绝常见的删除数据、修改系统、提权和多行命令，运行超过 20 秒自动终止
- 文件、剪贴板与终端结果只在用户发送下一条问题时交给当前选择的 AI
- 本机保存最近 30 条工具执行记录，可随时清空，不加入备份

### 安全与隐私

- DeepSeek 与 Gemini API Key 不写入源码、配置文件、备份或 GitHub
- Windows 使用系统凭据管理器保存 API Key
- macOS 使用系统钥匙串保存 API Key
- 聊天记录仅保存在当前电脑的 WebView 本地存储中
- 使用 DeepSeek 或 Gemini 时，对话内容会发送至当前选择的云端服务；使用 Ollama 时只发送至这台电脑上的本机服务
- 为了避免误连外部服务器，v0.7 的 Ollama 地址只允许 `localhost`、`127.0.0.1` 或 `::1`
- 语音转文字完全在本机执行，原始录音不保存、不上传
- 离线语音模型仅在用户点击下载后从 sherpa-onnx 官方发布地址获取
- 本地工具不会由 AI 自动执行；用户必须在 Kardii 界面中主动触发并确认
- 工具返回内容按不可信资料处理，不能覆盖 Kardii 的系统安全规则

## 支持平台

| 平台 | 构建目标 | 产物 |
| --- | --- | --- |
| Intel Mac | `x86_64-apple-darwin` | macOS Universal 应用 |
| M1–M5 Mac | `aarch64-apple-darwin` | macOS Universal 应用 |
| Windows 10/11 x64 | `x86_64-pc-windows-msvc` | `.exe` / `.msi` |

macOS 使用 `universal-apple-darwin` 将 Intel 与 Apple Silicon 合并为同一个安装包。

## AI 与语音设置

1. 单击 Kardii 打开聊天窗口，再点击右上角齿轮。
2. 选择 DeepSeek、Gemini 或 Ollama。
3. DeepSeek/Gemini：粘贴对应服务的 API Key，保存后点击“测试连接”。
4. Ollama：先在电脑上安装并运行 Ollama、下载至少一个模型，再点击“刷新模型”和“测试本机连接”。
5. 连接成功后关闭设置即可聊天；顶部标签会显示当前使用的服务。

第一次使用语音时，在同一设置面板点击“下载离线模型”。下载和加载完成后，聊天输入框旁会出现可用的麦克风按钮。自动朗读保持默认关闭，需要时再在设置中打开。

不要把 API Key 提交到仓库、截图公开或发送给其他人。

## 动画资源

```text
src/assets/pet/
├── idle.webp
├── thinking.webp
├── talking.webp
├── happy.webp
├── loading.webp
├── sleep.webp
└── error.webp
```

单帧源文件保存在 `src/assets/pet/frames/`。重新生成现有动画：

```bash
python tools/build_animations.py
```

只替换思考、说话或开心的 PNG 帧后，可以仅重建这三种动画：

```bash
python tools/build_animations.py --saved-only
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

- OpenAI 与 Claude 尚未加入，计划在后续版本扩展。
- Ollama 需要用户另行安装；较大的本机模型会占用更多硬盘和内存，速度取决于电脑配置。
- 桌面工具目前由用户在工具面板中手动触发，尚未接入 MCP 自动工具发现。
- 当前语音输入为“录完后识别”，尚未加入持续监听或唤醒词。
- Windows 与 macOS 安装包尚未进行正式代码签名。
- macOS 首次打开时可能需要在“隐私与安全性”中选择“仍要打开”。
