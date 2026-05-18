// Producer-brain FREE — FIRST-SHOT DIRECT, NO TUNING (Bowei 2026-05-18:
// "调多了反而差…干脆不要调…调一次都会有损失").
// ZERO upfront constraints. gemini-3.1-pro composes freely → renders
// on the live strudel.cc engine → ONE self-listen for an honest score
// (ranking only, NEVER triggers an edit). Quality = best-of-N first-
// shots + pick by ear, not iterative revision (every revise pass is
// net-lossy on a holistic artifact — feedback_first_shot_beats_revision).
// Only REACTIVE correctness heal (won't render / silent / real API
// error) is kept — broken→working, not aesthetic tuning.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { render, shutdown } from '@cactus/renderer';

const ROOT = '/Users/bowei/CactusStrudel';
const KEY = readFileSync(`${ROOT}/.env.local`, 'utf8').match(/GEMINI_API_KEY=(.+)/)![1]!.trim();
const MODEL = process.env.PB_MODEL || 'gemini-3.1-pro-preview'; // Pro does everything

function gemini(parts: any[], jsonOut = false): string {
  const body: any = { contents: [{ parts }] };
  body.generationConfig = jsonOut
    ? { responseMimeType: 'application/json', temperature: 1.0 }
    : { temperature: 1.1 };
  const tmp = `/tmp/_gf_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(tmp, JSON.stringify(body));
  const out = execSync(
    `curl -s --max-time 240 -X POST "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}" -H "Content-Type: application/json" -d @${tmp}`,
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const d = JSON.parse(out);
  if (!d.candidates) throw new Error('gemini: ' + JSON.stringify(d).slice(0, 200));
  return d.candidates[0].content.parts.map((p: any) => p.text || '').join('');
}
const strip = (s: string) => s.replace(/^```[a-z]*\n?/im, '').replace(/\n?```\s*$/m, '').trim();

// NO upfront constraints. Pure creative brief.
const PROMPT = `You are a gifted electronic music producer working in Strudel (the strudel.cc live-coding language — a JavaScript port of TidalCycles).

Compose ONE original piece that you genuinely find beautiful and alive. Complete artistic freedom: any genre, harmony, groove, structure, sound design, length. Make something with real feeling and motion that you would be proud to release.

Output ONLY the Strudel code. No markdown, no prose.`;

// Render once; classify: ok | api-error | silent. Returns wav db.
async function tryRender(code: string, i: number): Promise<{ ok: boolean; kind: 'ok' | 'api' | 'silent'; msg: string }> {
  try {
    await render({ code, durationCycles: 24, cps: 0.42, outputPath: `/tmp/free${i}.wav` });
    let maxDb = -91;
    try { maxDb = parseFloat(execSync(`ffmpeg -hide_banner -i /tmp/free${i}.wav -af volumedetect -f null - 2>&1|grep -oE 'max_volume: [-0-9.]+'|grep -oE '[-0-9.]+'`).toString().trim() || '-91'); } catch {}
    if (maxDb <= -55) return { ok: false, kind: 'silent', msg: `rendered but SILENT (max ${maxDb}dB) — a sound made no audio offline (gm_*/super* are silent here) or no audible notes` };
    return { ok: true, kind: 'ok', msg: `max ${maxDb}dB` };
  } catch (e) {
    return { ok: false, kind: 'api', msg: String((e as Error)?.message ?? e).slice(0, 220) };
  }
}

// Pro self-corrects against the LIVE engine's REAL feedback (reactive,
// not an upfront constraint). Returns rendering code or null.
async function healToRender(code: string, i: number, maxHeals = 6): Promise<string | null> {
  for (let h = 0; h <= maxHeals; h++) {
    const r = await tryRender(code, i);
    if (r.ok) return code;
    if (h === maxHeals) return null;
    const fix = r.kind === 'api'
      ? `Your piece failed on the LIVE strudel.cc engine with this REAL error:\n"${r.msg}"\nAn API/method you used does not exist. Fix it (real Strudel equivalent), keep all artistic intent. Output ONLY the corrected full code.`
      : `Your piece RENDERED but is SILENT.\n${r.msg}\nRe-voice the carrying parts with sounds that produce audio (oscillators sawtooth/square/triangle/sine, "piano", drum samples, .bank("RolandTR909"/"RolandTR808")). Keep the composition; only swap silent sounds. Output ONLY the corrected full code.`;
    try { code = strip(gemini([{ text: `${fix}\n\n${code}` }])); } catch { return null; }
  }
  return null;
}

(async () => {
  const N = parseInt(process.argv[2] || '2', 10);
  const results: any[] = [];

  for (let i = 1; i <= N; i++) {
    try { rmSync(`${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3`, { force: true }); } catch {}
    let code: string;
    try { code = strip(gemini([{ text: PROMPT }])); }
    catch (e) { console.log(`#${i} compose ERR ${String(e).slice(0, 120)}`); continue; }

    let good = await healToRender(code, i);
    if (!good) { console.log(`#${i} could not render after heals`); results.push({ i, rendered: false }); continue; }
    code = good;

    // FIRST-SHOT DIRECT — no aesthetic revision (every revise pass is
    // net-lossy on a holistic artifact; feedback_first_shot_beats_revision).
    // One Pro self-listen for an honest SCORE only (ranking the best-of-N
    // batch / labeling), NOT to trigger any edit. Quality = sample more
    // first-shots + pick, never tune.
    execSync(`ffmpeg -hide_banner -y -i /tmp/free${i}.wav -t 16 -ac 1 -ar 22050 /tmp/free${i}.mp3 2>/dev/null`);
    let crit: any = { score: 0, honest_assessment: '?' };
    try {
      crit = JSON.parse(gemini([
        { text: `This is YOUR OWN first-shot composition, rendered. Listen as a discerning producer and rate it honestly (no revision will happen — this score only ranks a batch).` },
        { inlineData: { mimeType: 'audio/mp3', data: readFileSync(`/tmp/free${i}.mp3`).toString('base64') } },
        { text: `JSON: {"score":1-10,"honest_assessment":"what you actually hear","intent":"what you were going for"}` },
      ], true));
    } catch (e) { crit = { score: 0, honest_assessment: 'listen failed: ' + String(e).slice(0, 80), intent: '' }; }
    const sc = Number(crit.score) || 0;

    execSync(`ffmpeg -hide_banner -y -i /tmp/free${i}.wav -codec:a libmp3lame -b:a 256k ${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3 2>/dev/null`);
    writeFileSync(`/tmp/free${i}.js`, code);
    const enc = execSync(`python3 -c "import base64,urllib.parse;print(urllib.parse.quote(base64.b64encode(open('/tmp/free${i}.js','rb').read()).decode()))"`).toString().trim();
    results.push({ i, rendered: true, score: sc, assessment: crit.honest_assessment, intent: crit.intent, url: `https://strudel.cc/#${enc}` });
    console.log(`#${i} DELIVERED (first-shot, no tuning) self ${sc}/10 — ${(crit.honest_assessment || '').slice(0, 80)} → ~/Downloads/cactus_gemini_free_${i}.mp3`);
  }
  await shutdown();
  writeFileSync(`${ROOT}/producer-brain/free_run_${Date.now()}.json`, JSON.stringify(results, null, 2));
  console.log('\n=== summary ===');
  for (const r of results) console.log(r.rendered
    ? `#${r.i} ${r.score}/10  ~/Downloads/cactus_gemini_free_${r.i}.mp3`
    : `#${r.i} failed`);
})();
