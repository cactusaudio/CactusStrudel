# Agent and Brain runtime

## Modules

| Module | Role |
|---|---|
| `capabilities.py` | exact-ID capability enrichment |
| `cliproxy.py` | direct native `/v1` client |
| `settings.py` | Draft/Catalog/Test/Apply and generation credential lifecycle |
| `job_store.py` | durable Brain jobs, events, turns, tool calls and receipts |
| `responses_runner.py` | Responses tool loop and cancellation |
| `tools.py` | separated product tool registries |
| `ultra.py` | bounded read-only scouts plus one lead |
| `keychain.py` | opaque credential references |

## Ownership

Agent Settings JSON lives under `~/.cactus-strudel/v3/agent/`. Brain
operational records share the canonical runtime SQLite file. Key bytes remain
in Keychain.

`runtime/v3_api.py` adapts these services to `/api/v2`; it also normalizes
Brain changes into the separate Producer UI `api_events` sequence.

Brain cannot mutate Agent Settings. A passing Test does not Apply. Read the
stable contract in `docs/SETTINGS.md`.

Brain may read evidence, archive/restore, queue independent first shots and
create reversible B previews. Scoring and revision promotion are deliberately
absent: those remain Bowei-owned listening/selection actions.

Focused tests: `tests/agent_v3/` plus the relevant `tests/v3_api/` adapter test.
