import test from "node:test";
import assert from "node:assert/strict";
import { createMelvorReceiver } from "./local-receiver.mjs";

const sample = () => ({
  schemaVersion: "melvor.snapshot.v0", game: "melvor-idle-1", source: "read-only-mod",
  capturedAt: new Date().toISOString(), gp: 123,
  bank: { used: 2, capacity: 20 },
  skills: { Fishing: 3, Cooking: 4, Mining: 5, Smithing: 6 },
  currentAction: { skill: null, actionId: null },
  combat: { hp: null, maxHp: null, foodEquipped: null }
});
async function post(port, token, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/snapshot`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-kardii-token": token },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}
test("loopback receiver rejects unauthorized and invalid snapshots", async () => {
  const receiver = createMelvorReceiver();
  const port = await receiver.start();
  try {
    assert.equal(receiver.server.address().address, "127.0.0.1");
    assert.equal((await post(port, "invalid", sample())).status, 401);
    assert.equal((await post(port, receiver.token, { gp: 42 })).status, 422);
    assert.equal(receiver.latest(), null);
  } finally { await receiver.stop(); }
});
test("valid snapshot is received and never grants execution", async () => {
  const received = [];
  const receiver = createMelvorReceiver({ onSnapshot: value => received.push(value) });
  const port = await receiver.start();
  try {
    const result = await post(port, receiver.token, sample());
    assert.equal(result.status, 200);
    assert.equal(result.body.mayExecute, false);
    assert.equal(receiver.latest().snapshot.gp, 123);
    assert.equal(received.length, 1);
    const stale = sample();
    stale.capturedAt = "2020-01-01T00:00:00Z";
    assert.equal((await post(port, receiver.token, stale)).status, 422);
    assert.equal(received.length, 1);
  } finally { await receiver.stop(); }
});

test("receiver rejects oversized payloads without replacing latest state", async () => {
  const receiver = createMelvorReceiver();
  const port = await receiver.start();
  try {
    assert.equal((await post(port, receiver.token, sample())).status, 200);
    const large = { ...sample(), extra: "x".repeat(9000) };
    assert.equal((await post(port, receiver.token, large)).status, 413);
    assert.equal(receiver.latest().snapshot.gp, 123);
  } finally { await receiver.stop(); }
});
test("receiver does not expose status or command endpoints", async () => {
  const receiver = createMelvorReceiver();
  const port = await receiver.start();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/command`, { method: "POST" });
    assert.equal(res.status, 404);
    const status = await fetch(`http://127.0.0.1:${port}/v1/snapshot`);
    assert.equal(status.status, 404);
  } finally { await receiver.stop(); }
});
