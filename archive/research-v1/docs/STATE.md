# CactusStrudel v3 — State

Snapshot date: 2026-07-28

This file records durable on-disk facts. Process health is live data; read it
with `bin/health` or `GET /api/v2/health`.

## Product

| Fact | Current value |
|---|---|
| active branch | `codex/cactusstrudel-v3` |
| application entry | `http://127.0.0.1:8765/studio` |
| API | `/api/v2` |
| UI source | `apps/producer-ui/` |
| UI build | `runtime/app/` |
| server | `runtime/serve.py` |
| runtime database | `~/.cactus-strudel/v3/runtime.sqlite3` |
| immutable assets | `producer-brain/assets/` |
| validator | deterministic |
| prompt-kernel hash | `3b14f2697c862db9` |

The active UI has Studio, Library, Research, Activity, Agent Settings,
Generation Settings, and System Settings. Playback is owned by one global audio
engine. A/B, score, Brain context, and active revision all point to the same
immutable revision identity and audio SHA.

## Baseline and rollback

The pre-rebuild GUI is frozen at:

```text
archive/gui/ui-v2-baseline-20260728-95f85f6/
```

- annotated git tag: `ui-v2-baseline-20260728-95f85f6`
- commit: `95f85f60596cc226c477543a873e3c4ec95e32fb`
- archive manifest: 19 SHA-256 entries, verified
- screenshots: all four pages at 1440×1000 and 1728×1117
- API snapshots: settings masked

Read-only UI routes:

- `/legacy/main`
- `/legacy/data`
- `/legacy/settings`
- `/legacy/spine`

These routes are visual/historical evidence. Their old APIs are disabled.

## Migration receipt

The reconciliation source was:

- `producer-brain/corpus.jsonl`: 49 rows
- `producer-brain/revisions.jsonl`: 6 rows
- archived `archive/runtime-v2/data/cc-bridge/tasks.jsonl`: 90 rows

Dry-run result:

| Classification | Count |
|---|---:|
| corpus rows planned | 49 |
| corpus rows importable | 49 |
| invalid JSON or shape | 0 |
| exact model provenance absent | 49 |
| audio hash drift | 2 |
| duplicate-evidence rows | 1 |
| incomplete/partial legacy evidence | 8 |
| recovery candidates | 4 |

Applied v3 readback:

| Durable record | Count |
|---|---:|
| total pieces | 50 |
| native v3 pieces | 1 |
| legacy-preserved pieces | 49 |
| immutable legacy revisions | 49 |
| imported human ratings | 4 |
| `ready` legacy revisions | 47 |
| `legacy_partial` revisions | 2 |

Evidence exceptions remain visible:

- `LDB-001` and `JH-001`: the observed audio hash differs from the old recorded
  hash; both values are retained.
- `UN-004`: duplicate evidence linked to `UN-003`; it was not silently merged
  or deleted.
- all 49 imports use `legacy_unknown` where exact model/route provenance did
  not exist.
- four completed-task JS/audio pairs remain recovery candidates and were not
  imported into the active library.

The JSONL files and their referenced source assets remain read-only evidence.
The importer copied verified bytes into immutable version directories and did
not rewrite, move, or delete the sources.

## Agent connection

Connection draft:

| Field | Current staged value |
|---|---|
| Base URL | `http://127.0.0.1:8318/v1` |
| key storage | macOS Keychain credential reference |
| selected model | `claude-opus-5` |
| reasoning effort | `null` |
| orchestration | `standard` |

Authenticated catalog readback contained 50 exact model IDs. The latest inert
tool-loop Test returned `READY` without mutation and recorded catalog,
Responses, and tool-output stages.

The Agent draft is **not active yet**. `active_revision_id` is `null`; Bowei’s
explicit Apply remains the only authority to activate it. Do not describe a
successful Test as Apply.

Generation has its own committed profile set derived from the same
authenticated catalog:

| Profile | Exact model | Effort |
|---|---|---|
| `gemini-pro` | `gemini-pro-agent` | `null` |
| `terra-balanced` | `gpt-5.6-terra` | `medium` |
| `sol-max` | `gpt-5.6-sol` | `max` |
| `grok-creative` | `grok-4.5` | `null` |
| `opus-producer` | `claude-opus-5` | `null` |

Default generation profile: `gemini-pro`.

## Native generation receipt

The first full native v3 path completed without a browser scraper:

| Field | Receipt |
|---|---|
| parent job | `gen_9300e7bcf3094f8ab9454213bc4215a4` |
| child job | `job_e1e2900c796149ef861bb06aba8244a0` |
| piece | `CS-20260728-055047-8244a0` |
| exact model | `gemini-pro-agent` |
| route | `http://127.0.0.1:8318/v1/responses` |
| kernel | `3b14f2697c862db9` |
| source/render code SHA-256 | `0962d6ac6e09abde7ebb032c44e70ee21314d658ae625bc55f5f712f7bf23d0b` |
| audio SHA-256 | `326c200c4fc3da0572f05c6d97ddcd118d2d7fd6596b58d81c32f9124a1ded18` |
| duration | 106.660563 seconds |
| score | not yet heard/scored |

The exact model response was durably captured before validation and rendering.
Two earlier failed attempts remain visible in Activity with their real terminal
errors; neither created a false piece or replaced existing assets.

## Job truth

- Generation accepts independent batch sizes 1, 2, and 4.
- A durable parent job ID is returned before model work.
- Child generation jobs record exact profile and configuration revision.
- Idempotency prevents duplicate work for a retried request.
- Refresh/reconnect resumes from the server snapshot plus monotonic event
  cursor.
- Cancellation reaches model and render work.
- A cancellation racing with an immutable commit ends
  `cancelled_after_commit`; committed evidence remains.
- Failed render work never replaces an active revision.

Brain jobs use the same durable principles: one stored user message, one pinned
Agent settings revision, idempotent tool calls, cancellation, receipts, and no
authority to apply Agent Settings.

## Quality boundary

Mechanical checks prove:

- code parses against the deterministic Strudel envelope;
- a render process succeeded;
- audio exists, has a positive duration, and matches its receipt;
- a mutation targets the expected piece, revision, and audio SHA;
- UI and API state reconnect consistently.

They do not prove musical quality. Bowei’s listening score on the exact audio
revision is the only music-quality gate.

Final 2026-07-28 cutover readback:

- canonical `:8765` returned 50 pieces, 5 generation profiles, 4 human ratings,
  4 read-only recovery candidates, and the real native prompt/receipt assets;
- audio byte-range seeking returned `206` against the exact native audio SHA;
- all seven SPA routes loaded in a real browser with zero console errors;
- old GUI bookmarks redirect one-way to v3, frozen `.html`/upload links remain
  readable, and old mutation APIs return `404`;
- `bin/v3-truth status` resolves the canonical live database, not a repo-local
  second SQLite store;
- deterministic gates passed: Agent 30/30, runtime truth 16/16, API 29/29,
  Producer UI 14/14, and shared TypeScript 608 passed with 14 explicitly
  skipped conformance tests;
- the native piece remains unscored. This mechanical closure is not a musical
  acceptance claim.

## Refresh checklist

Update this file after any material change to:

- UI build or routes;
- database schema or migration;
- immutable asset layout;
- generation profile set;
- active Agent settings revision;
- prompt-kernel hash;
- legacy/recovery disposition.
