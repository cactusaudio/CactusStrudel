#!/usr/bin/env bash
# After writing a .ts file in a package, run that package's tests if they're cheap.
# Skipped during pnpm install / build to avoid recursion. Hook is no-op while CACTUS_HOOK_QUIET=1.
set -euo pipefail

[ "${CACTUS_HOOK_QUIET:-0}" = "1" ] && exit 0

INPUT=$(cat)
if ! command -v jq >/dev/null 2>&1; then exit 0; fi
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0;;
esac

# Walk up to find packages/<name> or apps/<name>
PKG_DIR=""
DIR=$(dirname "$FILE_PATH")
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ] && [ -d "$DIR/src" ]; then
    PKG_DIR="$DIR"
    break
  fi
  DIR=$(dirname "$DIR")
done

[ -z "$PKG_DIR" ] && exit 0

# Skip if no test files
if ! find "$PKG_DIR/src" -name '*.test.ts' -print -quit 2>/dev/null | grep -q .; then
  exit 0
fi

# Hint Claude that tests are runnable here, but don't block.
PKG_NAME=$(jq -r '.name // empty' "$PKG_DIR/package.json")
[ -z "$PKG_NAME" ] && exit 0
cat <<EOF
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "Tests for $PKG_NAME exist. Consider: pnpm vitest run --root $PKG_DIR"}}
EOF

exit 0
