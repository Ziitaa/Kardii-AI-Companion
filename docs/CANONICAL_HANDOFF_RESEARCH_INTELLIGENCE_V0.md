# Canonical Handoff — Research Intelligence / External Evidence V0

Status: implemented on `agent/niko-workbench-v0` pending/subject to CI for the final commit in this execution unit.

## Architecture audit

The repo already contained the primitives needed for a low-maintenance External Research Intake:

- `ResearchSource` plus Bing RSS search and RSS item parsing in `src-tauri/src/lib.rs`;
- a hardened public-web reader/crawler with URL validation, public-IP resolution, robots.txt handling, bounded responses, redirect controls, and visible-text extraction;
- the existing AI provider layer (`DeepSeek / Gemini / Ollama / Codex`) and structured JSON parsing;
- the workbench Research UI;
- canonical trading research persistence in `kardii-trading.sqlite3`;
- `research_history`, `strategy_experiments`, Shadow experiments, Decision benchmarks, and deterministic Risk Engine boundaries.

The missing gap was **not collection breadth**. It was a canonical evidence lifecycle between a public source and an independently verified research conclusion.

Because RSS + public web + manual URL already satisfy V0 intake with no new paid API, production credentials, persistent server, or collector deployment, **OpenMagpie is not introduced in V0**.

## Collector decision

V0 collectors:

1. `manual-url` — explicit public URL, using the existing hardened web-fetch boundary.
2. `rss` — explicit RSS 2.0 feed URL, bounded to 1–20 items per user-triggered import.
3. Future adapter slot — any X reader, official API, third-party provider, Reddit/YouTube/HN adapter, or OpenMagpie service must map into the same provider-neutral canonical item contract.

No provider-specific schema is stored in the domain model. X/social ingestion is deliberately deferred.

## V0 architecture

```text
Manual URL / RSS / future external collector
                  |
                  v
        provider-neutral adapter item
                  |
                  v
        external_research_items
        (kardii-trading.sqlite3)
                  |
          +-------+--------+
          |                |
          v                v
   deterministic       configured AI
   dedupe/metadata     claim extraction
          |                |
          +-------+--------+
                  v
            Research Inbox
                  |
                  v
     Claim -> Hypothesis -> Verification
                  |
                  v
       existing experiment linkage
                  |
                  v
          Research Conclusion
```

Hard isolation remains:

```text
Research finding != Signal
Signal candidate != Approved strategy
Approved strategy != Risk permission
```

The External Research tables are not read by `decision.rs`, candidate ranking, `evaluate_risk`, Kill Switch, ledger reconciliation, or execution code.

## Canonical item fields

`external_research_items` stores:

- source_id, author, source_type, source_tier;
- canonical_url, title, summary, published_at, retrieved_at;
- raw_content, content_hash, normalized_hash, duplicate_of;
- topic, assets, mentioned indicators, mentioned tools;
- extracted claims and evidence links;
- possible commercial relationship;
- verification_status;
- linked_experiment_id, hypothesis, research_result;
- disposition and rejection_reason;
- ingestion_provider and timestamps.

There is deliberately no global source credibility score. `source_tier` is provenance class, not a trust score.

## Deduplication

1. canonical URL strips fragments and common tracking parameters;
2. identical canonical URL returns the existing item;
3. exact SHA-256 content duplicates are linked via `duplicate_of`;
4. normalized-content SHA-256 catches basic formatting/whitespace duplicates.

V0 does not attempt semantic/paraphrase deduplication.

## Claim extraction

The existing configured AI provider is reused. The prompt treats article text as untrusted data and extracts, without truth adjudication:

- summary;
- topic;
- source tier;
- assets;
- indicators;
- tools;
- claims with claim type / indicator / threshold / horizon / verification question;
- explicitly present evidence links;
- possible commercial relationship (defaults to unknown when unsupported);
- one falsifiable hypothesis.

Truth/falsehood must be established by market data, historical tests, experiments, primary sources, or other independent evidence.

## Research Inbox

The existing workbench Research panel is repurposed as the canonical Research Inbox.

Available V0 actions:

- add a public URL;
- import a small explicit RSS feed;
- extract claims using the already-configured AI provider;
- Create Hypothesis;
- set verification state and research result.

The legacy local-only Research note path is no longer used by the visible inbox, avoiding a second active Research state source.

## Experiment linkage

`linked_experiment_id` currently links to the existing `strategy_experiments.symbol` when supplied. It is optional so external research can remain unresolved until a relevant experiment exists.

This is intentionally narrow. A future generic backtest/experiment registry can replace the symbol linkage without changing the canonical research item contract.

## Tests / invariants

The execution unit adds checks for:

- canonical URL tracking-parameter removal;
- normalized content fingerprint stability;
- closed verification-status set;
- External Research schema/commands/UI presence;
- Decision layer contains no External Research dependency;
- deterministic `evaluate_risk` block contains no External Research dependency;
- existing JS syntax, Rust unit tests, market-gateway boundary checks and cross-platform CI remain authoritative.

## Deliberately not implemented

- OpenMagpie deployment;
- X API / TikHub / ScrapeCreators / paid social APIs;
- custom large crawler;
- autonomous full-internet feed;
- semantic credibility score;
- semantic/paraphrase dedupe;
- social content -> Signal;
- article/LLM -> position change;
- automatic hard-risk modification;
- external collector credentials with trading/account access;
- new Jev/router/agent framework for this feature.

## X / social next step

The minimum future X path is **one adapter**, not a new research subsystem:

```text
X reader / official API / compliant third-party provider
        -> ExternalResearchAdapterItem
        -> external_research_items
```

Choose the provider only when actual X intake is needed. First preference is a small read-only connector with stable URLs, timestamps, author identity, and raw post/thread text. If an external collector requires paid credentials, persistent paid hosting, or unclear ToS/licensing, stop for explicit approval rather than coupling it to Kardii core.
