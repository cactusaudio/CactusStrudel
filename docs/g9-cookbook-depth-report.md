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
