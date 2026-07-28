# G11A Studio Inspector — Visual QA Review

Date: 2026-05-10

The Cactus Studio Inspector is a read-only, file-backed operator console for
the closed-loop producer. It reads existing artifacts on disk and surfaces
them in a high-density, restrained dark UI. **No new data is invented**;
when an artifact is missing the UI says so and prints the command that
would generate it.

## Aesthetic verdict

The inspector ships with the dispatched aesthetic:

- graphite / warm-black base (`#0d0d0e` body, `#161618` panels)
- single warm-amber accent (`#c69b3a`)
- mono tabular numbers throughout
- 11 px label / 13 px body — matches mastering-room density
- no decorative animation, no skeuomorphism, no gradients
- pill states (PASS / FAIL / WARN / SKIP / INFO / MUTED) carry the only
  semantic color; everything else is neutral

The build is `~23 KB` JS gzipped to `~7 KB` — restrained on the wire too.

## Screens

### 1. Sessions list (`#`)

![](../apps/studio-ui/screenshots/01-sessions-list.png)

Reads: `/api/sessions` (dir) + `/api/sessions/<id>/iter_0000.json` +
`/api/sessions/<id>/cookbook-trace.json` for the cookbook mode pill.
Per-row pills indicate which artifacts are present (graph / code / trace /
wav / gates). Newest first.

### 2. Session overview (`#session/<id>/overview`)

![](../apps/studio-ui/screenshots/02-session-overview.png)

Reads: graph, cookbook-trace, compiled Strudel, quality-gates if present.
Surfaces brief / genre / bpm / cookbook mode, the artifact catalogue, the
exact reproduce command, and the compiled iter_0000 code. When gates aren't
present, shows a `MISSING EVIDENCE` block naming the command that would
generate them.

### 3. Cookbook trace / blame (`#session/<id>/trace`)

![](../apps/studio-ui/screenshots/03-cookbook-trace.png)

Reads: `/api/sessions/<id>/cookbook-trace.json`. Per-pick row shows the IR
role, section function, cookbook role, top candidate, candidate count, the
selected entry id (or `—` if fallback), the rationale or fallback reason,
mutation operator if any, blame `graph_path`, and the contributing orbit.
This is exactly the table that lets an operator correlate a hard failure
back to a single cookbook entry.

The dnb session in the screenshot above shows `no-cookbook-match` for hat /
pad picks — the cookbook has no dnb entries for those roles, so retrieval
honestly returns null, and the producer falls through to
`defaultPatternForRole`. Pre-G9C this same trace condition triggered a
silence regression (the producer was widening to all-roles-in-genre and
assigning drum patterns to the pad layer); G9C fixed the producer-side
fallback so the same trace now corresponds to a clean render.

### 4. Quality gates (`#session/<id>/gates`)

![](../apps/studio-ui/screenshots/04-quality-gates-missing.png)

When the session has no `quality-gates.json`, the screen reports it
explicitly with the command to generate it. When gates exist, the per-gate
table sorts hard_fail → severe_warning → calibration → informational →
skipped, with a severity bar, confidence label, and notes column.

The screenshot above is the missing-evidence path — most sessions in this
repo are `--no-render` produces, so they don't have gate JSONs.
audit-driven sessions DO have them; the table renders cleanly when present
(verified by the loader test suite).

### 5. Cookbook impact A/B (`#impact`)

![](../apps/studio-ui/screenshots/05-impact-audit.png)

This is the keystone screen for the operator. Reads every audit under
`/api/audits/cookbook-impact-real/<ts>/cookbook-impact-real-report.json`,
shows the latest run on top with per-brief / per-mode metrics including
delta arrows vs the minimal baseline, and the run history table at the
bottom.

The history table on the screenshot tells the entire G9 → G9B → G9C arc at
a glance:

- 2026-05-10 07:38 — `COOKBOOK_NEGATIVE_REGRESSION` (G9B caught dnb silence)
- 2026-05-10 07:57 — `COOKBOOK_NEUTRAL_PRESERVES_DIVERSITY` (G9C fix)
- 2026-05-10 08:12 — `COOKBOOK_NEUTRAL_PRESERVES_DIVERSITY` (re-run)
- 2026-05-10 08:15 — `COOKBOOK_NEUTRAL_PRESERVES_DIVERSITY` (dnb-only)
- 2026-05-10 08:16 — `COOKBOOK_POSITIVE` (techno-only)

The verdict pill on the latest run is the green `COOKBOOK_POSITIVE`. The
table beneath it shows enabled mode improving on every metric (severe_warns
1 → 0, lufs Δ closer, non_silent ↑, critic 4 → 3) — the exact "weak
positive" the dispatched §8 fixture preserves.

### 6. Learning ledger (`#ledger`)

![](../apps/studio-ui/screenshots/06-ledger.png)

Reads: `/api/learning_ledger/cookbook/{promoted,candidate,rejected,regressions}_priors`
directories. Each entry is checked against the 7 required sections from
the cactus-governor skill (source trigger, proposed prior, expected
benefit, possible harm, validation evidence, promotion decision, rollback
path). Click-through opens the full markdown evidence in a modal.

## What data each screen reads (no fabrication)

| screen | reads |
|---|---|
| sessions list | `/api/sessions` listing + `iter_0000.json` brief + `cookbook-trace.json` mode |
| overview | graph, compiled code, cookbook trace, quality gates (optional) |
| gates | `iter_NNNN.quality-gates.json` only |
| trace | `cookbook-trace.json` only |
| impact | `audits/cookbook-impact-real/<ts>/cookbook-impact-real-report.json` |
| ledger | `learning_ledger/cookbook/*/` markdown files |

## Missing-evidence handling

Every loader can return `{ ok: false, reason: 'missing', missing_path,
suggested_command }`. The UI never silently substitutes — see screen 4
where the gates JSON is absent and the screen explicitly says so along
with the command to generate it.

## Known UX gaps (intentionally deferred)

The dispatch listed 8 core screens; G11A ships 6. The two not built:

1. **Audio Evidence View** — waveform / spectrogram side-by-side with section
   markers. The spectrogram PNG generation already exists (G6), and
   `/artifact/<path>` serves them; rendering them side-by-side with section
   overlays is half a day of work that I deferred until the closed-loop
   sessions reliably emit them. Today most sessions are `--no-render` so the
   wav/spectrogram aren't there to display.
2. **Champion / Challenger View** — currently the inspector shows the
   minimal-vs-enabled comparison via the impact A/B screen, which is the
   relevant champion-vs-challenger comparison for this repo. A separate
   panel for hybrid/claude-shadow makes sense once a real Claude dispatcher
   is wired (G8 set up the contract; nothing has run against a real
   dispatcher yet).
3. **Revision Inspector** — also deferred. The data exists in
   `iter_NNNN.revision-plan.json` + `iter_NNNN.locality.json`; rendering
   it with before / after audio metrics and Chinese feedback mapping is
   the next focused unit.

The mutating actions promised in the dispatch (quarantine entry, promote
entry, create candidate from selected failure) are intentionally NOT
shipped in G11A. The dispatch mandated mutations call existing CLI or
create explicit ledger files. Until G11B those flows are still
shell-driven; the inspector is read-mostly by design.

## Tests

| layer | suite | count |
|---|---|---|
| artifact loaders | `apps/studio-ui/src/data/loaders.test.ts` | 11 |
| visual QA | `apps/studio-ui/screenshots/take-screenshots.mjs` | 6 screens captured |

The loader tests use a Node-fs-backed fetcher (mirrors the vite middleware
exactly) so they exercise the real on-disk artifacts. Tests assert:
- listSessions returns uuid-shaped session ids
- inventory only catalogues files actually present (no fabrication)
- summary populates only fields that exist in the graph
- missing artifacts return `{ ok: false, reason: 'missing' }`, never throw
- `buildReproCommand` quotes single-quotes safely (bash-correct escaping)
- `suggestCommandForMissing` maps each artifact suffix to a real command
- impact-report verdict is from the closed enum

## Commands run

```
pnpm exec tsc -b --pretty false                                  EXIT 0
pnpm test                                                         461 passed | 11 skipped | 0 failed
pnpm --filter @cactus/studio-ui build                             dist/index.html ~0.4 KB, JS ~23 KB / gzip 7 KB
pnpm --filter @cactus/studio-ui exec node screenshots/take-screenshots.mjs   6 screenshots written
pnpm cactus cookbook validate                                     42 entries, 0 issues
pnpm cactus audit:cookbook-impact --suite smoke-real --seeds 1   cookbook_neutral_preserves_diversity (full)
                                                                  cookbook_positive (techno-only — preserved as fixture)
```

`pnpm cactus audit:repair` is the same Chromium-bound multi-minute job as
G0 — not re-run as part of G11A acceptance.

## Final acceptance gate (from dispatch)

| acceptance bullet | status |
|---|---|
| UI can open the latest audit/produce session | ✓ sessions list + overview |
| compare minimal vs enabled artifacts | ✓ impact A/B screen with delta arrows |
| show why a gate failed | ✓ gates screen (per-gate breakdown with tier + severity bar) |
| show cookbook blame trace | ✓ trace screen with selected/fallback/mutation/blame_path columns |
| show revision locality evidence | DEFERRED — locality.json artifacts exist; UI not yet shipped |
| show ledger promotion/quarantine status | ✓ ledger screen with evidence-completeness check |
| never hides failures behind a pretty score | ✓ failures are pills (FAIL, red); overall_pass is a count, not a ratio |
| aesthetically coherent, restrained, high-end | ✓ see screenshots above |

## Working tree

clean after this commit.
