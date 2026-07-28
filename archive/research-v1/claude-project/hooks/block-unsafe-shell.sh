#!/usr/bin/env bash
# Block obviously destructive shell. Exit 0 = allow; non-zero stderr = block via JSON deny.
set -euo pipefail

# Read JSON from stdin
INPUT=$(cat)

# Extract command via jq if available, else grep
if command -v jq >/dev/null 2>&1; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
else
  CMD=$(echo "$INPUT" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')
fi

if [ -z "$CMD" ]; then
  exit 0
fi

# Patterns that should never run
DANGEROUS_PATTERNS=(
  'rm -rf /'
  'rm -rf ~'
  'rm -rf \$HOME'
  ':(){ :|:& };:'
  'mkfs\.'
  'dd if=.*of=/dev/sd'
  '>/dev/sda'
)

for pat in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$CMD" | grep -E "$pat" >/dev/null 2>&1; then
    cat <<EOF
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Blocked by block-unsafe-shell hook: command matched dangerous pattern '$pat'"}}
EOF
    exit 0
  fi
done

exit 0
