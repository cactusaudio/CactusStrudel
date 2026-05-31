# Research Database — Design + Implementation Plan

**Mission.** Every human-saved correction is research data. Build a schema-stable layer over the existing `corpus` + `brain-edit-backups/` so each save becomes a queryable revision with intent, diff, and (eventually) score-delta — then periodically synthesize harness-improvement proposals from this signal.

**Status.** Designed 2026-05-28. Bowei greenlit: covers = revision; generate = new node; v1 = code diff only; audio-feature diff deferred until a real "listening" model arrives.

---

## 1. Topology

```
producer-brain/
├── corpus-2026-05-21.jsonl        # ← unchanged, backward-compatible
├── revisions.jsonl                # NEW: schema-stable index, one revision per line
└── ...

runtime/cc-bridge/
└── brain-edit-backups/            # ← reused (Codex already builds these)
    └── <yyyymmdd-hhmmss>-<piece>/
        ├── manifest-entry.before.json   # existing
        ├── reason.txt                   # existing
        ├── <basename>.js                # existing — pre-edit snapshot
        ├── <basename>.mp3               # existing — pre-edit audio
        ├── <basename>.txt               # existing — prompt at gen time
        ├── diff.txt                     # NEW: unified diff (code only)
        └── revision.json                # NEW: full revision entry (resilient mirror of jsonl row)
```

**Why both `revisions.jsonl` AND per-revision files?**
- jsonl = fast scan, grep, aggregate. The spine.
- per-revision dir = preserves the full diff + before-state forever. Survives jsonl corruption / accidental truncation.
- Reuses the existing backup directories — zero file duplication, zero schema churn.

**No new file storage burden.** The backup dirs already exist for every save. We just write 2 extra small files into each.

---

## 2. Revision schema

One line per revision in `producer-brain/revisions.jsonl`:

```json
{
  "id":          "rev-<unix-ms>",
  "ts":          "2026-05-28 03:45:12",
  "piece":       "UI-1779898605",
  "source":      "brain-action" | "manual-edit" | "backfill",
  "intent": {
    "kind":      "filter" | "gain" | "effect" | "structure" | "melody" | "tempo" | "palette" | "freeform" | null,
    "target":    "lead" | "chords" | "bass" | "drums" | "global" | null,
    "params":    {"lpf":"1800","lpq":"4"} | {} | null,
    "brain_reply_id":       "rep-..." | null,
    "natural_lang_request": "给 lead 加点 lpf" | null
  },
  "code": {
    "before_chars": 1234,
    "after_chars":  1276,
    "delta_chars":  42,
    "added_lines":   3,
    "removed_lines": 1
  },
  "from_sha":     "abc...",
  "to_sha":       "def...",
  "from_dur":     63.5,
  "to_dur":       63.5,
  "score_before": 6.0,        // populated at revision time from corpus
  "score_after":  null,       // populated when next score event fires for this piece
  "score_delta":  null,       // computed when score_after set
  "backup_dir":   "runtime/cc-bridge/brain-edit-backups/20260528-021314-UI-1779898605"
}
```

**Field guarantees**
- `id`, `ts`, `piece`, `source`, `backup_dir` — always present.
- `intent.kind / target / params` — best-effort. May be `null` for manual edits where we don't introspect.
- `score_before` — read from corpus at revision time. `null` if piece unscored at that moment.
- `score_after` — back-filled by `_api_score`. `null` if Bowei hasn't rescored since this revision (or revision is the most recent and superseded by next edit before rescore).

### Intent taxonomy (closed set)

| `kind` | Trigger | `params` example |
|---|---|---|
| `filter` | `.lpf/.hpf/.lpq` adjustments | `{lpf:"1800",lpq:"4"}` |
| `gain`   | `.gain/.duck*` adjustments   | `{gain:"0.6"}` |
| `effect` | `.room/.delay/.crush/.shape/.vib` | `{room:"0.9",delaytime:"3/16"}` |
| `structure` | `arrange()/stack()/section` changes | `{added_section:"bridge"}` |
| `melody`  | `note()/n()/.scale()/.arp` content changes | `{notes_changed:true}` |
| `tempo`   | `setcpm()` value | `{from:"110/4",to:"124/4"}` |
| `palette` | `.s()/.bank()` swaps | `{from:"square",to:"triangle"}` |
| `freeform`| anything else | `null` |
| `null`    | unparseable / not introspected | `null` |

### Source taxonomy

- `brain-action` — Opus brain's local-executor parsed a structured action and applied it. `intent` is precise.
- `manual-edit` — Bowei (or any UI) called `/api/update-piece-code` directly. `intent.kind` likely `freeform`; `params` mostly null.
- `backfill` — imported one-shot from existing `brain-edit-backups/` at deployment time. Marker so aggregation can exclude or down-weight historical entries.

---

## 3. Integration points

### 3.1 Write triggers (revision created)

**A. `_execute_brain_code_action(action, user_text)` — brain-action path:**
After successful manifest write, before returning. Call:
```python
self._record_revision(
    piece_name=entry['name'],
    entry_before=entry_snapshot_before_edit,
    entry_after=updated_row,
    code_before=old_code,
    code_after=new_code,
    backup_dir=bdir,
    source='brain-action',
    intent={
        'kind': action.get('kind'),         # e.g., 'filter'
        'target': action.get('target'),     # e.g., 'lead'
        'params': {k:v for k,v in action.items() if k in ('lpf','lpq','gain','room','delay','...')},
        'brain_reply_id': None,             # filled later if needed
        'natural_lang_request': user_text,
    },
)
```

**B. `_api_update_piece_code` — manual-edit path:**
After successful manifest write. Call:
```python
self._record_revision(
    piece_name=name,
    entry_before=entry_before,
    entry_after=updated_entry,
    code_before=old_code,
    code_after=code,
    backup_dir=backup,
    source='manual-edit',
    intent={
        'kind': body.get('intent_kind'),     # optional from request body
        'target': body.get('intent_target'), # optional from request body
        'params': body.get('intent_params'), # optional
        'brain_reply_id': None,
        'natural_lang_request': body.get('intent_text'),
    },
)
```

Web UI may eventually pass these fields when a save is triggered by a brain suggestion the user manually pasted. v1 may leave them blank.

### 3.2 Score backfill (`_api_score`)

After updating the corpus row's `score_bowei`, walk `revisions.jsonl` in reverse and find the most recent revision for this piece with `score_after == None`. Set:
- `score_after = new_score`
- `score_delta = new_score - score_before`  (if both numeric)

Then rewrite that line in revisions.jsonl. Or append a tombstone? — No, in-place update is cleaner. revisions.jsonl is small.

Edge case: if Bowei rescores a piece multiple times without editing between scores, only the FIRST rescore populates the latest open revision. Subsequent rescores update the corpus but find no open revision to fill (all already filled). That's correct: a re-score without a revision in between has no associated edit-delta to measure.

### 3.3 Read

**`GET /api/revisions?piece=X&n=N`**
Returns `{ items: [...], total: N }` of latest N revisions for piece X. Used by the Data tab's Revisions timeline view.

**`GET /api/revisions?n=N`**  (no piece)
Returns latest N across all pieces — for global aggregation / summary script bootstrap.

---

## 4. Diff computation

Use Python's `difflib.unified_diff` with `lineterm=''`. Stats from line counts.

```python
def _diff_stats(old, new):
    old_lines = old.splitlines(keepends=False)
    new_lines = new.splitlines(keepends=False)
    diff = list(difflib.unified_diff(old_lines, new_lines, fromfile='before', tofile='after', lineterm=''))
    added   = sum(1 for l in diff if l.startswith('+') and not l.startswith('+++'))
    removed = sum(1 for l in diff if l.startswith('-') and not l.startswith('---'))
    return {
        'diff_text': '\n'.join(diff),
        'added_lines': added,
        'removed_lines': removed,
    }
```

Code stats also include `before_chars / after_chars / delta_chars` (`len()` based, includes whitespace).

---

## 5. Backfill of pre-feature history

One-shot script `bin/research-backfill` scans `runtime/cc-bridge/brain-edit-backups/*/`. For each dir:

1. Parse `<yyyymmdd-hhmmss>-<piece>` from dir name → revision ts + piece.
2. Read `manifest-entry.before.json` → entry_before (has score_bowei, sha, dur at that point).
3. Read `reason.txt` → natural_lang_request.
4. Read `<basename>.js` from backup → code_before.
5. Determine code_after:
   - If a later backup exists for same piece, its `<basename>.js` = this revision's code_after.
   - Else, the current piece file at `producer-brain/pieces/<basename>.js` = code_after.
6. Determine intent (heuristic):
   - If `reason.txt` starts with a recognizable filter / gain pattern (from brain actions), parse it.
   - Else: `source='backfill'`, `intent.kind='freeform'`.
7. Compute diff + stats.
8. Write `diff.txt` + `revision.json` into backup dir.
9. Append to `revisions.jsonl`.

Idempotent: if `revision.json` already exists in a backup dir, skip.

---

## 6. Periodic summarization

`bin/research-summary` reads `revisions.jsonl` and produces `docs/research/summary-<date>.md`:

- Group by `intent.kind × intent.target`.
- For each group: count, mean(score_delta), std(score_delta), exemplar revision ids.
- Also: cross-source comparison (brain-action vs manual-edit) — does brain do better on filter-lead?
- If a group shows N≥3 + mean_delta ≥ +0.5 + std < 0.5 → **strong signal**. Auto-append a proposal to `cc-bridge/proposals.jsonl` (`status: pending`) suggesting harness-level integration (e.g., "bake default `.lpf(1800).lpq(4)` into lead synthesis prompt").
- If a group shows mean_delta ≤ −0.3 → also flag as warning (don't auto-propose, but list).

The summary doc is human-readable, the proposal is human-decidable. Both paths preserve Bowei's veto.

Run cadence: manual (`bash bin/research-summary`) v1. Future: cron via `schedule` skill, or trigger on every +10 new revisions.

---

## 7. Data tab UI

Each piece card in `data.html` already has Code | Prompt tabs (added 2026-05-25). Add a third tab: **Revisions**.

Click → fetch `/api/revisions?piece=X`. Render as vertical timeline (newest at top):

```
─●─ rev-... · 2026-05-28 03:45 · brain-action / filter / lead
   ├ "给 lead 加点 lpf"
   ├ +.lpf(1800).lpq(4)
   ├ score: 7.5 → (pending rescore)
   └ ▸ view full diff (collapsed; clickable to expand)
─●─ rev-... · 2026-05-26 21:11 · manual-edit / freeform
   ├ +12 chars · +3/−1 lines
   ├ score: 6.0 → 6.8  (Δ +0.8)
   └ ▸ view full diff
```

Style: gold-led timeline (matching the rest of UI), monospace for diff snippets, score Δ chip with semantic color (green for +, red for −, muted for null).

---

## 8. What this does NOT do (deliberate scope cuts)

- **No audio-feature diff in v1.** Bowei's call: audio is reproducible; we wait for a real listening model.
- **No automatic rollback** of edits, even ones that lowered score. The user owns truth.
- **No corpus schema change.** Forward-compat is sacred.
- **No new database engine.** Plain jsonl, plain dirs.
- **No "revert this revision" button.** The backup dir has everything to manually restore; v1 doesn't expose it. Future: maybe.
- **No generate-then-save tracking as a revision.** A new generation is a new node (new corpus entry, new UI-XXX). Revisions are strictly mutations of an existing piece.

---

## 9. Acceptance gates

Before declaring v1 done:

1. `bin/health` shows `revisions <N>` in its output.
2. Triggering a brain action via chat → adds a row to `revisions.jsonl`, writes `diff.txt` + `revision.json` to backup dir.
3. Triggering manual Save+Render → same, with `source='manual-edit'`.
4. Calling `/api/score` after a revision → that revision's `score_after` and `score_delta` get populated.
5. `GET /api/revisions?piece=X` returns the list correctly.
6. `bin/research-backfill` runs once, imports historical backups, idempotent on re-run.
7. `bin/research-summary` runs, produces summary md + 0+ proposals.
8. Data tab Revisions toggle on a piece card opens the timeline; diff is readable.
9. `AGENTS.md §5` documents the new file; `bin/state-refresh` includes count.
10. No regression in existing save flows (both manual and brain).

---

## 10. Forward-compat hooks (don't build now, but leave room)

- **`revision.audio_features` field** — when a future model can listen, populate from `packages/analyzer` features at write time.
- **`revision.user_note` field** — let Bowei optionally type "this fixed X" alongside the save.
- **`revision.tags` array** — free-text tags for queryability.
- **Cross-revision diffs** — compare any two revisions of same piece for "what got better between rev-A and rev-B".
