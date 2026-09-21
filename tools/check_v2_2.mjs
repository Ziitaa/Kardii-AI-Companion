import fs from "node:fs";
import assert from "node:assert/strict";

const trading = fs.readFileSync("src-tauri/src/trading.rs", "utf8");
const gateway = fs.readFileSync("infra/market-gateway/server.mjs", "utf8");

assert.match(trading, /KARDII_MARKET_GATEWAY_BASE/);
assert.match(trading, /KARDII_MARKET_GATEWAY_TOKEN/);
assert.match(trading, /public_market_path_allowed/);
assert.match(trading, /fetch_public_json::<Vec<BinanceTicker>>\(&client, "\/api\/v3\/ticker\/24hr"\)/);

const allowlistStart = trading.indexOf("fn public_market_path_allowed");
const allowlistEnd = trading.indexOf("fn public_market_targets", allowlistStart);
assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart);
const allowlist = trading.slice(allowlistStart, allowlistEnd);
assert.doesNotMatch(allowlist, /\/api\/v3\/account/);
assert.doesNotMatch(allowlist, /\/sapi\//);

assert.match(gateway, /PUBLIC_PATHS/);
assert.match(gateway, /X-Kardii-Market-Token/i);
assert.doesNotMatch(gateway, /api[-_ ]?key/i);
assert.doesNotMatch(gateway, /secret/i);
assert.doesNotMatch(gateway, /withdraw/i);
assert.doesNotMatch(gateway, /order/i);

console.log("Kardii v2.2 market gateway boundary checks passed.");
