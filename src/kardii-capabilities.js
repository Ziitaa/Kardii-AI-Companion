(() => {
  const VERSION = "2.2.0";

  const FEATURES = [
    {
      id: "chat",
      icon: "✦",
      group: "Niko",
      title: "和 Niko 聊天",
      summary: "通过 Codex / ChatGPT 登录与 Niko 对话；会话和长期记忆保存在本机。",
      steps: ["直接输入问题或目标。", "需要真正执行时交给 Agent。", "不同事情可以使用独立会话。"],
      example: "Niko，告诉我你现在正在做什么，以及下一步是什么。",
      promptFact: "Niko 默认使用 Codex / ChatGPT OAuth。聊天支持独立会话、附件、长期记忆和向 Agent 交接。",
    },
    {
      id: "agent",
      icon: "A",
      group: "执行",
      title: "Agent 执行",
      summary: "把明确目标交给 Agent，先规划，再调用允许的工具执行。",
      steps: ["说清楚最终结果。", "Niko 生成执行计划。", "涉及外部写入或高风险动作时等待授权。"],
      example: "研究三个真实需求，选择最容易验证的一个并建立实验计划。",
      promptFact: "Niko Agent 支持任务规划、逐步执行、结果检查、附件、Skills 与后台自动化；最多 3 个隔离任务并行。",
    },
    {
      id: "workbench",
      icon: "▦",
      group: "Niko",
      title: "Niko Workbench",
      summary: "查看 Niko 的目标、业务、实验、活动、记忆、Skills 和 Treasury。",
      steps: ["打开 Niko Workbench。", "Today 看当前执行。", "Businesses / Experiments 看真实验证进度。", "Treasury 看收入和成本。"],
      example: "总结目前所有实验，并告诉我哪些应该继续、停止或等待证据。",
      promptFact: "Niko Workbench 直接复用真实 Agent tasks、Skills 和 Memory，并持久化 Niko 的业务与资金状态。",
    },
    {
      id: "browser",
      icon: "◎",
      group: "工具",
      title: "Browser",
      summary: "Agent 可以读取网页并在明确授权后执行浏览器交互。",
      steps: ["先让 Agent 调查公开信息。", "需要网页交互时确认 browser_action。", "付款、购买等动作仍受政策限制。"],
      example: "调查这个市场的公开竞争产品和定价，并保存来源。",
      promptFact: "公开网页研究可用于 Agent 任务；browser_action 属于受控工具，敏感或不可逆动作不得绕过授权。",
    },
    {
      id: "mcp",
      icon: "M",
      group: "工具",
      title: "MCP",
      summary: "给 Niko 接入额外工具；只读工具可自动化，写入和破坏性动作每次确认。",
      steps: ["配置可信 MCP Server。", "检查工具风险级别。", "只开放 Niko 真正需要的能力。"],
      example: "列出当前已连接的 MCP 工具和风险级别。",
      promptFact: "MCP read 工具可按策略自动调用；write/destructive 需要确认。付款、购买、下单和资金转移默认禁用。",
    },
    {
      id: "terminal",
      icon: ">_",
      group: "工具",
      title: "Terminal 与本地文件",
      summary: "Agent 可以在授权后读取文件、运行受控命令并验证结果。",
      steps: ["让 Agent 说明需要读取或运行什么。", "确认权限。", "执行结果进入任务 Activity。"],
      example: "检查这个项目的状态并运行必要的快速测试。",
      promptFact: "本地文件、Terminal、剪贴板等桌面能力属于受控工具；执行前遵循权限与安全限制。",
    },
    {
      id: "skills",
      icon: "◇",
      group: "执行",
      title: "Skills",
      summary: "把重复成功的方法保存成 Niko 可复用的能力。",
      steps: ["先在真实任务中验证方法。", "确认步骤稳定后保存 Skill。", "后续 Agent 可复用。"],
      example: "把这次验证成功的流程整理成一个可复用 Skill。",
      promptFact: "Skills 与 Agent 共用；Workbench 会显示已经保存和启用的 Skills。",
    },
    {
      id: "automation",
      icon: "↻",
      group: "执行",
      title: "后台自动化",
      summary: "让本机 Niko 在应用运行时按计划继续任务。",
      steps: ["为任务建立自动化。", "保持 Niko Workbench 运行。", "需要授权时任务暂停并提醒。"],
      example: "每天检查一次这个实验的新证据，没有变化就不要制造工作。",
      promptFact: "本机自动化依赖应用和电脑运行；需要权限或用户回答时暂停，不会绕过确认。",
    },
    {
      id: "treasury",
      icon: "$",
      group: "治理",
      title: "Treasury 与 Policy",
      summary: "记录收入、成本和资金状态；真实资金能力默认关闭。",
      steps: ["先记录真实收入与支出。", "任何付款先经过政策检查。", "身份、合同和高风险金融动作必须人工批准。"],
      example: "显示 Niko 当前 Treasury 和所有需要我批准的动作。",
      promptFact: "Niko V0 的 real_money_enabled=false。真实付款、钱包转账、身份验证和合同签署需要人工批准。",
    },
  ];

  function knowledgeText(status = {}) {
    const runtime = [
      status.codexAuthenticated ? "Codex / ChatGPT 已登录。" : "Codex / ChatGPT 登录状态未确认。",
      status.browserRunning ? "Browser bridge 已运行。" : "Browser bridge 当前未运行。",
      status.storageReady ? "SQLite 持久化已就绪。" : "SQLite 持久化状态未确认。",
      `长期记忆：${Number(status.memoryCount || 0)} 条。`,
    ].join(" ");
    return [
      "Niko Workbench 当前能力：",
      ...FEATURES.map((feature) => `- ${feature.title}：${feature.promptFact}`),
      "",
      "当前运行状态：",
      runtime,
    ].join("\n");
  }

  const versionHighlights = [
    "Niko Workbench 成为唯一工作台。",
    "Codex / ChatGPT OAuth 成为默认模型入口。",
    "保留 Agent、Browser、MCP、Terminal、Skills、Automation 与 SQLite。",
    "移除旧企业微信、企业邮箱和企业云办公模块。",
  ];

  const troubleshooting = [
    { id: "codex", title: "Codex 未连接", symptom: "Niko 无法开始模型任务", keywords: "codex chatgpt 登录", steps: ["打开模型设置。", "使用 ChatGPT 完成 Codex 登录。", "回到帮助页刷新状态。"] },
    { id: "browser", title: "Browser 未连接", symptom: "Agent 无法读取当前浏览器页面", keywords: "browser chrome edge", steps: ["启动 Browser bridge。", "确认扩展已经配对。", "重新运行任务。"] },
    { id: "storage", title: "SQLite 未就绪", symptom: "状态或会话无法可靠持久化", keywords: "sqlite storage 数据", steps: ["重新打开 Niko Workbench。", "刷新帮助状态。", "若仍失败，保留错误信息再检查 storage bootstrap。"] },
  ];

  function statusRows(status = {}) {
    return [
      { label: "Codex", value: status.codexAuthenticated ? "ChatGPT 已登录" : "未登录 / 未确认", tone: status.codexAuthenticated ? "good" : "warn" },
      { label: "Agent", value: `${Number(status.agentRunning || 0)} 运行 · ${Number(status.agentQueued || 0)} 排队`, tone: "neutral" },
      { label: "Browser", value: status.browserRunning ? (status.browserPaired ? "已运行 · 已配对" : "已运行 · 未配对") : "未运行", tone: status.browserRunning ? "good" : "neutral" },
      { label: "MCP", value: `${Number(status.mcpConnected || 0)} / ${Number(status.mcpConfigured || 0)} 已连接`, tone: "neutral" },
      { label: "SQLite", value: status.storageReady ? `已就绪 · ${Number(status.storageItemCount || 0)} 项` : "未就绪 / 未确认", tone: status.storageReady ? "good" : "warn" },
      { label: "Memory", value: `${Number(status.memoryCount || 0)} 条`, tone: "neutral" },
    ];
  }

  function selfCheckRows(status = {}) {
    return [
      { title: "Codex / ChatGPT", detail: status.codexAuthenticated ? "登录正常" : "需要登录或刷新状态", tone: status.codexAuthenticated ? "good" : "warn", actionLabel: "模型设置", action: "agent-settings" },
      { title: "SQLite", detail: status.storageReady ? "持久化正常" : "持久化尚未就绪", tone: status.storageReady ? "good" : "warn", actionLabel: "刷新", action: "agent-settings" },
      { title: "Browser", detail: status.browserRunning ? "Bridge 已运行" : "按需启动即可", tone: status.browserRunning ? "good" : "neutral", actionLabel: "查看工具", action: "agent-settings" },
    ];
  }

  window.KardiiCapabilities = { version: VERSION, features: FEATURES, versionHighlights, troubleshooting, knowledgeText, statusRows, selfCheckRows };
})();
