# Live truth versus research evidence

## Live product truth

- canonical SQLite records for pieces, revisions, ratings and jobs;
- immutable version assets and receipts;
- Agent settings draft/Test/Applied readback;
- currently served Producer UI build;
- prompt-kernel fragments used by generation;
- Bowei’s score on an exact revision/audio SHA.

Live mutations occur only through current v3 product/domain interfaces.

## Preserved research and legacy evidence

- `producer-brain/corpus.jsonl`;
- legacy JS/audio/prompt files;
- `producer-brain/failure-spine.jsonl`;
- `producer-brain/revisions.jsonl`;
- archived task and migration evidence;
- historical implementations under `archive/`.

Preserving evidence does not restore its old authority. Importing legacy bytes
into immutable revisions does not upgrade unknown model provenance to exact.

## Allowed transition

Research may support:

- a prompt-kernel candidate;
- a profile comparison;
- a Brain suggestion;
- a preview edit;
- a listening experiment.

It may not automatically:

- rewrite the active prompt kernel;
- promote a revision;
- score music;
- Apply Agent Settings;
- archive live evidence;
- present correlation as validated taste.

The transition into live truth is an explicit product action with a receipt.
Musical acceptance remains human.

## Mechanical limits

The validator and renderer may prove:

- source parses and uses known Strudel API;
- render completed;
- audio is non-empty with positive duration;
- code/audio/prompt/features hashes agree;
- identity and receipts reconcile.

Descriptive audio features can help inspect a render. They are not an
aesthetic score or automatic acceptance gate.

## Historical access

`archive/README.md` maps preserved generations. Normal feature work does not
read archive content. Open it only for a named migration, regression, provenance
or restoration question.

The frozen v2 GUI at `/legacy/*` is a script-free screenshot viewer. Its exact
source remains archived for explicit restoration only. Old APIs and automatic
Claude/SessionGraph/gf control paths remain closed.

## Reporting verbs

- **built** — source compiled;
- **served** — the live server returned that build;
- **committed** — a durable receipt exists;
- **tested** — the exact candidate completed the stated probe;
- **Applied** — active settings changed and readback matched;
- **scored** — Bowei rated an exact audio SHA;
- **accepted** — Bowei explicitly accepted the music or product behavior.
