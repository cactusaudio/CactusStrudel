#!/bin/zsh
# Validation batch: 5 runs of the new baseline (arrange-hint NOW BAKED into
# gemini-fetch.ts PROMPT_BASE, no PROMPT_EXTRA). Compare scores to prior
# baseline V01 (6.5) + V02 (6.0) — same guideline but no arrange hint.
# Expected lift: ~+0.38 (per fs-013). If validated, arrange-hint stays in
# baseline; if not, it's noise.
set -u
ROOT="${CACTUS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST="$ROOT/producer-brain/corpus-2026-05-21.jsonl"
LOG=/tmp/corpus-arr5.log
> "$LOG"
echo "[corpus-arr5] manifest=$MANIFEST log=$LOG" | tee -a "$LOG"

for i in 1 2 3 4 5; do
  name="ARR-0$i"
  echo "" | tee -a "$LOG"
  echo "[corpus-arr5] [$i/5] $name — $(date '+%H:%M:%S')" | tee -a "$LOG"
  unset PROMPT_EXTRA  # baseline (with new built-in arrange hint)
  TMP_OUT=$(mktemp)
  "$ROOT/gf" 2>&1 | tee -a "$LOG" > "$TMP_OUT"
  js=$(grep -E "^GEMINI_OUT=" "$TMP_OUT" | tail -1 | cut -d= -f2)
  mp3=$(grep -oE "$ROOT/producer-brain/audio/gemini_auto_[0-9]+\\.mp3" "$TMP_OUT" | tail -1)
  sha=""
  [ -f "$mp3" ] && sha=$(shasum -a256 "$mp3" | cut -c1-16)
  dur=""
  [ -f "$mp3" ] && dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp3" 2>/dev/null)
  rm -f "$TMP_OUT"
  js_r="${js#$ROOT/}"; mp3_r="${mp3#$ROOT/}"
  printf '{"i":%d,"name":"%s","extra":"(BASELINE+arrange-baked)","js":"%s","mp3":"%s","sha":"%s","dur":"%s","ts":"%s"}\n' \
    "$((10+i))" "$name" "$js_r" "$mp3_r" "$sha" "$dur" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$MANIFEST"
  sleep 3
done

echo "" | tee -a "$LOG"
echo "[corpus-arr5] DONE $(date '+%H:%M:%S')" | tee -a "$LOG"
tail -5 "$MANIFEST" | tee -a "$LOG"
