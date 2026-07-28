# Packaging CactusStrudel for fresh-Mac deployment

> Source-of-truth recipe for building the deployment tar + double-clickable
> installer. Follow this exactly next time; deviations have historically caused
> incomplete bundles (refs/ omission, key-doc mismatch, host-specific configs
> baked into the launcher).

## Goal

Anyone (Bowei OR a friend with no CLIProxy setup) should be able to:
1. Receive `cactus-strudel-bundle.tar.gz` + `install-cactus-strudel.command` in
   the same folder.
2. Double-click `.command` once.
3. Within ~5 minutes have a working CactusStrudel + a Desktop launcher.
4. Open Settings, paste API key(s), save → all-green availability indicators.

## Architecture: install vs configure

| Step | Owner | What |
|---|---|---|
| Install | `install-cactus-strudel.command` | untar, pnpm install (× 2), Playwright Chromium, Desktop launcher, boot server |
| Configure | In-app Settings UI (`/runtime/settings.html`) | API keys, CLIProxy URL, AGY binary path, default model |

**Key principle**: the installer does NOT detect or bake in any per-host
configuration. No port scanning, no API-key-doc filename matching, no env
vars in the launcher. All that is moved to the in-app Settings page which
edits `~/.cactus-strudel/config.json` (mode 0600, survives reinstalls).

## What MUST be in the bundle

### Source

- `runtime/` — serve.py + main.html + data.html + settings.html + prompt_kernel.py + user_config.py + cc-bridge/
  (skip all local bridge history/state: `.agy-run-*.log`, `*.jsonl`, `.kick`,
  `brain-edit-backups/`)
- `apps/cli/src/` + `apps/cli/package.json` + `apps/cli/tsconfig.json` (NO `dist/`, `audits/`, `sessions/`)
- `apps/renderer-page/` (NO `node_modules/`, `dist/`)
- `apps/studio-ui/` (NO `node_modules/`, `dist/`)
- `packages/*/` (NO `node_modules/`, `dist/`)
- `scripts/`
- `docs/` (incl. `PACKAGING.md`, `SETTINGS.md`, `MILESTONES.md`, `cactus-strudel-opus-pilot.md`)
- `bin/`
- `archive-gf/`
- `genres/`
- `cookbook/`
- root files: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `tsconfig.json`, `LICENSE`, `README.md`, `CLAUDE.md`

### Data (producer-brain)

- `producer-brain/corpus.jsonl` (active library)
- `producer-brain/genre-codes.json`
- `producer-brain/kernel/` (6 fragments + style/)
- `producer-brain/pieces/` + `producer-brain/features/` + `producer-brain/prompts/`
- `producer-brain/failure-spine.jsonl`
- `producer-brain/revisions.jsonl`

### Runtime-required external dep — `refs/strudel-monorepo/` (SUBSET)

The renderer-page vite config does:
```ts
import bundleAudioWorkletPlugin from '../../refs/strudel-monorepo/packages/vite-plugin-bundle-audioworklet/...';
```

Required:
- `refs/strudel-monorepo/packages/` (3.7MB) — all the @strudel/* sources
- `refs/strudel-monorepo/package.json`
- `refs/strudel-monorepo/pnpm-lock.yaml`
- `refs/strudel-monorepo/pnpm-workspace.yaml`
- `refs/strudel-monorepo/tools/` (referenced by pnpm-workspace.yaml)
- `refs/strudel-monorepo/.nvmrc`

Excluded:
- `refs/strudel-monorepo/{node_modules,.git,website,docs,test,src-tauri,jsdoc,examples,paper,samples,bench,.astro}`
- `refs/{strudel-songs,keygen,midi,references}` (~900MB ref audio not used at runtime)

## What MUST NOT be in the bundle

| Path | Why |
|---|---|
| `node_modules/` (any) | Rebuilt by `pnpm install` |
| `.git/` | Source control noise |
| `.env*` | May contain machine-specific secrets — config now lives in `~/.cactus-strudel/config.json` instead |
| `apps/cli/audits/` | 2.3GB research outputs |
| `apps/cli/sessions/` | 1.5GB research bundles |
| `apps/cli/dist/`, `apps/*/dist/`, `packages/*/dist/` | Build artifacts |
| `*.tsbuildinfo` | Build cache |
| `runtime/cc-bridge/.agy-run-*.log` | Run logs (per-task) |
| `runtime/cc-bridge/*.jsonl`, `runtime/cc-bridge/.kick` | Local private chat/task/transcript history |
| `runtime/cc-bridge/brain-edit-backups/` | 9.9MB local-only history |
| `runtime/uploads/` | Local uploads/screenshots/scratch files |
| `producer-brain/audio/`, `producer-brain/archive-v0/` | Machine-local rendered audio history; regenerate on target |
| `producer-brain/checkpoints/` | Local rollback snapshots that may contain stale runtime/prompt copies |
| `tests/`, `learning_ledger/`, `sessions/`, `probe-renderer.mjs` | Research substrate |
| `*.bak.*`, `*.bak`, `.DS_Store`, `*.pyc`, `__pycache__` | Cruft |
| `.cactus_pid` | Runtime state |

## Canonical tar build command

Run from `~/` (so `CactusStrudel` is at the top of every entry):

```bash
tar --exclude='CactusStrudel/node_modules' \
    --exclude='CactusStrudel/.git' \
    --exclude='CactusStrudel/.gitignore' \
    --exclude='CactusStrudel/.env' \
    --exclude='CactusStrudel/.env.*' \
    --exclude='CactusStrudel/refs/strudel-songs' \
    --exclude='CactusStrudel/refs/keygen' \
    --exclude='CactusStrudel/refs/midi' \
    --exclude='CactusStrudel/refs/strudel-monorepo/node_modules' \
    --exclude='CactusStrudel/refs/strudel-monorepo/.git' \
    --exclude='CactusStrudel/refs/strudel-monorepo/website' \
    --exclude='CactusStrudel/refs/strudel-monorepo/docs' \
    --exclude='CactusStrudel/refs/strudel-monorepo/test' \
    --exclude='CactusStrudel/refs/strudel-monorepo/src-tauri' \
    --exclude='CactusStrudel/refs/strudel-monorepo/jsdoc' \
    --exclude='CactusStrudel/refs/strudel-monorepo/examples' \
    --exclude='CactusStrudel/refs/strudel-monorepo/paper' \
    --exclude='CactusStrudel/refs/strudel-monorepo/samples' \
    --exclude='CactusStrudel/refs/strudel-monorepo/packages/*/node_modules' \
    --exclude='CactusStrudel/refs/strudel-monorepo/tools/*/node_modules' \
    --exclude='CactusStrudel/references' \
    --exclude='CactusStrudel/apps/cli/audits' \
    --exclude='CactusStrudel/apps/cli/sessions' \
    --exclude='CactusStrudel/apps/cli/dist' \
    --exclude='CactusStrudel/apps/cli/tsconfig.tsbuildinfo' \
    --exclude='CactusStrudel/apps/*/node_modules' \
    --exclude='CactusStrudel/apps/*/dist' \
    --exclude='CactusStrudel/packages/*/node_modules' \
    --exclude='CactusStrudel/packages/*/dist' \
    --exclude='CactusStrudel/runtime/cc-bridge/.agy-run-*.log' \
    --exclude='CactusStrudel/runtime/cc-bridge/*.jsonl' \
    --exclude='CactusStrudel/runtime/cc-bridge/.kick' \
    --exclude='CactusStrudel/runtime/cc-bridge/brain-edit-backups' \
    --exclude='CactusStrudel/runtime/uploads' \
    --exclude='CactusStrudel/producer-brain/audio' \
    --exclude='CactusStrudel/producer-brain/archive-v0' \
    --exclude='CactusStrudel/producer-brain/checkpoints' \
    --exclude='CactusStrudel/tests' \
    --exclude='CactusStrudel/learning_ledger' \
    --exclude='CactusStrudel/sessions' \
    --exclude='CactusStrudel/probe-renderer.mjs' \
    --exclude='*.tsbuildinfo' \
    --exclude='*.bak.*' --exclude='*.bak-*' --exclude='*.bak' \
    --exclude='*.DS_Store' --exclude='*.pyc' --exclude='__pycache__' \
    --exclude='.cactus_pid' \
    -czf /tmp/cactus-strudel-bundle.tar.gz CactusStrudel
```

Expected size: **a few MB** as of 2026-05-31 for the sanitized source/runtime
bundle. If your tar is hundreds of MB, you probably included local rendered
audio, reference corpora, bridge history, or checkpoints.

## Canonical install script

Source-of-truth: `bin/install-cactus-strudel.command.template`.

Ship as `/tmp/install-cactus-strudel.command` next to the tar:

```bash
cp bin/install-cactus-strudel.command.template /tmp/install-cactus-strudel.command
chmod +x /tmp/install-cactus-strudel.command
shasum -a 256 /tmp/cactus-strudel-bundle.tar.gz > /tmp/cactus-strudel-bundle.tar.gz.sha256
```

The install script's required behavior (8 steps):

1. **Sanity**: tar is next to script. Bail if missing.
2. **Integrity**: if `cactus-strudel-bundle.tar.gz.sha256` is next to the tar,
   verify it before extraction and bail on mismatch.
3. **Unpack** to `~/CactusStrudel`. Preserve existing `producer-brain/` (move
   aside before extract, restore after). Existing config at
   `~/.cactus-strudel/config.json` is outside `~/CactusStrudel` — automatically
   preserved.
4. **Verify deps**: node + pnpm + python3 (brew install if missing).
5. **`pnpm install --prefer-offline`** in `~/CactusStrudel` (≈ 1-2 min).
6. **`pnpm install --prefer-offline`** in `~/CactusStrudel/refs/strudel-monorepo`
   (≈ 1-2 min — rebuilds @strudel deps + symlinks).
7. **`pnpm exec playwright install chromium`** — IMPORTANT: must run from a
   workspace package that actually depends on `playwright` (typically
   `apps/renderer-page/` or `apps/cli/`). The installer auto-detects which
   workspace by grepping for `playwright` in their `package.json`. Running
   from the root fails with `command not found`.
8. **Write `~/Desktop/CactusStrudel.command`** launcher. No env vars baked in.
   Pure boot: kill any existing serve on 8765, `nohup python3 runtime/serve.py`,
   `open` browser.
9. **Boot serve.py + open browser**.

The installer should NOT:
- Detect CLIProxy ports
- Scan `~/Downloads/` for API-key docs
- Write `export X=...` lines into the launcher
- Modify `~/.cactus-strudel/config.json`

All config goes through the in-app Settings UI — see `docs/SETTINGS.md`.

## Companion: the post-deploy dispatch

Optional. Useful when handing off to Claude Code on the target machine for
end-to-end verification + Bowei-style memory bootstrap.

Template: `bin/cactus-strudel-postdeploy.md.template`. For a friend's machine
that has no Claude Code, skip this entirely; the Settings UI + the install
script's own verification output is sufficient.

## Deploy via mesh (Bowei-specific)

For Bowei's three-Mac mesh:

```bash
# Mac mini → mbp (note: install script, not deploy script)
rsync -avh --progress \
  /tmp/cactus-strudel-bundle.tar.gz \
  /tmp/cactus-strudel-bundle.tar.gz.sha256 \
  /tmp/install-cactus-strudel.command \
  bowei@mbp.local:Downloads/

# Mac mini → Mac-Studio (different OS user: jack)
rsync -avh --progress \
  /tmp/cactus-strudel-bundle.tar.gz \
  /tmp/cactus-strudel-bundle.tar.gz.sha256 \
  /tmp/install-cactus-strudel.command \
  jack@Mac-Studio.local:Downloads/
```

## Verification (post-install canary)

After the install script finishes on the target, the user opens the workbench
and:

1. Sees a setup banner (gold) saying "⚙ No backends configured yet" if no
   keys are set yet, OR a soft banner showing partial availability.
2. Opens Settings, fills in at least one section, clicks Test for each, then Save.
3. Returns to the workbench — the banner disappears. The model dropdown shows
   the configured slots as available; the rest as red `unavailable`.
4. Smoke-test endpoints (optional, for verifying installer correctness):

```bash
# Health check
curl -s http://localhost:8765/api/version
curl -s http://localhost:8765/api/setup-status

# After Settings configured
curl -s http://localhost:8765/api/backends | python3 -m json.tool

# End-to-end generate (CLIProxy or direct, depending on what was configured)
curl -s --max-time 180 -N -X POST http://localhost:8765/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"slot":"gpt-5.5","extra":"Style envelope they'\''re after: Lo-fi hip-hop.\n\nBPM 82, key D minor."}'
```

If render fails with `Could not resolve "../../refs/strudel-monorepo/..."` →
tar missed the strudel-monorepo subset (step 5 in install failed or was skipped).
If it fails with `playwright not found` → step 6 didn't find a workspace with
playwright; manually `cd <pkg with playwright> && pnpm exec playwright install chromium`.

## Known bugs caught + fixed across versions

| Bundle version | Bug | Symptom | Fix |
|---|---|---|---|
| v1 (deploy-cactus-strudel.command) | refs/strudel-monorepo omitted | vite.config.ts:9 unresolved import | v2 includes subset (3.7MB) + pnpm install in monorepo |
| v1 | Playwright Chromium not installed | render: `playwright not found` | v2 added `pnpm exec playwright install chromium` |
| v2 | KEY_DOC chosen by filename order | mbp picked Mac mini's key doc → 401 | v2 → match by detected port in doc body. v3 → removed entirely (config via UI) |
| v2 | HEREDOC escape corruption in launcher | `export X=\"path\"` literal backslashes | v2 → rewrite as `echo` statements. v3 → launcher has no env vars at all |
| v2 | `pnpm exec playwright install chromium` from repo root failed | "command not found" because root package.json doesn't depend on playwright | v3 → auto-detect which workspace owns playwright (apps/renderer-page, apps/cli, packages/renderer) and run install from there |
| v2 | Per-host configs baked into launcher → non-portable | Friend with no CLIProxy/key doc can't use | v3 → moved all config to in-app Settings UI editing `~/.cactus-strudel/config.json`; installer is fully host-agnostic |
| v2 | Only CLIProxy supported as a multi-vendor route | Users without CLIProxy can't use 6/7 slots | v3 → each slot has BOTH cliproxy_model and direct_model; dispatch picks based on what's configured per-vendor |

## Future hardening (open items)

- **Keychain integration**: move API keys from `~/.cactus-strudel/config.json`
  plaintext to macOS keychain via `security` CLI.
- **Direct-API tool_use for non-CLIProxy users**: currently brain-chat tool_use
  only works through CLIProxy (which translates OpenAI tools → Anthropic
  tool_use). Direct Anthropic mode uses the OpenAI-compatible /v1/chat/completions
  beta surface (assumed to support tools). Direct OpenAI / direct Google /
  direct xAI should also support standard OpenAI tools format — needs vendor-
  by-vendor verification.
- **Model name auto-discovery**: `direct_model` defaults in `BACKEND_REGISTRY`
  may go stale as vendors release new models. Either pin a known-good model
  or let Settings UI offer a per-slot model override.
- **Cross-machine corpus sync**: each install has an independent corpus.
  Optional `/sync-corpus` rsync between user's own machines.
