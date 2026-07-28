# Handoff contract

The active handoff, when one exists, is the ignored local file
`handoffs/HANDOFF.latest.md`. It records only the current delta; architecture,
API tables and mutable state stay in their owning sources.

## Commands

```bash
bin/handoff start "objective"
bin/handoff show
bin/handoff check
bin/handoff close "outcome"
```

`start` captures branch, HEAD, effective/working/landing source identities,
current Producer UI generated/served output, renderer-page generated output,
observed time and a compact live-state summary.
`check` verifies required headings, existing scoped paths, a bounded length and
an actionable pending/resume point.
`close` records the outcome and marks the handoff inactive.

## Required content

- Objective
- Files in scope
- Changed
- Evidence
- Pending
- Bowei-owned decisions
- Resume from

Keep it under 100 lines. Link to receipts or files instead of copying logs.
Never claim a dirty change is committed/installed, or a render is accepted,
without the corresponding evidence.

This ignored file is an ephemeral baton, not an archive. `start` may replace a
previous closed handoff. Durable history lives in source, git and product
receipts; do not accumulate dated handoff files in active docs.
