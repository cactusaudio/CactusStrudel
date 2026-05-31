# CactusStrudel

A live Strudel music studio: real-time generation through 7 model backends, a
listener-grade catalog GUI, and an action-capable Opus brain — all running
local on the LAN.

```
Advanced panel ─→ /api/generate ─→ backend slot ─→ render ─→ corpus.jsonl
                                       │
       Chat ─→ /api/brain-chat ─→ Opus brain (tool-use) ─┘
                                       │
                                       └─→ Data page (catalog, search, filter)
```

## Current state (milestone — 2026-05-28, ckpt-25)

- **Runtime**: `runtime/serve.py` (Python stdlib, threaded HTTP) + `runtime/main.html`
  (workbench) + `runtime/data.html` (catalog GUI). Port 8765.
- **Backend registry**: 7 slots (1 subprocess + 6 HTTP-API), single source of truth
  in `serve.py` `BACKEND_REGISTRY`. UI never sees model IDs / effort suffixes.

  | Slot | Backend | Model | Color |
  |---|---|---|---|
  | GPT 5.5 (default) | CLIProxy API | `gpt-5.5(high)` | purple `#a855f7` |
  | GPT 5.5x | CLIProxy API | `gpt-5.5(xhigh)` | deep purple `#6d28d9` |
  | AGY CLI | subprocess | Antigravity OAuth | turquoise `#2dd4bf` |
  | Opus 4.7 | CLIProxy API | `claude-opus-4-7(xhigh)` | orange `#fb923c` |
  | Gemini Flash | CLIProxy API | `gemini-3-flash-agent(high)` | sky `#38bdf8` |
  | Gemini Pro | CLIProxy API | `gemini-pro-agent(high)` | deep blue `#1d4ed8` |
  | Grok Build | CLIProxy API | `grok-build-0.1(high)` | silver `#94a3b8` |

- **Producer-brain corpus** (`producer-brain/corpus.jsonl`, schema_v2):
  per-piece `name` (`<CODE>-NNN`), `source` (slot key), `genre_code/preset/label/category`,
  `score_bowei`, `note_bowei`, `note_ts`, `archived_at`, plus standard `js/mp3/prompt/sha/dur`.
- **Archive-v0** (`producer-brain/archive-v0/`): 104 legacy pieces, frozen. Not counted.
- **Genre code registry** (`producer-brain/genre-codes.json`): 32 codes × 6 categories
  drive both the Advanced preset dropdown and the catalog grouping.
- **Kernel** (`producer-brain/kernel/*.md`): 6 fragments compiled fresh per generation;
  editable in-UI via the Kernel disclosure.
- **Opus brain with tool-use**: `/api/brain-chat` uses OpenAI function-calling
  (CLIProxy → Anthropic tool_use). 5 tools: `generate_piece`, `list_recent`,
  `get_piece_code`, `search_corpus`, `score_piece`. Repo source files are locked off.
- **Data page**: catalog grid + 2 rows of trajectory cards (7 category +
  7 model, clickable filters), free-text search, archived/render-failed visibility,
  inline note editor, archive/delete flow with 2-stage confirm.

## Quick start (fresh Mac)

1. Download `cactus-strudel-bundle.tar.gz` + `install-cactus-strudel.command`.
2. Put both in the same folder (e.g. `~/Downloads/`).
3. Double-click `install-cactus-strudel.command`.
4. After install completes, the workbench opens. Open the
   **Settings** tab and configure at least one backend:
   - **CLIProxy** (if you run a local multi-vendor gateway) — URL + key, or
   - **Direct vendor APIs** — paste your OpenAI / Anthropic / Google / xAI key, or
   - **AGY CLI** — already auto-detected if `~/.local/bin/agy` exists.
5. Done. Pick a backend in the dropdown and click Fast Gen.

## Manual start

```bash
cd ~/CactusStrudel
python3 runtime/serve.py
open http://localhost:8765/runtime/main.html
```

The `pnpm` toolchain is required for the render pipeline (Playwright Chromium):

```bash
brew install node pnpm
pnpm install                                          # main repo
(cd refs/strudel-monorepo && pnpm install)            # strudel monorepo
(cd apps/renderer-page && pnpm exec playwright install chromium)
```

## Dependencies

- **Python**: stdlib only (Python 3.10+). No pip deps needed.
- **Node + pnpm**: required for the render pipeline (Playwright Chromium).
- **Backend** (at least one of):
  - **CLIProxy gateway** (optional): a local multi-vendor proxy. URL + key in Settings.
  - **Direct vendor APIs**: OpenAI / Anthropic / Google / xAI keys, each in Settings.
  - **AGY CLI**: `~/.local/bin/agy` (Antigravity OAuth) — auto-detected if installed.

See `docs/SETTINGS.md` for the full schema.

## Configuration

Open `http://localhost:8765/runtime/settings.html` in-app to edit. The
underlying config file lives at `~/.cactus-strudel/config.json` (mode 0600,
machine-local, survives reinstalls).

For scripted overrides, see env vars in `docs/SETTINGS.md` (CLIPROXY_*, OPENAI_API_KEY,
ANTHROPIC_API_KEY, GOOGLE_API_KEY, XAI_API_KEY, AGY_BIN, etc.).

## Endpoints

```
GET  /api/version           → {main_html_build, serve_py_build, server_started}
GET  /api/backends          → {slots: [{key, label, available, reason}]}
GET  /api/recent?n=20       → corpus tail
GET  /api/archive           → archive-v0 index
GET  /api/genre-codes       → registry
GET  /api/revisions         → revision log
GET  /api/gen-status        → in-flight generation jobs
GET  /api/piece?name=X      → {entry, code}
GET  /api/kernel/fragments  → list
GET  /api/kernel/fragment   → content
POST /api/generate          → {slot, extra}  (SSE stream: start/log/error/done)
POST /api/score             → set score+note
POST /api/save-piece        → save edited code as new EDIT-* piece
POST /api/update-piece-code → overwrite existing piece, render, record revision
POST /api/midi              → MIDI export
POST /api/render            → re-render a .js
POST /api/rename-piece      → atomic rename + file moves
POST /api/brain-chat        → Opus brain with 5 tools
POST /api/piece/archive     → set archived_at
PUT  /api/piece/note        → update note_bowei + note_ts
PUT  /api/kernel/fragment   → write fragment + .bak
DELETE /api/piece           → permanent delete + file removal (requires confirm token)
```

## Checkpoints

`producer-brain/checkpoints/`. Each ckpt has `snapshot.tar.gz` + `manifest.md` +
`rollback.sh`. Latest = `25-brain-tool-use`.

Roll back:

```bash
bash producer-brain/checkpoints/<name>/rollback.sh
```

## Older substrate (research)

The `apps/` + `packages/` + `genres/` + `cookbook/` tree from the earlier
"closed-loop producer" research phase is still on disk and importable from the
CLI (`pnpm cactus -- produce -b '...'`). It is not the active path; the current
UX is `serve.py` + Advanced panel + brain. See `docs/architecture.md` for the
research-substrate design.

## License

AGPL-3.0-or-later.
