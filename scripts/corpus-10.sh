#!/bin/zsh
# Corpus runner: 10 single-axis variations of the Gemini-fetch guideline.
# Each iteration: export PROMPT_EXTRA → run gf chained → record manifest line.
# Sequential (CDP attach is single-Chrome). ~3-5min/piece → ~30-50min total.
set -u
ROOT="${CACTUS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST="$ROOT/producer-brain/corpus-2026-05-21.jsonl"
LOG=/tmp/corpus-10.log
> "$LOG"
echo "[corpus-10] manifest=$MANIFEST log=$LOG" | tee -a "$LOG"

# Variations: "name|extra"
typeset -a V
V=(
  "V01-baseline|"
  "V02-baseline2|"
  "V03-arrange|Use arrange() with at least 4 sections of varying layer density (e.g., intro+kick / +bass / full / breakdown / outro)."
  "V04-lead-hook|Make a memorable melodic LEAD the focal point — a clear hook on top, not just texture or arpeggios."
  "V05-ambient|Genre: ambient — slow evolving sparse, large reverb (room 0.9), gentle pads, no aggressive drums, ~80 bpm."
  "V06-techno|Genre: techno — driving 4/4 kick, layered hypnotic, 128-140 BPM, minimal harmonic motion, percussive subdivisions."
  "V07-dnb|Genre: drum-and-bass — fast breakbeat ~170 BPM, prominent sub bass, atmospheric pad, syncopated drums."
  "V08-diatonic|Use diatonic modal progression (e.g., C minor / A minor scale chords) — avoid jazz extensions (^7, m9, m7) unless featured intentionally."
  "V09-form|Total >= 64 cycles with clear ABABCA-style structure — repeat A theme with variation, contrast B section."
  "V10-density|Keep AT LEAST 3 layers playing throughout — no section with only 1-2 layers (especially no pad-only intros/outros)."
)

i=0
for v in "${V[@]}"; do
  i=$((i+1))
  name="${v%%|*}"
  extra="${v#*|}"
  echo "" | tee -a "$LOG"
  echo "[corpus-10] [$i/10] $name — $(date '+%H:%M:%S')" | tee -a "$LOG"
  export PROMPT_EXTRA="$extra"
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
  # JSONL entry — keep tight
  printf '{"i":%d,"name":"%s","extra":%s,"js":"%s","mp3":"%s","sha":"%s","dur":"%s","ts":"%s"}\n' \
    "$i" "$name" "$(printf '%s' "$extra" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))')" \
    "$js_r" "$mp3" "$sha" "$dur" "$(date '+%Y-%m-%d %H:%M:%S')" >> "$MANIFEST"
  unset PROMPT_EXTRA
  # tiny cooldown between Gemini calls (be polite to web Gemini)
  sleep 3
done

echo "" | tee -a "$LOG"
echo "[corpus-10] DONE $(date '+%H:%M:%S')" | tee -a "$LOG"
echo "=== manifest ===" | tee -a "$LOG"
cat "$MANIFEST" | tee -a "$LOG"
