(() => {
  const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{6}$/;
  const ACTIVE_STATUSES = new Set([
    "draft", "queued", "planning", "running", "waiting_input",
    "waiting_authorization", "waiting_permission", "paused",
  ]);

  function cleanCode(value) {
    const code = String(value || "").trim().toUpperCase();
    return CODE_PATTERN.test(code) ? code : "";
  }

  function createCode(cryptoSource = globalThis.crypto) {
    if (!cryptoSource?.getRandomValues) throw new Error("当前系统无法生成安全绑定码。");
    const bytes = new Uint8Array(6);
    cryptoSource.getRandomValues(bytes);
    return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
  }

  function parseCommand(value) {
    const text = String(value || "").trim().replace(/^／/, "/");
    if (!text.startsWith("/")) return null;
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { type: "invalid", error: "命令格式无法识别，请发送 /帮助 查看用法。" };
    const name = match[1].toLowerCase();
    const argument = String(match[2] || "").trim();
    const aliases = {
      "帮助": "help", help: "help",
      "状态": "status", status: "status",
      "绑定": "bind", bind: "bind",
      "任务": "task", agent: "task", task: "task",
      "确认": "confirm", confirm: "confirm",
      "回答": "answer", answer: "answer",
      "结果": "result", result: "result",
      "取消": "cancel", cancel: "cancel",
    };
    const type = aliases[name];
    if (!type) return { type: "invalid", error: "未知命令，请发送 /帮助 查看可用命令。" };
    if (["help", "status"].includes(type)) return argument
      ? { type: "invalid", error: `/${name} 后面不需要其他内容。` }
      : { type };
    if (type === "task") {
      const goal = argument.slice(0, 2_000).trim();
      return goal
        ? { type, goal }
        : { type: "invalid", error: "请在 /任务 后写清楚要完成的事情。" };
    }
    if (type === "answer") {
      const answerMatch = argument.match(/^([^\s]+)\s+([\s\S]+)$/);
      const code = cleanCode(answerMatch?.[1]);
      const answer = String(answerMatch?.[2] || "").trim().slice(0, 4_000);
      return code && answer
        ? { type, code, answer }
        : { type: "invalid", error: "请使用：/回答 任务码 你的补充内容" };
    }
    if (type === "cancel" && !argument) return { type, code: "" };
    const code = cleanCode(argument);
    return code
      ? { type, code }
      : { type: "invalid", error: `请在 /${name} 后输入 6 位有效验证码。` };
  }

  function normalizeSettings(value = {}) {
    return {
      enabled: value.wecomRemoteAgentEnabled === true,
      ownerUserId: String(value.wecomRemoteOwnerUserId || "").trim().slice(0, 256),
      allowKnowledge: value.wecomRemoteAllowKnowledge === true,
      allowWecomDocuments: value.wecomRemoteAllowDocuments === true,
      pairingCode: cleanCode(value.wecomRemotePairingCode),
      pairingExpiresAt: Math.max(0, Number(value.wecomRemotePairingExpiresAt) || 0),
    };
  }

  function normalizeSource(value = {}) {
    const ai = value.ai && typeof value.ai === "object" ? value.ai : {};
    return {
      requestId: String(value.requestId || "").slice(0, 100),
      conversationKey: String(value.conversationKey || "").slice(0, 300),
      fromUserId: String(value.fromUserId || "").slice(0, 256),
      taskCode: cleanCode(value.taskCode),
      allowKnowledge: value.allowKnowledge === true,
      allowWecomDocuments: value.allowWecomDocuments === true,
      ai: {
        provider: ["deepseek", "gemini", "ollama", "codex"].includes(ai.provider) ? ai.provider : "deepseek",
        model: String(ai.model || "").slice(0, 120),
        ollamaBaseUrl: String(ai.ollamaBaseUrl || "http://127.0.0.1:11434").slice(0, 200),
      },
    };
  }

  function actionViolation(sourceValue, action = {}) {
    const source = normalizeSource(sourceValue);
    const tool = String(action.tool || "");
    if (["finish", "ask_user", "web_search"].includes(tool)) return "";
    if (tool === "knowledge_search") {
      return source.allowKnowledge ? "" : "这个远程任务没有获得读取 Kardii 知识库的桌面授权。";
    }
    if (tool === "wecom_document") {
      const mode = String(action.arguments?.action || "").toLowerCase();
      if (!source.allowWecomDocuments) return "这个远程任务没有获得读取企业微信文档的桌面授权。";
      if (["search", "read"].includes(mode)) return "";
      return "企微远程任务不允许创建、追加、覆盖或删除文档。";
    }
    return {
      memory_search: "企微远程任务不能读取桌面私人长期记忆。",
      browser_read: "企微远程任务不能读取或控制桌面浏览器。",
      browser_action: "企微远程任务不能读取或控制桌面浏览器。",
      mcp_call: "企微远程任务首版不调用第三方 MCP 工具。",
      read_file: "企微远程任务首版不读取未在桌面明确选择的本机文件。",
      read_clipboard: "企微远程任务不能读取桌面剪贴板。",
      write_clipboard: "企微远程任务不能写入桌面剪贴板。",
      open_url: "企微远程任务不能在桌面打开网页。",
      run_terminal: "企微远程任务不能运行终端命令。",
    }[tool] || "这个动作不在企微远程任务的安全白名单中。";
  }

  function isActiveStatus(status) {
    return ACTIVE_STATUSES.has(String(status || ""));
  }

  window.KardiiWecomRemote = Object.freeze({
    cleanCode,
    createCode,
    parseCommand,
    normalizeSettings,
    normalizeSource,
    actionViolation,
    isActiveStatus,
  });
})();
