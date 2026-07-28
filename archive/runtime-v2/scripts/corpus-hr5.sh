#!/bin/zsh
# Validation batch 3: refined lead-hook (arrange + lead-hook-with-explicit-
# anti-vibrato, both baked). Compare to ARR baseline 6.98. Tests whether
# forbidding heavy vibrato recovers the lead-hook idea (fs-016).
set -u
ROOT="${CACTUS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST="$ROOT/producer-brain/corpus-2026-05-21.jsonl"
LOG=/tmp/corpus-hr5.log
> "$LOG"
echo "[corpus-hr5] manifest=$MANIFEST log=$LOG" | tee -a "$LOG"
for i in 1 2 3 4 5; do
  name="HR-0$i"
  echo "" | tee -a "$LOG"
  echo "[corpus-hr5] [$i/5] $name — $(date '+%H:%M:%S')" | tee -a "$LOG"
  unset PROMPT_EXTRA
  TMP_OUT=$(mktemp)
  "$ROOT/gf" 2>&1 | tee -a "$LOG" > "$TMP_OUT"
  js=$(grep -E "^GEMINI_OUT=" "$TMP_OUT" | tail -1 | cut -d= -f2)
  mp3=$(grep -oE "$ROOT/producer-brain/audio/gemini_auto_[0-9]+\\.mp3" "$TMP_OUT" | tail -1)
  sha=""; [ -f "$mp3" ] && sha=$(shasum -a256 "$mp3" | cut -c1-16)
  dur=""; [ -f "$mp3" ] && dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp3" 2>/dev/null)
  rm -f "$TMP_OUT"
  js_r="${js#$ROOT/}"; mp3_r="${mp3#$ROOT/}"
  printf '{"i":%d,"name":"%s","extra":"(BASELINE+arrange+refined-lead-hook baked)","js":"%s","mp3":"%s","sha":"%s","dur":"%s","ts":"%s"}\n' \
    "$((23+i))" "$name" "$js_r" "$mp3_r" "$sha" "$dur" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$MANIFEST"
  sleep 3
done
echo "" | tee -a "$LOG"
echo "[corpus-hr5] DONE $(date '+%H:%M:%S')" | tee -a "$LOG"
tail -5 "$MANIFEST" | tee -a "$LOG"
