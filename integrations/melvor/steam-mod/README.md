# Kardii Steam Melvor Idle 1 bridge (prototype)

This is a **read-only, opt-in mod prototype** for the Steam edition of Melvor Idle **1**. It uses the game's official mod context `setup(ctx)` and exposes `getStatus()` and `getSnapshot()` through `ctx.api` under namespace `kardii_bridge`.

It does not connect to the Kardii desktop process yet. There is **no network listener, token exchange, mouse automation, or command execution**. Do not confuse the in-game mod API with a remote desktop API.

To test: back up your character save, enable Melvor's in-game modding/Creator Toolkit, and link this folder using the toolkit's Directory Link feature if available in your game version. Load a character and inspect `mod.api.kardii_bridge.getStatus()` / `getSnapshot()` in a developer console, if accessible. Do not publish the prototype publicly.

The exact runtime shapes of `game.gp`, `game.bank`, and `game.skills` are **not yet validated against a running Steam client**. Unknown values are `null`; the desktop snapshot validator deliberately rejects incomplete data rather than silently making up values. The next milestone is to confirm the actual game object fields, then build a localhost-only authenticated transport and test a full end-to-end read.
