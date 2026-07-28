#!/usr/bin/env bash
# Proportional v3 source gate. Musical quality remains a human listening gate.

set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf "\n=== %s ===\n" "$1"; }

step "Repository contracts"
python3 scripts/check_docs.py
node --test scripts/build-receipt.test.mjs

step "Python runtime"
python3 -m py_compile \
  runtime/serve.py \
  runtime/v3_api.py \
  runtime/prompt_kernel.py \
  scripts/repo_context.py \
  scripts/repo_fingerprint.py \
  scripts/check_docs.py
python3 -m unittest discover -s tests/repo_systems -t . -v
python3 -m unittest discover -s tests/agent_v3 -v
python3 -m unittest discover -s tests/v3 -v
PYTHONWARNINGS=error::ResourceWarning \
  python3 -m unittest discover -s tests/v3_api -t . -v

step "Active TypeScript workspace"
pnpm typecheck
pnpm test

step "Production web builds"
pnpm --filter @cactus/producer-ui build
pnpm --filter @cactus/renderer-page build
node scripts/build-receipt.mjs check producer-ui
node scripts/build-receipt.mjs check renderer-page

step "Operator CLI syntax"
while IFS= read -r script; do
  if head -n 1 "$script" | grep -q 'bash'; then
    bash -n "$script"
  fi
done < <(find bin -maxdepth 1 -type f -perm -111 -print | sort)

step "Patch hygiene"
git diff --check

step "DONE — deterministic v3 checks green; music still requires Bowei's ear"
