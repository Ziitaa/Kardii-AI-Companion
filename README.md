# Niko Workbench

Kardii 正在重构为 **Niko 的专属工作系统**。

## 目标

Niko 不是一个通用企业办公助手。这个分支移除旧的企业工作台方向，把已经成熟的桌面 Agent 能力收敛成 Niko 的长期运行环境。

### 保留的核心能力

- ChatGPT / Codex OAuth 登录，不要求单独配置 OpenAI API Key
- 多 Agent 与后台任务
- Browser、MCP、Terminal 与本地文件工具
- Skills 与 Automation
- SQLite 本地持久化
- 桌面聊天、桌宠和 Agent Activity
- GitHub / 互联网 / 后续业务工具接入

### 正在退役

- 企业微信聊天、企微远程 Agent、企微文档
- 企业邮箱和企业云盘入口
- 关系库、企业联合分析、旧商业情报工作台
- 通用 Companion 预设人格和企业知识库体验

## Niko 治理层

Niko 的身份、目标、权限和业务状态放在 `niko/`：

- `NIKO.md`
- `GOALS.md`
- `CONSTITUTION.md`
- `policy.json`
- `state.json`
- `ledger.json`

执行能力继续复用 Kardii 已有的 Agent / Browser / MCP / Terminal / Codex OAuth，不再重复造另一套 runtime。

## 当前阶段

`agent/niko-workbench-v0` 是安全重构分支。第一阶段先切换产品入口和 Niko 工作台，并停用企业微信构建依赖；原生旧模块会在回归验证后继续物理删除。
