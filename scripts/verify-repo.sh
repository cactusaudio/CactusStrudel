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
echo "OK: $LATEST"

step "DONE — repo truth gate green"
