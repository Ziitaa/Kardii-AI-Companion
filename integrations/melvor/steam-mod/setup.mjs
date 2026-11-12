// Steam Melvor Idle 1: opt-in, read-only in-game bridge.
// Exposes a snapshot to the mod API. No network, writes, or automation.
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
export function setup(ctx) {
  let ready = false;
  ctx.onInterfaceReady(() => { ready = true; });
  ctx.api({
    getStatus: () => ({ ready, mode: "read-only", transport: "in-game-mod-api" }),
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
