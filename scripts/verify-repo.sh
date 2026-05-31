#!/usr/bin/env bash
# Repo truth gate (G0). Runs the build / test / audit pipeline that the
# Phase-15 ultra-review identified as required for autonomous governor work.
# Exits 0 only if every step passes.

set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf "\n=== %s ===\n" "$1"; }

step "git state"
git rev-parse --short HEAD
git status --short

step "node + pnpm"
node --version
pnpm --version
uname -a

step "pnpm install (frozen lockfile)"
pnpm install --frozen-lockfile

step "tsc -b (project references compile)"
pnpm exec tsc -b --pretty false

step "pnpm test (unit suite)"
pnpm test

step "renderer E2E smoke (Chromium + renderer-page + WAV)"
CACTUS_RENDER_E2E=1 pnpm exec vitest run packages/renderer/src/index.test.ts -t 'renders a synth pattern to non-silent audio'

step "renderer conformance (samples + batch determinism)"
CACTUS_RENDER_E2E=1 pnpm exec vitest run tests/conformance/renderer-conformance.test.ts

step "produce real-chain conformance (render + analyze + critic)"
CACTUS_RENDER_E2E=1 pnpm exec vitest run tests/conformance/produce-real-chain.test.ts

step "runtime python helpers"
python3 -m py_compile runtime/serve.py runtime/test_serve_helpers.py
python3 -m unittest runtime/test_serve_helpers.py

step "portable helper paths"
if rg -n '/Users/bowei/CactusStrudel' bin scripts runtime \
  --glob '!runtime/cc-bridge/**' \
  --glob '!runtime/uploads/**' \
  --glob '!runtime/data.html' \
  --glob '!scripts/verify-repo.sh' \
  --glob '!bin/*template' \
  --glob '!bin/cactus-strudel-postdeploy.md.template'; then
  echo "FAIL: operational helper hardcodes /Users/bowei/CactusStrudel" >&2
  exit 1
fi

step "live/research boundary doc"
test -f docs/LIVE_VS_RESEARCH.md
rg -q 'runtime/serve\.py' docs/LIVE_VS_RESEARCH.md
rg -q 'apps/cli/src/auto-render\.ts' docs/LIVE_VS_RESEARCH.md
rg -q 'SessionGraph.*TypeScript research engine' docs/LIVE_VS_RESEARCH.md
rg -q 'live product improvement from research-only green tests' docs/LIVE_VS_RESEARCH.md
rg -q 'Stack Ownership Matrix' docs/LIVE_VS_RESEARCH.md
rg -q 'Retired Zombie Claims' docs/LIVE_VS_RESEARCH.md
rg -q 'Research Architecture \(Historical\)' docs/architecture.md
rg -q 'not the live CactusStrudel product architecture' docs/architecture.md
rg -q 'Research IR — SessionGraph' docs/ir.md
rg -q 'not the live studio.s data contract' docs/ir.md
rg -q 'docs/LIVE_VS_RESEARCH\.md' CLAUDE.md

step "pnpm cactus audit:repair (real-WAV smoke)"
# audit:repair writes its bundle under sessions/audits/repair-<timestamp>/.
# Default cwd is the cli package; we accept either path, just fail if no bundle appears.
pnpm cactus -- audit:repair

step "verify audit bundle artifacts"
# `ls` exits non-zero when no glob matches and pipefail/set-e would abort the
# script before the FAIL branch can run, so guard the lookup explicitly.
LATEST=""
for cand in apps/cli/sessions/audits sessions/audits; do
  if [ -d "$cand" ]; then
    found="$(find "$cand" -mindepth 1 -maxdepth 1 -type d -name 'repair-*' -print 2>/dev/null | sort | tail -1)"
    if [ -n "$found" ] && [ -z "$LATEST" ]; then LATEST="$found"; fi
  fi
done
if [ -z "$LATEST" ] || [ ! -d "$LATEST" ]; then
  echo "FAIL: no audit:repair bundle found in apps/cli/sessions/audits/ or sessions/audits/" >&2
  exit 1
fi
test -f "$LATEST/audit-report.md"
test -f "$LATEST/audit-summary.json"
test -d "$LATEST/diagnostics"
node -e "const fs=require('fs'); const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const cats=s.champion_failures_by_category||{}; const bad=Object.entries(cats).filter(([,v])=>Number(v)>0); if ((s.champion_fail||0)>0 || bad.length) { console.error('FAIL: audit champion_fail='+s.champion_fail+' categories='+JSON.stringify(cats)); process.exit(1); }" "$LATEST/audit-summary.json"
echo "OK: $LATEST"

step "DONE — repo truth gate green"
