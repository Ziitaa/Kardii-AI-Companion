import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const BINANCE_UPSTREAM = "https://data-api.binance.vision";
const OKX_PUBLIC_BASE = String(process.env.KARDII_OKX_PUBLIC_BASE || "").trim();
const TOKEN = String(process.env.KARDII_MARKET_GATEWAY_TOKEN || "").trim();
const ALLOW_UNAUTHENTICATED =
  process.env.KARDII_MARKET_GATEWAY_ALLOW_UNAUTHENTICATED === "1";

const BINANCE_PUBLIC_PATHS = new Set([
  "/api/v3/ticker/24hr",
  "/api/v3/ticker/price",
  "/api/v3/klines",
  "/api/v3/depth",
  "/api/v3/exchangeInfo",
]);

const OKX_PUBLIC_PATHS = new Set([
  "/api/v5/market/tickers",
  "/api/v5/market/ticker",
  "/api/v5/market/books",
  "/api/v5/market/candles",
  "/api/v5/public/instruments",
]);

function normalizedOkxBase() {
  if (!OKX_PUBLIC_BASE) return "";
  const url = new URL(OKX_PUBLIC_BASE);
  if (url.protocol !== "https:") {
    throw new Error("KARDII_OKX_PUBLIC_BASE must use HTTPS.");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "okx.com" && !host.endsWith(".okx.com")) {
    throw new Error("KARDII_OKX_PUBLIC_BASE must be an official okx.com domain.");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("KARDII_OKX_PUBLIC_BASE must be a clean site root URL.");
  }
  return url.origin;
}

const OKX_UPSTREAM = normalizedOkxBase();

if (!TOKEN && !ALLOW_UNAUTHENTICATED) {
  throw new Error(
    "KARDII_MARKET_GATEWAY_TOKEN is required. " +
      "Set KARDII_MARKET_GATEWAY_ALLOW_UNAUTHENTICATED=1 only for isolated development."
  );
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(payload.length),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function authorized(req) {
  if (ALLOW_UNAUTHENTICATED && !TOKEN) return true;
  return req.headers["x-kardii-market-token"] === TOKEN;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method !== "GET") {
      return json(res, 405, { error: "method_not_allowed" });
    }

    if (url.pathname === "/healthz") {
      return json(res, 200, {
        ok: true,
        service: "kardii-market-gateway",
        upstream: "binance-public-market-data",
        okxPublicEnabled: Boolean(OKX_UPSTREAM),
      });
    }
    if (!authorized(req)) {
      return json(res, 401, { error: "unauthorized" });
    }
    let upstreamBase = BINANCE_UPSTREAM;
    let upstreamPath = url.pathname;
    if (url.pathname.startsWith("/okx/")) {
      upstreamPath = url.pathname.slice("/okx".length);
      if (!OKX_UPSTREAM) {
        return json(res, 503, { error: "okx_public_provider_not_configured" });
      }
      if (!OKX_PUBLIC_PATHS.has(upstreamPath)) {
        return json(res, 403, { error: "public_market_path_only" });
      }
      upstreamBase = OKX_UPSTREAM;
    } else if (!BINANCE_PUBLIC_PATHS.has(url.pathname)) {
      return json(res, 403, { error: "public_market_path_only" });
    }
    if (url.toString().length > 4096) {
      return json(res, 414, { error: "request_uri_too_long" });
    }

    const upstreamUrl = new URL(upstreamPath + url.search, upstreamBase);
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        "user-agent": "Kardii-Market-Gateway/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });

    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength > 8 * 1024 * 1024) {
      return json(res, 502, { error: "upstream_response_too_large" });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > 8 * 1024 * 1024) {
      return json(res, 502, { error: "upstream_response_too_large" });
    }

    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "content-length": String(body.length),
      "cache-control": "no-store",
      "x-kardii-market-gateway": "1",
    });
    res.end(body);
  } catch (error) {
    json(res, 502, {
      error: "gateway_error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(
    `Kardii Market Gateway listening on 0.0.0.0:${PORT}\n`
  );
});
