(() => {
  const VERSION = "2.0.0";

  const FEATURES = [
    {
      id: "chat",
      icon: "✦",
      group: "聊天与执行",
      title: "直接聊天",
      summary: "使用当前选择的 AI 问问题、写内容、分析资料，并在独立会话中保留上下文。",
      steps: [
        "直接在聊天框输入问题，Enter 发送。",
        "到齿轮中选择 DeepSeek、Gemini、Ollama 或 Codex。",
        "需要更换语气、称呼和长期记忆时，打开爱心设置。",
      ],
      example: "你现在会什么？请按聊天、Agent 和工作台分别介绍，并说明当前哪些功能可以直接使用。",
      promptFact: "普通聊天可用 DeepSeek、Gemini、Ollama 或 Codex 回答问题、写作和分析；所选服务必须已配置或登录。聊天支持最多 30 个独立会话。",
    },
    {
      id: "chat-sessions",
      icon: "▤",
      group: "聊天与执行",
      title: "多个独立聊天会话",
      summary: "不同事情分开保存；切回原会话会恢复它自己的聊天、Codex 线程和关联 Agent。",
      steps: [
        "点击顶部的会话图标打开聊天列表。",
        "点击“新对话”建立完全不带旧聊天内容的会话；系统会根据第一条消息自动生成标题。",
        "切回旧会话即可继续原话题；同一会话再次转给 Agent 时会回到原任务继续。",
      ],
      example: "请告诉我当前会话是否关联了 Agent 任务，以及它现在进行到哪里。",
      promptFact: "Kardii 最多保留 30 个聊天会话；每个会话拥有独立聊天历史、草稿、Codex 线程和关联 Agent 任务。普通个性设置与用户确认的长期记忆是全局共用的。旧版单一聊天记录会自动迁移为一个会话，完整备份包含全部会话。",
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
      promptFact: "Agent 支持任务规划、逐步执行、结果检查、任务附件、技能库和后台自动化；最多 3 个任务可在隔离上下文中并行，涉及电脑或外部写入操作时必须由用户确认权限。",
    },
    {
      id: "parallel-agents",
      icon: "A³",
      group: "聊天与执行",
      title: "并行 Agent 与后台自动化",
      summary: "最多 3 个任务分别保存目标、计划和记录；Kardii 留在托盘时可继续只读后台步骤。",
      steps: [
        "可以连续建立不同任务；前三个获得独立 Agent 席位，其余任务自动排队。",
        "隐藏 Agent 窗口不会停止任务；自动化到时会由后台调度器唤醒并执行。",
        "需要授权、用户回答、完成或失败时，桌宠会显示提醒；点击即可定位到对应任务。",
      ],
      example: "请告诉我现在有几个 Agent 正在运行、几个任务排队，以及哪些任务正在等我确认。",
      promptFact: "Kardii v1.9 最多并行运行 3 个相互隔离的 Agent 任务，更多任务按创建时间排队。任务各自保留目标、计划、历史、技能和来源聊天。Agent 窗口隐藏后只读步骤仍可继续；Rust 调度器每 30 秒唤醒自动化。需要权限或回答时任务暂停并由桌宠提醒。完全退出 Kardii 或电脑关机后不会运行，也不会补做多次错过的周期任务。",
    },
    {
      id: "attachments",
      icon: "＋",
      group: "资料与工作",
      title: "上传文档、表格与图片",
      summary: "普通聊天和 Agent 都可以添加常用资料；长文档会按问题选择相关片段。",
      steps: [
        "点击输入框左侧的＋，也可以把文件拖进窗口或粘贴图片。",
        "支持 PDF、DOCX、PPTX、XLSX、CSV、TXT、Markdown、JSON、PNG、JPG 和 WebP，一次最多 6 个。",
        "文字先在本机提取；扫描 PDF、图片和 Office 内图片需要 Gemini 才能识别。",
      ],
      example: "请总结我上传的表格，并找出金额最高的三项，注明对应行。",
      promptFact: "聊天和 Agent 支持 PDF、DOCX、PPTX、XLSX、CSV、TXT、Markdown、JSON、PNG、JPG、WebP 附件，一次最多 6 个；长文档会依据问题选择相关片段，扫描 PDF、文档内图片、普通图片和桌面截图仅 Gemini 能识别，其他模型不得猜测画面。",
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
      id: "wecom",
      icon: "企",
      group: "资料与工作",
      title: "连接企业微信",
      summary: "扫码搜索和读取有权访问的企微文档，并在逐次确认后创建、追加或覆盖；也可用 API 模式机器人直接聊天。",
      steps: [
        "打开工作台的“外部连接”，在企业微信连接中扫码授权文档账号。",
        "搜索文档时先选择明确候选；Agent 的搜索和读取可自动，创建、追加和覆盖每次确认。",
        "要在企业微信中聊天，创建 API 模式智能机器人并把 Bot ID 与 Secret 保存到 Kardii。",
      ],
      example: "搜索企业微信里关于项目周报的文档，列出候选让我选择后再读取。",
      promptFact: "Kardii 的企业微信连接使用官方 wecom-cli v1.1.0：扫码账号只能搜索当前用户有权访问的文档，可读取和修改 doc / smartpage；搜索多候选必须由用户选择，写入前重新读取最新内容，创建/追加/覆盖每次确认，发布态 b1_ 智能文档只读。大圆或同事创建且分享给当前账号的文档可被搜索，但 Kardii 不能读取大圆的私有记忆或无权访问的文档。API 模式智能机器人可把企微文字与已转写语音交给当前 Kardii AI，并按 Bot、单聊与群聊隔离本机会话；机器人保留 Kardii 性格但不带入桌面私人长期记忆或自定义指令，历史可在工作台清空。远程聊天不能执行 Agent 或外部写入，需回到桌面确认。Bot Secret 保存在系统凭据库。",
    },
    {
      id: "enterprise-analysis",
      icon: "✦",
      group: "资料与工作",
      title: "企业资料联合分析",
      summary: "按项目、关系和时间范围汇总多类资料，生成带来源的进展、承诺、风险、下一步与今日简报。",
      steps: [
        "打开工作台的“联合分析”，选择项目、关系、时间范围和资料来源。",
        "点击生成后核对每条事实旁的 [S1] 来源编号，并修改模型推断或缺失项。",
        "确认后保存分析；需要时把下一步转成今日待办，或开启只在 Kardii 运行时生效的每日提醒。",
      ],
      example: "请根据最近 30 天的邮件、日历、项目和知识库，整理已确认承诺、风险与今天要推进的三件事。",
      promptFact: "工作台联合分析可选项目、关系、最近 7/30/90 天或全部时间，并组合项目/关系/待办/活动、邮件摘要、Google/Microsoft 云端概览、知识库/网站以及当前聊天。输出进展、承诺、风险、下一步和今日简报，事实要求保留 [S] 来源编号，推断须明确标记；结果先人工编辑再保存，可生成本机待办。每日提醒仅在 Kardii 运行或下次打开时建立待办，不会在后台上传或发送资料。",
    },
    {
      id: "website-knowledge",
      icon: "◎",
      group: "资料与工作",
      title: "整站与多网页知识库",
      summary: "从一个公开网址预览同域页面，确认后保存为可更新、可引用的网站知识集合。",
      steps: [
        "打开工作台知识库，点击“导入网站”，填写公开起始网址。",
        "选择最多 5/10/20 页和 0–2 层深度，确认有权读取后先预览结果。",
        "检查页面标题、网址、字数与告警，再确认保存；以后可重新抓取或删除整个集合。",
      ],
      example: "把这个公开帮助中心的相关页面导入知识库，然后回答各套餐有什么区别并标注来源。",
      promptFact: "Kardii 可抓取用户明确授权的公开 HTTP(S) 网站，同一集合最多 20 页、链接深度最多 2 层；只跟随同域链接，校验公开 IP 和重定向，拒绝 localhost、内网、登录态、跨域和非网页内容，并遵守 robots.txt 的基础规则。抓取不使用 Cookie、不执行 JavaScript、不填表单且不在后台持续运行；页面先预览再保存，保存后参与知识库检索和 [K] 来源问答。",
    },
    {
      id: "browser",
      icon: "◎",
      group: "资料与工作",
      title: "连接 Chrome / Edge 当前网页",
      summary: "由你发送当前页；Agent 可提出点击、填写、选择、滚动、导航或下载，并由你逐步执行。",
      steps: [
        "打开工作台的“外部连接”，启动浏览器连接并打开扩展文件夹。",
        "在 Chrome / Edge 扩展页加载文件夹，用 6 位配对码连接。",
        "在目标网页点击扩展并发送；Agent 操作每次先在 Kardii 确认，再回扩展核对并执行。",
      ],
      example: "请总结我刚刚从浏览器扩展发送的网页，并列出三条需要核实的信息。",
      promptFact: "Kardii Browser Connector 只在用户主动点击时读取 Chrome / Edge 当前页，可交给聊天、Agent 或知识库；Agent 可提出点击、填写普通输入、选择、滚动、导航与非可执行文件下载，但每一步都需在 Kardii 确认并在扩展中再次点击执行。它不持续监控，不读取 Cookie、密码、输入框现有内容或其他标签页；付款、购买、下单、资金转移、密码、验证码与支付卡填写始终禁用。",
    },
    {
      id: "mcp",
      icon: "⌘",
      group: "资料与工作",
      title: "连接 MCP 工具服务器",
      summary: "连接 Streamable HTTP MCP 服务器；只读工具可由 Agent 使用，写入与删除逐次确认。",
      steps: [
        "在工作台“外部连接”添加 MCP 服务器地址和可选 Token。",
        "先测试连接并核对服务器返回的工具清单。",
        "可在连接中心手动调用，也可让 Agent 使用；只读可自动，写入与删除每次确认。",
      ],
      example: "请告诉我当前保存了几个 MCP 连接，以及调用第三方工具时有哪些安全限制。",
      promptFact: "Kardii 支持连接使用初始化会话的 Streamable HTTP MCP 服务器（2025-03-26 至 2025-11-25）并读取工具清单；远程地址必须使用 HTTPS，本机 HTTP 仅允许回环地址，Bearer Token 保存在系统凭据库。服务器明确标注只读的工具可由 Agent 自动调用，未知、写入和删除工具逐次确认；付款、购买、下单和资金转移类工具直接禁用，密码、Token、验证码和支付卡字段不发送给 MCP。",
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
      id: "local-storage",
      icon: "▣",
      group: "设置与数据",
      title: "SQLite 本机数据与恢复",
      summary: "聊天、记忆、工作台和 Agent 数据会写入本机 SQLite，并保留有限恢复点。",
      steps: [
        "首次升级会把旧版 WebView 数据自动迁移到 SQLite，不需要重新设置。",
        "打开齿轮中的“本机数据”，可以检查完整性或立即建立恢复点。",
        "需要回退时选择“恢复最近一次”；恢复前还会自动保留当前状态。",
      ],
      example: "请告诉我 Kardii 当前的 SQLite 数据库是否正常，以及有几个本机恢复点。",
      promptFact: "Kardii v1.8 使用本机 SQLite 作为聊天、设置、记忆、工作台、Agent、技能和自动化的耐久数据层，同时保留 WebView 缓存以兼容旧版。首次运行自动迁移旧数据；每天首次启动最多自动建立一次恢复点并只保留最近 5 个，也可手动建立或恢复。API Key、邮箱密码和登录令牌不会写入 SQLite。",
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
    "新增企业微信连接：扫码读取有权限的文档，逐次确认创建或修改，并通过 API 模式智能机器人直接聊天。",
    "新增最多 3 个隔离 Agent 并行执行：每个任务保留自己的计划、上下文、工具记录与来源会话，超出的任务自动排队。",
    "新增托盘后台自动化执行端：Rust 定时唤醒，只读步骤可在窗口隐藏时继续；授权、回答、完成和失败会由桌宠提醒。",
    "新增 SQLite 本机数据层：旧数据自动迁移，聊天、记忆、工作台、Agent、技能和自动化拥有修订保护与最多 5 个恢复点。",
    "新增企业资料联合分析：跨工作台、邮件、云端、知识库、网站和当前聊天生成带 [S] 来源的简报与待办。",
    "知识库新增公开网站导入：最多 20 个同域页面、2 层链接深度，先预览后保存并支持整组更新或删除。",
    "新增最多 30 个独立聊天会话，自动生成标题，并隔离聊天历史、草稿和 Codex 线程。",
    "同一会话再次交给 Agent 时会回到原任务继续，普通聊天也能读取该任务的当前状态和结果。",
    "普通聊天支持 PDF、Word、PPT、表格、文本与图片，长文档按问题挑选相关片段。",
    "工作台增加多邮箱与 Google / Microsoft 只读连接。",
    "新增可搜索帮助、一键自检、快捷入口和逐步高亮引导。",
    "扫描 PDF、普通图片与 Office 文档内图片可在用户主动上传后交给 Gemini 识别。",
    "Chrome / Edge 当前网页支持受控点击、填写、选择、滚动、导航与下载，并在扩展中二次确认。",
    "MCP 只读工具可交给 Agent，写入与删除逐次确认，付款和资金操作始终禁用。",
    "聊天窗口不再强制置顶，确认窗口统一为 Kardii 主题。",
  ];

  const LIMITATIONS = [
    "联合分析只使用本机已保存或已同步的摘要与正文片段，不会自动读取尚未同步的外部资料；日报提醒仅在 Kardii 运行或下次打开时建立待办，不是服务器后台任务。",
    "网站知识库只抓取用户确认有权读取的公开同域页面，最多 20 页和 2 层；不使用登录态、Cookie 或 JavaScript，不支持付费墙、复杂单页应用、跨域整合或后台持续爬取。",
    "邮箱、Google 与 Microsoft 连接保持只读；发送邮件、修改日历、写入云盘和表格仍不支持。",
    "最多并行执行 3 个 Agent 任务；更多任务会排队。并行任务仍共享当前 AI 服务的额度、速率限制和电脑资源。",
    "后台自动化依赖 Kardii 进程留在托盘；完全退出、电脑关机或休眠时不会执行，重新打开后每条到期自动化最多补建一次，不提供云端服务器执行。",
    "语音是录完后本机识别；实时连续对话、持续监听和唤醒词尚未加入。",
    "SQLite 已作为耐久数据层，WebView 本机存储仍保留为兼容缓存；网页端、iOS 与跨设备同步尚未加入。",
    "复杂文档版面、批注和逐元素还原仍有限；企业微信当前只对 doc 与 smartpage 提供正文读写，其他搜索结果需在企微客户端打开。",
    "企业微信中的 Kardii 只处理文字和已转写语音；为了保留桌面确认，远程聊天不会直接执行 Agent、创建或修改外部文档。",
    "MCP 服务器需要手动配置，没有第三方工具市场；付款、购买、下单、资金转移和敏感凭据填写是永久安全禁区，不列入自动化计划。",
  ];

  const TROUBLESHOOTING = [
    {
      id: "chat-context",
      title: "聊天串进了不相关的话题",
      symptom: "新事情引用旧聊天，或回到原任务时接不上 Agent 的进度。",
      keywords: "聊天 会话 上下文 串话 新对话 agent 继续 历史",
      steps: ["点击顶部会话图标。", "不相关的事情使用“新对话”；同一件事切回原来的会话。", "如果仍出现个人偏好，检查爱心中的全局长期记忆；关联 Agent 可点击带圆点的 ✦ 打开。"],
      action: "sessions",
      actionLabel: "查看聊天会话",
    },
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
      title: "文档无法上传或分析不完整",
      symptom: "PDF / DOCX / PPTX / XLSX / CSV 被拒绝，或回答漏掉后半部分。",
      keywords: "文档 pdf word docx pptx 表格 excel xlsx csv 上传 扫描 ocr 长文档 分析",
      steps: ["确认格式属于帮助中列出的附件类型。", "一次不要超过 6 个，单个文件不超过 20 MB。", "扫描件请切换 Gemini；长文档提问时写清要查的主题。"],
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
      id: "browser-pairing",
      title: "浏览器扩展连接不上 Kardii",
      symptom: "扩展提示连接不到 Kardii、配对码不正确或旧连接已失效。",
      keywords: "浏览器 chrome edge 扩展 当前网页 配对码 连接不上 失效",
      steps: ["打开工作台的外部连接并点击“启动连接”。", "确认扩展是从 Kardii 打开的文件夹加载，输入当前显示的 6 位配对码。", "如果撤销过旧连接，请在扩展中使用新配对码重新连接。"],
      action: "connections",
      actionLabel: "管理浏览器连接",
    },
    {
      id: "browser-stale-page",
      title: "Kardii 仍显示上一次网页",
      symptom: "切换标签页后，Kardii 没有自动换成新页面。",
      keywords: "浏览器 网页 旧页面 没更新 当前页 切换 标签页",
      steps: ["Kardii 不会持续监控浏览器，这是预期的隐私保护。", "切换到新网页后重新点击扩展。", "再次点击“发送当前网页给 Kardii”。"],
      action: "connections",
      actionLabel: "查看最近网页",
    },
    {
      id: "browser-action",
      title: "Agent 等待浏览器操作",
      symptom: "任务显示等待执行、页面目标失效，或操作超时。",
      keywords: "浏览器 agent 点击 填写 下拉 滚动 导航 下载 扩展 等待 超时 目标失效",
      steps: ["保持目标标签页处于当前窗口。", "打开 Kardii 浏览器扩展，核对页面和动作，再点“检查后执行”。", "页面跳转或目标变化后重新发送当前网页。"],
      action: "connections",
      actionLabel: "查看浏览器连接",
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
    const browserStatus = status.browserPaired ? "浏览器已连接" : status.browserRunning ? "浏览器等待配对" : "浏览器未启动";
    const mcpConfigured = Number(status.mcpConfigured || 0);
    const mcpConnected = Number(status.mcpConnected || 0);
    const wecomStatus = status.wecomDocumentsAuthorized && status.wecomBotConnected
      ? "企微文档与聊天已连接"
      : status.wecomDocumentsAuthorized ? "企微文档已连接" : status.wecomBotConnected ? "企微聊天已连接" : "企微未连接";
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
        value: `${status.agentMode ? "下一条强制交给 Agent" : status.autoAgentHandoff ? "智能判断已开启" : "仅手动切换"} · ${Number(status.agentRunning || 0)}/3 运行${Number(status.agentQueued || 0) ? ` · ${Number(status.agentQueued)} 排队` : ""}`,
        tone: status.agentMode || status.autoAgentHandoff ? "success" : "neutral",
      },
      {
        id: "voice",
        label: "离线语音",
        value: voiceStatus(status.voiceModelState),
        tone: status.voiceModelState === "ready" ? "success" : "neutral",
      },
      {
        id: "storage",
        label: "本机数据",
        value: status.storageReady
          ? `SQLite 正常 · ${Number(status.storageItemCount || 0)} 项 · ${Number(status.storageSnapshotCount || 0)} 个恢复点`
          : status.storageIntegrity ? `SQLite 需要检查 · ${status.storageIntegrity}` : "SQLite 尚未检测",
        tone: status.storageReady ? "success" : status.storageIntegrity ? "warning" : "neutral",
      },
      {
        id: "connections",
        label: "外部连接",
        value: `${browserStatus} · ${wecomStatus} · ${connectionStatus(emailConfigured, emailConnected, "邮箱")} · ${connectionStatus(cloudConfigured, cloudConnected, "云端")} · ${connectionStatus(mcpConfigured, mcpConnected, "MCP")}`,
        tone: status.browserPaired || status.wecomDocumentsAuthorized || status.wecomBotConnected || (emailConnected || 0) + (cloudConnected || 0) + mcpConnected > 0 ? "success" : "neutral",
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
    const mcpConfigured = Number(status.mcpConfigured || 0);
    const mcpConnected = Number(status.mcpConnected || 0);
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
        id: "wecom",
        title: "企业微信连接",
        detail: status.wecomDocumentsAuthorized && status.wecomBotConnected
          ? "文档与机器人聊天均已连接"
          : status.wecomDocumentsAuthorized ? "文档已授权，机器人聊天未连接" : status.wecomBotConnected ? "机器人聊天已连接，文档未授权" : "文档与机器人均未连接",
        tone: status.wecomDocumentsAuthorized || status.wecomBotConnected ? "success" : "neutral",
        action: "connections",
        actionLabel: status.wecomDocumentsAuthorized || status.wecomBotConnected ? "管理" : "去连接",
      },
      {
        id: "browser",
        title: "Chrome / Edge 当前网页",
        detail: status.browserPaired
          ? `扩展已连接${status.browserCaptureTitle ? ` · 最近：${status.browserCaptureTitle}` : ""}`
          : status.browserRunning ? "本机连接已启动，等待扩展配对" : "尚未启动浏览器连接",
        tone: status.browserPaired ? "success" : status.browserRunning ? "warning" : "neutral",
        action: "connections",
        actionLabel: status.browserPaired ? "查看" : "去连接",
      },
      {
        id: "mcp",
        title: "MCP 工具服务器",
        detail: connectionStatus(mcpConfigured, mcpConnected, "MCP"),
        tone: mcpConnected > 0 ? "success" : mcpConfigured > 0 ? "warning" : "neutral",
        action: "connections",
        actionLabel: mcpConfigured ? "管理" : "去连接",
      },
      {
        id: "agent",
        title: "聊天与 Agent 衔接",
        detail: `${status.autoAgentHandoff ? "智能判断已开启" : "当前只会手动切换"} · ${Number(status.agentRunning || 0)}/3 运行${Number(status.agentQueued || 0) ? ` · ${Number(status.agentQueued)} 排队` : ""}`,
        tone: status.autoAgentHandoff ? "success" : "neutral",
        action: "agent-settings",
        actionLabel: "设置",
      },
      {
        id: "storage",
        title: "SQLite 本机数据",
        detail: status.storageReady
          ? `${Number(status.storageItemCount || 0)} 项数据 · ${Number(status.storageSnapshotCount || 0)} 个恢复点`
          : status.storageIntegrity ? `完整性结果：${status.storageIntegrity}` : "尚未检测",
        tone: status.storageReady ? "success" : status.storageIntegrity ? "warning" : "neutral",
        action: "settings",
        actionLabel: "查看",
      },
    ];
  }

  function knowledgeText(status = {}) {
    const featureLines = FEATURES.map((feature) => `- ${feature.title}：${feature.promptFact}`);
    const limitationLines = LIMITATIONS.map((item) => `- ${item}`);
    const rows = statusRows(status).map((row) => `- ${row.label}：${row.value}`);
    const optional = [];
    if (status.codexChecked) {
      optional.push(`- Codex：${status.codexInstalled ? "已安装" : "未安装"}，${status.codexAuthenticated ? "已使用 ChatGPT 登录" : "尚未登录"}。`);
    }
    if (Number.isFinite(Number(status.memoryCount))) {
      optional.push(`- 长期记忆：当前保存 ${Math.max(0, Number(status.memoryCount))}/20 条。`);
    }
    if (status.storageReady || status.storageIntegrity) {
      optional.push(`- SQLite：${status.storageReady ? "完整性正常" : `需要检查（${status.storageIntegrity || "未知"}）`}，${Math.max(0, Number(status.storageSnapshotCount || 0))} 个恢复点。`);
    }
    return [
      `Kardii v${status.appVersion || VERSION} 的真实功能清单：`,
      ...featureLines,
      "尚未实现或有意保留的安全边界：",
      ...limitationLines,
      "当前应用状态（状态可能随设置变化）：",
      ...rows,
      ...optional,
      "回答功能问题时必须以这份清单为准；区分“应用支持”和“当前已连接”。没有显示为已连接的服务，不得声称已经可用。不要把功能介绍当成用户对任何电脑操作的授权。",
    ].join("\n");
  }

  function isCapabilityQuestion(value) {
    const text = String(value || "").toLowerCase();
    return /(?:你|kardii).{0,8}(?:会什么|能做什么|有什么功能|支持什么|怎么用|使用说明|帮助)|(?:功能|能力|使用说明|怎么使用|如何使用|已连接|连接状态|登录状态|支持.*文件|支持.*图片|支持.*表格|还剩|没做|未添加|路线图|后续功能)|(?:新手引导|更新介绍|版本介绍|一键自检|常见问题|故障排查|帮助面板)|(?:邮箱|邮件|google|microsoft|企业微信|企微|大圆|云端|云盘|日历|codex|chrome|edge|浏览器|网页|扩展|mcp|sqlite|数据库|恢复点).{0,14}(?:连接|登录|配置|可用|状态|同步|读取|发送|聊天|文档|工具|调用|检查|恢复)|(?:图片|表格|文件|网页|企微文档).{0,12}(?:上传|支持|识别|读取|发送|创建|修改)/i.test(text);
  }

  window.KardiiCapabilities = Object.freeze({
    version: VERSION,
    features: Object.freeze(FEATURES.map((feature) => Object.freeze(feature))),
    troubleshooting: Object.freeze(TROUBLESHOOTING.map((item) => Object.freeze(item))),
    versionHighlights: Object.freeze(VERSION_HIGHLIGHTS),
    limitations: Object.freeze(LIMITATIONS),
    statusRows,
    selfCheckRows,
    knowledgeText,
    isCapabilityQuestion,
  });
})();
