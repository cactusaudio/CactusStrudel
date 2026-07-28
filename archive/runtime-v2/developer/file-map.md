# File map

What each major file/folder owns. Edit only files in your designated lane.

## Runtime (the live server + UI)

| Path | What it owns | Edit triggers |
|---|---|---|
| `runtime/serve.py` | The HTTP server. All API endpoints. Backend dispatch. Brain tool-use loop. | Adding a new endpoint, fixing a backend bug, refactoring dispatch |
| `runtime/main.html` | Workbench page (Advanced panel, dropdown, code editor, chat sidebar) | UI changes on the workbench |
| `runtime/data.html` | Catalog page (2 trajectory rows + grid) | Changes to corpus browsing |
| `runtime/spine.html` | Failure-spine knowledge base UI | Spine UI changes |
| `runtime/settings.html` | Settings UI (backends, providers, AGY, dev mode) | New config fields, layout fixes |
| `runtime/user_config.py` | Config loader. 3-layer resolution. Mask helpers. | Adding a new persisted config field |
| `runtime/prompt_kernel.py` | Compiles `producer-brain/kernel/*.md` fragments into a single prompt | Rarely — kernel compiler logic |
| `runtime/cc-bridge/*.jsonl` | Chat history, inbox, replies, transcript, proposals, tasks. | Never edit by hand. Append-only via server. |
| `runtime/cc-bridge/.kick` | One-byte trigger file for Claude Code bridge | Never edit |
| `runtime/cc-bridge/brain-edit-backups/` | Per-piece backup before brain-led edits | Never edit |

## Producer-brain (data layer)

| Path | What it owns | Edit triggers |
|---|---|---|
| `producer-brain/corpus.jsonl` | Active corpus (schema_v2 entries) | Only via `_build_corpus_entry()`. Atomic rewrites. |
| `producer-brain/genre-codes.json` | 32 genre codes × 6 categories registry | Adding a new genre/category — single source of truth |
| `producer-brain/kernel/*.md` | Compiled-into-prompt knowledge fragments (00-50-*) | Via Settings UI Kernel disclosure. NOT via code paths. |
| `producer-brain/failure-spine.jsonl` | Active spine (post-2026-05-28) | Brain `add_spine_entry` / `update_spine_status` tools. Atomic on update. |
| `producer-brain/archive-v0/` | FROZEN: 104 legacy pieces + 20 legacy spine entries. Read-only. | Never write here. |
| `producer-brain/pieces/*.js` | Strudel JS source per piece | Created by generate pipeline; updated by `update_piece_code` |
| `producer-brain/audio/*.mp3` | Rendered mp3 per piece | Created by `apps/cli/src/auto-render.ts` |
| `producer-brain/prompts/*.{txt,json}` | Prompt snapshots per piece | Created by generate pipeline. .json = structured meta. |
| `producer-brain/checkpoints/<name>/` | Rollback-able snapshots | Created by `bin/checkpoint-create`. Never edit by hand. |
| `producer-brain/revisions.jsonl` | Append log of code edits per piece | Atomic rewrites |
| `producer-brain/dev-mode-audit.jsonl` | Brain's audit trail in Developer Mode | Append-only by `_dev_audit()` |

## Docs

| Path | What it owns |
|---|---|
| `README.md` | Top-level user-facing intro + quick-start |
| `CLAUDE.md` | Project-specific Claude Code hard rules (top of repo) |
| `docs/PACKAGING.md` | Canonical tar build + installer recipe |
| `docs/SETTINGS.md` | Config schema + env var table |
| `docs/MILESTONES.md` | Sprint history (high-level only) |
| `docs/cactus-strudel-opus-pilot.md` | Brain's persistent operating pilot (loaded in every chat) |
| `docs/architecture.md` | Older architecture doc (research substrate phase) |
| `developer/` | YOUR knowledge base (this folder) |

## Scripts + tooling

| Path | What it owns |
|---|---|
| `bin/checkpoint-create` | Snapshot scope-paths into a ckpt |
| `bin/checkpoint-rollback` | Restore from a ckpt |
| `bin/install-cactus-strudel.command.template` | Universal installer template — copy + ship |
| `bin/deploy-cactus-strudel.command.template` | (legacy v2 installer, use install instead) |
| `bin/cactus-strudel-postdeploy.md.template` | Post-deploy dispatch for target Claude Code |
| `bin/health` | Quick health probe (status, port, log tail) |
| `scripts/*.sh`, `scripts/*.mjs`, `scripts/*.py` | Various one-off operations — not in main runtime path |

## Apps (research substrate)

| Path | What it owns |
|---|---|
| `apps/cli/src/auto-render.ts` | The render pipeline. Called by save-piece + update-piece-code + generate flows. Critical for any new audio. |
| `apps/cli/src/midi-export.ts` | MIDI export (used by `/api/midi`) |
| `apps/renderer-page/` | Vite app loading strudel.cc engine for headless render. Uses `refs/strudel-monorepo/`. |
| `apps/cli/{audits,sessions,dist}/` | Research outputs — gitignored. Never in tar. |

## Packages (research substrate)

| Path | What it owns |
|---|---|
| `packages/ir/` | SessionGraph IR types |
| `packages/agent-runtime/` | Older brief→graph→produce pipeline (CLI `produce`) |
| `packages/genres/` | Per-genre YAML data + applier |
| Other `packages/*` | Various research-era libs. Generally don't touch from runtime work. |

## refs/ (required for render)

| Path | What it owns |
|---|---|
| `refs/strudel-monorepo/packages/` | @strudel/* source. Required by renderer-page vite alias. |
| `refs/strudel-monorepo/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml,tools/,.nvmrc}` | Required for the monorepo's own pnpm install |
| All other `refs/strudel-monorepo/*` | EXCLUDED from tar — rebuilt by pnpm install on target |
| `refs/strudel-songs/` | 885MB ref audio. EXCLUDED from tar. Not used at runtime. |

See `docs/PACKAGING.md` for the canonical tar include/exclude list.
