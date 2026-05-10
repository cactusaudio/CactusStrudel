---
entry_id: tk-kick-002
status: promoted
date: 2026-05-10
related_audit: G9 cookbook seed
---

## source trigger

The producer at G2 was emitting tk-kick-001 (sparse 4-on-4) for peak-time
techno main + drop sections; rendered tracks felt thin under the gates.

## proposed prior

`bd*4` (full-bar repetition) for techno main + drop, energy ≥ 0.6,
incompatible with intro / breakdown / outro.

## expected benefit

Peak-time main RMS rises into target band; arrangement_arc score improves
when paired with tk-kick-001 in intro and tk-kick-006 (very sparse) in
deeper intro variants.

## possible harm

Could over-uniformise tracks if every techno main picks bd*4. Diversity
must stay measurable — the cookbook should also offer tk-kick-005 and
tk-kick-004 as alternatives.

## validation evidence

- pnpm cactus cookbook validate: OK
- per-genre/role count: techno/kick = 6 (no over-population)
- diversity overlap within techno/kick bucket: bounded; near-duplicate
  detection finds tk-kick-004 / tk-kick-005 as similar-token but
  different-grid (correctly NOT flagged as duplicate)
- legacy genres test "techno snippets all parse as valid mini-notation" passes

## render-audit artifact

Recorded under sessions/cookbook-audits/<latest>/renders/tk-kick-002.wav
(produced by `cactus cookbook render-audit --genre techno --role kick`).

## impact-audit result

Real-render impact audit (`cactus audit:cookbook-impact --suite smoke-real`)
should confirm peak-time techno main passes gates with this entry as the
default companion for tk-hat-003.

## promotion decision

Accepted as default for techno main + drop sections at energy ≥ 0.6.
Validation status: validator_passed (raised to render_smoke_passed once
the render audit ran).

## rollback path

Revert this file and remove `tk-kick-002` from `cookbook/techno/kick.jsonl`;
producer falls back to tk-kick-001 minimal. The change is self-contained
in one JSONL line.
