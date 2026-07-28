# techno enabled-mode weak-positive — captured 2026-05-10

## Brief
`peak time techno 132 BPM, 16 bars, hypnotic` (seed=7)

## Real-render observation (smoke-real, post-G9C fix)

| metric | minimal | enabled |
|---|---|---|
| gate_pass | ✓ | ✓ |
| hard_fail_count | 0 | 0 |
| severe_warning_count | 1 | **0** |
| non_silent_ratio | 0.766 | **0.814** |
| critic_issue_count | 4 | **3** |
| lufs_distance (dB) | ~2.99 | ~2.74 |

Enabled improves on every metric without introducing a hard failure. The
delta is small — this is **weak positive**, not strong positive — but it
preserves the dispatch's contract that "system has at least one protected
case where cookbook helps or safely improves warnings".

## Why it improves

The trace shows enabled mode picks distinct cookbook entries for each
section based on energy / function:

- intro / kick: `tk-kick-001` (sparse 4-on-4) — energy match
- main / kick: `tk-kick-002` (driving 4-on-4)
- drop / kick: `tk-kick-002` (already seen → -10 penalty, but still wins)
- intro / hat: `tk-hat-001` (offbeat) — energy:mid match
- main / hat: `tk-hat-003` (sixteenth-driving) — energy:high match
- main / bass: `tk-bass-002` (rolling)

The minimal mode picks role defaults uniformly across all sections, so the
arrangement reads flatter to the critic.

## Artifacts

- `enabled/session-graph.json`, `compiled.strudel.js`, `cookbook-trace.json`
- `minimal/session-graph.json`, `compiled.strudel.js`, `cookbook-trace.json`

## Regression contract

If a future cookbook change makes this brief regress (gate_pass false OR
hard_fail > 0 OR `severe_warning_count` increases above the minimal
baseline), the test in
`tests/integration/cookbook-regression-fixtures.test.ts` flags it.

This fixture is also the seed of a future "evidence-driven content
expansion" guarantee: any new techno entries must NOT cause a regression
on this brief.
