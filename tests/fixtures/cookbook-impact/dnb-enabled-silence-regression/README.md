# dnb enabled-mode silence regression — captured 2026-05-10

## Brief
`dnb 174 BPM, 16 bars, rolling reese sub` (seed=7)

## Symptom (pre-G9C)
- minimal mode: renders cleanly, `non_silent_ratio = 1.000`, gate pass.
- enabled mode: `non_silent_ratio = 0.000`, hard_fail_count = 2, gate fail.

The smoke-real audit verdict was `cookbook_negative_regression` driven by this
case alone (techno, ambient, idm were neutral or unchanged; dub_techno had a
pre-existing render failure).

## Root cause
Build-graph fallback chain in `buildPatternBank` widened the role-specific
cookbook lookup to **all roles in genre** when the role-specific JSONL file
was missing:

```ts
let legacySnippets = await loadCookbookSnippets(genre.slug, legacyRole);
if (legacySnippets.length === 0) legacySnippets = await loadCookbookSnippets(genre.slug);
```

dnb has no `hat.jsonl` and no `pad.jsonl`. With this widening, the hat layer
got randomly assigned a snare pattern (`~ ~ ~ ~ sd ~ ~ ~`) and the pad layer
got kick / snare / bass patterns (`bd ~ ~ ~ bd ~ ~ ~`, `<a1 a1 c2 a1>`).

The compiler emits `note(...)` for tonal roles (pad, bass, chord, lead). For
the pad, this produced `note("bd ~ ~ ~ bd ~ ~ ~").s("fm")` — Strudel cannot
parse "bd" as a note name, so the pad rendered as **silence** across most of
the timeline. With pad active in 5 / 5 sections covering the whole arrangement,
the master mix's `non_silent_ratio` collapsed to ~0.

## Fix (G9C)
`buildPatternBank` no longer widens to all-roles. When the role-specific
cookbook is empty, it falls through to `defaultPatternForRole(role)` — a
role-appropriate default like `[~ hh]*4` for hat or `a3` for pad.

## Artifacts in this fixture

- `pre-fix-enabled/` — the failing artifact (kept as historical evidence)
  - `session-graph.json`: pad layer has patterns like `bd ~ ~ ~ bd ~ ~ ~` and `~ ~ ~ ~ sd ~ ~ ~`
  - `compiled.strudel.js`: shows `note("bd ~ ~ ~").s("fm")` lines (the silence trigger)
  - `cookbook-trace.json`: 15 picks; pad / hat all have `selected_id=null` and `fallback_reason=no-cookbook-match`
- `post-fix-enabled/` — the same brief + seed AFTER the G9C fix
  - pad uses `a3` (role default), hat uses `[~ hh]*4`
  - non_silent_ratio = 1.000 in real-render audit
- `minimal/` — minimal-mode baseline for comparison
  - kick uses `bd ~ ~ ~ bd ~ ~ ~`, hat uses `[~ hh]*4`, etc.
  - mode is `minimal`, `baseline_only: true`, picks list is empty

## Regression test
`tests/integration/cookbook-regression-fixtures.test.ts` exercises the brief
and asserts that enabled-mode dnb produces a graph whose pad / hat patterns
do NOT contain sample tokens (bd, sd) — verifying the fallback no longer
mis-routes patterns by role.
