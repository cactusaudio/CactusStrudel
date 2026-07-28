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
import { execFileSync, spawnSync } from 'node:child_process';
import { render, shutdown } from '@cactus/renderer';

const ROOT = '/Users/bowei/CactusStrudel';
const KEY = readFileSync(`${ROOT}/.env.local`, 'utf8').match(/GEMINI_API_KEY=(.+)/)![1]!.trim();
const MODEL = process.env.PB_MODEL || 'gemini-3.1-pro-preview'; // compose + audit-fix (quality/correctness-critical)
const LISTEN_MODEL = 'gemini-3-flash-preview';                  // self-listen score = cheap batch triage only

async function gemini(parts: any[], jsonOut = false, model: string = MODEL): Promise<string> {
  const body: any = { contents: [{ parts }] };
  body.generationConfig = jsonOut
    ? { responseMimeType: 'application/json', temperature: 1.0 }
    : { temperature: 1.1 };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const d = await res.json() as any;
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
    try {
      const probe = spawnSync('ffmpeg', [
        '-hide_banner',
        '-i', `/tmp/free${i}.wav`,
        '-af', 'volumedetect',
        '-f', 'null',
        '-',
      ], { encoding: 'utf8' });
      const m = (probe.stderr || '').match(/max_volume:\s*([-0-9.]+)/);
      if (m) maxDb = parseFloat(m[1]!);
    } catch {}
    if (maxDb <= -55) return { ok: false, kind: 'silent', msg: `rendered but SILENT (max ${maxDb}dB) — a sound made no audio offline (gm_*/super* are silent here) or no audible notes` };
    return { ok: true, kind: 'ok', msg: `max ${maxDb}dB` };
  } catch (e) {
    return { ok: false, kind: 'api', msg: String((e as Error)?.message ?? e).slice(0, 220) };
  }
}

// Claude-as-CODE-AUDITOR (Bowei 2026-05-18): compliance + completeness
// ONLY, zero aesthetics. Static checks (my engineering judgment, no
// taste) + the live engine as correctness oracle → a CORRECTNESS+
// TIMBRE-only fix directive that explicitly FORBIDDEN from changing
// the composition (notes/rhythm/structure/arrangement) — that's the
// lossy thing. Looped a few times until compliant (not until "good").
const SILENT_OFFLINE = /\b(?:s|sound)\(\s*["'`][^"'`]*\b(gm_[a-z0-9_]+|super(?:saw|piano|fm|chip|mandolin|zow|hammond|gong))\b/gi;
const FAKE_API = /\.(stutter|subdivide|mod|krush|stut|quantise|quantize)\s*\(|\bgmm_|\.q\s*\(/g;

function staticAudit(code: string): string[] {
  const f: string[] = [];
  const fake = [...code.matchAll(FAKE_API)].map((m) => m[0]).filter((v, k, a) => a.indexOf(v) === k);
  if (fake.length) f.push(`INVALID APIs (do not exist in Strudel — replace with the real equivalent): ${fake.join(', ')}`);
  const sil = [...code.matchAll(SILENT_OFFLINE)].map((m) => m[1]).filter((v, k, a) => a.indexOf(v) === k);
  if (sil.length) f.push(`SILENT-OFFLINE sounds (these produce NO audio in this engine → that layer is effectively MISSING): ${sil.join(', ')}. Substitute each with an AUDIBLE sound of similar character (oscillators sawtooth/square/triangle/sine, "piano", drum samples, or .bank("RolandTR909"/"RolandTR808"/"LinnDrum")).`);
  return f;
}

const NO_COMPOSE_EDIT =
  `STRICT: this is a CODE-COMPLIANCE fix, NOT a rewrite. Do NOT change the composition — keep every note, rhythm, pattern, structure, arrangement, layer, tempo and effect intent EXACTLY. Only: (a) replace invalid APIs with the correct real Strudel method, (b) substitute SILENT sounds with an audible sound of similar timbral character so no layer goes missing, (c) if a carrying layer is inaudible, only adjust its .gain/filters. Output ONLY the full corrected code.`;

// audit → correctness/timbre-only fix → render → re-audit, a few times.
async function auditAndFix(code: string, i: number, maxRounds = 4): Promise<string | null> {
  for (let h = 0; h <= maxRounds; h++) {
    const r = await tryRender(code, i);
    const issues: string[] = [];
    if (!r.ok) issues.push(r.kind === 'api'
      ? `LIVE-ENGINE error (an API you used does not exist): "${r.msg}"`
      : `LIVE-ENGINE: ${r.msg}`);
    issues.push(...staticAudit(code));        // static audit even if it rendered (silent-offline layers)
    if (r.ok && issues.length === 0) return code;   // compliant + complete
    if (h === maxRounds) return r.ok ? code : null;  // out of rounds: keep if at least audible
    try {
      code = strip(await gemini([{ text: `CODE AUDIT — fix ONLY these compliance/completeness problems:\n- ${issues.join('\n- ')}\n${NO_COMPOSE_EDIT}\n\n${code}` }]));
    } catch { return r.ok ? code : null; }
  }
  return null;
}

(async () => {
  const N = parseInt(process.argv[2] || '2', 10);
  const results: any[] = [];

  for (let i = 1; i <= N; i++) {
    try { rmSync(`${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3`, { force: true }); } catch {}
    let code: string;
    try { code = strip(await gemini([{ text: PROMPT }])); }
    catch (e) { console.log(`#${i} compose ERR ${String(e).slice(0, 120)}`); continue; }

    const good = await auditAndFix(code, i);
    if (!good) { console.log(`#${i} failed code audit (uncompliant after rounds)`); results.push({ i, rendered: false }); continue; }
    code = good;

    // FIRST-SHOT DIRECT — no aesthetic revision (every revise pass is
    // net-lossy on a holistic artifact; feedback_first_shot_beats_revision).
    // One Pro self-listen for an honest SCORE only (ranking the best-of-N
    // batch / labeling), NOT to trigger any edit. Quality = sample more
    // first-shots + pick, never tune.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-y',
      '-i', `/tmp/free${i}.wav`,
      '-t', '16',
      '-ac', '1',
      '-ar', '22050',
      `/tmp/free${i}.mp3`,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    let crit: any = { score: 0, honest_assessment: '?' };
    try {
      crit = JSON.parse(await gemini([
        { text: `This is YOUR OWN first-shot composition, rendered. Listen as a discerning producer and rate it honestly (no revision will happen — this score only ranks a batch).` },
        { inlineData: { mimeType: 'audio/mp3', data: readFileSync(`/tmp/free${i}.mp3`).toString('base64') } },
        { text: `JSON: {"score":1-10,"honest_assessment":"what you actually hear","intent":"what you were going for"}` },
      ], true, LISTEN_MODEL));
    } catch (e) { crit = { score: 0, honest_assessment: 'listen failed: ' + String(e).slice(0, 80), intent: '' }; }
    const sc = Number(crit.score) || 0;

    execFileSync('ffmpeg', [
      '-hide_banner',
      '-y',
      '-i', `/tmp/free${i}.wav`,
      '-codec:a', 'libmp3lame',
      '-b:a', '256k',
      `${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3`,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    writeFileSync(`/tmp/free${i}.js`, code);
    const enc = encodeURIComponent(Buffer.from(code).toString('base64'));
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
