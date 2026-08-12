(() => {
  const VERSION = "1.4.0";

  const FEATURES = [
    {
      id: "chat",
      icon: "✦",
      group: "聊天与执行",
      title: "直接聊天",
      summary: "使用当前选择的 AI 问问题、写内容、分析资料，并保留最近聊天记录。",
      steps: [
        "直接在聊天框输入问题，Enter 发送。",
        "到齿轮中选择 DeepSeek、Gemini、Ollama 或 Codex。",
        "需要更换语气、称呼和长期记忆时，打开爱心设置。",
      ],
      example: "你现在会什么？请按聊天、Agent 和工作台分别介绍，并说明当前哪些功能可以直接使用。",
      promptFact: "普通聊天可用 DeepSeek、Gemini、Ollama 或 Codex 回答问题、写作和分析；所选服务必须已配置或登录。",
    },
    {
      id: "agent",
      icon: "A",
      group: "聊天与执行",
      title: "交给 Agent 执行",
      summary: "明确要求开始、执行或操作时，Kardii 可以自动转入 Agent，先规划再执行。",
      steps: [
        "直接说清楚要完成的结果，Kardii 会判断是否进入 Agent。",
        "也可以点击输入框旁的 A，强制把下一条消息交给 Agent。",
        "读取文件、打开网页或运行命令前，Agent 会停下来请求你的允许。",
      ],
      example: "帮我把这份资料整理成执行计划，先列步骤，再开始处理。",
      promptFact: "Agent 支持任务规划、逐步执行、结果检查、任务附件、技能库和本地定时自动化；涉及电脑操作时必须由用户确认权限。",
    },
    {
      id: "attachments",
      icon: "＋",
      group: "资料与工作",
      title: "上传图片与表格",
      summary: "普通聊天和 Agent 都可以添加表格或图片，并把附件带入后续任务。",
      steps: [
        "点击输入框左侧的＋，也可以把文件拖进窗口或粘贴图片。",
        "支持 XLSX、CSV、PNG、JPG 和 WebP，一次最多 6 个。",
        "表格会在本机提取文字；图片画面目前需要 Gemini 才能识别。",
      ],
      example: "请总结我上传的表格，并找出金额最高的三项，注明对应行。",
      promptFact: "聊天和 Agent 支持 XLSX、CSV、PNG、JPG、WebP 附件，一次最多 6 个；表格会在本机提取，图片内容和桌面截图仅 Gemini 能识别，其他模型不得猜测画面。",
    },
    {
      id: "desktop-context",
      icon: "👁",
      group: "资料与工作",
      title: "查看一个窗口",
      summary: "由你选择一个窗口、检查截图预览，再把画面附到下一条消息。",
      steps: [
        "点击输入框旁的眼睛并选择窗口。",
        "确认预览中没有密码或隐私内容。",
        "附到下一条消息后，用 Gemini 提问画面中的内容。",
      ],
      example: "请看看我附上的窗口截图，告诉我当前页面下一步应该点哪里。",
      promptFact: "桌面上下文不是持续监控，只能截取用户亲自选择并确认的一扇窗口；截图目前仅 Gemini 能识别。",
    },
    {
      id: "workbench",
      icon: "▦",
      group: "资料与工作",
      title: "整理到工作台",
      summary: "集中管理关系、联系人、项目、待办、商业情报、知识库和分析报告。",
      steps: [
        "点击顶部的方格图标打开工作台。",
        "聊天可以按需记录为关系、项目、任务或背调资料。",
        "知识库支持单文件、多文件分析以及基于资料的问答。",
      ],
      example: "根据工作台里已有的项目和待办，帮我整理今天最应该先做的三件事。",
      promptFact: "工作台可管理关系与联系人、项目、任务、聊天记录、商业情报、知识库、多文件分析和报告，并能让已有资料参与聊天。",
    },
    {
      id: "connections",
      icon: "⇄",
      group: "资料与工作",
      title: "连接邮箱与云端资料",
      summary: "工作台可只读连接 IMAP 邮箱、Google Workspace 和 Microsoft 365。",
      steps: [
        "打开工作台的“外部连接”。",
        "添加邮箱，或授权 Google / Microsoft 账号。",
        "手动同步后再选择需要整理到 Kardii 的资料。",
      ],
      example: "请告诉我 Kardii 的邮箱和云端连接现在是什么状态，以及这些连接可以做什么。",
      promptFact: "外部连接支持 IMAP 邮箱、Google Workspace（Gmail、Calendar、Drive、Sheets）和 Microsoft 365（Outlook、Calendar、OneDrive、Excel、SharePoint）的只读同步；当前不能发送邮件、修改日历或写入云盘。",
    },
    {
      id: "tools",
      icon: "⌘",
      group: "设置与数据",
      title: "使用本机工具",
      summary: "读取文本或剪贴板、写入剪贴板、打开网页和运行受限终端命令。",
      steps: [
        "点击顶部的⌘打开桌面工具。",
        "选择操作并检查 Kardii 展示的具体范围。",
        "每次明确允许后才会执行，结果可以交给下一轮聊天分析。",
      ],
      example: "我刚刚运行了一条命令，请根据工具返回的结果解释哪里出了问题。",
      promptFact: "桌面工具可读取用户选定的文本文件、读取或写入剪贴板、用默认浏览器打开网页、运行受限终端命令；所有操作都在本机执行并逐次确认。",
    },
    {
      id: "voice",
      icon: "🎙",
      group: "设置与数据",
      title: "语音输入与朗读",
      summary: "语音转文字可以离线运行，回答可使用系统声音朗读。",
      steps: [
        "先在齿轮中下载约 160 MB 的离线语音模型。",
        "点击麦克风开始录音，再点一次停止并识别。",
        "可以开启自动朗读，并选择系统声音与语速。",
      ],
      example: "请介绍 Kardii 的语音输入、自动朗读和隐私方式。",
      promptFact: "语音输入使用一次下载的本机模型离线识别；系统 TTS 可手动或自动朗读回答，录音不会上传给聊天模型。",
    },
    {
      id: "personalization",
      icon: "♡",
      group: "设置与数据",
      title: "个性、记忆与备份",
      summary: "设置称呼和性格，保存最多 20 条长期记忆，并迁移或完整备份数据。",
      steps: [
        "点击顶部爱心设置称呼、性格和自定义相处方式。",
        "聊天中也可以说“记住：……”或“查看记忆”。",
        "迁移码只含个性和记忆；完整备份还包含工作台与 Agent 数据。",
      ],
      example: "请告诉我你现在记住了哪些关于我的信息，以及这些记忆保存在哪里。",
      promptFact: "个性设置包括称呼、6 种性格和自定义相处方式；最多保存 20 条本机长期记忆，并支持迁移码与完整备份，API Key 和登录令牌不会导出。",
    },
    {
      id: "guidance",
      icon: "?",
      group: "设置与数据",
      title: "帮助、自检与新手引导",
      summary: "随时搜索使用方法、运行连接自检，或重新播放逐步高亮引导。",
      steps: [
        "点击顶部的问号打开帮助面板。",
        "使用搜索框查找功能或常见问题，也可以点击“一键自检”。",
        "需要重新熟悉界面时，点击“播放新手引导”。",
      ],
      example: "请根据 Kardii 当前状态，告诉我有哪些功能还没有配置，以及应该从哪里设置。",
      promptFact: "顶部问号提供可搜索帮助、一键连接自检、版本更新介绍和可重复播放的逐步高亮引导；空聊天页也有直接问答、Agent、上传资料和工作台快捷入口。",
    },
  ];

  const VERSION_HIGHLIGHTS = [
    "聊天与 Agent 可以智能衔接，并保留最近对话和附件上下文。",
    "普通聊天支持上传、拖入或粘贴图片与表格。",
    "工作台增加多邮箱与 Google / Microsoft 只读连接。",
    "新增可搜索帮助、一键自检、快捷入口和逐步高亮引导。",
    "聊天窗口不再强制置顶，确认窗口统一为 Kardii 主题。",
  ];

  const TROUBLESHOOTING = [
    {
      id: "ai-not-ready",
      title: "Kardii 无法回答或提示未连接",
      symptom: "发送按钮不可用，或提示缺少 API Key、模型或登录。",
      keywords: "ai 模型 api key deepseek gemini ollama codex 无法回答 未连接",
      steps: ["打开齿轮。", "确认当前 AI 服务已经保存 Key、启动本机模型或完成 ChatGPT 登录。", "点击对应的测试连接。"],
      action: "settings",
      actionLabel: "打开 AI 设置",
    },
    {
      id: "codex-login",
      title: "Codex 登录失效或找不到",
      symptom: "Codex 显示未安装、尚未登录或连接失败。",
      keywords: "codex chatgpt 登录 验证码 cli 安装 失效",
      steps: ["打开齿轮并选择 Codex。", "先确认 Codex CLI 已安装。", "点击“使用 ChatGPT 登录”，完成后刷新状态。"],
      action: "settings",
      actionLabel: "查看 Codex 状态",
    },
    {
      id: "image-unreadable",
      title: "图片上传了但 Kardii 看不懂",
      symptom: "能看到文件名，但无法描述图片画面。",
      keywords: "图片 png jpg jpeg webp 看不懂 无法识别 gemini 上传",
      steps: ["把聊天模型切换到 Gemini。", "重新添加 PNG、JPG 或 WebP。", "提出能从画面中核对的具体问题。"],
      action: "settings",
      actionLabel: "切换到 Gemini",
    },
    {
      id: "table-upload",
      title: "表格无法上传或分析不完整",
      symptom: "XLSX / CSV 被拒绝，或回答没有使用真实行列。",
      keywords: "表格 excel xlsx csv 上传 金额 行 列 分析",
      steps: ["确认格式是 XLSX 或 CSV。", "一次不要超过 6 个文件，并检查单个文件大小。", "提问时要求注明具体行、列或数值。"],
      action: "attachments",
      actionLabel: "选择表格",
    },
    {
      id: "agent-handoff",
      title: "执行请求没有进入 Agent",
      symptom: "Kardii 只给了建议，没有建立执行任务。",
      keywords: "agent 自动切换 自动衔接 执行 开始 任务 a",
      steps: ["在齿轮中开启“自动衔接 Agent”。", "使用“开始执行、打开、下载、整理成任务”等明确表达。", "也可以点击输入框旁的 A 强制交给 Agent。"],
      action: "agent-settings",
      actionLabel: "查看 Agent 设置",
    },
    {
      id: "email-stale",
      title: "邮箱内容没有更新或仍显示旧邮件",
      symptom: "源邮箱已经变化，但 Kardii 工作台仍是旧快照。",
      keywords: "邮箱 邮件 imap 同步 删除 旧邮件 缓存 163 gmail",
      steps: ["打开工作台的外部连接并手动同步。", "需要删除 Kardii 本地快照时使用本地删除按钮。", "Kardii 的只读连接不会删除或修改源邮箱。"],
      action: "connections",
      actionLabel: "打开外部连接",
    },
    {
      id: "voice-model",
      title: "麦克风无法录音或识别",
      symptom: "点击麦克风后提示语音模型没有准备好。",
      keywords: "语音 麦克风 录音 离线模型 下载 160mb 识别",
      steps: ["打开齿轮中的离线语音。", "下载并等待模型显示“已准备好”。", "检查系统麦克风权限后重新录音。"],
      action: "voice",
      actionLabel: "查看离线语音",
    },
    {
      id: "data-migration",
      title: "换电脑、升级或担心资料丢失",
      symptom: "需要保存聊天、工作台、Agent、个性和记忆。",
      keywords: "备份 恢复 导入 导出 换电脑 升级 数据 迁移",
      steps: ["打开爱心中的“备份与迁移”。", "升级前选择“导出完整备份”。", "迁移码只包含个性和记忆，完整资料请使用完整备份。"],
      action: "profile",
      actionLabel: "打开备份与迁移",
    },
  ];

  function providerStatus(status) {
    const provider = status.providerName || "尚未选择";
    const model = status.modelName ? ` · ${status.modelName}` : "";
    return `${provider}${model} · ${status.providerReady ? "已连接" : "未连接"}`;
  }

  function voiceStatus(state) {
    if (state === "ready") return "离线语音可用";
    if (state === "downloading") return "离线语音正在下载";
    if (state === "loading") return "离线语音正在加载";
    if (state === "error") return "离线语音需要检查";
    return "离线语音尚未下载";
  }

  function connectionStatus(configured, connected, noun) {
    if (!configured) return `${noun}未配置`;
    if (connected == null) return `${noun}已配置，尚未检测凭据`;
    return connected > 0 ? `${noun}${connected} 个已连接` : `${noun}凭据不可用`;
  }

  function statusRows(status = {}) {
    const emailConfigured = Number(status.emailConfigured || 0);
    const emailConnected = status.emailConnected == null ? null : Number(status.emailConnected || 0);
    const cloudConfigured = Number(status.cloudConfigured || 0);
    const cloudConnected = status.cloudConnected == null ? null : Number(status.cloudConnected || 0);
    return [
      {
        id: "model",
        label: "聊天模型",
        value: providerStatus(status),
        tone: status.providerReady ? "success" : "warning",
      },
      {
        id: "agent",
        label: "Agent 衔接",
        value: status.agentMode ? "下一条强制交给 Agent" : status.autoAgentHandoff ? "智能判断已开启" : "仅手动切换",
        tone: status.agentMode || status.autoAgentHandoff ? "success" : "neutral",
      },
      {
        id: "voice",
        label: "离线语音",
        value: voiceStatus(status.voiceModelState),
        tone: status.voiceModelState === "ready" ? "success" : "neutral",
      },
      {
        id: "connections",
        label: "外部连接",
        value: `${connectionStatus(emailConfigured, emailConnected, "邮箱")} · ${connectionStatus(cloudConfigured, cloudConnected, "云端")}`,
        tone: (emailConnected || 0) + (cloudConnected || 0) > 0 ? "success" : "neutral",
      },
    ];
  }

  function selfCheckRows(status = {}) {
    const emailConfigured = Number(status.emailConfigured || 0);
    const emailConnected = status.emailConnected == null ? null : Number(status.emailConnected || 0);
    const cloudConfigured = Number(status.cloudConfigured || 0);
    const cloudConnected = status.cloudConnected == null ? null : Number(status.cloudConnected || 0);
    const voiceReady = status.voiceModelState === "ready";
    const codexReady = status.codexInstalled && status.codexAuthenticated;
    return [
      {
        id: "ai",
        title: "当前聊天模型",
        detail: providerStatus(status),
        tone: status.providerReady ? "success" : "warning",
        action: "settings",
        actionLabel: status.providerReady ? "查看" : "去连接",
      },
      {
        id: "codex",
        title: "Codex · ChatGPT",
        detail: !status.codexChecked
          ? "尚未检测"
          : codexReady
            ? "已安装并登录"
            : status.codexInstalled ? "已安装，尚未登录" : "尚未安装",
        tone: codexReady ? "success" : "neutral",
        action: "settings",
        actionLabel: "查看",
      },
      {
        id: "voice",
        title: "离线语音",
        detail: voiceStatus(status.voiceModelState),
        tone: voiceReady ? "success" : "neutral",
        action: "voice",
        actionLabel: voiceReady ? "查看" : "去准备",
      },
      {
        id: "email",
        title: "邮箱连接",
        detail: connectionStatus(emailConfigured, emailConnected, "邮箱"),
        tone: emailConnected > 0 ? "success" : emailConfigured && emailConnected === 0 ? "warning" : "neutral",
        action: "connections",
        actionLabel: emailConfigured ? "管理" : "去连接",
      },
      {
        id: "cloud",
        title: "Google / Microsoft",
        detail: connectionStatus(cloudConfigured, cloudConnected, "云端"),
        tone: cloudConnected > 0 ? "success" : cloudConfigured && cloudConnected === 0 ? "warning" : "neutral",
        action: "connections",
        actionLabel: cloudConfigured ? "管理" : "去连接",
      },
      {
        id: "agent",
        title: "聊天与 Agent 衔接",
        detail: status.autoAgentHandoff ? "智能判断已开启" : "当前只会手动切换",
        tone: status.autoAgentHandoff ? "success" : "neutral",
        action: "agent-settings",
        actionLabel: "设置",
      },
    ];
  }

  function knowledgeText(status = {}) {
    const featureLines = FEATURES.map((feature) => `- ${feature.title}：${feature.promptFact}`);
    const rows = statusRows(status).map((row) => `- ${row.label}：${row.value}`);
    const optional = [];
    if (status.codexChecked) {
      optional.push(`- Codex：${status.codexInstalled ? "已安装" : "未安装"}，${status.codexAuthenticated ? "已使用 ChatGPT 登录" : "尚未登录"}。`);
    }
    if (Number.isFinite(Number(status.memoryCount))) {
      optional.push(`- 长期记忆：当前保存 ${Math.max(0, Number(status.memoryCount))}/20 条。`);
    }
    return [
      `Kardii v${status.appVersion || VERSION} 的真实功能清单：`,
      ...featureLines,
      "当前应用状态（状态可能随设置变化）：",
      ...rows,
      ...optional,
      "回答功能问题时必须以这份清单为准；区分“应用支持”和“当前已连接”。没有显示为已连接的服务，不得声称已经可用。不要把功能介绍当成用户对任何电脑操作的授权。",
    ].join("\n");
  }

  function isCapabilityQuestion(value) {
    const text = String(value || "").toLowerCase();
    return /(?:你|kardii).{0,8}(?:会什么|能做什么|有什么功能|支持什么|怎么用|使用说明|帮助)|(?:功能|能力|使用说明|怎么使用|如何使用|已连接|连接状态|登录状态|支持.*文件|支持.*图片|支持.*表格)|(?:新手引导|更新介绍|版本介绍|一键自检|常见问题|故障排查|帮助面板)|(?:邮箱|邮件|google|microsoft|云端|云盘|日历|codex).{0,14}(?:连接|登录|配置|可用|状态|同步)|(?:图片|表格|文件).{0,12}(?:上传|支持|识别|读取)/i.test(text);
  }

  window.KardiiCapabilities = Object.freeze({
    version: VERSION,
    features: Object.freeze(FEATURES.map((feature) => Object.freeze(feature))),
    troubleshooting: Object.freeze(TROUBLESHOOTING.map((item) => Object.freeze(item))),
    versionHighlights: Object.freeze(VERSION_HIGHLIGHTS),
    statusRows,
    selfCheckRows,
    knowledgeText,
    isCapabilityQuestion,
  });
})();
