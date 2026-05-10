# G9C Cookbook Regression Triage — Final Report

Date: 2026-05-10

## Verdict per dispatch's own gate

The dispatch said:

> Final acceptance:
> - dnb enabled mode no longer produces non_silent_ratio=0
> - no quarantined/experimental entry is used by default enabled mode
> - cookbook-impact smoke-real is no longer cookbook_negative_regression from the same dnb silence cause
> - if verdict becomes positive for any genre, preserve that case as a regression fixture

Result: **all four met**, plus a stronger outcome on techno specifically.

| acceptance bullet | status |
|---|---|
| dnb non_silent_ratio = 0 | **fixed**: nsr 0.000 → 1.000, hard_fail 2 → 0 |
| no quarantined/experimental retrieved by default | **enforced** in retrieve(); 8 dedicated tests |
| smoke-real no longer cookbook_negative_regression | `cookbook_neutral_preserves_diversity` (full); `cookbook_positive` (techno) |
| positive case preserved as fixture | techno-enabled-weak-positive captured + 4 protection tests |

## Root cause of the dnb silence

`buildPatternBank` in pre-G9C had this fallback chain:

```ts
let legacySnippets = await loadCookbookSnippets(genre.slug, legacyRole);
if (legacySnippets.length === 0) legacySnippets = await loadCookbookSnippets(genre.slug);
```

The second line widened the lookup to **all roles in genre** when the
role-specific JSONL was absent. dnb has no `hat.jsonl` and no `pad.jsonl`,
so the wide lookup returned the kick + snare + bass entries. `pickSnippet`
then randomly assigned a kick pattern (`bd ~ ~ ~ bd ~ ~ ~`) to the pad layer.

The compiler emits `note(...)` for tonal roles (pad, bass, chord, lead).
For pad with `bd ~ ~ ~`, this produced `note("bd ~ ~ ~").s("fm")`. Strudel
cannot parse `bd` as a note name, so the pad rendered as **silence**
across the timeline. With pad active in 5 / 5 sections, the master mix's
`non_silent_ratio` collapsed to ~0.

The audit caught this honestly because:
1. Cookbook-trace.json showed `selected_id=null, fallback_reason=no-cookbook-match` for hat / pad picks
2. The compiled Strudel showed `note("bd ~ ~ ~ bd ~ ~ ~").s("fm")` for pad sections
3. The analyzer reported `non_silent_ratio = 0.000`

The chain was reproducible and attributable in under 200 lines of investigation.

## The fix (one line)

`packages/agent-runtime/src/build-graph.ts`:

```ts
// Pre-G9C
let legacySnippets = await loadCookbookSnippets(genre.slug, legacyRole);
if (legacySnippets.length === 0) legacySnippets = await loadCookbookSnippets(genre.slug);

// Post-G9C
const legacySnippets = await loadCookbookSnippets(genre.slug, legacyRole);
// fall through to defaultPatternForRole when role-specific is empty
```

Net production change: **-1 LOC + role-default fallback that already existed**.

## smoke-real before / after

| brief | metric | minimal | enabled (pre-G9C) | enabled (post-G9C) |
|---|---|---|---|---|
| techno | gate_pass | ✓ | ✓ | ✓ |
| techno | severe_warnings | 1 | 0 | **0** |
| techno | non_silent_ratio | 0.756 | 0.747 | **0.814** |
| techno | critic | 4 | 3 | **3** |
| dnb | gate_pass | ✓ | **✗** | ✓ |
| dnb | non_silent_ratio | 1.000 | **0.000** | **1.000** |
| dnb | hard_fail_count | 0 | **2** | **0** |
| ambient | gate_pass | ✓ | ✓ | ✓ |
| idm | gate_pass | ✗ | ✗ | ✗ (pre-existing, unrelated) |
| dub_techno | rendered | — | — | — (pre-existing render bug) |

Per-genre verdicts (post-fix):

```
audit:cookbook-impact --suite smoke-real --seeds 1               cookbook_neutral_preserves_diversity
audit:cookbook-impact --suite smoke-real --seeds 1 --genres dnb  cookbook_neutral_preserves_diversity
audit:cookbook-impact --suite smoke-real --seeds 1 --genres techno  cookbook_positive
```

## Cookbook trace + blame example

```bash
$ CACTUS_COOKBOOK_MODE=enabled pnpm cactus produce \
    -b 'dnb 174 BPM, 16 bars, rolling reese sub' --no-render --seed 7
$ jq '.picks[] | select(.layer_role == "pad")' <session>/cookbook-trace.json
```

Pre-fix excerpt (preserved as fixture):

```json
{
  "layer_role": "pad",
  "section_function": "drop",
  "cookbook_role": "pad_atmo",
  "candidates_total": 0,
  "selected_id": null,
  "fallback_reason": "no-cookbook-match",
  "blame": {
    "graph_path": "/pattern_bank/patterns/pad/<sec>",
    "post_value": "bd ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ bd ~ ~ ~",
    "contributes_to_orbit": 4,
    "suspected_in_hard_failure": true
  }
}
```

Post-fix excerpt:

```json
{
  "layer_role": "pad",
  "section_function": "drop",
  "cookbook_role": "pad_atmo",
  "candidates_total": 0,
  "selected_id": null,
  "fallback_reason": "no-cookbook-match",
  "blame": {
    "graph_path": "/pattern_bank/patterns/pad/<sec>",
    "post_value": "a3",            ← role default now, not a drum pattern
    "contributes_to_orbit": 4
  }
}
```

## Quarantine + activation policy

`packages/cookbook/src/activation-policy.ts` is the single source of truth
for "where may cookbook serve patterns by default." DEFAULT_POLICY:

| (genre, role) | level | reason |
|---|---|---|
| techno/kick, techno/hat, techno/bass | enabled_default | smoke-real 2026-05-10: weak-positive |
| dnb/kick, dnb/clap_snare, dnb/bass | enabled_default | smoke-real 2026-05-10 post-G9C: neutral |
| dnb/hat, dnb/pad | (default minimal) | no entries; default pattern |
| dub_techno/* | minimal_only | pre-existing render failure pending repair |
| idm/* | minimal_only | minimal-mode hard_fail; cookbook unrelated |
| ambient/pad_atmo | minimal_only | enabled adds severe_warnings; needs investigation |
| any unknown (genre, role) | minimal_only | no smoke-real evidence yet |

The policy is consulted in `selectPrior` BEFORE retrieval. When a (genre,
role) pair is `minimal_only`, the trace records
`fallback_reason: "policy-disabled: <reason>"` and the producer falls
through to `defaultPatternForRole`. No quarantined or experimental entry
can leak through.

Default exclusion list in retrieve():
- `quarantined`, `rejected` — hard-excluded always
- `diagnostic`, `experimental` — gated unless `include_diagnostic: true`
- `accepted_with_warning` — gated unless `allow_warnings: true`

## Production fallback (semantics)

The G9C contract is: producer outputs are always safe; audit outputs are
always honest.

For audit:cookbook-impact:
- raw enabled-mode output is reported even if it hard-fails
- the verdict reflects the raw cookbook performance
- hidden fallbacks would violate audit honesty and are NOT used

For producer (`cactus produce` etc.):
- the default activation policy is conservative — only (genre, role)
  pairs with positive/neutral evidence get cookbook influence
- when policy denies, the producer uses `defaultPatternForRole` (the
  same code path minimal mode uses)
- there is NO silent "tried enabled, fell back to minimal" — there is
  only "policy says minimal_only; trace records why"

This means production is safe by construction (policy gates retrieval),
and the audit can still surface real regressions (it ignores policy and
runs raw enabled mode for measurement).

## Mutation guards

`tryMutate` already validates each mutated entry against the v2 schema
(rejecting structural breaks). G9C adds one more guard:

- `density_down` rejects mutations that produce all-rest patterns. An
  all-rest pattern compiles to silence and would re-introduce the same
  class of failure dnb had. `isAllRest()` covers operators + nested
  groupings + multipliers.

## Tests added (29 new)

- `packages/cookbook/src/activation-policy.test.ts` — 11 tests covering
  per-(genre, role) lookup, default fallback, policy override.
- `packages/cookbook/src/quarantine.test.ts` — 8 tests covering
  retrieval exclusion (quarantined, rejected, experimental,
  accepted_with_warning) + isAllRest mutation guard.
- `tests/integration/dnb-silence-regression.test.ts` — 5 pinned tests on
  the dnb fixture: pre-fix bug preserved, post-fix produces no
  drum-tokens-in-pad, kick still uses cookbook, compiled code never
  emits `note("bd ...")` / `note("sd ...")` / `note("hh ...")`.
- `tests/integration/techno-weak-positive.test.ts` — 4 tests pinning
  the techno positive case: enabled produces different graph than
  minimal, cookbook trace populates blame on every pick.
- `packages/agent-runtime/src/cookbook-prior.test.ts` — extended with
  the new policy-disabled path test.

## Suite total

```
Test Files  52 passed | 3 skipped (55)
Tests       450 passed | 11 skipped (461)
```

(G9 was 382, G9B was 421 — net +29 new G9C tests.)

## Exact commands run

```
pnpm exec tsc -b --pretty false                                            EXIT 0
pnpm test                                                                  450 passed | 11 skipped | 0 failed
pnpm cactus cookbook validate                                              42 entries OK
pnpm cactus cookbook render-audit --changed --dry-run                      38 accepted, 4 experimental, 0 rejected
pnpm cactus audit:cookbook-impact --suite smoke-real --seeds 1             cookbook_neutral_preserves_diversity
pnpm cactus audit:cookbook-impact --suite smoke-real --seeds 1 --genres dnb     cookbook_neutral_preserves_diversity
pnpm cactus audit:cookbook-impact --suite smoke-real --seeds 1 --genres techno  cookbook_positive (upgraded by critic-issue delta)
pnpm cactus cookbook ledger-check                                          OK, 1 promoted, 0 issues
```

`pnpm cactus audit:repair` is the same Chromium-bound multi-minute job
as G0 — not re-run as part of G9C acceptance.

## Remaining gaps + next concrete blockers

1. **dub_techno render failure** — both modes fail to produce a clean
   render. Pre-existing, unrelated to G9C. Investigate next.
2. **idm hard_fail** — both modes fail the same gate. Pre-existing,
   unrelated to G9C. Likely loop_fatigue on the smoke brief.
3. **ambient enabled mode adds severe_warnings (1 → 3)** — gate still
   passes but warnings increased. Currently gated by activation policy
   to `minimal_only`; investigate why enabled adds warnings before
   re-activating.

Per the dispatch's own gate: **G9C delivers `cookbook_positive` on
techno without regressions on any genre, plus quarantine + activation
policy + production fallback + blame trace + 29 protection tests.**

The next focused unit of work is dub_techno render-failure
investigation — but that is **not gating G11**.

## Commit

`G9C cookbook regression triage: dnb silence root cause + narrow fix + activation policy + quarantine`

Working tree expected: clean after this commit.
