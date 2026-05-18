// Producer-brain FREE + self-optimize (Bowei 2026-05-18):
// "让pro自己听、自己优化，先不要给pro任何约束。先跑通，再调审美."
// → ZERO upfront constraints. gemini-3.1-pro composes freely, RENDERS
// on the live strudel.cc engine, LISTENS to its own audio, and
// REVISES its own work to improve — Pro does compose+heal+listen+
// optimize. The only feedback fed back is REACTIVE reality (the
// engine's real error / a silent render) — that is Pro self-
// correcting, not an upfront cage. Aesthetics are NOT tuned here yet.

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
  const AESTHETIC_ROUNDS = parseInt(process.argv[3] || '2', 10);
  const results: any[] = [];

  for (let i = 1; i <= N; i++) {
    try { rmSync(`${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3`, { force: true }); } catch {}
    let code: string;
    try { code = strip(gemini([{ text: PROMPT }])); }
    catch (e) { console.log(`#${i} compose ERR ${String(e).slice(0, 120)}`); continue; }

    let good = await healToRender(code, i);
    if (!good) { console.log(`#${i} could not render after heals`); results.push({ i, rendered: false }); continue; }
    code = good;

    // Pro self-listen + self-optimize loop.
    const trail: any[] = [];
    let bestCode = code, bestScore = -1;
    for (let a = 0; a <= AESTHETIC_ROUNDS; a++) {
      execSync(`ffmpeg -hide_banner -y -i /tmp/free${i}.wav -t 16 -ac 1 -ar 22050 /tmp/free${i}.mp3 2>/dev/null`);
      const b64 = readFileSync(`/tmp/free${i}.mp3`).toString('base64');
      let crit: any;
      try {
        crit = JSON.parse(gemini([
          { text: `This is YOUR OWN composition, rendered. Listen to it as a discerning producer. Be honest — is it actually good, or mechanical/dull? Then decide: is it release-worthy as is, or do you want to revise it to make it better music?` },
          { inlineData: { mimeType: 'audio/mp3', data: b64 } },
          { text: `JSON: {"score":1-10,"honest_assessment":"what you actually hear","verdict":"keep|improve","improve_how":"if improve: the specific musical change you will make"}` },
        ], true));
      } catch (e) { crit = { score: 0, honest_assessment: 'listen failed: ' + String(e).slice(0, 80), verdict: 'keep' }; }
      trail.push({ round: a, ...crit });
      const sc = Number(crit.score) || 0;
      if (sc >= bestScore) { bestScore = sc; bestCode = code; }
      console.log(`#${i} a${a}: ${sc}/10 ${crit.verdict} — ${(crit.honest_assessment || '').slice(0, 80)}`);
      if (crit.verdict !== 'improve' || sc >= 8 || a === AESTHETIC_ROUNDS) break;

      // Pro revises its OWN work toward its OWN stated improvement.
      let rev: string;
      try {
        rev = strip(gemini([{ text:
`You listened to your own piece and decided to improve it. Your assessment: "${crit.honest_assessment}". The change you will make: "${crit.improve_how}". Revise the piece accordingly — make it genuinely better music, keep what works. Output ONLY the full revised Strudel code.\n\n${code}` }]));
      } catch { break; }
      const revGood = await healToRender(rev, i);
      if (!revGood) { console.log(`#${i} a${a}: revision broke render — keeping prior best`); await tryRender(bestCode, i); break; }
      code = revGood;
    }

    // Deliver the best-scoring audible version.
    await tryRender(bestCode, i);
    execSync(`ffmpeg -hide_banner -y -i /tmp/free${i}.wav -codec:a libmp3lame -b:a 256k ${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3 2>/dev/null`);
    writeFileSync(`/tmp/free${i}.js`, bestCode);
    const enc = execSync(`python3 -c "import base64,urllib.parse;print(urllib.parse.quote(base64.b64encode(open('/tmp/free${i}.js','rb').read()).decode()))"`).toString().trim();
    results.push({ i, rendered: true, bestScore, trail, url: `https://strudel.cc/#${enc}` });
    console.log(`#${i} DELIVERED best ${bestScore}/10 → ~/Downloads/cactus_gemini_free_${i}.mp3`);
  }
  await shutdown();
  writeFileSync(`${ROOT}/producer-brain/free_run_${Date.now()}.json`, JSON.stringify(results, null, 2));
  console.log('\n=== summary ===');
  for (const r of results) console.log(r.rendered
    ? `#${r.i} ${r.bestScore}/10  ~/Downloads/cactus_gemini_free_${r.i}.mp3`
    : `#${r.i} failed`);
})();
