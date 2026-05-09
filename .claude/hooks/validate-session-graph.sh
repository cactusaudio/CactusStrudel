#!/usr/bin/env bash
# Validate any SessionGraph JSON file written under sessions/ or tests/fixtures/session-graphs/.
# Phase 0: only checks JSON parses + has required top-level keys.
# Phase 1+: invokes the @cactus/ir validator via tsx.
set -euo pipefail

INPUT=$(cat)

if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
else
  FILE_PATH=""
fi

if [ -z "$FILE_PATH" ]; then exit 0; fi

case "$FILE_PATH" in
  */sessions/*.json|*/tests/fixtures/session-graphs/*.json) ;;
  *) exit 0;;
esac

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

if ! jq -e '.schema_version and .session_id and .brief and .song' "$FILE_PATH" >/dev/null 2>&1; then
  echo "validate-session-graph: $FILE_PATH missing required top-level keys (schema_version, session_id, brief, song)" >&2
  exit 2
fi

exit 0
