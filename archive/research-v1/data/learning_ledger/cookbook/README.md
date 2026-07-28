# Cookbook learning ledger (G9 §10)

Every meaningful cookbook prior promotion / rejection lives here.

## Subdirectories

- `candidate_priors/` — proposed but not yet validated
- `promoted_priors/` — accepted into the cookbook (ID matches an entry in `cookbook/<genre>/<role>.jsonl`)
- `rejected_priors/` — proposed but rejected, with reason
- `regressions/` — priors that were promoted then later regressed; explanation + rollback path

## Entry format

Each promotion / rejection / regression is a single Markdown file named
`<entry_id>.md` (or `<entry_id>__<YYYYMMDD>.md` if multiple entries per id):

```markdown
---
entry_id: tk-kick-002
status: promoted          # candidate | promoted | rejected | regressed
date: 2026-05-10
related_session: <uuid?>
related_audit: <path?>
---

## source failure or opportunity
The producer at G2 was emitting a sparse 4-on-4 in main sections;
peak-time tracks felt thin.

## proposed prior
`bd*4` for techno main + drop sections, energy ≥ 0.6.

## expected benefit
Peak-time main section RMS rises into target band; arrangement_arc
score improves.

## risk
Could over-uniformise tracks if every techno main picks bd*4.
Diversity must stay measurable.

## validation evidence
- pnpm cactus cookbook validate: OK
- per-genre/role count: techno/kick=6 (no over-population)
- diversity overlap within techno/kick bucket: < 0.6 mean

## promotion decision
Accepted as default for techno main + drop sections.

## rollback path
Revert cookbook entry; producer falls back to tk-kick-001 minimal.
```

## Why this layer exists

Cookbook entries are easy to add and forget about. The Cactus Governor
(.claude/skills/cactus-governor/SKILL.md) requires every meaningful prior
have traceable promotion. This is where the trace lives.

A prior that quietly drifts the producer toward a template should leave a
regression entry here, not be silently removed.
