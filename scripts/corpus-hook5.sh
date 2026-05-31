#!/bin/zsh
# Validation batch 2: 5 runs with lead-hook hint NOW BAKED into baseline
# (arrange hint already baked). Compare to ARR batch (mean 6.98, arrange-
# only). Tests whether lead-hook STACKS on top of arrange.
set -u
ROOT="${CACTUS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST="$ROOT/producer-brain/corpus-2026-05-21.jsonl"
LOG=/tmp/corpus-hook5.log
> "$LOG"
echo "[corpus-hook5] manifest=$MANIFEST log=$LOG" | tee -a "$LOG"
for i in 1 2 3 4 5; do
  name="HOOK-0$i"
  echo "" | tee -a "$LOG"
  echo "[corpus-hook5] [$i/5] $name — $(date '+%H:%M:%S')" | tee -a "$LOG"
  unset PROMPT_EXTRA
  TMP_OUT=$(mktemp)
  "$ROOT/gf" 2>&1 | tee -a "$LOG" > "$TMP_OUT"
  js=$(grep -E "^GEMINI_OUT=" "$TMP_OUT" | tail -1 | cut -d= -f2)
  mp3=$(grep -oE "$ROOT/producer-brain/audio/gemini_auto_[0-9]+\\.mp3" "$TMP_OUT" | tail -1)
  sha=""; [ -f "$mp3" ] && sha=$(shasum -a256 "$mp3" | cut -c1-16)
  dur=""; [ -f "$mp3" ] && dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp3" 2>/dev/null)
  rm -f "$TMP_OUT"
  js_r="${js#$ROOT/}"; mp3_r="${mp3#$ROOT/}"
  printf '{"i":%d,"name":"%s","extra":"(BASELINE+arrange+lead-hook baked)","js":"%s","mp3":"%s","sha":"%s","dur":"%s","ts":"%s"}\n' \
    "$((15+i))" "$name" "$js_r" "$mp3_r" "$sha" "$dur" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$MANIFEST"
  sleep 3
done
echo "" | tee -a "$LOG"
echo "[corpus-hook5] DONE $(date '+%H:%M:%S')" | tee -a "$LOG"
tail -5 "$MANIFEST" | tee -a "$LOG"
