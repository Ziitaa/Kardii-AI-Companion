# Melvor adapter — read-only snapshot contract (draft)

This is an optional adapter for the general-purpose Kardii Agent. No game integration or runtime is implemented by this document.

## Input snapshot v0

```json
{
  "schemaVersion": "melvor.snapshot.v0",
  "game": "melvor-idle-1",
  "capturedAt": "2026-11-12T00:00:00Z",
  "gp": 0,
  "bank": {"used": 0, "capacity": 0},
  "skills": {"Fishing": 1, "Cooking": 1, "Mining": 1, "Smithing": 1},
  "currentAction": {"skill": null, "actionId": null},
  "combat": {"hp": null, "maxHp": null, "foodEquipped": null},
  "source": "read-only-mod"
}
```

All fields are observations, never inferred as successful actions. A missing field is null, not zero. The sample values are placeholders, not a real character snapshot. Keep source version and timestamp with every observation.

## MVP boundaries

- A Melvor 1 read-only mod collects the snapshot after save/character loading; do not access credentials, alter save data, grant items or modify timers.
- Kardii receives snapshots through an explicitly enabled localhost-only adapter with per-session authorization; avoid exposing a public listener.
- First demonstrate repeatable accurate reads of GP, bank and skill levels, including after an in-game action.
- Later, separate propose, policy-check, execute and verify stages. Use a normal-game-action allowlist and a kill switch; disable unattended combat/thieving until food/HP safety is proven.
- Keep Melvor 2 as a different future adapter, not a compatibility claim.

## Proposed next code change

Inventory Niko's trading-only UI and backend references, then remove them in small buildable commits while preserving generic Agent tools and permissions. Do not delete stored user data automatically.
