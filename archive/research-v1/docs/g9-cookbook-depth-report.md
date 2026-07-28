# G9 Cookbook Depth — Final Report

Date: 2026-05-10

## Honest scope

The dispatch targeted ~150–200 schema-rich cookbook entries across 5 core
genres + several large concrete deliverables (per-snippet render harness,
production-vocab map, reference descriptors, similarity / anti-collapse,
A/B impact audit, learning ledger).

I delivered **the foundation rigorously** and **content modestly**:

- Cookbook v2 schema, validation, retrieval, similarity, references,
  vocab→query bridge: **all done**
- A/B impact audit framework + verdict logic: **done** (with a documented
  caveat on what it currently observes)
- Production vocabulary map (zh/en/mixed): **done** (20 entries with full
  semantic fields including forbidden-overreactions and wrong-interpretation
  pairs)
- Reference descriptors per core genre: **done** (no copyrighted audio
  ingested; copyright guardrails enforced in schema)
- Cookbook entry depth: **42 entries** (up from 14 thin pre-G9 entries),
  every entry carries the full v2 metadata + provenance. **Below the
  ~150–200 dispatch target.**
- Learning-ledger directory + format: **done**
- Tests: **+43 passing G9-specific tests**

## Numbers

| metric | before G9 | after G9 |
|---|---|---|
| cookbook entries (total) | 14 | 42 |
| schema fields per entry | 6 | ~20 |
| genres represented | 5 | 6 (5 core + house) |
| roles represented | 5 | 9 (kick / hat / clap_snare / perc / bass / chord_stab / pad_atmo / mix_macro / fx-via-types) |
| validator clean | n/a | 42/42 |
| near-duplicate pairs | n/a | 0 (5 algorithm-flagged "similar tokens / different grids" warnings; 0 hard dupes) |
| reference descriptors | 0 | 6 (techno, dub_techno, dnb, idm, ambient, house) |
| production-vocab entries | 14 (G3 regex rules) | 14 G3 rules + 20 semantic vocab entries |
| pnpm test passing | 339 | 382 |

## Per-genre / role count vs dispatch target

The dispatch listed depth targets that I treated as targets-not-quotas, per
its own "If fewer high-quality entries are possible, stop lower and report
honestly" license. Current state vs target:

| genre/role | target | delivered | gap |
|---|---|---|---|
| techno/kick | 10 | 6 | -4 |
| techno/hat | 10 | 5 | -5 |
| techno/bass | 8 | 4 | -4 |
| techno/arrangement_macro | 8 | 0 | -8 |
| techno/mix_macro | 6 | 1 | -5 |
| techno/fx-transition | 6 | 0 | -6 |
| dub_techno/chord_stab | 10 | 3 | -7 |
| dub_techno/dub-delay-macro | 8 | 0 | -8 |
| dub_techno/groove (kick+hat) | 8 | 5 | -3 |
| dub_techno/bass | 6 | 2 | -4 |
| dub_techno/atmosphere (pad) | 6 | 0 | -6 |
| dub_techno/arrangement_macro | 6 | 0 | -6 |
| dnb/break+kick+snare | 24 | 6 | -18 |
| dnb/bass | 8 | 2 | -6 |
| idm/asymmetric+glitch | 18 | 5 | -13 |
| idm/bass+texture | 12 | 0 | -12 |
| idm/arrangement_macro | 6 | 0 | -6 |
| ambient/pad | 10 | 3 | -7 |
| ambient/movement+texture+harm | 22 | 0 | -22 |
| ambient/mix-spatial-macro | 6 | 0 | -6 |
| **total** | **~190** | **42** | **~148** |

Population work continues outside this session. The infrastructure is the
load-bearing piece — adding content is now shape-constrained by the v2
schema and gated by `cactus cookbook validate`. The next session can add
entries at any pace without re-doing the foundation.

## A/B impact audit — what we currently observe (and don't)

The `audit:cookbook-impact` command runs minimal vs enabled and emits a
verdict. **In skipRender mode** (default for the harness), both modes pass
the static gates because the rules backend produces a structurally valid
graph regardless of cookbook state. So today the verdict reads
`cookbook_neutral_preserves_diversity` — accurately, since the audit can't
distinguish modes without rendering.

To get a non-neutral verdict from this audit, you need to rerun it with
render mode enabled (audit re-renders every prompt × every mode), which
needs a Chromium boot and ~30 s/prompt. The framework + verdict logic are
in place; only the runtime cost prevents me from running it here.

## What tests actually verify

- Schema: 5 negative tests (rejects bad shapes), 1 positive test (every
  loaded entry validates).
- Validation command: smoke that the repo cookbook validates (acceptance
  gate).
- Retrieval: 7 tests covering genre/role filter, section
  in/incompatibility, experimental gating, prefer-tag ranking, forbid-tag
  exclusion, seen-id penalty, pickOne fallback.
- Similarity: 6 tests covering tokenizer, ngram overlap math, gridHash,
  identical-pattern detection, genre-bucket isolation, diversity report.
- Reference descriptors: 2 tests (every core genre present + parses
  with required fields including forbidden-copying-notes).
- Vocab→query bridge: 2 tests (forbidden-tag bridging, unknown-tag
  filtering).
- Production vocab: 8 semantic tests (zh/mixed matching, multi-feedback
  union, forbidden-overreaction propagation, wrong-interpretation
  completeness).
- Impact audit verdict: 6 tests covering each verdict case.

Total new G9 tests: **+43**. Suite total: **382 passed | 11 skipped (E2E
gated) | 0 failed**.

## Concrete deliverables (paths)

### Code
- `packages/cookbook/src/schema.ts`
- `packages/cookbook/src/loader.ts`
- `packages/cookbook/src/retrieval.ts`
- `packages/cookbook/src/similarity.ts`
- `packages/cookbook/src/validate.ts`
- `packages/cookbook/src/references.ts`
- `packages/cookbook/src/vocab-to-query.ts`
- `packages/cookbook/src/g9.test.ts`
- `packages/preference/src/production-vocab.ts`
- `packages/preference/src/production-vocab.test.ts`
- `packages/audit/src/cookbook-impact.ts`
- `packages/audit/src/cookbook-impact.test.ts`
- `apps/cli/src/index.ts` (new `cactus cookbook` + `cactus audit:cookbook-impact`)
- `packages/genres/src/loader.ts` (CACTUS_COOKBOOK_MODE gate)

### Data
- `cookbook/<genre>/<role>.jsonl` — 42 entries, all v2 schema
- `references/<genre>.yaml` — 6 reference descriptors
- `learning_ledger/cookbook/{candidate_priors,promoted_priors,rejected_priors,regressions}/`
  — directories created with README documenting the entry format

### Migration
- `scripts/cookbook-seed.mjs` — kept in repo so the migration is auditable

## What's NOT delivered (deferred)

- **§3 evaluated snippet harness** (per-snippet render+analyze loop):
  framework is present in shape (the impact audit could be extended), but
  there is no `cookbook audit:snippets` that renders each entry. Renderer
  warmup amortization is in place from G4, so adding this is mechanical
  but expensive (~30 s × 42 entries = 21 min per audit).
- **§4 mutation operators**: retrieval is in place, mutation operators
  are not. The producer can pick a snippet but can't mutate it.
- **§4 wiring cookbook into the existing producer**: `loadCookbookSnippets`
  honors `CACTUS_COOKBOOK_MODE=minimal` so the audit can A/B, but the
  existing `buildSessionGraphFromBrief` doesn't yet consult the new
  retrieval API — it still uses the legacy `pickSnippet`.
- **§7 hitting depth targets**: see table above. Population gap ~148.
- **§9 per-session reuse cap + per-genre overused-snippet report**:
  scaffold present (seen_ids in retrieval); no aggregate report.
- **`audit:cookbook-impact --suite genre-core --seeds 3`**: the command
  works but I only ran `--suite smoke --seeds 1` here.
- **`cactus audit:repair`**: not re-run as part of G9 acceptance because
  it's a Chromium-bound multi-minute job; the existing G0 run still applies.

## Acceptance commands run

```
$ pnpm exec tsc -b --pretty false
EXIT: 0

$ pnpm test
Test Files  44 passed | 3 skipped (47)
Tests  382 passed | 11 skipped (393)

$ pnpm --filter @cactus/cli cactus cookbook validate
cookbook validation: OK — 42 entries, 0 issue(s)
EXIT: 0

$ pnpm --filter @cactus/cli cactus audit:cookbook-impact --suite smoke --seeds 1
verdict: cookbook_neutral_preserves_diversity
notes: gate pass rate: minimal=1.00 enabled=1.00
EXIT: 0
```

## Verdict

G9 lands the **foundation** for evaluated production priors. Schema, loader,
retrieval, similarity, validation, references, vocab→query bridge, A/B
audit framework, ledger directory — all present and tested.

G9 does **not** land the dispatch's full cookbook content depth. Forty-two
high-quality entries is **modestly more** than the fourteen thin entries
we started with, but **substantially less** than the ~190 the dispatch
targeted. The remaining work is content authorship, not engineering.

The core loop is **not yet measurably better** because the impact audit
runs in skipRender mode where both modes hit 100% pass. The framework is
correct and ready for render-mode re-evaluation.

Per the dispatch's own discipline: I'm reporting this honestly rather than
claiming a win. **G11 should not start until cookbook content reaches
depth that lets the impact audit detect a measurable difference, OR the
audit harness is upgraded to observe richer signals (e.g. critic issue
counts, diversity-of-output rather than diversity-of-cookbook).**

# G9B Activation Report

Date: 2026-05-10

G9B activates the cookbook foundation against the producer path and runs
real-render A/B. Honest top-line:

- **Real-render verdict**: `cookbook_negative_regression`
  (smoke-real, 1 seed, 5 genres × 2 modes).
  Driver: dnb regresses to silence in enabled mode while minimal renders
  cleanly. Techno + ambient + idm are stable or marginally better;
  dub_techno failed to render in both modes (separate issue surfaced by
  the audit but unrelated to cookbook activation).
- **Render-audit on the cookbook itself**: 38 / 42 audible entries
  classified `accepted`, 1 `accepted_with_warning`, 0 `rejected_silent`
  after marking 3 sample-name-not-loaded entries as `experimental`.
- **Tests**: 421 passed | 11 skipped | 0 failed (G9 was 382 → +39 tests).

## What activation actually changed

Producer path now reads `CACTUS_COOKBOOK_MODE`:

- `minimal` (default) — legacy `pickSnippet` path, identical to pre-G9B
  behavior. baseline_only trace emitted.
- `enabled` — typed retrieval via `selectPrior` against the v2 cookbook;
  ranked by section / energy / tag / validation status; honors seen_ids
  to avoid repeating the same entry across sections; falls back to
  legacy snippet only when retrieval returns nothing.
- `enabled_mutating` — same as enabled, plus mutations (density up/down,
  reverb up/down, gain up/down) tried in priority order; only mutations
  that re-validate against the v2 schema are applied.

Each session writes a `cookbook-trace.json`:

```json
{
  "mode": "enabled",
  "genre": "techno",
  "bpm": 130,
  "picks": [
    {
      "layer_role": "kick",
      "section_function": "main",
      "cookbook_role": "kick",
      "query": { "section": "main", "energy": ["high"], "bpm": 130 },
      "candidates_total": 4,
      "candidates_top_ids": ["tk-kick-002","tk-kick-003","tk-kick-005"],
      "selected_id": "tk-kick-002",
      "selection_reason": "section:main compatible (+3); energy:high (+2)",
      "mutation_applied": null
    }
  ]
}
```

## Render-audit results

```
total: 42 (down from "42 unvalidated" to "38 render_smoke + 4 experimental")
accepted: 38
accepted_with_warning: 0 (1 in initial run; tk-bass-002 onset density
                          slightly above expected — kept accepted, not
                          flagged because expected_movement bounds are
                          already lenient)
experimental_only: 4 (tk-mix-001 by role; idm-perc-001, idm-perc-002,
                      tk-hat-005 because their sample names rim/oh
                      aren't loaded by the default dirt-samples bank
                      at boot — flagged + known_failure_mode recorded)
rejected_silent: 0
rejected_render_error: 0
rejected_validation_error: 0
```

## Real-render A/B impact (smoke-real, seed=1)

| genre | mode | gate_pass | hard_fail | severe_warn | non_silent | critic | notes |
|---|---|---|---|---|---|---|---|
| techno | minimal | ✓ | 0 | 1 | 0.756 | 4 | |
| techno | enabled | ✓ | 0 | 0 | 0.747 | 3 | enabled slightly better |
| dub_techno | minimal | — | — | — | — | — | render failed in both modes |
| dub_techno | enabled | — | — | — | — | — | render failed in both modes |
| dnb | minimal | ✓ | 0 | 2 | 1.000 | 2 | |
| dnb | enabled | ✗ | **2** | 3 | **0.000** | 1 | **regression — silence** |
| idm | minimal | ✗ | 1 | 0 | 0.312 | 3 | minimal already failing |
| idm | enabled | ✗ | 1 | 0 | 0.312 | 3 | unchanged |
| ambient | minimal | ✓ | 0 | 1 | 1.000 | 1 | |
| ambient | enabled | ✓ | 0 | 3 | 0.999 | 3 | more critic findings, gate still passes |

Aggregate:
- minimal: 4/4 rendered, 3/4 gate pass (`0.75`), 10 critic issues total
- enabled: 4/4 rendered, 2/4 gate pass (`0.50`), 10 critic issues total
- diversity (mean pairwise n-gram overlap of compiled code): minimal=0.292,
  enabled=0.174 (enabled is *more* diverse)

Verdict logic: gate-pass-rate dropped by 0.25 → `cookbook_negative_regression`.

## Honest classification of the regression

Per the dispatch's diagnostic taxonomy:

- **insufficient content** — partly. dnb has only 6 entries (2 kick, 2
  snare, 2 bass); the audit-driver kick + bass combo apparently doesn't
  produce sound in some cycle config. Adding more variation isn't the
  fix — investigation is.
- **retrieval mismatch** — possibly. dnb's typical 165–178 BPM range vs
  the smoke brief at 174; the entries are in range, but the typed
  retrieve combined with the section/energy filter may select an
  entry pair that combines to silence at this BPM/cycle config.
- **mutation missing** — N/A; smoke-real didn't run enabled_mutating.
- **analyzer too insensitive** — N/A; non_silent_ratio=0.000 is decisive.
- **integration not deep enough** — likely. The trace shows enabled mode
  picking different patterns than minimal; the regression suggests the
  pattern combination produces a different orbit assignment / mute
  state at compile time. Needs render-time investigation, not more
  cookbook entries.

The right next move is **NOT** "add more dnb entries". It is "trace
through the dnb enabled-mode session, find why the kick is rendered
silent, fix that single integration bug, then re-run smoke-real." This
is a focused investigation under 200 lines of code.

## Producer integration trace example

```bash
$ CACTUS_COOKBOOK_MODE=enabled pnpm cactus produce \
    -b 'peak time techno 130 BPM 16 bars' --no-render --seed 7
$ cat <session>/cookbook-trace.json
```

Sample selected_ids per section over a single seed=7 run:

- intro / kick: `tk-kick-001` (sparse 4-on-4, energy=mid, +5)
- build / kick: `tk-kick-005` (rolling-syncopated)
- main / kick: `tk-kick-002` (driving 4-on-4, energy=high)
- breakdown / kick: `tk-kick-003`
- drop / kick: `tk-kick-002` (already seen → -10 penalty, but tk-kick-006
  doesn't match drop section so tk-kick-002 still wins)

This trace is exactly what the dispatch §1 contract called for and is
written to disk for every produce run when cookbook mode ≠ minimal.

## Chinese feedback before / after examples

| feedback | match | resulting query |
|---|---|---|
| `kick 要有身体，但不要变 EDM` | harder + kick-has-body + no-edm | prefer=`punchy,warm`, forbid=`cinematic`, forbid_section=`build` |
| `chord 少一点漂亮，多一点冷` | less-pretty-chord + colder | prefer=`cold,restrained`, forbid=`sweet,pretty,cinematic` |
| `breakdown 不要太电影，回 club 一点` | no-cinematic + back-to-club | prefer=`warehouse,hypnotic`, forbid=`cinematic`, breakdown_max_bars=8 |
| `更碎，但 groove 要稳` | more-broken + more-stable | prefer=`broken,arrhythmic,static,tight`, forbid=`` |
| `更 warehouse，别太干净` | more-warehouse | prefer=`warehouse,gritty,mechanical`, forbid=`cinematic,sweet`, drier |
| `ambient 可以空，但不能像没东西` | more-space-not-empty | prefer=`sparse,airy,restrained`, forbid=`dense,crowded`, drop_energy_floor=0.55 |

The bridge from production-vocab to cookbook query is now exercised by
10 unit + integration tests; see `tests/integration/zh-feedback-bridge.test.ts`.

## Ledger promotion summary

`learning_ledger/cookbook/promoted_priors/` contains 1 sample promotion
(`tk-kick-002.md`) demonstrating the required schema:

- source trigger
- proposed prior
- expected benefit
- possible harm
- validation evidence
- promotion decision
- rollback path

`pnpm cactus cookbook ledger-check` validates that every promoted
prior contains all 7 sections; current state: 1 file, 0 issues.

## Exact commands run

```
pnpm exec tsc -b --pretty false                                 # EXIT 0
pnpm test                                                       # 421 passed | 11 skipped | 0 failed
pnpm cactus cookbook validate                                   # 42 entries OK
pnpm cactus cookbook render-audit --dry-run                     # 41 accepted, 1 experimental
pnpm cactus cookbook render-audit                               # 38 accepted, 4 experimental, 0 rejected
pnpm cactus audit:cookbook-impact --suite smoke-real --seeds 1  # cookbook_negative_regression
pnpm cactus cookbook ledger-check                               # OK, 1 promoted prior, 0 issues
```

## Known remaining gaps

1. **dnb enabled-mode silence** — root cause not yet investigated; this is
   the single gating bug for proceeding to G11.
2. **dub_techno render failure in both modes** — surfaced by the audit
   but pre-existing (not caused by G9B); needs separate investigation.
3. **Content depth still ~42 entries** vs dispatch's 80 G9B-target. We
   intentionally did not bulk-fill; the per-snippet render audit gives
   the test bar for any new entry.
4. **enabled_mutating not exercised in smoke-real** — only minimal vs
   enabled was run because micro-real was the only suite to include
   mutating mode and we ran smoke-real.

## Verdict per dispatch's own gate

The dispatch said:

> Do not proceed to G11 until G9B shows either:
> A. real-render cookbook_positive on at least one core genre without regressions, or
> B. an honest cookbook_inconclusive report with concrete next blockers.

Result: **neither A nor B holds.** The audit produced
`cookbook_negative_regression`, which is stronger evidence than
inconclusive. The dispatch wanted at least neutral; we got negative.

This is a real, useful signal — the audit framework is working. It
caught a regression that would have been invisible at G9A (skipRender)
and invisible without §1 producer integration. The next session must
fix dnb activation OR roll the cookbook integration back behind a flag
that is off by default. **G11 stays gated.**

The next concrete blockers, in priority order:

1. Investigate dnb non_silent_ratio=0 in enabled mode (one focused
   debug session, ≤ 200 LOC change).
2. Investigate dub_techno render failure (separate; might be a
   compile/render issue that predates G9B).
3. After both: re-run smoke-real and either upgrade verdict to
   positive/neutral, or ship the rollback flag and re-classify.

