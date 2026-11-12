import { createMelvorReceiver } from "./local-receiver.mjs";

const configuredOrigin = process.env.KARDII_MELVOR_ORIGIN || "";
if (configuredOrigin && !/^https?:\/\/[^/]+$/.test(configuredOrigin)) {
  throw new Error("KARDII_MELVOR_ORIGIN must be an exact HTTP(S) origin");
}
const receiver = createMelvorReceiver({
  allowedOrigins: configuredOrigin ? [configuredOrigin] : [],
  onSnapshot: ({ snapshot, assessment }) => {
    console.log(JSON.stringify({
      receivedAt: new Date().toISOString(),
      gp: snapshot.gp,
      skills: snapshot.skills,
      bank: snapshot.bank,
      warnings: assessment.warnings,
      mayExecute: false
    }));
  }
});
const port = await receiver.start();
console.log("Kardii Melvor read-only receiver (local test only)");
console.log("URL: http://127.0.0.1:" + port + "/v1/snapshot");
console.log("Session token (keep private): " + receiver.token);
console.log("Allowed browser origin: " + (configuredOrigin || "none (non-browser requests only)"));
console.log("Press Ctrl+C to stop. No commands are accepted.");
process.on("SIGINT", async () => { await receiver.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await receiver.stop(); process.exit(0); });
