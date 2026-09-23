import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";

const repoRoot = new URL("../", import.meta.url);
const token = randomBytes(32).toString("hex");
const okxBase = String(process.env.KARDII_OKX_PUBLIC_BASE || "").trim();

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForReady(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("gateway startup timed out")), timeoutMs);
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdout.on("data", chunk => {
      const text = String(chunk);
      if (text.includes("Kardii Market Gateway listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", code => {
      clearTimeout(timeout);
      reject(new Error(`gateway exited before ready (code ${code}): ${stderr}`));
    });
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["infra/market-gateway/server.mjs"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    KARDII_MARKET_GATEWAY_TOKEN: token,
    ...(okxBase ? { KARDII_OKX_PUBLIC_BASE: okxBase } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForReady(child);

  const health = await fetchJson(`${base}/healthz`);
  if (!health.response.ok || health.body?.ok !== true) {
    throw new Error(`health check failed: HTTP ${health.response.status}`);
  }

  const unauthorized = await fetchJson(`${base}/api/v3/ticker/price?symbol=BTCUSDT`);
  if (unauthorized.response.status !== 401) {
    throw new Error(`unauthenticated public route was not rejected: HTTP ${unauthorized.response.status}`);
  }

  const blocked = await fetchJson(`${base}/api/v3/account`, {
    headers: { "X-Kardii-Market-Token": token },
  });
  if (blocked.response.status !== 403) {
    throw new Error(`private Binance route was not blocked: HTTP ${blocked.response.status}`);
  }

  const binance = await fetchJson(`${base}/api/v3/ticker/price?symbol=BTCUSDT`, {
    headers: { "X-Kardii-Market-Token": token },
  });
  if (!binance.response.ok || !binance.body?.price) {
    throw new Error(`Binance public BTC price failed: HTTP ${binance.response.status}`);
  }

  let okxResult = "not configured";
  if (okxBase) {
    if (health.body?.okxPublicEnabled !== true) {
      throw new Error("OKX base was supplied but gateway health did not enable OKX public");
    }
    const okxBlocked = await fetchJson(`${base}/okx/api/v5/account/balance`, {
      headers: { "X-Kardii-Market-Token": token },
    });
    if (okxBlocked.response.status !== 403) {
      throw new Error(`private OKX route was not blocked: HTTP ${okxBlocked.response.status}`);
    }
    const okx = await fetchJson(`${base}/okx/api/v5/market/ticker?instId=BTC-USDT`, {
      headers: { "X-Kardii-Market-Token": token },
    });
    if (!okx.response.ok || okx.body?.code !== "0" || !Array.isArray(okx.body?.data) || !okx.body.data.length) {
      throw new Error(`OKX public BTC ticker failed: HTTP ${okx.response.status} ${okx.body?.msg || ""}`);
    }
    okxResult = "ready";
  }

  console.log(JSON.stringify({
    gateway: "ready",
    binancePublic: "ready",
    okxPublic: okxResult,
    privateRoutesBlocked: true,
    accountCredentialsUsed: false,
  }, null, 2));
} finally {
  child.kill("SIGTERM");
}
