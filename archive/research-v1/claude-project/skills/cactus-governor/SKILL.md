---
description: Cactus Governor — load when planning or executing changes to the Cactus Strudel codebase. Enforces the closed-loop discipline: deterministic rules stay champion, gates aren't weakened to pass, every phase commits with evidence, and the learning ledger captures what was tried + outcome. Refuse changes that violate the hard rules in this skill, and append a ledger entry when a session completes.
---

# Cactus Governor

The Governor is the discipline layer that keeps the closed-loop producer
honest as it grows. Apply it whenever you are:

- adding a phase / G-step
- changing a gate threshold
- swapping deterministic logic for an LLM call
- relaxing a validator / invariant
- skipping a test or marking it `skip` / `xfail`

## Hard rules (refuse to violate)

1. **Deterministic rules stay champion.** Claude / hybrid backends are
   challengers. Never silently fall back from challenger to rules without
   recording the swap and reason in the audit's `champion_challenger` block.
2. **Gates are calibrated, not weakened.** If a gate fails on a track that
   sounds good, write an ADR explaining the calibration before changing the
   threshold. ADR > config tweak.
3. **Hooks enforce, they do not advise.** A PostToolUse hook that returns
   `0` on a validator failure is wrong; it must return `2` with stderr
   feedback per Claude Code's hook contract.
4. **Every phase commits with evidence.** A G-step is not done until:
   - tsc clean
   - new + existing tests pass (`pnpm test`)
   - the dispatch's stated acceptance command succeeds end-to-end
   - the commit names artifacts (paths) for the evidence
5. **No UI / new genre / new feature ahead of the core loop being
   trustworthy.** If `cactus produce` cannot make a credible track without
   manual intervention, surface area expansion is forbidden.
6. **Renderer / analyzer boundaries stay AGPL-clean.** The renderer page
   wraps `@strudel/web` (AGPL-3.0); the renderer package wraps the page; the
   analyzer wraps `essentia.js`. Don't import either upstream into commercial
   surfaces. Whole repo is AGPL-3.0-or-later.
7. **Critic must cite measurable evidence.** No prose like "make it
   punchier" — every CritiqueTarget needs `graph_paths` + numeric
   `evidence` fields the planner can map to an op.
8. **Patches respect agent write boundaries.** `isAgentAllowedToWrite`
   gates every applied op; planner output that violates the table is
   silently dropped, not silently allowed.
9. **Session graph is the protocol.** Strudel code is a compile output
   only; never an agent's primary artifact.
10. **Semantic invariants are blocking.** A graph that fails
    `validateSemanticInvariants` does not get rendered or committed; fix the
    graph or the patch that produced it.

## Severity tier discipline

| tier | meaning | overall_pass impact |
|---|---|---|
| `hard_fail` | track is broken (silent, clipped, wrong duration) | yes — overall_pass=false |
| `severe_warning` | clearly off-target but rendered | logged, doesn't block accept |
| `calibration_warning` | borderline, threshold-dependent | logged |
| `informational` | for the human; ignore for accept | none |
| `skipped` | gate did not run (e.g. track too short) | none |

`overall_pass` is `hard_fail_count === 0`. Do not change this without an ADR.

## When extending the planner

Path additions in `revision-planner.ts` must:

- read movement keys via `readMovement(target)` (works whether the synthetic
  target carries `intended_movement` directly or has been merged into
  `evidence` by `revise.ts`)
- resolve role → orbit dynamically (`graph.layers.find((l) => l.role === '...')`)
  rather than trusting a hardcoded orbit number from the synthetic target's
  `graph_paths`
- only emit ops the agent is allowed to write (the boundary check filters
  others, but inviting filtering is wasteful)

## Learning ledger contract

Every closed-loop or revise session appends one entry to
`docs/learning-ledger.jsonl` summarizing what was tried + what happened.
Schema (one JSON object per line):

```json
{
  "ts": "2026-05-10T12:34:56.000Z",
  "session_id": "<uuid>",
  "mode": "produce-closed-loop" | "revise" | "audit",
  "brief": "<string>",
  "iterations": <int>,
  "stopped_reason": "accepted" | "plateau" | "max_iterations" | "no_patches" | "failure",
  "hard_fail_count": <int>,
  "severe_warning_count": <int>,
  "patches_applied": <int>,
  "failed_patch_iters": [<int>, ...],
  "weighted_score_first": <float>,
  "weighted_score_last": <float>,
  "spectrogram_path": "<path|null>",
  "notes": "<freeform, optional>"
}
```

The ledger is append-only. Don't rewrite history. If an entry is wrong,
append a correction entry that references the original by `session_id`.

## What to refuse

- Renaming `producer-*` agents without updating `AGENT_WRITE_PATHS` and
  every test that names them.
- Removing a gate because tests are failing — calibrate or skip with
  `severity_tier=skipped` + reason in `notes`.
- Adding a new top-level command before `produce` / `revise` /
  `audit:repair` are all clean.
- Mocking the renderer in production-path code (mocks are test-only, in
  `*.test.ts` with `vi.doMock`).
- Skipping pre-commit hooks (`--no-verify`).

## Reference

Hard rules also live in `CLAUDE.md` and `docs/adr/`. Don't restate them
here when adding a new rule — link to the ADR.
