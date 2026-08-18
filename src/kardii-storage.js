(() => {
  const mainScript = document.currentScript?.dataset?.main || "";
  const tauri = window.__TAURI__;
  const invoke = tauri?.core?.invoke;
  const emitTo = tauri?.event?.emitTo;
  const listen = tauri?.event?.listen;
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  const nativeClear = Storage.prototype.clear;
  const EPHEMERAL_KEYS = new Set([
    "kardii-workbench-open-target-v1",
    "kardii-agent-open-target-v1",
    "kardii-chat-open-target-v1",
    "kardii-browser-context-v1",
    "kardii-browser-agent-request-v1",
    "kardii-browser-capture-seen-v1",
    "kardii-wecom-remote-pairing-v1",
    "kardii-wecom-remote-pending-v1",
  ]);
  const BLOCKED_KEY_PARTS = ["password", "api-key", "apikey", "credential", "bearer-token", "oauth-token"];

  let databaseActive = false;
  let applyingDatabaseState = false;
  let cachedStatus = null;
  let lastError = "";
  let writeQueue = Promise.resolve();

  function isPersistentKey(value) {
    const key = String(value || "");
    const lower = key.toLowerCase();
    return key.startsWith("kardii-")
      && key.length <= 160
      && !EPHEMERAL_KEYS.has(key)
      && !BLOCKED_KEY_PARTS.some((part) => lower.includes(part));
  }

  function localPersistentKeys() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isPersistentKey(key)) keys.push(key);
    }
    return keys;
  }

  function readLegacyEntries() {
    return localPersistentKeys().map((key) => ({
      key,
      value: localStorage.getItem(key) || "",
    }));
  }

  function applyEntries(entries) {
    applyingDatabaseState = true;
    try {
      for (const key of localPersistentKeys()) {
        Reflect.apply(nativeRemoveItem, localStorage, [key]);
      }
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (!isPersistentKey(entry?.key)) continue;
        Reflect.apply(nativeSetItem, localStorage, [String(entry.key), String(entry.value ?? "")]);
      }
    } finally {
      applyingDatabaseState = false;
    }
  }

  function enqueue(command, args) {
    if (!databaseActive || !invoke) return writeQueue;
    writeQueue = writeQueue
      .then(() => invoke(command, args))
      .catch((error) => {
        lastError = String(error);
        console.error("Kardii SQLite mirror failed:", error);
      });
    return writeQueue;
  }

  Storage.prototype.setItem = function setItem(key, value) {
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    const result = Reflect.apply(nativeSetItem, this, [normalizedKey, normalizedValue]);
    if (this === localStorage && !applyingDatabaseState && isPersistentKey(normalizedKey)) {
      void enqueue("storage_set", { key: normalizedKey, value: normalizedValue });
    }
    return result;
  };

  Storage.prototype.removeItem = function removeItem(key) {
    const normalizedKey = String(key);
    const result = Reflect.apply(nativeRemoveItem, this, [normalizedKey]);
    if (this === localStorage && !applyingDatabaseState && isPersistentKey(normalizedKey)) {
      void enqueue("storage_remove", { key: normalizedKey });
    }
    return result;
  };

  Storage.prototype.clear = function clear() {
    const mirrorsKardii = this === localStorage && localPersistentKeys().length > 0;
    const result = Reflect.apply(nativeClear, this, []);
    if (mirrorsKardii && !applyingDatabaseState) void enqueue("storage_clear", {});
    return result;
  };

  async function bootstrap() {
    if (!invoke) {
      lastError = "当前不是 Kardii 桌面运行环境，继续使用 WebView 本机存储。";
      return null;
    }
    try {
      const result = await invoke("storage_bootstrap", { legacyEntries: readLegacyEntries() });
      applyEntries(result?.entries);
      cachedStatus = result?.status || null;
      databaseActive = cachedStatus?.ready === true;
      window.dispatchEvent(new CustomEvent("kardii-storage-ready", { detail: cachedStatus }));
      return cachedStatus;
    } catch (error) {
      lastError = String(error);
      databaseActive = false;
      console.error("Kardii SQLite bootstrap failed; keeping the WebView cache:", error);
      window.dispatchEvent(new CustomEvent("kardii-storage-error", { detail: lastError }));
      return null;
    }
  }

  const ready = bootstrap();

  if (mainScript) {
    void ready.finally(() => {
      const script = document.createElement("script");
      script.src = mainScript;
      document.body.append(script);
    });
  }

  async function status() {
    await ready;
    if (!invoke || !databaseActive) {
      throw new Error(lastError || "SQLite 本机数据层尚未准备好。");
    }
    await writeQueue;
    cachedStatus = await invoke("storage_status");
    return cachedStatus;
  }

  async function createSnapshot() {
    await ready;
    if (!invoke || !databaseActive) throw new Error(lastError || "SQLite 本机数据层尚未准备好。");
    await writeQueue;
    cachedStatus = await invoke("storage_create_snapshot");
    return cachedStatus;
  }

  async function restoreSnapshot(snapshotId) {
    await ready;
    if (!invoke || !databaseActive) throw new Error(lastError || "SQLite 本机数据层尚未准备好。");
    await writeQueue;
    const result = await invoke("storage_restore_snapshot", { snapshotId });
    applyEntries(result?.entries);
    cachedStatus = result?.status || null;
    return result;
  }

  async function flush() {
    await ready;
    await writeQueue;
  }

  async function reloadAllWindows() {
    if (!emitTo) {
      window.location.reload();
      return;
    }
    await Promise.all(["main", "chat", "workbench", "agent"].map((label) => (
      emitTo(label, "kardii-storage-restored", {}).catch(() => {})
    )));
  }

  if (listen) {
    void listen("kardii-storage-restored", () => {
      window.location.reload();
    });
  }

  window.KardiiStorage = Object.freeze({
    ready,
    isPersistentKey,
    applyEntries,
    status,
    createSnapshot,
    restoreSnapshot,
    flush,
    reloadAllWindows,
    get active() { return databaseActive; },
    get cachedStatus() { return cachedStatus; },
    get lastError() { return lastError; },
  });
})();
