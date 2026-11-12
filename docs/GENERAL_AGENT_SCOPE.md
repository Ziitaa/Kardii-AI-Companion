# Kardii — General-purpose Agent scope

This branch is derived from `agent/niko-workbench-v0`. Its purpose is to retain Kardii as a general AI desktop companion, not a cryptocurrency-specific product or a game-only bot.

## Keep

- Floating desktop pet, chat, personalities and memory
- Model selection and credential handling
- File reading, document analysis and knowledge base
- Agent planning, task progress, user questions, cancellation and logs
- General browser/desktop tools and MCP connections, with existing permissions and safeguards
- Backups and migration, without leaking secrets

## Remove from the product (after dependency review)

- Trading dashboards, cryptocurrency market scans, exchange-specific integrations and execution flows
- Trade intents, ledgers, shadow trading and financial-risk UI
- Trading-only prompts, menu entries and persisted preferences

Do not delete user data, secrets or stored backups during the cleanup. Prefer migrations and explicit opt-in data deletion. Do not remove generic safety mechanisms because trading-specific code also used them.

## Implementation checkpoints

1. Inventory front-end references and Rust commands related to `trading` and `decision`. Separate shared infrastructure from domain logic.
2. Remove trading-only UI routes and navigation without changing the Agent/chat experience. Run frontend checks.
3. Remove trading-only Rust modules, commands, state and dependencies; verify Tauri builds for macOS. Preserve generic authorization, cancellation, auditing and credential storage.
4. Smoke-test chat, file handling, model selection, memory, MCP, browser access and backup restore.
5. Add a separate optional Melvor adapter. Do not couple Melvor code to the general Agent.

## Melvor adapter contract (proposed, not implemented)

Read-only first: character ID (non-secret), game version, skills, bank capacity/occupancy, GP, current action, equipment, food and HP. Normalize these into a versioned snapshot. Never read credentials, modify save data, accelerate timers or fabricate items. Then implement a bounded `propose -> validate -> execute -> verify` loop for supported normal in-game actions.

Safety: explicit opt-in per game session, action allowlist, max consecutive actions, stop button, dry-run mode, health/food checks before combat or thieving, and audit log. Buying in-game upgrades may require a distinct approval policy. Avoid autonomous combat until survival checks are tested.

Melvor 2 (if used later) needs a separate adapter and compatibility investigation; do not assume Melvor 1 mod APIs work there.

## Status

This document is a development scope, not evidence that code cleanup, the adapter or runtime tests are complete.
