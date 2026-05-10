# Ultra-review baseline — Phase 15 → G0 reproducibility gate

Date: 2026-05-10
Reviewer: external (uploaded zip)
Repo head reviewed: `a7e52ce` (phase 15: champion baseline repair + rubric calibration)

## Findings the reviewer surfaced

The reviewer caught five concrete blockers and several architectural gaps. All
five blockers are reproduced verbatim below, with what was fixed in this G0
gate, what was deferred to later G phases, and the exact commands proving the
repo is now reproducible.

### 1. `tsc -b` was failing at HEAD a7e52ce

```
packages/ir/src/factory.ts(20,7): TS2783: 'text' is specified more than once,
  so this usage will be overwritten.
packages/strudel-validator/src/code-validator.ts(24,28): TS2694:
  Namespace '"...acorn..."' has no exported member 'SyntaxError'.
packages/analyzer/src/essentia.ts(10,37): TS7016:
  Could not find a declaration file for module 'essentia.js'.
```

Reproduced locally on darwin-arm64 / node v25.9.0 / pnpm 11.0.9.

**Fixes (surgical, no behavior change):**

- `packages/ir/src/factory.ts`: removed the explicit `text:` line; the trailing
  `...init.brief` spread already provides the required field per the input
  type (`Partial<BriefGraph> & { text: string }`).
- `packages/strudel-validator/src/code-validator.ts`: replaced
  `acorn.SyntaxError` (not exported by acorn) with a structural cast to
  `Error & { pos?, loc? }` matching the runtime fields actually read.
- `packages/analyzer/src/types/essentia-js.d.ts`: new local declaration for
  the dynamic import; runtime structural checks in `essentia.ts` remain the
  source of truth (the package's API surface is large + version-volatile, so
  baking strict types adds a maintenance tax for no real-world benefit).
- `packages/analyzer/tsconfig.json`: include the new `src/types/**/*.d.ts`.

**Verification:** `pnpm exec tsc -b --pretty false` exits 0.

### 2. Uploaded zip wasn't cross-platform runnable

True. `node_modules` in the zip carried macOS-native binaries (esbuild,
playwright, etc.). This is a packaging artifact, not a product bug. Future
ultra-reviews should use a fresh clone + `pnpm install`, not the zip's
`node_modules`. Documented in this file as the convention going forward.

### 3. `produce` silently swallows render/analyze failures

Confirmed in `packages/agent-runtime/src/produce.ts`: render error → `wavPath
= undefined`, analyze error → silent skip, only logged under
`CACTUS_RENDER_VERBOSE`. This is the right behavior for a fast preview but
**wrong** as a default for a closed-loop producer.

**Deferred to G2** ("produce as closed-loop"): default to fatal failures with
artifact, optional `--best-effort`, three explicit modes (draft / closed-loop
/ audit). Tracked as task 33.

### 4. Hooks are advisory, not enforcement

Confirmed:
- `.claude/hooks/validate-strudel-code.sh` has a `TODO Phase 2` and exits 0.
- `.claude/hooks/validate-session-graph.sh` only checks top-level keys with `jq`.
- `.claude/hooks/run-fast-tests-on-write.sh` only injects a hint, never blocks.

**Deferred to G1** ("severity tiers + real hooks"). Tracked as task 32.

### 5. Cactus Governor doesn't exist

Confirmed: no `governor`, `flywheel`, or `learning_ledger` paths.
**Deferred to G7** ("Cactus Governor skill + ledger"). Tracked as task 38.

## P1-P5 findings (acknowledged, not yet acted on in G0)

The reviewer also surfaced:

- ADR 0005 says severity tiers exist; code has only numeric severity. → **G1**.
- `produce` is not the product loop. → **G2**.
- `revise` records feedback but doesn't apply audio-targeted patches. → **G3**.
- Renderer cold-boots per render. → **G4**.
- Claude dispatcher seam exists; CLI doesn't load it. → **G8**.
- IR schema validates shape but not enough semantics. → **G5**.
- Critic still deterministic and shallow. → **G6**.
- Cookbook depth thin (37 snippets across 14 files). → **G9**.
- Studio UI not release-critical. → handled by deferring G11 to last.

These are tracked in the task list and addressed in the G1-G12 sequence.

## Provenance

The G0 gate was executed by Claude Code under autonomous-execution mandate
following the dispatch in `docs/dispatch/g0-g12-roadmap.md` (this file's
sibling). Every step has artifact backing:

```
$ pnpm exec tsc -b --pretty false
exit 0

$ pnpm test
Test Files  30 passed | 1 skipped (31)
Tests  251 passed | 6 skipped (257)

$ pnpm cactus -- audit:repair
{
  "ok": true,
  "mode": "audit:repair",
  "champion_pass": 1,
  "champion_fail": 0,
  "failures": "mix_mud=1"
  // mix_mud is a calibration-warning category (low_mid/mid 9.2 just over the
  // ADR-0005 threshold of 8.0). It surfaces in the report; no gate fails.
}

$ scripts/verify-repo.sh
exit 0
```

## What this gate does NOT prove

- That the closed-loop producer actually exists end-to-end (G2).
- That feedback drives real audio change (G3).
- That hooks enforce anything (G1).
- That genre breadth is production-ready (G9).
- That a Claude challenger has ever beaten the champion on real audio (G8).
- That the system can self-improve under governance (G7, G12).

What it does prove: **the repo is now truthful**. From a fresh shell, the
build compiles, the tests pass, the smoke audit runs end-to-end, and the
champion baseline has not regressed. The dispatch's preconditions for
turning on the governor flywheel are met.
