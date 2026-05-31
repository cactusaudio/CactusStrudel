# Architecture

```
                   ┌──────────────────────────────────────────────┐
                   │              Browser (4 pages)               │
                   │   main.html · data.html · spine.html ·       │
                   │              settings.html                   │
                   └────────┬─────────────────────────┬───────────┘
                            │ HTTP/SSE 8765           │
                ┌───────────▼─────────────────────────▼──────────┐
                │           runtime/serve.py                     │
                │   stdlib HTTP, threaded, single source         │
                │   • /api/generate (slot dispatch)              │
                │   • /api/brain-chat (Opus tools)               │
                │   • /api/settings (UI ↔ user_config.py)        │
                │   • /api/piece/{archive,note,delete}           │
                │   • /api/kernel/fragment{,s}                   │
                │   • /api/cc/stream (SSE long-poll)             │
                └────────┬──────────────────┬─────────┬──────────┘
                         │                  │         │
              ┌──────────▼────────┐ ┌──────▼──────┐ ┌─▼──────────┐
              │ producer-brain/   │ │ ~/.cactus-  │ │ External   │
              │ (data layer)     │ │ strudel/    │ │ backends   │
              │ • corpus.jsonl   │ │ config.json │ │            │
              │ • kernel/*.md    │ │ (0600)      │ │ • AGY CLI  │
              │ • failure-spine  │ │             │ │ • CLIProxy │
              │ • pieces/audio   │ │             │ │ • OpenAI   │
              │ • archive-v0/    │ │             │ │ • Anthr.   │
              │ • checkpoints/   │ │             │ │ • Google   │
              └───────────────────┘ └─────────────┘ │ • xAI      │
                                                    └────────────┘
```

## 4 pages, one server

- **main.html**: workbench — Advanced panel, model dropdown, code editor, chat (right sidebar).
- **data.html**: corpus catalog — 2 trajectory rows (7 category + 7 model), grid of piece cards.
- **spine.html**: failure-spine knowledge base — status filter + search + piece deep-links.
- **settings.html**: configuration — backends, providers, AGY, brain models, dev mode.

All share the same top nav (logo + 4 tabs + sticky gradient). All use the same `--gold` / `米色` color system.

## Server (runtime/serve.py)

Single stdlib HTTP server, threaded. ~3000 lines, organized in clear API method blocks.

Key sections (line-approximate):
- **Constants & registry** (1-80): ROOT derive, AGY_BIN, BACKEND_REGISTRY (7 slots × 2 routes), BACKEND_SLOTS order
- **Handler class** (80-220): do_GET/POST/PUT/DELETE dispatchers
- **API: corpus** (220-510): recent, archive, piece, score, save_piece, update_piece_code, render, rename, archive, delete, note
- **API: backends + settings + setup** (640-820): `/api/backends`, `/api/settings` GET/PUT, `/api/settings/test-backend`, `/api/setup-status`
- **API: generate dispatch** (820-1100): `_api_generate` → cliproxy / direct / agy routes; per-vendor HTTP call helpers
- **CC bridge** (1400-1700): inbox/replies/proposals/tasks SSE long-poll
- **Brain chat + tools** (1900-2700): tool-use loop (OpenAI function-calling format), 9+ brain tools
- **Kernel + spine helpers** (700-900, 2250-2350): editor + tool support

## Config system

3-layer resolution at every read (no startup caching for user_config keys):

```
env vars (CLIPROXY_API_KEY, OPENAI_API_KEY, etc.)
   ↓
~/.cactus-strudel/config.json (mode 0600, machine-local)
   ↓
runtime/user_config.py DEFAULTS
```

`user_config.load()` returns the fully-merged config. `user_config.save(c)` writes only the file layer.

`mask_secrets()` and `unmask_save()` handle the UI round-trip so masked sentinel `••••• (set)` means "keep existing".

## Backend dispatch — 7 slots, 2 routes each

Each slot in `BACKEND_REGISTRY` has:
- `label` (UI display)
- `vendor` (one of: openai / anthropic / google / xai / agy)
- `cliproxy_model` (model name on CLIProxy)
- `direct_model` (model name on vendor's direct API)

`_resolve_slot_route(slot)` returns `{mode, base_url, api_key, model, reason}`:
- If vendor=agy and binary exists → `mode='agy'`
- Elif `cliproxy.enabled AND key present AND cliproxy_model defined` → `mode='cliproxy'`
- Elif `providers[vendor].api_key present AND direct_model defined` → `mode='direct'`
- Else `mode=None` (slot is red unavailable in UI, reason explains)

`_api_generate` and brain's `generate_piece` tool both use this resolver.

## Brain tool-use

`/api/brain-chat`:
1. User text → POST `{text, context}` (clears textarea immediately on send)
2. Server reads user_config to pick chat route (cliproxy preferred, else direct anthropic)
3. Calls `/chat/completions` with `tools: BRAIN_TOOLS` (OpenAI function-calling)
4. If response has `tool_calls` → execute each via `_exec_brain_tool` → append `role:tool` results → loop
5. When response has no tool_calls → it's the final answer → append to BRAIN_HISTORY + REPLIES, return

Max 5 iterations per chat round (safety bound).

Tools register in `BRAIN_TOOLS` (OpenAI schema) + dispatch in `_exec_brain_tool` + implement as `_brain_tool_*`.

## Checkpoints

`bin/checkpoint-create <name> "<description>"`:
- Tars in-scope paths (runtime/, producer-brain/kernel/, producer-brain/corpus.jsonl, etc.)
- Writes `producer-brain/checkpoints/<name>/{snapshot.tar.gz, scope.txt, manifest.md, rollback.sh, state-*}`
- Updates `.latest` pointer

Rollback: `bash producer-brain/checkpoints/<name>/rollback.sh`.

Always checkpoint before architectural changes. See `dev-workflow.md`.

## Critical contracts (do not break)

1. **corpus.jsonl schema_v2**: every entry has `schema_version`, `i`, `name`, `genre_code`, `category`, `source` (slot key), plus `js/mp3/prompt/sha/dur/ts`. New writes MUST go through `_build_corpus_entry()`.
2. **Atomic writes**: any rewrite of corpus.jsonl, failure-spine.jsonl, replies.jsonl, tasks.jsonl, settings/config.json — use `_atomic_write_text()` (tmp + os.replace). Never raw `open(path, 'w')`.
3. **Top nav identical** across main/data/spine/settings — `nav.top` CSS block. Copy verbatim, do not redesign.
4. **米色 = AI, 金色 = user** — color identity convention. Don't reverse.
5. **info-icon pattern** — hide metadata details behind a hover `i` (`runtime/main.html` has the reusable component). Use anywhere "nice-to-have" info clutters the UI.
6. **No edits to producer-brain/kernel/ outside Settings UI** — kernel fragments are user-editable via Settings → Kernel disclosure. Don't write to them programmatically from a feature path.

See `conventions.md` for more.
