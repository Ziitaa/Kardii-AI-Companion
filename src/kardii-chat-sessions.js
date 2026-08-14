(() => {
  const VERSION = 1;
  const MAX_SESSIONS = 30;
  const MAX_MESSAGES = 50;
  const DEFAULT_TITLE = "新对话";

  function nowIso() {
    return new Date().toISOString();
  }

  function newId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function cleanMessage(value) {
    const role = value?.role === "assistant" ? "assistant" : value?.role === "user" ? "user" : "";
    const content = typeof value?.content === "string" ? value.content.trim().slice(0, 100_000) : "";
    if (!role || !content) return null;
    const message = { role, content };
    if (typeof value?.displayContent === "string" && value.displayContent.trim()) {
      message.displayContent = value.displayContent.trim().slice(0, 20_000);
    }
    return message;
  }

  function summarizeTitle(value) {
    let text = String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^(?:好的?|可以|行|ok(?:ay)?)[，,。！! ]*/i, "")
      .replace(/^那(?:你)?(?:就)?[，,。！! ]*/, "")
      .replace(/^(?:我想(?:让你|请你)?|我需要你?|需要你?|想请你|麻烦你|请你?|你来|帮我|替我)[，,。！! ]*/i, "")
      .replace(/^(?:能不能|可不可以|可以)(?:帮我)?/, "")
      .split(/(?:\n|[。；;！!?？]|然后|另外|以及|还有)/)[0]
      .trim()
      .replace(/^[：:，,。；;\-— ]+|[：:，,。；;\-— ]+$/g, "");
    if (!text) return DEFAULT_TITLE;
    const chars = [...text];
    return chars.length > 24 ? `${chars.slice(0, 24).join("")}…` : text;
  }

  function normalizeSession(value = {}) {
    const createdAt = String(value.createdAt || nowIso());
    const messages = (Array.isArray(value.messages) ? value.messages : [])
      .map(cleanMessage)
      .filter(Boolean)
      .slice(-MAX_MESSAGES);
    const firstUser = messages.find((message) => message.role === "user");
    const requestedTitle = String(value.title || "").trim().slice(0, 60);
    const title = requestedTitle && requestedTitle !== DEFAULT_TITLE
      ? requestedTitle
      : summarizeTitle(firstUser?.displayContent || firstUser?.content || requestedTitle);
    const linkedAgentTaskId = String(value.linkedAgentTaskId || "").slice(0, 100);
    const agentTaskIds = [...new Set([
      linkedAgentTaskId,
      ...(Array.isArray(value.agentTaskIds) ? value.agentTaskIds : []),
    ].map((item) => String(item || "").slice(0, 100)).filter(Boolean))].slice(-20);
    return {
      id: String(value.id || newId()).slice(0, 100),
      title,
      messages,
      draft: String(value.draft || "").slice(0, 4_000),
      linkedAgentTaskId,
      agentTaskIds,
      createdAt,
      updatedAt: String(value.updatedAt || createdAt),
    };
  }

  function createSession(value = {}) {
    return normalizeSession({
      id: newId(),
      title: DEFAULT_TITLE,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...value,
    });
  }

  function normalizeStore(value, legacyMessages = []) {
    let sessions = (Array.isArray(value?.sessions) ? value.sessions : [])
      .map(normalizeSession)
      .filter((session, index, all) => all.findIndex((item) => item.id === session.id) === index)
      .slice(0, MAX_SESSIONS);
    if (!sessions.length) {
      sessions = [createSession({ messages: Array.isArray(legacyMessages) ? legacyMessages : [] })];
    }
    const requestedActiveId = String(value?.activeSessionId || "");
    const activeSessionId = sessions.some((session) => session.id === requestedActiveId)
      ? requestedActiveId
      : sessions[0].id;
    return { version: VERSION, activeSessionId, sessions };
  }

  window.KardiiChatSessions = Object.freeze({
    version: VERSION,
    maxSessions: MAX_SESSIONS,
    maxMessages: MAX_MESSAGES,
    defaultTitle: DEFAULT_TITLE,
    summarizeTitle,
    createSession,
    normalizeSession,
    normalizeStore,
  });
})();
