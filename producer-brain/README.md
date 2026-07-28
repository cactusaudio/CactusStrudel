# Producer data and prompt assets

This directory contains both live v3 assets and deliberately preserved legacy
evidence. It is not an autonomous self-listening Agent loop.

## Live

| Path | Role |
|---|---|
| `kernel/` | technical prompt-envelope fragments |
| `kernel.lock.json` | compiled fragment/hash receipt |
| `assets/<piece>/<revision>/` | immutable v3 code/audio/prompt/features/receipt |

The kernel permits creative freedom and prevents technical/render failure. It
does not prescribe taste, arrangement formulas, required layers, or mixing
recipes.

## Preserved evidence

| Path | Role |
|---|---|
| `corpus.jsonl` | original legacy corpus rows |
| `pieces/`, `audio/`, `prompts/` | exact legacy source assets |
| `failure-spine.jsonl` | heard findings and historical hypotheses |
| `revisions.jsonl` | legacy revision research rows |

These files support provenance and dry-run reconciliation. They do not own the
current piece pointer, current score, jobs, Agent Settings or generation
profiles. Do not rewrite them to make historical provenance look cleaner.

Old self-critique runs, checkpoints, prototype outputs and research code are
preserved under `archive/research-v1/` or the ignored `archive/local/`.

## Human boundary

Features, spine entries and aggregate research may suggest what to listen for.
Only Bowei scores or accepts music. Promotion, scoring, Agent Apply and kernel
changes remain explicit actions.
