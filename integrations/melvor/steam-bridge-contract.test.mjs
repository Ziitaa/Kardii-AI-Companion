import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshot } from "./steam-mod/setup.mjs";
import { parseMelvorSnapshot, assessMelvorSnapshot } from "./snapshot.mjs";

test("Steam bridge snapshot passes desktop validator when all observed values are valid", () => {
  const game = {
    gp: { amount: 250 },
    bank: { items: [1, 2], maximumSlots: 12 },
    skills: { getObjectByID: () => ({ level: 4 }) }
  };
  const snapshot = createSnapshot(game);
  const parsed = parseMelvorSnapshot(snapshot);
  assert.equal(parsed.gp, 250);
  assert.equal(parsed.bank.used, 2);
  assert.equal(assessMelvorSnapshot(snapshot).mayExecute, false);
});

test("Steam bridge and desktop validator reject incomplete character data", () => {
  const snapshot = createSnapshot({ skills: { getObjectByID: () => undefined } });
  assert.throws(() => parseMelvorSnapshot(snapshot));
});
