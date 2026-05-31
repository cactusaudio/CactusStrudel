# Settings + Configuration

CactusStrudel reads configuration in 3 layers (highest wins):

1. **Environment variables**
2. **`~/.cactus-strudel/config.json`** (mode 0600, machine-local, survives reinstalls)
3. **Built-in defaults** (in `runtime/user_config.py`)

In the UI, the **Settings page** (`/runtime/settings.html`) edits layer 2. Use
env vars (layer 1) only for one-off / scripted overrides.

## Schema

```jsonc
{
  "cliproxy": {
    "enabled": true,                              // toggle the CLIProxy route
    "base_url": "http://127.0.0.1:8318/v1",      // your local CLIProxy gateway
    "api_key": ""                                 // the gateway's API key
  },
  "providers": {
    "openai":    { "api_key": "", "base_url": "https://api.openai.com/v1" },
    "anthropic": { "api_key": "", "base_url": "https://api.anthropic.com" },
    "google":    { "api_key": "", "base_url": "https://generativelanguage.googleapis.com/v1beta" },
    "xai":       { "api_key": "", "base_url": "https://api.x.ai/v1" }
  },
  "agy":  { "bin_path": "~/.local/bin/agy" },
  "ui":   { "default_slot": "gpt-5.5" },
  "cc":   { "session_dir": "~/.claude/projects/-Users-bowei" }
}
```

## Dispatch model

Each of the 7 generation slots has two routing paths defined in
`runtime/serve.py` `BACKEND_REGISTRY`:

| Slot | Vendor | CLIProxy model | Direct vendor model |
|---|---|---|---|
| GPT 5.5 | openai | `gpt-5.5(high)` | `gpt-5-mini` |
| GPT 5.5x | openai | `gpt-5.5(xhigh)` | `gpt-5` |
| AGY CLI | agy | — | — |
| Opus 4.8 | anthropic | `claude-opus-4-8(xhigh)` | `claude-opus-4-8` |
| Gemini Flash | google | `gemini-3-flash-agent(high)` | `gemini-2.5-flash` |
| Gemini Pro | google | `gemini-pro-agent(high)` | `gemini-2.5-pro` |
| Grok Build | xai | `grok-build-0.1(high)` | `grok-2-1212` |

At dispatch time, `_resolve_slot_route(slot)` picks one:

```
if vendor == 'agy' and AGY binary exists:                → mode='agy'
elif cliproxy.enabled and cliproxy.api_key present:      → mode='cliproxy'
elif providers[vendor].api_key present:                  → mode='direct'
else:                                                     → unavailable, reason="..."
```

Slots that resolve to no route are marked **red unavailable** in the UI
(`/api/backends` returns `available:false, reason:"..."`).

## Env var overrides

These env vars override the corresponding config fields:

| Env | Overrides |
|---|---|
| `CLIPROXY_ENABLED` | `cliproxy.enabled` (`true`/`false`) |
| `CLIPROXY_BASE_URL` | `cliproxy.base_url` |
| `CLIPROXY_API_KEY` | `cliproxy.api_key` |
| `OPENAI_API_KEY` | `providers.openai.api_key` |
| `ANTHROPIC_API_KEY` | `providers.anthropic.api_key` |
| `GOOGLE_API_KEY` | `providers.google.api_key` |
| `XAI_API_KEY` | `providers.xai.api_key` |
| `AGY_BIN` | `agy.bin_path` |
| `CC_SESSION_DIR` | `cc.session_dir` |
| `CACTUS_DEFAULT_SLOT` | `ui.default_slot` |
| `CACTUS_ROOT` | Project root (default = derived from `runtime/serve.py` location) |

## API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/settings` | GET | Return current config (API keys masked as `••••• (set)`) |
| `/api/settings` | PUT | Update config; masked keys are preserved (only changed when overwritten) |
| `/api/settings/test-backend` | POST | Test connectivity (`{target: "cliproxy"\|"agy"\|<vendor>}` → `{ok, detail, latency_ms}`) |
| `/api/setup-status` | GET | `{needs_setup: bool, available_count, total, unavailable: [{slot, label, reason}]}` |
| `/api/backends` | GET | Per-slot availability + mode (cliproxy/direct/agy) |

## First-run UX

When `serve.py` boots with no `~/.cactus-strudel/config.json` and no env vars
configured:
- `/api/backends` reports all CLIProxy/direct slots as `available:false`
- Only `AGY CLI` is available IF `~/.local/bin/agy` exists
- `main.html` shows a gold banner: "⚙ No backends configured yet — Set up Settings →"
- User clicks → fills CLIProxy section OR direct vendor section OR both
- Save → reload → all slots that have a valid route become green-available

## Key security

API keys are stored in plaintext JSON at `~/.cactus-strudel/config.json` with
file mode `0600` (owner-read-only). Config directory itself is mode `0700`.

UI **never returns raw keys** in `/api/settings` GET — fields with a non-empty
key return `••••• (set)`. On PUT, that masked sentinel means "keep the existing
key unchanged"; an actual new string overwrites.

Future hardening (not yet implemented): move keys to macOS keychain via
`security` CLI.
