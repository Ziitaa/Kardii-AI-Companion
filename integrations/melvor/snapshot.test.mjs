import test from "node:test";
import assert from "node:assert/strict";
import { parseMelvorSnapshot, assessMelvorSnapshot } from "./snapshot.mjs";

const sample = () => ({
  schemaVersion: "melvor.snapshot.v0", game: "melvor-idle-1",
  capturedAt: "2026-11-12T00:00:00Z", gp: 2273,
  bank: { used: 25, capacity: 30 },
  skills: { Fishing: 6, Cooking: 4, Mining: 30, Smithing: 2 },
  currentAction: { skill: "Mining", actionId: "copper" },
  combat: { hp: 100, maxHp: 100, foodEquipped: false },
  source: "read-only-mod",
});

test("accepts valid snapshot and recommends fishing", () => {
  assert.equal(parseMelvorSnapshot(sample()).gp, 2273);
  assert.deepEqual(assessMelvorSnapshot(sample()).suggestedSkill, "Fishing");
  assert.equal(assessMelvorSnapshot(sample()).mayExecute, false);
});

test("rejects impossible bank capacity", () => {
  const s = sample(); s.bank.used = 31;
  assert.throws(() => parseMelvorSnapshot(s), /Bank usage/);
});

test("rejects negative currency", () => {
  const s = sample(); s.gp = -1;
  assert.throws(() => parseMelvorSnapshot(s), /gp/);
});

test("rejects unsupported game versions and sources", () => {
  const s = sample(); s.game = "melvor-idle-2";
  assert.throws(() => parseMelvorSnapshot(s), /Unsupported/);
  const t = sample(); t.source = "unknown";
  assert.throws(() => parseMelvorSnapshot(t), /Untrusted/);
});

test("flags unsafe unattended combat and full bank", () => {
  const s = sample(); s.bank.used = 29;
  const result = assessMelvorSnapshot(s);
  assert.ok(result.warnings.includes("bank-nearly-full"));
  assert.ok(result.warnings.includes("unattended-combat-unsafe"));
});

test("recommends cooking after fishing reaches 30", () => {
  const s = sample(); s.skills.Fishing = 30;
  assert.equal(assessMelvorSnapshot(s).suggestedSkill, "Cooking");
});
