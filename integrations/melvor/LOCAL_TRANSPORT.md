# Melvor Steam → Kardii local transport

The optional Steam mod exposes a **read-only in-game API** through `mod.api.kardii_bridge`. This API is only visible within the Melvor mod runtime; it does **not** automatically communicate with the desktop application.

`local-receiver.mjs` provides the **desktop-side HTTP intake prototype**. It binds to 127.0.0.1, accepts only POST /v1/snapshot, checks a per-session secret header, rejects stale or invalid observations, and never accepts action commands. Run `npm run test:melvor` to exercise its contract.

## Remaining integration work

1. Verify Steam mod loading and actual game object fields in a live client. Back up the save first.
2. Implement an explicitly enabled in-game sender or desktop-mediated transport. The game engine's restrictions (CORS, network policy, mod permissions) must be checked in Steam before choosing the transport. Do not assume an in-game `fetch` to localhost is allowed.
3. Embed the receiver into Kardii's desktop lifecycle with a visible start/stop control and session-secret exchange. The standalone Node module is **not** yet embedded into Tauri and is **not** a working end-to-end connection.
4. Test actual character snapshots and recover gracefully from disconnects.
5. Add separate, allowlisted **normal game actions** only after user consent and real-game validation; no save editing, XP injection, or hidden automation.

The receiver does not log secrets or expose a GET status endpoint. It keeps only the most recently accepted snapshot in memory. The API should not be exposed through a public network proxy.
