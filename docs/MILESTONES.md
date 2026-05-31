# CactusStrudel Milestones

Highest-level history of the runtime + corpus + brain.
Detailed per-phase state lives in `producer-brain/checkpoints/`.

## 2026-05-29 — Opus 4.8 upgrade + full brain chat-coverage

- Brain + Anthropic generation slot upgraded **Opus 4.7 → 4.8**
  (`claude-opus-4-8(xhigh)`; slot `opus-4.8`). 4.7 retired; use 4.8 going forward.
  Older "4.7" entries below are true historical record — left as-is.
- Brain reached **31/31 chat-reachable feature coverage** (11 new tools +
  scratchpad + planning); see `developer/brain-capability-evidence.md`.
- Fixes: concurrent-render port/wav collision; confabulation guard (zero-tool +
  state-assertion → forced tool call); genre-resolver exact-match (psytrance→PT).

## ckpt-25 — Brain tool-use (2026-05-28)

- Opus brain now has 5 tools via OpenAI function-calling (`generate_piece`,
  `list_recent`, `get_piece_code`, `search_corpus`, `score_piece`).
- CLIProxy auto-converts to Anthropic `tool_use`. Verified end-to-end.
- Pilot doc updated: "you have tools — call them". Repo source files locked off
  (`runtime/`, `scripts/`, `docs/`, `bin/`, `archive-gf/`, `producer-brain/kernel/`).
- Fixed `CLIPROXY_MODEL undefined` regression in `_api_brain_chat`.
- Chat input clears immediately on send.

## ckpt-24 — Per-vendor model palette (2026-05-28)

- 7 backend colors finalized per Bowei's spec.
- trajectory header → "X categories, 7 models, Y pieces".
- Synced to per-piece `.m-backend` pill colors.

## ckpt-23 — Model trajectory row (2026-05-28)

- 2nd row of Research Trajectory: 7 model cards (one per backend slot).
- Same structure + detail disclosure as the 7 category cards.
- Clickable to toggle `UI.model` filter.

## ckpt-22 — Note editor + delete flow (2026-05-28)

- Note moved from inline display to expandable `▸ note` panel with editable
  textarea + Save. New `PUT /api/piece/note` endpoint.
- Trash icon on each card → 2-stage modal: archive (soft) or permanent delete.
- `POST /api/piece/archive` (sets `archived_at`), `DELETE /api/piece` (with
  confirm token; removes corpus entry + .js/.mp3/.txt/.json files).
- Archived pieces hidden from default trajectory + grid.

## ckpt-21 — info-icon popup positioning (2026-05-28)

- `.info-icon` reusable component with body-level `position:fixed` popup
  positioned by JS — escapes any ancestor `overflow:hidden`.
- Lowercase `i` (Georgia serif; `text-transform:none !important` overrides
  ancestor uppercase).
- Recent panel horizontal scrollbar killed.

## ckpt-20 — UI info-icon sweep (2026-05-28)

- 7 noisy metadata strings moved behind `info-icon`s: kernel sha/path,
  audMeta sha, codeStat, advPromptStat, build pill, Commands footer,
  piece card sha, hero h-top sha.

## ckpt-19 — Data page Sprint 1 (2026-05-28)

- Free-text search across name/genre/note/extra.
- 6 trajectory cards clickable → category filter.
- Auto-refresh 30s when tab visible.
- Render-failed pieces visible with badge.
- `genre_code` chip per card. `note_bowei` inline.
- localStorage persistence (sort only; filters reset per visit).
- `#piece=NAME` deep-link hash.

## ckpt-18 — Backend registry + CLIProxy live (2026-05-28)

- 6 backend slots: AGY CLI + 5 CLIProxy (Opus 4.7, GPT 5.5, Gemini Flash,
  Gemini Pro, Grok Build). Slot-based dispatch.
- `/api/backends` single source of truth for UI dropdowns.
- `entry.source` field on each corpus entry = slot key (model-version-agnostic).
- CLIProxy implementation: OpenAI-compatible HTTP POST + Bearer auth.
- Smoke verified: Opus 4.7 generates CHP-001 end-to-end.

## ckpt-17 — Severe-six fix (2026-05-28)

- gf path permanently archived to `archive-gf/`.
- `corpus.jsonl` schema unified via `_build_corpus_entry` helper (schema_v2 + `source`).
- `_atomic_write_text` helper; all manifest writes now atomic (tmp + os.replace).
- `ROOT` derived from `__file__`; env overrides for `AGY_BIN`, `CC_SESSION_DIR`,
  `CLIPROXY_KEY_DOC`. Cross-Mac portable.
- Frontend bugs: `boundedSurprise` uses live dropdown options; `advRandomness`
  dead refs removed; Stop All bumps reload-seq.

## ckpt-16 — Pre-fix snapshot (2026-05-28)

Reference state before the severe-six fix. Use `bash rollback.sh` to roll back.

## ckpt 1–15 — Phase 1–15

The genesis phase of the producer-brain + Advanced panel + Research Trajectory
6-card layout. See per-ckpt `manifest.md` for detail.

- Phase 1: kernel introduction (`producer-brain/kernel/*.md` fragments).
- Phase 6: Strudel-native preset library (31 presets).
- Phase 7: vision-hero panel + reference + algorave toggle.
- Phase 11: 31-preset expansion (12+ jazz-electronic presets).
- Phase 12: harmony anchor strengthening (chord-progression library).
- Phase 13: 32 genre codes + archive-v0 separation.
- Phase 14: 6-card Research Trajectory (categories).
- Phase 15: archive hidden from view, category color accents.
