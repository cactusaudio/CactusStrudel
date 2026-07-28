// Cactus producer-brain MVP (2026-05-18).
// Architecture (Bowei-decided): Gemini-2.5 (native multimodal) COMPOSES
// Strudel → renders → LISTENS to its own render → critiques → revises.
// Claude = governor/curriculum/meta-critic (between runs, not in-loop).
// v1 memory = DeepSeek-Gem-style FAILURE-INTELLIGENCE SPINE: every
// heard defect becomes a durable avoid-rule retrieved into the next
// compose prompt. Interactive bootstrap; promote to resident later.
//
// Run: tsx src/producer-brain.ts "<governor brief>" [rounds]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { render, shutdown } from '@cactus/renderer';

const ROOT = process.env.CACTUS_ROOT || '/Users/bowei/CactusStrudel';
const KEY = readFileSync(`${ROOT}/.env.local`, 'utf8').match(/GEMINI_API_KEY=(.+)/)![1]!.trim();
const SPINE = `${ROOT}/producer-brain/failure-spine.jsonl`;
const MODEL = 'gemini-3.1-flash-lite';

// Renderable subset learned this session (offline renderer ≠ strudel.cc).
const SYNTAX = `STRUDEL SYNTAX CONTRACT (hard — code MUST render in the offline engine):
- tempo: setcpm(BPM/4)
- pitched: n("<deg deg ...>").scale("a3:minor")  // scale-degree patterns; one scale-helper root per layer for coherence
- chords: n("<[0,2,4] [5,0,2]>/2").scale("c3:minor")  // simultaneous degrees
- drums: sound("bd*4"), sound("~ cp ~ cp"), sound("[~ hh]*4"), sound("white*16").decay(.01).sustain(0)
- structure: $NAME: <pattern> blocks; stack(...); per-cycle variation via <a b c>; [..] groups; * ! ~ @ ,
- chain ONLY: .gain .lpf .lpq .hpf .clip .room .delay .delaytime .delayfeedback .decay .sustain .attack .release .mask .add .sub .fast .slow .pan
- WAVEFORM is set ONLY by .s("sawtooth") or .sound("triangle"). THERE IS NO .sine() / .sawtooth() / .triangle() / .square() METHOD — calling one CRASHES the render. Likewise NO .struct("0@4") with numbers.
- sounds ONLY: "sawtooth" "square" "triangle" "sine" + drums bd sd hh cp white
- FORBIDDEN (will fail to render): cat() .apply() .struct() perlin superimpose lpenv .bank() gm_* "oh" "piano" "supersaw" ; bare top-level VAR= assignments are fine ONLY if the LAST line is a bare Pattern expression OR use $NAME: blocks.
- arrangement: per-layer .mask("<0@2 1@10>") (1=on/0=off per cycle); keep each layer's mask total equal.
SPACE/SEPARATION — there is NO sidechain/EQ/compressor here. Create space ONLY via: gain balance between layers, lpf/hpf frequency carving, rests in patterns, and .mask staging. Do NOT .clip() every layer (that causes a harsh wall of distortion); clip is rare deliberate grit on at most ONE element.
EXACT WORKING SKELETON — match this shape precisely (note: clip used sparingly):
setcpm(120/4)
$BASS: n("<[0 0 7 0] [5 5 4 5]>*2").scale("c2:minor").s("sawtooth").lpf(560).gain(0.4)
$CHORD: n("<[0,2,4] [5,0,2]>/2").scale("c3:minor").s("triangle").lpf(1500).gain(0.16).room(0.5)
$LEAD: n("<[0 ~ 3 2] [4 ~ 2 0]>").scale("c4:minor").s("square").lpf(2600).gain(0.28).room(0.3).delay(0.25).mask("<0@2 1@10>")
$DRUMS: stack(sound("bd*4").gain(0.92), sound("~ cp ~ cp").gain(0.4), sound("[~ hh]*4").gain(0.24).hpf(7000)).mask("<0@2 1@10>")
Output ONLY the Strudel code in exactly this style. No markdown fences, no prose, no .sine()-style method calls.`;

const IDIOMS = `LEARNED CRAFT (from 149-song corpus + human verdicts):
- Lean into CANONICAL FORMULA: axis/4-chord progressions (I–vi–IV–V, i–VI–III–VII), proven dance forms (deep house, synthpop, lo-fi, ambient, trance). Formula carries musicality.
- WARMTH + CONSONANCE + SPACE beat technical correctness. Filter raw waves; leave rests; vary bars.
- Bass = rhythmic scale-degree pattern locked to kick (NEVER a held drone).
- Melody-forward: the hook must be present and clear, not buried.
- One memorable motif reused at octaves/sections for cohesion.`;

interface Round { n: number; code: string; renderOk: boolean; renderErr?: string; critique?: any; }

async function gemini(parts: any[], jsonOut = false): Promise<string> {
  const body: any = { contents: [{ parts }] };
  if (jsonOut) body.generationConfig = { responseMimeType: 'application/json', temperature: 0.7 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const d = await res.json() as any;
  if (!d.candidates) throw new Error('gemini: ' + JSON.stringify(d).slice(0, 300));
  return d.candidates[0].content.parts.map((p: any) => p.text).join('');
}

function loadSpine(): string {
  if (!existsSync(SPINE)) return '(none yet)';
  return readFileSync(SPINE, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => { const e = JSON.parse(l); return `- AVOID: ${e.avoid_rule}  [because: ${e.symptom_heard}]`; })
    .join('\n');
}
function stripFences(s: string): string {
  return s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

(async () => {
  const brief = process.argv[2] || 'a warm, formulaic deep-house piece, ~16 bars, canonical progression, the proven-strength lane';
  const maxRounds = parseInt(process.argv[3] || '4', 10);
  const spine = loadSpine();
  console.log(`BRIEF: ${brief}\nSPINE (${spine.split('\n').length} avoid-rules) loaded\n`);

  const rounds: Round[] = [];
  let lastCritique = '';
  let lastFix = '';
  let bestCode = '';
  let lastGoodCode = ''; // last code that actually rendered
  for (let i = 1; i <= maxRounds; i++) {
    const fresh = `You are the resident Strudel music producer. Compose ONE piece.
GOAL: ${brief}
${IDIOMS}
FAILURE MEMORY — you have heard these mistakes before, do NOT repeat them:
${spine}
${SYNTAX}`;
    // Revise = MINIMAL edit of the last code that RENDERED (robust for a
    // lite model; free recompose-from-critique kept breaking the render).
    const composePrompt = (lastGoodCode && lastFix)
      ? `You are the resident Strudel producer revising YOUR OWN piece.
${SYNTAX}
FAILURE MEMORY:
${spine}
This code RENDERED correctly:
${lastGoodCode}
Apply ONLY this fix you decided from listening: "${lastFix}".
Change as LITTLE as possible (mostly gain/lpf/hpf/rests/mask — never add unsupported constructs). Keep what works. Output the full corrected code only.`
      : fresh;
    let code = stripFences(await gemini([{ text: composePrompt }]));
    // render with up to 2 self-heal retries on render error
    let renderOk = false, renderErr = '';
    for (let h = 0; h < 3; h++) {
      try {
        await render({ code, durationCycles: 24, cps: 0.42, outputPath: '/tmp/pb.wav' });
        renderOk = true; break;
      } catch (e) {
        renderErr = String((e as Error)?.message ?? e).slice(0, 200);
        if (h < 2) {
          const hint = `RENDER FAILED ("${renderErr}"). Almost always one of: (1) a .sine()/.sawtooth()/.triangle()/.square()/.struct() method call — DELETE it, set waveform only via .s("sine"); (2) the program's final value is not a Pattern — END with a bare Pattern expression OR use $NAME: blocks for every layer; (3) an unsupported function (cat/apply/perlin/superimpose/bank/gm_). Rewrite to match the WORKING SKELETON exactly.`;
          code = stripFences(await gemini([{ text: `${composePrompt}\n\n${hint}\n\nYOUR FAILED CODE:\n${code}` }]));
        }
      }
    }
    const r: Round = { n: i, code, renderOk, renderErr };
    if (renderOk) {
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-y',
        '-i', '/tmp/pb.wav',
        '-t', '13',
        '-ac', '1',
        '-ar', '22050',
        '/tmp/pb.mp3',
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
      const b64 = readFileSync('/tmp/pb.mp3').toString('base64');
      const judge = await gemini([
        { text: `This is the audio of YOUR OWN composition (~13s) + its code. Judge honestly as a producer with ears. Be specific about what you HEAR. Code:\n${code}` },
        { inlineData: { mimeType: 'audio/mp3', data: b64 } },
        { text: `Respond JSON: {"score":1-10,"good":bool,"what_works":"...","top_weakness":"the single most important concrete audible flaw","fix":"specific actionable fix","new_failure_rule":{"symptom_heard":"...","root_cause":"...","avoid_rule":"..."},"verdict":"keep|revise"}` }
      ], true);
      try { r.critique = JSON.parse(judge); } catch { r.critique = { raw: judge.slice(0, 500) }; }
      lastCritique = `score ${r.critique.score}/10; works: ${r.critique.what_works}; TOP WEAKNESS: ${r.critique.top_weakness}; FIX: ${r.critique.fix}`;
      lastFix = `${r.critique.top_weakness || ''} — ${r.critique.fix || ''}`;
      lastGoodCode = code;            // anchor revise on the last RENDERED code
      if (!bestCode || (r.critique.score || 0) >= (rounds.filter(x=>x.critique).reduce((m,x)=>Math.max(m,x.critique.score||0),0))) bestCode = code;
    }
    rounds.push(r);
    console.log(`--- round ${i} --- render:${renderOk ? 'OK' : 'FAIL '+renderErr.slice(0,80)}` +
      (r.critique ? ` | score ${r.critique.score}/10 ${r.critique.verdict} | weakness: ${(r.critique.top_weakness||'').slice(0,90)}` : ''));
    if (r.critique && (r.critique.verdict === 'keep' || r.critique.score >= 8)) { console.log('Gemini judges it done.'); break; }
  }
  await shutdown();

  // Emit run artifacts for Claude (governor) to review.
  const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  writeFileSync(`${ROOT}/producer-brain/run_${ts}.json`, JSON.stringify({ brief, rounds }, null, 2));
  if (bestCode) {
    writeFileSync(`${ROOT}/producer-brain/last_best.strudel.js`, bestCode);
    const enc = encodeURIComponent(Buffer.from(bestCode).toString('base64'));
    console.log(`\nstrudel.cc/#${enc.slice(0,60)}…  (full link in run json)`);
    writeFileSync(`${ROOT}/producer-brain/last_best.url`, `https://strudel.cc/#${enc}`);
  }
  // Candidate failure-spine entries Gemini proposed — Claude curates before commit.
  const cands = rounds.filter(r => r.critique?.new_failure_rule).map(r => r.critique.new_failure_rule);
  writeFileSync(`${ROOT}/producer-brain/candidate_rules_${ts}.json`, JSON.stringify(cands, null, 2));
  console.log(`\nrounds: ${rounds.length} | best score: ${Math.max(0, ...rounds.map(r => r.critique?.score || 0))}/10`);
  console.log(`candidate failure-rules for Claude to curate: ${cands.length}`);
  console.log(`artifacts: producer-brain/run_${ts}.json, last_best.strudel.js, candidate_rules_${ts}.json`);
})();
