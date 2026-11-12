import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { parseMelvorSnapshot, assessMelvorSnapshot } from "./snapshot.mjs";

const MAX_BYTES = 8192;
const constantTimeEqual = (a, b) => {
  const x = Buffer.from(a || "");
  const y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createMelvorReceiver({ token = randomBytes(32).toString("hex"), onSnapshot = () => {}, allowedOrigins = [] } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("Receiver token must be at least 32 characters");
  let latest = null;
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const corsAllowed = typeof origin === "string" && allowedOrigins.includes(origin);
    if (corsAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Kardii-Token");
    }
    const reply = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/v1/snapshot" && req.method === "OPTIONS") {
      res.writeHead(corsAllowed ? 204 : 403);
      return res.end();
    }
    if (origin && !corsAllowed) return reply(403, { error: "origin-not-allowed" });
    if (req.url !== "/v1/snapshot" || req.method !== "POST") return reply(404, { error: "not-found" });
    if (!constantTimeEqual(req.headers["x-kardii-token"], token)) return reply(401, { error: "unauthorized" });
    const chunks = [];
    let size = 0;
    let oversized = false;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) { oversized = true; return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (oversized) return reply(413, { error: "payload-too-large" });
      try {
        const snapshot = parseMelvorSnapshot(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (Math.abs(Date.now() - Date.parse(snapshot.capturedAt)) > 120000) return reply(422, { error: "stale-snapshot" });
        const assessment = assessMelvorSnapshot(snapshot);
        latest = { snapshot, assessment };
        onSnapshot(latest);
        return reply(200, { accepted: true, warnings: assessment.warnings, mayExecute: false });
      } catch {
        return reply(422, { error: "invalid-snapshot" });
      }
    });
  });
  return {
    token,
    server,
    latest: () => latest,
    async start(port = 0) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      return server.address().port;
    },
    async stop() { if (server.listening) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
  };
}
