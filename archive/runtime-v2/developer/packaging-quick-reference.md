# Packaging quick reference

TL;DR of `docs/PACKAGING.md`. Read this when you're about to build a bundle.

## When you'd build a bundle

Bowei says: "打包一下" or "传到 mbp" or "更新 mbp 的部署". That's the signal.

## Steps

```bash
# 1. Build the tar (run from ~ so paths are CactusStrudel/...)
cd ~
tar --exclude='CactusStrudel/node_modules' \
    --exclude='CactusStrudel/.git' \
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
    --exclude='CactusStrudel/references' \
    --exclude='CactusStrudel/learning_ledger' \
    --exclude='CactusStrudel/sessions' \
    --exclude='CactusStrudel/probe-renderer.mjs' \
    --exclude='*.tsbuildinfo' --exclude='*.bak*' \
    --exclude='*.DS_Store' --exclude='*.pyc' --exclude='__pycache__' \
    -czf /tmp/cactus-strudel-bundle.tar.gz CactusStrudel

# Expected size: a few MB for the sanitized source/runtime bundle
ls -lh /tmp/cactus-strudel-bundle.tar.gz

# 2. Refresh installer
cp /Users/bowei/CactusStrudel/bin/install-cactus-strudel.command.template /tmp/install-cactus-strudel.command
chmod +x /tmp/install-cactus-strudel.command

# 3. Ship
rsync -avh /tmp/cactus-strudel-bundle.tar.gz /tmp/install-cactus-strudel.command bowei@mbp.local:Downloads/
# Or to Mac-Studio:
rsync -avh /tmp/cactus-strudel-bundle.tar.gz /tmp/install-cactus-strudel.command jack@Mac-Studio.local:Downloads/

# 4. Tell Bowei to double-click install-cactus-strudel.command on the target.
```

## Sanity expectations

- Tar size: **a few MB** for the sanitized source/runtime bundle. If hundreds of MB → check local audio/archive/checkpoint/bridge excludes.
- Files: small source/runtime bundle, not a corpus/audio archive
- After install on target: 7 backends available (assuming Settings configured), Settings page reachable.

## Critical includes

These are easy to accidentally exclude. Verify the tar HAS them:

```bash
# Critical: strudel-monorepo subset (3.7MB)
tar -tzf /tmp/cactus-strudel-bundle.tar.gz | grep "refs/strudel-monorepo/packages/" | head
# Should show many files

# Critical: kernel fragments
tar -tzf /tmp/cactus-strudel-bundle.tar.gz | grep "producer-brain/kernel/" | head
# Should show 6+ .md files

# Critical: no private/runtime-local state
tar -tzf /tmp/cactus-strudel-bundle.tar.gz | rg 'runtime/cc-bridge|runtime/uploads|producer-brain/(audio|archive-v0|checkpoints)|(^|/)\.env(\.|$)' && exit 1 || echo "clean"

# Critical: runtime/user_config.py, runtime/settings.html
tar -tzf /tmp/cactus-strudel-bundle.tar.gz | grep -E "(user_config\.py|settings\.html)"
```

## What the installer does (high-level)

1. Unpack tar → `~/CactusStrudel` (preserves existing `producer-brain/` first)
2. Brew install node + pnpm if missing
3. `pnpm install` in main repo (~1-2 min)
4. `pnpm install` in `refs/strudel-monorepo` (~1-2 min, rebuilds @strudel deps)
5. `pnpm exec playwright install chromium` from the workspace that owns playwright
6. Write `~/Desktop/CactusStrudel.command` (no env baked in — Settings UI handles)
7. Start serve.py + `open` browser

## Common shipping mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Forgot `refs/strudel-monorepo/packages/` | renderer-page vite import fails | Add to tar, re-rsync |
| Missed `pnpm install` in strudel-monorepo | @strudel/* internal symlinks broken | Installer runs both pnpm installs |
| Playwright install ran from repo root | "command not found" | Installer finds the workspace that owns playwright |
| Baked env vars into launcher | Wrong CLIProxy port on target | Don't — Settings UI handles |
| Hardcoded `-Users-bowei` in user_config defaults | Mac-Studio `jack` user breaks | `getpass.getuser()` auto-derive |

All fixed in current v3 installer. If you write a new packaging variant, re-check
each of these.

## Verification dispatch (companion file)

`bin/cactus-strudel-postdeploy.md.template` is a pre-written dispatch Bowei can
paste into the target machine's Claude Code AFTER install completes. It runs
end-to-end verification + memory bootstrap. Skip if user isn't running Claude
Code on the target.
