import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("general-purpose Kardii must not poll trading APIs in the background", () => {
  assert.doesNotMatch(source, /trading_runtime\s*\.\s*refresh\s*\(/);
  assert.doesNotMatch(source, /trading_runtime\s*\.\s*sync_binance_readonly_snapshot\s*\(/);
});

test("generic agent and browser functionality remain registered", () => {
  assert.match(source, /create_agent_plan,/);
  assert.match(source, /decide_agent_action,/);
  assert.match(source, /mod browser;/);
  assert.match(source, /mod mcp;/);
});
