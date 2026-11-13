// Steam Melvor Idle 1: opt-in, read-only in-game bridge.
// Exposes a read-only snapshot; network sending requires explicit opt-in.
const safeInt = (n) => Number.isSafeInteger(n) && n >= 0 ? n : null;
const safeLevel = (n) => Number.isSafeInteger(n) && n >= 1 && n <= 120 ? n : null;
const skillLevel = (game, name) => {
  const skill = game?.skills?.getObjectByID?.("melvorD:" + name) ?? game?.[name.toLowerCase()];
  return safeLevel(skill?.level);
};
export function createSnapshot(game) {
  if (!game || !game.skills) return null;
  const names = ["Fishing", "Cooking", "Mining", "Smithing"];
  const skills = Object.fromEntries(names.map(name => [name, skillLevel(game, name)]));
  const gp = safeInt(game.gp?.amount);
  // Unknown values are null, never invented. Desktop adapter must reject incomplete snapshots.
  return {
    schemaVersion: "melvor.snapshot.v0", game: "melvor-idle-1",
    source: "read-only-mod", capturedAt: new Date().toISOString(),
    gp, skills,
    bank: { used: safeInt(game.bank?.items?.length ?? game.bank?.items?.size), capacity: safeInt(game.bank?.maximumSlots) },
    currentAction: { skill: null, actionId: null },
    combat: { hp: null, maxHp: null, foodEquipped: null }
  };
}
// Explicit opt-in. Disabled by default; never sends credentials or save files.
// This is an experimental Steam WebView transport: localhost CORS must be verified.
export async function sendSnapshot({ game, url, token, fetchImpl = globalThis.fetch }) {
  if (typeof url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+\/v1\/snapshot$/.test(url)) {
    throw new Error("Only the local Kardii snapshot endpoint is allowed");
  }
  if (typeof token !== "string" || token.length < 32) throw new Error("Missing session token");
  if (typeof fetchImpl !== "function") throw new Error("Network transport unavailable");
  if (!Number.isInteger(new URL(url).port * 1) || Number(new URL(url).port) < 1 || Number(new URL(url).port) > 65535) {
    throw new Error("Invalid local receiver port");
  }
  const snapshot = createSnapshot(game);
  if (!snapshot) throw new Error("Character not ready");
  const missing = [];
  if (snapshot.gp === null) missing.push("gp");
  if (snapshot.bank.used === null) missing.push("bank.used");
  if (snapshot.bank.capacity === null) missing.push("bank.capacity");
  for (const [name, value] of Object.entries(snapshot.skills)) {
    if (value === null) missing.push("skills." + name);
  }
  if (missing.length) throw new Error("Incomplete character snapshot: " + missing.join(", "));
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kardii-token": token },
    body: JSON.stringify(snapshot),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Kardii receiver rejected snapshot: " + response.status);
  return response.json();
}

export function setup(ctx) {
  let ready = false;
  ctx.onInterfaceReady(() => { ready = true; });
  ctx.api({
    getStatus: () => ({ ready, mode: "read-only", transport: "in-game-mod-api" }),
    sendOnce: (url, token) => ready
      ? sendSnapshot({ game: globalThis.game, url, token })
      : Promise.reject(new Error("Character not ready")),
    getSnapshot: () => ready ? createSnapshot(globalThis.game) : null,
    getDiagnostics: () => {
      if (!ready) return { ready: false, missing: ["character-not-ready"] };
      const snapshot = createSnapshot(globalThis.game);
      if (!snapshot) return { ready: true, missing: ["game"] };
      const missing = [];
      if (snapshot.gp === null) missing.push("gp");
      if (snapshot.bank.used === null) missing.push("bank.used");
      if (snapshot.bank.capacity === null) missing.push("bank.capacity");
      for (const [name, level] of Object.entries(snapshot.skills)) {
        if (level === null) missing.push("skills." + name);
      }
      return { ready: true, missing };
    }
  });
}
