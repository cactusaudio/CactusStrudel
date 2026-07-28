# Agent and generation settings

## Stable topology

```text
CactusStrudel → direct native CLIProxy `/v1` → exact selected model
```

There is no shim, Router/Core, `84xx` port, vendor fallback,
`/chat/completions` fallback, model alias fallback, or hidden effort fallback.
The authenticated live catalog is authoritative for currently available IDs.
Exact capability enrichment lives in `runtime/agent/capabilities.py`.

## Agent Settings lifecycle

```text
Draft → authenticated Catalog → exact model → Test → Apply → readback
```

The draft contains:

- Base URL;
- Keychain credential reference;
- exact model ID;
- supported reasoning effort or `null`;
- Standard or Ultra orchestration.

Changing endpoint, credential, model, effort, or orchestration changes the
fingerprint. Apply accepts only a current successful Test for the exact same
fingerprint. Test is evidence, not activation.

Draft staging is compare-and-swap: the panel sends the `base_fingerprint` it
last read, and a stale base is refused as 409 instead of silently
overwriting a newer draft from another tab. The settings document exposes a
compact `draft_diff` against the active profile plus first-class
`applied_receipt` and `catalog_receipt` identities.

Only Bowei performs Apply. Brain has no tool that can Test or Apply settings.

## Test receipt

A successful Test has three stages:

1. authenticated `/models`; selected exact ID is present;
2. selected model calls inert `agent_probe`;
3. the client returns `function_call_output` and receives final `READY`/`OK`.

Each stage records latency and request identity. A failed or stale Test remains
visible and cannot be Applied.

## Reasoning and Ultra

- Model effort and orchestration are separate settings.
- Supported GPT effort values are `low`, `medium`, `high`, `xhigh`, `max`.
- `"ultra"` is never sent as upstream effort or added to a model ID.
- Standard sends the chosen supported effort.
- Ultra keeps that choice visible but sends upstream `max` for bounded scouts
  and lead.
- Ultra uses at most two read-only, tool-free scouts and one lead. Only the
  lead receives product tools.
- A failed scout fails the Ultra job; it does not silently degrade to Standard.

## Generation settings

Generation and Brain activation are intentionally separate:

- `settings/generation/sync` requires the current matching passing Agent Test
  and its authenticated catalog;
- sync publishes only profiles whose exact IDs are present;
- sync never Applies Agent settings;
- the Studio default must be one exact configured profile ID;
- unchanged sync/default operations are no-ops with readback.

At queue time, every generation batch durably snapshots the exact immutable
generation configuration and compiled prompt kernel. All 1/2/4 children use
that same snapshot even if Settings or kernel source changes while they wait.
Every generation receipt records the exact base route, model ID, effort,
orchestration, settings revision, prompt-kernel hash, validator mode, response
hash, render hashes and job identity.

## Persistence

- Settings JSON: `~/.cactus-strudel/v3/agent/`.
- Current generation pointer: `~/.cactus-strudel/v3/generation.json`.
- Immutable generation revisions:
  `~/.cactus-strudel/v3/generation-revisions/gencfg-*.json`.
- Operational jobs/receipts: `~/.cactus-strudel/v3/runtime.sqlite3`.
- Key bytes: macOS Keychain service `com.cactusstrudel.agent.v3`.
- Browser and repo files receive only masked state or credential references.

Replacing or resetting a candidate removes now-unreferenced candidate
credentials while preserving any reference pinned by draft state, every
immutable Applied Agent revision, or every immutable generation revision.

## Environment boundary

Historical `CLIPROXY_*` and `CACTUS_AGENT_*` variables do not override the
panel. The in-product Applied revision is the sole Brain route/model/effort
authority. Operational variables such as the server port or state-root path
remain process controls, not Agent configuration.

## Verification boundary

Use the UI or exact API readback to distinguish:

- candidate saved;
- catalog discovered;
- Test passed;
- settings Applied;
- generation profiles synchronized;
- Studio default changed;
- a job actually used that configuration.

Do not infer one state from another.
