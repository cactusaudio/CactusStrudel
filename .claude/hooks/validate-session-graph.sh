#!/usr/bin/env bash
# G1: real SessionGraph validator. Forwards stdin to scripts/hooks/validate-graph-on-write.mjs
# which loads SessionGraphSchema (zod) from packages/ir and reports issues via stderr+exit 2.
# Replaces the prior jq-only top-level-keys check.
set -euo pipefail
exec node "$CLAUDE_PROJECT_DIR/scripts/hooks/validate-graph-on-write.mjs"
