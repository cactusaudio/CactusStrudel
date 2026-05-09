#!/usr/bin/env bash
# Validate any Strudel snippet written under cookbook/ or tests/fixtures/strudel-snippets/.
# Phase 0: stub. Phase 2 wires the real validator.
set -euo pipefail

INPUT=$(cat)
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
else
  FILE_PATH=""
fi

if [ -z "$FILE_PATH" ]; then exit 0; fi

case "$FILE_PATH" in
  */cookbook/*.jsonl|*/tests/fixtures/strudel-snippets/*) ;;
  *) exit 0;;
esac

# TODO Phase 2: invoke @cactus/strudel-validator
exit 0
