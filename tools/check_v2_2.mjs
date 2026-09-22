import fs from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const trading = fs.readFileSync("src-tauri/src/trading.rs", "utf8");
const decision = fs.readFileSync("src-tauri/src/decision.rs", "utf8");
const gateway = fs.readFileSync("infra/market-gateway/server.mjs", "utf8");
const readonly = fs.readFileSync("src-tauri/src/readonly_viewer.rs", "utf8");
const lib = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const workbench = fs.readFileSync("src/workbench.html", "utf8");
const railway = fs.readFileSync("infra/market-gateway/railway.json", "utf8");
const remoteTransport = fs.readFileSync("infra/remote-transport/README.md", "utf8");

assert.match(trading, /KARDII_MARKET_GATEWAY_BASE/);
assert.match(trading, /KARDII_MARKET_GATEWAY_TOKEN/);
assert.match(trading, /public_market_path_allowed/);
assert.match(trading, /normalize_market_gateway_base/);
assert.match(trading, /远程 Market Data Gateway 必须使用 HTTPS/);
assert.match(trading, /fetch_public_json::<Vec<BinanceTicker>>\(&client, "\/api\/v3\/ticker\/24hr"\)/);

const allowlistStart = trading.indexOf("fn public_market_path_allowed");
const allowlistEnd = trading.indexOf("fn public_market_targets", allowlistStart);
assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart);
const allowlist = trading.slice(allowlistStart, allowlistEnd);
assert.doesNotMatch(allowlist, /\/api\/v3\/account/);
assert.doesNotMatch(allowlist, /\/sapi\//);
assert.doesNotMatch(allowlist, /\/okx\/api\/v5\/account\//);
assert.doesNotMatch(allowlist, /\/okx\/api\/v5\/trade\//);

assert.match(gateway, /BINANCE_PUBLIC_PATHS/);
assert.match(gateway, /OKX_PUBLIC_PATHS/);
assert.match(gateway, /KARDII_OKX_PUBLIC_BASE/);
assert.match(gateway, /official okx\.com domain/);
assert.match(gateway, /X-Kardii-Market-Token/i);
assert.doesNotMatch(gateway, /api[-_ ]?key/i);
assert.doesNotMatch(gateway, /secret/i);
assert.doesNotMatch(gateway, /withdraw/i);
assert.doesNotMatch(gateway, /\/api\/v5\/account\//);
assert.doesNotMatch(gateway, /\/api\/v5\/trade\//);

const methodGuard = gateway.indexOf('if (req.method !== "GET")');
const healthRoute = gateway.indexOf('if (url.pathname === "/healthz")');
assert.ok(methodGuard >= 0 && healthRoute > methodGuard);

const syntax = spawnSync(process.execPath, ["--check", "infra/market-gateway/server.mjs"], {
  encoding: "utf8",
});
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);

const workbenchSyntax = spawnSync(process.execPath, ["--check", "src/workbench.js"], {
  encoding: "utf8",
});
assert.equal(workbenchSyntax.status, 0, workbenchSyntax.stderr || workbenchSyntax.stdout);

const railwayConfig = JSON.parse(railway);
assert.equal(railwayConfig.deploy.healthcheckPath, "/healthz");

assert.match(trading, /save_market_gateway_connection/);
assert.match(trading, /okx_public_available/);
assert.match(trading, /okxPublicEnabled/);
assert.match(trading, /\/okx\/api\/v5\/market\/ticker/);
assert.match(trading, /market-gateway-token-v1/);
assert.match(trading, /validate_market_gateway_token/);
assert.match(trading, /DecisionProviderBenchmark/);
assert.match(trading, /DECISION_BENCHMARK_POLICY_VERSION/);
assert.match(trading, /direction-1h-v1/);
assert.match(trading, /DECISION_BULLISH_THRESHOLD_PERCENT: f64 = 0\.30/);
assert.match(trading, /DECISION_BEARISH_THRESHOLD_PERCENT: f64 = -0\.30/);
assert.match(trading, /direction_accuracy_percent/);
assert.match(readonly, /providerBenchmarks/);
assert.match(readonly, /readonly-viewer-public-base-v1/);
assert.match(readonly, /save_readonly_viewer_public_base/);
assert.match(readonly, /get_readonly_viewer_transport_status/);
assert.match(readonly, /verify_remote_public_base/);
assert.match(readonly, /full-status-mirror/);
assert.match(lib, /save_market_gateway_connection/);
assert.match(lib, /save_readonly_viewer_public_base/);
assert.match(lib, /get_readonly_viewer_transport_status/);
assert.match(workbench, /MARKET DATA EGRESS/);
assert.match(workbench, /设置 HTTPS 入口/);
assert.match(railway, /"healthcheckPath": "\/healthz"/);
assert.doesNotMatch(railway, /KARDII_MARKET_GATEWAY_TOKEN/);
assert.match(remoteTransport, /tailscale serve --bg http:\/\/127\.0\.0\.1:43199/);
assert.match(remoteTransport, /Do \*\*not\*\* use Tailscale Funnel/);

assert.match(decision, /https:\/\/api\.typesafe\.ai\/v1\/systemone/);
assert.match(decision, /JevDecisionProvider/);
assert.match(decision, /"executionEnabled": false/);
assert.match(decision, /"positionContextAvailable": false/);
assert.match(decision, /"enter": "Evidence supports a new spot entry candidate strongly enough for shadow benchmarking; this does not authorize execution\."/);
assert.match(trading, /evaluate_with_fallback\(None, &baseline, &input\)/);
assert.match(trading, /external_provider_configured: load_jev_api_key_from_keyring\(\)\.ok\(\)\.flatten\(\)\.is_some\(\)/);
assert.match(trading, /execution_linked: false/);

assert.match(decision, /TYPESAFE_MODELS_ENDPOINT/);
assert.match(decision, /validate_access/);
assert.match(trading, /typesafe-jev-api-key-v1/);
assert.match(trading, /save_jev_provider_credentials/);
assert.match(trading, /get_jev_provider_status/);
assert.match(trading, /delete_jev_provider_credentials/);
assert.match(trading, /Always record the deterministic baseline on the same sample first/);
assert.match(trading, /execution_linked: false/);
assert.match(workbench, /连接 Jev/);

console.log("Kardii v2.2 market gateway boundary checks passed.");
