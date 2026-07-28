#!/usr/bin/env bash
# G1: real Strudel validator. Forwards stdin to scripts/hooks/validate-strudel-on-write.mjs
# which loads the actual @cactus/strudel-validator and reports issues via stderr+exit 2.
set -euo pipefail
exec node "$CLAUDE_PROJECT_DIR/scripts/hooks/validate-strudel-on-write.mjs"
