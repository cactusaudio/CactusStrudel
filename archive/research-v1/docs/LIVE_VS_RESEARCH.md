# Live Product Truth vs Research Evidence

CactusStrudel keeps production facts and research hypotheses in different
lanes. This prevents a green analysis report from being mistaken for working
music or a human decision.

## The boundary

| Question | Live product truth | Research evidence |
|---|---|---|
| What is the current piece? | SQLite piece row and active revision ID | old manifest name or dashboard row |
| What code/audio was heard? | immutable revision assets plus full SHA receipt | backup, diff, or source JSONL path |
| What did the human score? | rating bound to revision ID and audio SHA | aggregate, note extraction, critic output |
| What model made it? | exact recorded route/model/config receipt | historical source label or inference |
| Is a job running? | durable server job state | transcript, task note, or UI animation |
| Is a setting active? | applied immutable settings revision | draft, recommendation, or passed Test |
| Is the music good? | Bowei’s listening judgment | no machine substitute |

## Live product truth

The authoritative live surfaces are:

- `~/.cactus-strudel/v3/runtime.sqlite3`;
- `producer-brain/assets/<piece-id>/<revision-id>/`;
- active Agent and generation configuration revisions;
- `/api/v2/bootstrap` plus the monotonic event cursor;
- the UI build actually served at `/studio`;
- Bowei’s score on the exact revision/audio SHA.

Live mutations go through the v3 application boundary. A source-file edit or a
successful test suite is not enough to claim the live product changed.

## Research evidence

Research surfaces include:

- `producer-brain/corpus.jsonl`;
- `producer-brain/revisions.jsonl`;
- `producer-brain/failure-spine.jsonl`;
- old JS, audio, prompts, and backups;
- analyzer/critic package output;
- aggregate research summaries;
- the frozen v2 GUI archive.

These remain useful because they preserve experiments, failures, and ambiguity.
They do not own the current piece, active audio, active settings, or job state.

## Migration does not erase uncertainty

The v3 migration copied 49 valid corpus rows into immutable revisions while
preserving the original JSONL and source assets read-only.

It did not invent facts:

- all 49 rows are `legacy_unknown` where an exact model/route receipt was absent;
- `LDB-001` and `JH-001` retain hash drift as `legacy_partial`;
- `UN-004` stays linked to `UN-003` as duplicate evidence;
- six old revision records remain research evidence where fields are partial;
- four completed-task asset pairs remain recovery candidates outside the
  active library.

Importing bytes into v3 makes their identity durable. It does not upgrade old
provenance from unknown to exact.

## Research may propose, not promote

A research result may support:

- a prompt-kernel candidate;
- a generation-profile comparison;
- a Brain suggestion;
- a preview edit;
- a better listening experiment.

It may not automatically:

- rewrite the active prompt kernel;
- promote a preview revision;
- apply Agent Settings;
- archive evidence;
- turn a correlation into a validated musical rule;
- declare a score on Bowei’s behalf.

The transition into live truth is an explicit product action with a receipt.
Musical acceptance remains human.

## Validator and critic limits

Deterministic validation may check:

- syntax and known Strudel API usage;
- source preservation;
- render exit status;
- non-empty audio;
- full hashes and positive duration;
- identity and receipt consistency.

Analyzer or critic code may describe measurable properties. Neither is a
music-quality gate. Do not add a second model pass that rewrites every first
shot under the label “validation.”

## Old GUI

The frozen v2 pages are available only at:

- `/legacy/main`
- `/legacy/data`
- `/legacy/settings`
- `/legacy/spine`

They are read-only evidence backed by
`archive/gui/ui-v2-baseline-20260728-95f85f6/`. They do not regain mutation
authority if opened.

## Reporting language

Use precise verbs:

- **built** — source compiled;
- **served** — the running server returned that build;
- **committed** — a durable revision/settings/job receipt exists;
- **tested** — the exact draft completed the stated probe;
- **applied** — the active revision changed and readback matched;
- **scored** — Bowei rated an exact audio SHA;
- **accepted** — Bowei explicitly accepted the music or product behavior.

Do not collapse these into “done.”
