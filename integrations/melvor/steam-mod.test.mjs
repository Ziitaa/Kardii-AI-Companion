import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshot, setup } from "./steam-mod/setup.mjs";

test("incomplete game state is never fabricated", () => {
  assert.equal(createSnapshot(null), null);
  const snapshot = createSnapshot({ skills: { getObjectByID: () => undefined } });
  assert.equal(snapshot.gp, null);
  assert.equal(snapshot.skills.Fishing, null);
  assert.equal(snapshot.bank.capacity, null);
  assert.equal(snapshot.source, "read-only-mod");
});

test("valid mocked fields are captured without changing game state", () => {
  const game = {
    gp: { amount: 42 },
    bank: { items: [1, 2], maximumSlots: 20 },
    skills: { getObjectByID: (id) => ({ level: id === "melvorD:Fishing" ? 9 : 1 }) }
  };
  const before = JSON.stringify(game);
  const snapshot = createSnapshot(game);
  assert.equal(snapshot.gp, 42);
  assert.equal(snapshot.skills.Fishing, 9);
  assert.deepEqual(snapshot.bank, { used: 2, capacity: 20 });
  assert.equal(JSON.stringify(game), before);
});

test("mod does not expose commands and waits for interface readiness", () => {
  let readyCallback, api;
  setup({
    onInterfaceReady: (fn) => { readyCallback = fn; },
    api: (value) => { api = value; }
  });
  assert.deepEqual(api.getStatus(), { ready: false, mode: "read-only", transport: "in-game-mod-api" });
  assert.equal(api.getSnapshot(), null);
  assert.deepEqual(api.getDiagnostics(), { ready: false, missing: ["character-not-ready"] });
  assert.deepEqual(Object.keys(api).sort(), ["getDiagnostics", "getSnapshot", "getStatus"]);
  readyCallback();
  assert.equal(api.getStatus().ready, true);
  assert.deepEqual(api.getDiagnostics(), { ready: true, missing: ["game"] });
});

test("diagnostics report missing runtime fields without guessing", () => {
  const oldGame = globalThis.game;
  let callback, api;
  try {
    globalThis.game = { skills: { getObjectByID: () => undefined } };
    setup({ onInterfaceReady: fn => { callback = fn; }, api: endpoints => { api = endpoints; } });
    callback();
    assert.deepEqual(api.getDiagnostics().missing, [
      "gp", "bank.used", "bank.capacity",
      "skills.Fishing", "skills.Cooking", "skills.Mining", "skills.Smithing"
    ]);
  } finally {
    if (oldGame === undefined) delete globalThis.game;
    else globalThis.game = oldGame;
  }
});
