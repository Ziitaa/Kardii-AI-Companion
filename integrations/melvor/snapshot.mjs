/**
 * Melvor snapshot validation boundary. No game writes or execution.
 * This module is deliberately dependency-free so it can be used by the
 * desktop Agent and by a future opt-in Melvor 1 adapter.
 */
export const MELVOR_SNAPSHOT_VERSION = "melvor.snapshot.v0";
const SKILLS = ["Fishing", "Cooking", "Mining", "Smithing"];

function nonnegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative safe integer`);
  }
  return value;
}

function nullableInteger(value, field) {
  return value == null ? null : nonnegativeInteger(value, field);
}

export function parseMelvorSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Snapshot must be an object");
  }
  if (input.schemaVersion !== MELVOR_SNAPSHOT_VERSION || input.game !== "melvor-idle-1") {
    throw new TypeError("Unsupported Melvor snapshot version or game");
  }
  if (input.source !== "read-only-mod") {
    throw new TypeError("Untrusted snapshot source");
  }
  const captured = Date.parse(input.capturedAt);
  if (typeof input.capturedAt !== "string" || !Number.isFinite(captured)) {
    throw new TypeError("Invalid capturedAt timestamp");
  }
  const bank = input.bank;
  if (!bank || typeof bank !== "object") throw new TypeError("Missing bank");
  const used = nonnegativeInteger(bank.used, "bank.used");
  const capacity = nonnegativeInteger(bank.capacity, "bank.capacity");
  if (used > capacity) throw new RangeError("Bank usage exceeds capacity");
  const skills = input.skills;
  if (!skills || typeof skills !== "object") throw new TypeError("Missing skills");
  const normalizedSkills = {};
  for (const name of SKILLS) {
    const level = skills[name];
    if (!Number.isSafeInteger(level) || level < 1 || level > 120) {
      throw new RangeError(`Invalid ${name} level`);
    }
    normalizedSkills[name] = level;
  }
  const combat = input.combat;
  if (!combat || typeof combat !== "object") throw new TypeError("Missing combat");
  const hp = nullableInteger(combat.hp, "combat.hp");
  const maxHp = nullableInteger(combat.maxHp, "combat.maxHp");
  if (hp !== null && maxHp !== null && hp > maxHp) throw new RangeError("HP exceeds max HP");
  const foodEquipped = combat.foodEquipped;
  if (foodEquipped !== null && typeof foodEquipped !== "boolean") {
    throw new TypeError("combat.foodEquipped must be boolean or null");
  }
  const action = input.currentAction;
  if (!action || typeof action !== "object") throw new TypeError("Missing currentAction");
  for (const key of ["skill", "actionId"]) {
    if (action[key] !== null && (typeof action[key] !== "string" || action[key].length > 128)) {
      throw new TypeError(`Invalid currentAction.${key}`);
    }
  }
  return Object.freeze({
    schemaVersion: MELVOR_SNAPSHOT_VERSION,
    game: "melvor-idle-1",
    capturedAt: new Date(captured).toISOString(),
    gp: nonnegativeInteger(input.gp, "gp"),
    bank: Object.freeze({ used, capacity }),
    skills: Object.freeze(normalizedSkills),
    currentAction: Object.freeze({ skill: action.skill, actionId: action.actionId }),
    combat: Object.freeze({ hp, maxHp, foodEquipped }),
    source: "read-only-mod",
  });
}

/** Read-only advice. Never emits executable game commands. */
export function assessMelvorSnapshot(snapshot) {
  const state = parseMelvorSnapshot(snapshot);
  const warnings = [];
  if (state.bank.capacity - state.bank.used <= 3) warnings.push("bank-nearly-full");
  if (state.combat.hp === null || state.combat.maxHp === null || state.combat.foodEquipped !== true) {
    warnings.push("unattended-combat-unsafe");
  }
  return Object.freeze({
    warnings: Object.freeze(warnings),
    suggestedSkill: state.skills.Fishing < 30 ? "Fishing" : state.skills.Cooking < 20 ? "Cooking" : "Smithing",
    mayExecute: false,
  });
}
