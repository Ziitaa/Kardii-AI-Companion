import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshot, setup, sendSnapshot } from "./steam-mod/setup.mjs";

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
  assert.deepEqual(Object.keys(api).sort(), ["getDiagnostics", "getSnapshot", "getStatus", "sendOnce"]);
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

test("sender only permits loopback, requires token and never sends game commands", async () => {
  const game = {
    gp: { amount: 3 }, bank: { items: [], maximumSlots: 10 },
    skills: { getObjectByID: () => ({ level: 1 }) }
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ accepted: true, mayExecute: false }) };
  };
  const token = "a".repeat(64);
  await assert.rejects(sendSnapshot({ game, url: "https://example.com/v1/snapshot", token, fetchImpl }), /Only the local/);
  await assert.rejects(sendSnapshot({ game, url: "http://127.0.0.1:3000/v1/snapshot", token: "bad", fetchImpl }), /token/);
  const result = await sendSnapshot({ game, url: "http://127.0.0.1:3000/v1/snapshot", token, fetchImpl });
  assert.equal(result.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["x-kardii-token"], token);
  assert.equal(JSON.parse(calls[0].options.body).source, "read-only-mod");
});

test("sender rejects incomplete Steam game data before any network request", async () => {
  let called = false;
  await assert.rejects(
    sendSnapshot({
      game: { skills: { getObjectByID: () => undefined } },
      url: "http://127.0.0.1:3000/v1/snapshot",
      token: "a".repeat(64),
      fetchImpl: async () => { called = true; throw new Error("must not send"); }
    }),
    /Incomplete character snapshot/
  );
  assert.equal(called, false);
});
