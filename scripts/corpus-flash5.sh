#!/bin/zsh
# Model-axis experiment: 5 runs on Gemini 3.5 Flash (vs 3.1 Pro baseline).
# Same baseline guideline (arrange-hint, no lead-hook). GEMINI_MODEL switches
# the web model selector. Compare to Pro arrange-only baseline 6.98.
set -u
ROOT="${CACTUS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST="$ROOT/producer-brain/corpus-2026-05-21.jsonl"
LOG=/tmp/corpus-flash5.log
> "$LOG"
START=${1:-1}; END=${2:-5}
for i in $(seq $START $END); do
  name="FLASH-0$i"
  echo "" | tee -a "$LOG"
  echo "[corpus-flash5] [$i] $name — $(date '+%H:%M:%S')" | tee -a "$LOG"
  export GEMINI_MODEL="3.5 Flash"
  unset PROMPT_EXTRA
  TMP_OUT=$(mktemp)
  "$ROOT/gf" 2>&1 | tee -a "$LOG" > "$TMP_OUT"
  js=$(grep -E "^GEMINI_OUT=" "$TMP_OUT" | tail -1 | cut -d= -f2)
  mp3=$(grep -oE "$ROOT/producer-brain/audio/gemini_auto_[0-9]+\\.mp3" "$TMP_OUT" | tail -1)
  sha=""; [ -f "$mp3" ] && sha=$(shasum -a256 "$mp3" | cut -c1-16)
  dur=""; [ -f "$mp3" ] && dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp3" 2>/dev/null)
  rm -f "$TMP_OUT"
  js_r="${js#$ROOT/}"; mp3_r="${mp3#$ROOT/}"
  printf '{"i":%d,"name":"%s","extra":"(3.5-Flash, arrange-baseline)","js":"%s","mp3":"%s","sha":"%s","dur":"%s","ts":"%s"}\n' \
    "$((29+i))" "$name" "$js_r" "$mp3_r" "$sha" "$dur" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$MANIFEST"
  sleep 3
done
echo "[corpus-flash5] DONE $(date '+%H:%M:%S')" | tee -a "$LOG"
