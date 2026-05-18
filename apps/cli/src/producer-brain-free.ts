// Free-mode experiment (Bowei 2026-05-18: "不给gemini加约束，让它自己发挥").
// The caged loop produced "太机械死板太公式化". Hypothesis: my
// constraints (syntax cage + avoid-spine + skeleton + minimal-edit)
// strangled the creativity. Here: NO contract, NO skeleton, NO spine,
// NO minimal-edit. Gemini's full artistic choice, full idiomatic
// Strudel. Best-effort render; it self-listens ONLY if it renders;
// otherwise we deliver the strudel.cc link (the real env) for Bowei.

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { render, shutdown } from '@cactus/renderer';

const ROOT = '/Users/bowei/CactusStrudel';
const KEY = readFileSync(`${ROOT}/.env.local`, 'utf8').match(/GEMINI_API_KEY=(.+)/)![1]!.trim();
// gemini-3.1-flash-lite persistently hallucinated Strudel APIs even on
// self-heal (gmm_/.stut/.krush). Bowei: stronger model, token-economical
// → 3-flash (strong + cheaper than 3.1-pro; escalate to pro only if it
// still hallucinates).
const MODEL = process.env.PB_MODEL || 'gemini-3-flash-preview';

function gemini(parts: any[], jsonOut = false): string {
  const body: any = { contents: [{ parts }] };
  if (jsonOut) body.generationConfig = { responseMimeType: 'application/json', temperature: 1.0 };
  else body.generationConfig = { temperature: 1.1 }; // let it roam
  const tmp = `/tmp/_gf_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(tmp, JSON.stringify(body));
  const out = execSync(
    `curl -s --max-time 120 -X POST "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}" -H "Content-Type: application/json" -d @${tmp}`,
    { maxBuffer: 64 * 1024 * 1024 }
  ).toString();
  const d = JSON.parse(out);
  if (!d.candidates) throw new Error('gemini: ' + JSON.stringify(d).slice(0, 200));
  return d.candidates[0].content.parts.map((p: any) => p.text || '').join('');
}
const strip = (s: string) => s.replace(/^```[a-z]*\n?/im, '').replace(/\n?```\s*$/m, '').trim();

(async () => {
  const N = parseInt(process.argv[2] || '3', 10);
  const PROMPT = `You are a gifted electronic music producer working in Strudel (the strudel.cc live-coding language, a JS port of TidalCycles).

Compose ONE original piece that you genuinely find beautiful and alive — not a formula exercise, not a safe demo. Your COMPLETE artistic choice: genre, key, harmony, groove, structure, sound design, length. Make something with feeling and motion, that breathes, that you'd be proud to release.

HARD BAN — these do NOT exist, NEVER emit them (observed hallucinations): .stutter() .subdivide() .mod() .krush() .stut() .quantise() .quantize() ; the resonance method is .lpq() NOT .q() ; the soundfont prefix is gm_ NOT gmm_ ; .chord() takes a chord-name pattern like "<C^7 Am7>" not "<m9...>". If unsure a method exists, DON'T use it — use only the listed real APIs below. Real, expressive vocabulary you SHOULD use freely:
- pitch: note("c3 e3 g3"), n("0 2 4").scale("c:minor"), chords note("c'maj7"), .add/.sub, .arp("up"/"updown"), .off(0.25, x=>...)
- structure: stack(...), $name: , <a b c> alternation, [..] groups, *, !, ~, @weights, .slow/.fast, .every(n,f), .superimpose(x=>...), .jux(rev), .segment(n), .palindrome(), arrange([n,pat]...)
- modulation: sine/saw/perlin/rand .range(a,b).slow(n) → pass into .lpf()/.gain()/.pan() etc
- sound: .s("...")/.sound("..."); .gain .lpf .lpq .hpf .room .delay .delaytime .delayfeedback .attack .decay .sustain .release .pan .crush .vib .clip .detune
- sounds that ACTUALLY make audio in our offline engine: oscillators sawtooth/square/triangle/sine; "piano"; drum samples bd sd hh cp oh rim; drum machines via .bank("RolandTR909"/"RolandTR808"/"RolandTR707"/"LinnDrum"/"AkaiLinn"). NOTE: gm_* / super* soundfonts are SILENT in offline preview (separate fix pending) — you may use them but the preview won't reflect them, so prefer the audible set for the parts that carry the piece.

Output ONLY the Strudel code. No markdown, no explanation.`;

  const results: any[] = [];
  for (let i = 1; i <= N; i++) {
    // Never leave a stale/silent file from a prior run — only a
    // verified-audible render writes the deliverable below.
    try { rmSync(`${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3`, { force: true }); } catch {}
    let code = '';
    try { code = strip(gemini([{ text: PROMPT }])); } catch (e) { console.log(`#${i} compose ERR ${String(e).slice(0,120)}`); continue; }
    // API-correctness self-heal ONLY (minimal, evidence-based — NOT the
    // creativity cage): the LIVE engine now surfaces the real error
    // (e.g. ".stutter is not a function"); feed it back, fix ONLY the
    // invalid API, keep all artistic intent. Up to 4 heals.
    let rendered = false, warnN = -1, rerr = '';
    for (let h = 0; h <= 4; h++) {
      try {
        const r = await render({ code, durationCycles: 24, cps: 0.42, outputPath: `/tmp/free${i}.wav` });
        // SILENCE-IS-FAILURE gate: "render OK" but a silent wav is NOT
        // success (truth vs harness). Treat near-silence as a failure
        // → real self-heal signal, not a false pass.
        let maxDb = -91;
        try { maxDb = parseFloat(execSync(`ffmpeg -hide_banner -i /tmp/free${i}.wav -af volumedetect -f null - 2>&1|grep -oE 'max_volume: [-0-9.]+'|grep -oE '[-0-9.]+'`).toString().trim() || '-91'); } catch {}
        if (maxDb <= -55) {
          rerr = `rendered but SILENT (max ${maxDb}dB). Likely a sound that produces no audio offline (gm_*/super* are silent here) or a pattern with no audible notes. Re-voice the carrying parts with the audible set: sawtooth/square/triangle/sine, "piano", drum samples, .bank("RolandTR909"/"RolandTR808"). Keep the composition; only swap the silent sounds.`;
          if (h === 4) break;
          code = strip(gemini([{ text: `Your piece RENDERED but is SILENT.\n${rerr}\nOutput ONLY the corrected full code, keep all artistic intent.\n\n${code}` }]));
          continue;
        }
        rendered = true; warnN = r.warnings.length; break;
      } catch (e) {
        rerr = String((e as Error)?.message ?? e).slice(0, 200);
        if (h === 4) break;
        try {
          code = strip(gemini([{ text:
`Your Strudel piece failed on the LIVE strudel.cc engine with this REAL error:
"${rerr}"
That means an API/method you used does NOT exist in Strudel. Fix ONLY the invalid API (replace it with a real Strudel equivalent) — keep your artistic intent, structure, sounds, and everything that works UNCHANGED. Output ONLY the corrected full code, no prose.

${code}` }]));
        } catch { break; }
      }
    }
    let critique: any = null;
    if (rendered) {
      try {
        execSync(`ffmpeg -hide_banner -y -i /tmp/free${i}.wav -t 14 -ac 1 -ar 22050 /tmp/free${i}.mp3 2>/dev/null`);
        execSync(`ffmpeg -hide_banner -y -i /tmp/free${i}.wav -codec:a libmp3lame -b:a 256k ${process.env.HOME}/Downloads/cactus_gemini_free_${i}.mp3 2>/dev/null`);
        const b64 = readFileSync(`/tmp/free${i}.mp3`).toString('base64');
        const j = gemini([
          { text: `This is YOUR own composition (the offline render may be missing samples/soundfonts — judge the MUSIC, not just timbre). Honestly: is it alive or mechanical? score 1-10.` },
          { inlineData: { mimeType: 'audio/mp3', data: b64 } },
          { text: `JSON: {"score":1-10,"alive_or_mechanical":"...","what_you_were_going_for":"...","honest_flaw":"..."}` },
        ], true);
        try { critique = JSON.parse(j); } catch { critique = { raw: j.slice(0, 300) }; }
      } catch (e) { critique = { note: 'listen step failed: ' + String(e).slice(0, 80) }; }
    }
    const enc = (() => { const f = `/tmp/free${i}.js`; writeFileSync(f, code);
      return execSync(`python3 -c "import base64,urllib.parse;print(urllib.parse.quote(base64.b64encode(open('${f}','rb').read()).decode()))"`).toString().trim(); })();
    results.push({ i, rendered, warnN, rerr, critique, url: `https://strudel.cc/#${enc}`, codeHead: code.split('\n').slice(0, 4).join(' / ') });
    console.log(`#${i} render:${rendered ? 'OK warn=' + warnN : 'FAIL ' + rerr.slice(0,70)}` +
      (critique ? ` | self: ${critique.score}/10 ${(critique.alive_or_mechanical||'').slice(0,60)}` : ''));
  }
  await shutdown();
  writeFileSync(`${ROOT}/producer-brain/free_run_${Date.now()}.json`, JSON.stringify(results, null, 2));
  console.log('\n=== free pieces ===');
  for (const r of results) {
    console.log(`#${r.i} ${r.rendered ? 'mp3: ~/Downloads/cactus_gemini_free_' + r.i + '.mp3' : '(no offline render — strudel.cc only)'}`);
    if (r.critique?.what_you_were_going_for) console.log(`   intent: ${r.critique.what_you_were_going_for}`);
    console.log(`   ${r.url.slice(0, 78)}…`);
  }
})();
