# `strudel` CLI

`bin/strudel` is the unified command line: a strict `/api/v2` client plus the
operational verbs. No product logic lives in it — invariants, idempotency
and receipts flow through the same application boundary as the GUI and MCP.
`--json` on any verb emits machine output.

| Verb | Does |
|---|---|
| `strudel status` | compact runtime readback |
| `strudel doctor` | full diagnostic pass; exit 1 when any check fails |
| `strudel pieces [--all] [--limit N]` | list the library |
| `strudel piece <id>` | one piece with revisions and usability |
| `strudel play <id> [--revision R] [--open]` | exact-bytes audio URL |
| `strudel gen <1\|2\|4> [prompt] [--profile P]` | queue first shots |
| `strudel score <piece> <0-10> [note] [--revision R]` | bind an ear score |
| `strudel promote <piece> <revision>` | make a revision current |
| `strudel preview <piece> <source-rev> <file\|-\>` | render code as B |
| `strudel brain "msg" [--pin piece] [--wait]` | one durable Brain message |
| `strudel ops <idempotency-key>` | exact prior outcome of one key |
| `strudel settings` | masked Agent settings readback |
| `strudel backup [--no-assets]` | snapshot all durable truth |
| `strudel restore <archive> [--force]` | verify-before-adopt restore |

Scoring resolves the revision's exact `audio_sha` server-side before
binding, so a CLI score carries the same byte identity as a GUI score.
Scoring via this CLI is Bowei's own hand; agents score only through the
MCP tool's `acting_for_bowei` relay contract. The legacy single-purpose
`bin/` scripts remain available as independent utilities, and `bin/cactus`
stays as a deprecated alias of `strudel`. Restore adopts
nothing until every archived byte verifies against the manifest and the
archive contains no unmanifested files; replaced state moves aside to a
timestamped `.pre-restore-*` sibling for one-rename rollback.

`CACTUS_BASE_URL` overrides the runtime address (default
`http://127.0.0.1:8765`).
