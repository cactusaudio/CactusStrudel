"""user_config — per-user, machine-local config for CactusStrudel.

Lives at ~/.cactus-strudel/config.json (mode 0600). Survives reinstalls.
NEVER committed in git.

Precedence (highest wins):
  1. Environment variables (CACTUS_*, CLIPROXY_*, etc.)
  2. ~/.cactus-strudel/config.json
  3. DEFAULTS in this file

Schema (all keys optional; loader merges with defaults):
{
  "cliproxy": {
    "enabled": true,
    "base_url": "http://127.0.0.1:8318/v1",
    "api_key": "..."
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
"""
import copy
import getpass
import json
import os
import stat

CONFIG_DIR = os.path.expanduser('~/.cactus-strudel')
CONFIG_PATH = os.path.join(CONFIG_DIR, 'config.json')

# Vendor list — used by /api/settings + dispatch
VENDORS = ('openai', 'anthropic', 'google', 'xai')

def _default_cc_dir():
    """Auto-derive Claude Code project dir from current user.
    Bowei: -Users-bowei. jack@Mac-Studio: -Users-jack. Friend on Mac: -Users-X."""
    try:
        user = getpass.getuser()
    except Exception:
        user = os.environ.get('USER', 'unknown')
    return f'~/.claude/projects/-Users-{user}'


DEFAULTS = {
    'cliproxy': {
        'enabled': True,
        'base_url': 'http://127.0.0.1:8318/v1',
        'api_key': '',
    },
    'providers': {
        'openai':    {'api_key': '', 'base_url': 'https://api.openai.com/v1'},
        'anthropic': {'api_key': '', 'base_url': 'https://api.anthropic.com'},
        'google':    {'api_key': '', 'base_url': 'https://generativelanguage.googleapis.com/v1beta'},
        'xai':       {'api_key': '', 'base_url': 'https://api.x.ai/v1'},
    },
    'agy': {'bin_path': '~/.local/bin/agy'},
    'ui':  {'default_slot': 'gpt-5.5'},
    'cc':  {'session_dir': _default_cc_dir()},
    'brain': {
        'cliproxy_model': 'claude-opus-4-8(xhigh)',
        'direct_model':   'claude-opus-4-8',
    },
    # Developer Mode — TWO-LAYER permission model (Bowei pref 2026-05-29):
    #   enabled (default True):
    #     • READ any file in repo (dev_read_file / dev_list_dir)
    #     • WRITE to producer-brain/, developer/, /tmp/ only (sandbox writes)
    #     • Create checkpoints
    #     • CANNOT modify software source (runtime/, scripts/, docs/, bin/,
    #       packages/, apps/, refs/, root config files, kernel/)
    #     • dev_run_bash refused (read needs are served by dev_read_file/dev_list_dir)
    #   write_override (default False):
    #     • Lifts source-write restriction
    #     • Enables dev_run_bash
    #     • Only enable when Bowei explicitly intends brain to act as peer dev
    'developer': {
        'enabled': True,
        'write_override': False,
    },
    # Post-generation syntax validation: brain reads the generated code BEFORE
    # render and gates on Strudel-syntax correctness. Three modes:
    #   off    — skip entirely (render straight)
    #   light  — 1 comprehensive pass (~10-60s typical)
    #   heavy  — 3 focused passes: parse → samples/synths → playability (~30-180s typical)
    # Default = heavy (Bowei pref 2026-05-29; measured ~105s/run, well under 4min cap).
    'validator': {
        'mode': 'heavy',  # 'off' | 'light' | 'heavy'
    },
}

# Env var overrides (env wins over config file)
ENV_MAP = {
    ('cliproxy', 'enabled'):   'CLIPROXY_ENABLED',   # 'true'/'false' string
    ('cliproxy', 'base_url'):  'CLIPROXY_BASE_URL',
    ('cliproxy', 'api_key'):   'CLIPROXY_API_KEY',
    ('agy', 'bin_path'):       'AGY_BIN',
    ('cc', 'session_dir'):     'CC_SESSION_DIR',
    ('ui', 'default_slot'):    'CACTUS_DEFAULT_SLOT',
    ('brain', 'cliproxy_model'): 'BRAIN_CLIPROXY_MODEL',
    ('brain', 'direct_model'):   'BRAIN_DIRECT_MODEL',
    ('developer', 'enabled'):           'CACTUS_DEVELOPER_MODE',
    ('developer', 'write_override'):    'CACTUS_DEVELOPER_WRITE_OVERRIDE',
    ('validator', 'mode'):       'CACTUS_VALIDATOR_MODE',
}
ENV_VENDOR_KEY_MAP = {
    'openai':    'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'google':    'GOOGLE_API_KEY',
    'xai':       'XAI_API_KEY',
}


def _deep_merge(base, overlay):
    """Merge overlay into base, recursively for dicts. Returns new dict."""
    out = copy.deepcopy(base)
    if not isinstance(overlay, dict):
        return out
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _read_file_config():
    """Read ~/.cactus-strudel/config.json. Returns {} if missing/corrupt."""
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f) or {}
    except Exception as e:
        print(f'[user_config] failed to read {CONFIG_PATH}: {e}')
        return {}


def _apply_env_overrides(config):
    """Layer env vars on top of file config. Returns modified copy."""
    out = copy.deepcopy(config)
    for path, env in ENV_MAP.items():
        val = os.environ.get(env)
        if val is None:
            continue
        # cliproxy.enabled is boolean
        if path == ('cliproxy', 'enabled'):
            val = val.strip().lower() in ('1', 'true', 'yes', 'on')
        cur = out
        for k in path[:-1]:
            cur = cur.setdefault(k, {})
        cur[path[-1]] = val
    for vendor, env in ENV_VENDOR_KEY_MAP.items():
        val = os.environ.get(env)
        if val:
            out.setdefault('providers', {}).setdefault(vendor, {})['api_key'] = val
    return out


def load():
    """Return the fully-merged config (env > file > defaults)."""
    file_config = _read_file_config()
    merged = _deep_merge(DEFAULTS, file_config)
    merged = _apply_env_overrides(merged)
    return merged


def save(new_config):
    """Atomically write `new_config` to ~/.cactus-strudel/config.json with
    mode 0600. The full structure is written — caller is responsible for
    merging changes with existing config first if doing partial updates.

    Does NOT clear env-derived values (those are runtime-only).
    """
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)
    tmp = f'{CONFIG_PATH}.tmp.{os.getpid()}'
    body = json.dumps(new_config, ensure_ascii=False, indent=2)
    with open(tmp, 'w') as f:
        f.write(body)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_PATH)
    try:
        os.chmod(CONFIG_DIR, 0o700)
    except Exception:
        pass
    return CONFIG_PATH


def update(partial):
    """Read current file config, merge `partial` into it, save back. Does NOT
    include env-derived values in the persisted file (only the user's intent
    via UI). Returns the fully-resolved (env+file+defaults) post-save config."""
    file_config = _read_file_config()
    merged_file = _deep_merge(file_config, partial)
    save(merged_file)
    return load()


def mask_secrets(config):
    """Return a copy of config with API keys redacted to '••••• (set)' if
    present, or '' if empty. Use before sending config to the UI."""
    out = copy.deepcopy(config)
    if isinstance(out.get('cliproxy'), dict):
        key = out['cliproxy'].get('api_key') or ''
        out['cliproxy']['api_key'] = '••••• (set)' if key else ''
        out['cliproxy']['_has_key'] = bool(key)
    if isinstance(out.get('providers'), dict):
        for vendor, info in out['providers'].items():
            if isinstance(info, dict):
                key = info.get('api_key') or ''
                info['api_key'] = '••••• (set)' if key else ''
                info['_has_key'] = bool(key)
    return out


def unmask_save(submitted, current):
    """When the UI saves, a masked key field of '••••• (set)' means
    'keep the existing key, don't change it'. Returns config with masked
    keys swapped back to real values from `current`."""
    out = copy.deepcopy(submitted)

    def is_mask(v):
        return isinstance(v, str) and v.startswith('•')

    if isinstance(out.get('cliproxy'), dict) and is_mask(out['cliproxy'].get('api_key', '')):
        out['cliproxy']['api_key'] = current.get('cliproxy', {}).get('api_key', '')
    out.get('cliproxy', {}).pop('_has_key', None)

    if isinstance(out.get('providers'), dict):
        for vendor, info in out['providers'].items():
            if isinstance(info, dict) and is_mask(info.get('api_key', '')):
                info['api_key'] = current.get('providers', {}).get(vendor, {}).get('api_key', '')
            if isinstance(info, dict):
                info.pop('_has_key', None)
    return out


if __name__ == '__main__':
    # Quick smoke (`python3 user_config.py`)
    c = load()
    print(json.dumps(mask_secrets(c), ensure_ascii=False, indent=2))
