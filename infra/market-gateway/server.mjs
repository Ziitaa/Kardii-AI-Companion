import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = "https://data-api.binance.vision";
const TOKEN = String(process.env.KARDII_MARKET_GATEWAY_TOKEN || "").trim();
const ALLOW_UNAUTHENTICATED =
  process.env.KARDII_MARKET_GATEWAY_ALLOW_UNAUTHENTICATED === "1";

const PUBLIC_PATHS = new Set([
  "/api/v3/ticker/24hr",
  "/api/v3/ticker/price",
  "/api/v3/klines",
  "/api/v3/depth",
  "/api/v3/exchangeInfo",
]);

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

    if (url.pathname === "/healthz") {
      return json(res, 200, {
        ok: true,
        service: "kardii-market-gateway",
        upstream: "binance-public-market-data",
      });
    }

    if (req.method !== "GET") {
      return json(res, 405, { error: "method_not_allowed" });
    }
    if (!authorized(req)) {
      return json(res, 401, { error: "unauthorized" });
    }
    if (!PUBLIC_PATHS.has(url.pathname)) {
      return json(res, 403, { error: "public_market_path_only" });
    }
    if (url.toString().length > 4096) {
      return json(res, 414, { error: "request_uri_too_long" });
    }

    const upstreamUrl = new URL(url.pathname + url.search, UPSTREAM);
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
