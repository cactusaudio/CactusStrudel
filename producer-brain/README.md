# Cactus producer-brain

Bowei-decided architecture (2026-05-18): **Gemini-3.1-flash-lite
(native multimodal) composes Strudel → renders → LISTENS to its own
render → self-critiques → revises.** Claude = governor/curriculum/
meta-critic (between runs, NOT in-loop). v1 memory = DeepSeek-Gem-
style **failure-intelligence spine** (`failure-spine.jsonl`): every
heard defect → durable avoid-rule / taught technique, retrieved into
the next compose prompt. Interactive bootstrap; promote to resident.

- `apps/cli/src/producer-brain.ts` — the loop. Run:
  `tsx src/producer-brain.ts "<brief>" <rounds>`
- `failure-spine.jsonl` — the accumulating brain (Claude-curated).
- `run_*.json` — per-run transcript (Gemini's code + its own heard
  critiques). `candidate_rules_*` — Gemini-proposed rules awaiting
  Claude curation. `last_best.{strudel.js,url}` — best output.

Status: MVP loop proven end-to-end — Gemini genuinely hears its own
output and self-improves (4→6/10 honest). Plateau at 6/10 on kick/
bass low-end masking → addressed by curriculum entry fs-010.
Renderer is the offline (oscillator) subset; final pieces are for
strudel.cc.
