#!/bin/bash
# LAN deploy (D3): push this checkout to a sibling Mac without git push.
#
#   scripts/deploy-lan.sh <host> [remote-path]
#
# Rsyncs the repository working tree (git history included; state roots,
# node_modules, and the machine-local archive bulk excluded) to the sibling,
# then runs bootstrap there. Per-machine state stays per-machine: the
# sibling gets its own empty state root, its own owner epoch, its own
# library. Music assets ride along (they are repo-adjacent immutable truth).
#
# This intentionally does NOT touch the sibling's existing ~/.cactus-strudel.

set -euo pipefail

HOST="${1:?usage: deploy-lan.sh <host> [remote-path]}"
REMOTE_PATH="${2:-CactusStrudel}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== preflight ($HOST)"
ssh -o ConnectTimeout=6 "$HOST" true || {
  echo "deploy-lan: $HOST unreachable over ssh" >&2
  exit 1
}

echo "== rsync → $HOST:$REMOTE_PATH"
rsync -az --delete \
  --exclude 'node_modules/' \
  --exclude 'archive/local/' \
  --exclude '.DS_Store' \
  --exclude 'handoffs/' \
  "$REPO_ROOT/" "$HOST:$REMOTE_PATH/"

echo "== bootstrap on $HOST"
ssh "$HOST" "cd '$REMOTE_PATH' && bash scripts/bootstrap.sh"

echo "== verify"
ssh "$HOST" "cd '$REMOTE_PATH' && bin/strudel status"
echo "deploy-lan: $HOST done"
