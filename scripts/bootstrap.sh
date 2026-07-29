#!/bin/bash
# CactusStrudel machine bootstrap (D1): fresh checkout → serving runtime.
#
# Idempotent, no sudo. Verifies external dependencies (naming the exact fix
# when one is missing), installs workspace deps with the frozen lockfile,
# produces both controlled builds, installs/refreshes the user LaunchAgent,
# then gates on health + doctor. Safe to re-run at any time.
#
# Env overrides: CACTUS_PORT (default 8765), CACTUS_V3_STATE_ROOT,
# CACTUS_SHUTDOWN_TIMEOUT, CACTUS_SKIP_LAUNCHD=1 (build/verify only).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${CACTUS_PORT:-8765}"
LABEL="com.cactus.strudel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_ROOT="${CACTUS_V3_STATE_ROOT:-$HOME/.cactus-strudel/v3}"
LOG_PATH="$STATE_ROOT/serve.log"

step() { printf '\n== %s\n' "$1"; }
fail() { printf 'bootstrap: %s\n' "$1" >&2; exit 1; }

step "dependencies"
command -v git >/dev/null || fail "git is missing (xcode-select --install)"
PYTHON_BIN="$(command -v python3)" || fail "python3 is missing (brew install python)"
command -v node >/dev/null || fail "node is missing (brew install node)"
command -v ffmpeg >/dev/null || fail "ffmpeg is missing (brew install ffmpeg)"
command -v ffprobe >/dev/null || fail "ffprobe is missing (brew install ffmpeg)"
if ! command -v pnpm >/dev/null; then
  command -v corepack >/dev/null || fail "pnpm and corepack are both missing (brew install node, then corepack enable)"
  corepack enable >/dev/null 2>&1 || fail "corepack enable failed; run it manually"
  command -v pnpm >/dev/null || fail "pnpm still missing after corepack enable"
fi
if [ ! -e "/Applications/Google Chrome.app" ] && [ -z "${CACTUS_RENDER_BROWSER_PATH:-}" ]; then
  # Renderer prefers system Chrome; bundled Chromium is the fallback.
  (cd "$REPO_ROOT/packages/renderer" && pnpm exec playwright install chromium) \
    || fail "no Chrome and Playwright Chromium install failed"
fi
echo "git/node/pnpm/ffmpeg/python3 present"

step "workspace install (frozen lockfile)"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile)

step "controlled builds"
(cd "$REPO_ROOT" && node scripts/build-receipt.mjs run producer-ui)
(cd "$REPO_ROOT" && node scripts/build-receipt.mjs run renderer-page)

if [ "${CACTUS_SKIP_LAUNCHD:-0}" = "1" ]; then
  step "launchd skipped (CACTUS_SKIP_LAUNCHD=1)"
else
  step "launch agent"
  mkdir -p "$(dirname "$PLIST")" "$STATE_ROOT"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON_BIN</string>
        <string>$REPO_ROOT/runtime/serve.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CACTUS_NO_BROWSER</key>
        <string>1</string>
        <key>CACTUS_PORT</key>
        <string>$PORT</string>
        <key>CACTUS_V3_STATE_ROOT</key>
        <string>$STATE_ROOT</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>$LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$LOG_PATH</string>
</dict>
</plist>
PLIST_EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  # launchd returns EIO when the old job has not fully unloaded yet; give it
  # a moment and retry.
  BOOTSTRAPPED=0
  for _ in 1 2 3 4 5; do
    sleep 2
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
      BOOTSTRAPPED=1
      break
    fi
  done
  [ "$BOOTSTRAPPED" = "1" ] || fail "launchctl bootstrap kept failing for $LABEL"
  launchctl kickstart "gui/$(id -u)/$LABEL" 2>/dev/null || true

  step "health gate"
  for _ in $(seq 1 60); do
    if curl -sf -m 2 "http://127.0.0.1:$PORT/api/v2/health" >/dev/null; then
      break
    fi
    sleep 1
  done
  curl -sf -m 5 "http://127.0.0.1:$PORT/api/v2/health" >/dev/null \
    || fail "server never became healthy on :$PORT (log: $LOG_PATH)"

  step "doctor gate"
  if ! CACTUS_BASE_URL="http://127.0.0.1:$PORT" "$REPO_ROOT/bin/cactus" doctor; then
    echo "bootstrap: doctor reports attention items above (runtime IS serving)." >&2
  fi
fi

step "done"
echo "CactusStrudel → http://127.0.0.1:$PORT/studio"
