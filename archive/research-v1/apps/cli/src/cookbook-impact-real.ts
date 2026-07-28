// G9B §3: lightweight real-render cookbook-impact runner. Pays the renderer
// boot tax once, runs a small set of (brief × mode) renders, computes
// per-mode metrics, emits a verdict.
//
// Design:
//   - smoke-real: one brief per core genre (5), modes minimal vs enabled
//   - micro-real: two briefs (caller picks --genres), modes minimal +
//     enabled + enabled_mutating
//   - smoke-real-genre: smoke-real, but caller can subset --genres
//
// Each (brief × mode) renders ~5s + a short analyzer run; smoke-real total
// ≈ 10 renders ≈ 60s after warmup. Reports honestly and writes a full JSON
// summary plus per-render artifacts.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseBrief, buildSessionGraphFromBrief } from '@cactus/agent-runtime';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';
import { loadGenre } from '@cactus/genres';
import { masterTrack } from '@cactus/mastering';
import { runQualityGates, analyzeDecoded, readWav } from '@cactus/analyzer';
import { critique } from '@cactus/critic';
import { decideVerdict, type CookbookImpactRunSummary, type CookbookMode } from '@cactus/audit';
import { ngramOverlap, ngrams, tokenize } from '@cactus/cookbook';

export type ImpactSuite = 'smoke-real' | 'micro-real';

export interface RealImpactOptions {
  suite: ImpactSuite;
  seeds?: number;
  /** Filter / restrict genres (subset of canonical core list). */
  genres?: string[];
  outDir?: string;
}

export interface RealImpactResult {
  ok: boolean;
  ts: string;
  suite: ImpactSuite;
  out_dir: string;
  modes: CookbookMode[];
  per_mode: CookbookImpactRunSummary[];
  per_brief: Array<{
    brief: string;
    bpm?: number;
    genre?: string;
    rows: Array<{
      mode: CookbookMode;
      ok: boolean;
      validator_issues: number;
      gate_pass: boolean;
      hard_fail_count: number;
      severe_warning_count: number;
      lufs_distance: number | null;
      true_peak_db: number | null;
      non_silent_ratio: number | null;
      arrangement_arc_ok: boolean | null;
      critic_issue_count: number;
      mini_notation_token_overlap_vs_minimal: number | null;
      seed: number;
    }>;
  }>;
  /**
   * G11A audit closeout: briefs that parseBrief failed to recognize. The
   * pre-fix smoke-real silently dropped underscore-spelled dub_techno; we
   * report dropouts now instead of silently down-counting prompts.
   */
  dropped_briefs: Array<{ brief: string; reason: string }>;
  /**
   * Number of distinct seeds used per (brief × mode). When > 1, the
   * verdict aggregates across seeds.
   */
  seeds_per_prompt: number;
  verdict: 'cookbook_positive' | 'cookbook_neutral_preserves_diversity' | 'cookbook_negative_regression' | 'cookbook_inconclusive_insufficient_signal';
  notes: string[];
}

// G9C+ note (verified 2026-05-10): brief-parser matches `\bdub[\s-]+techno\b`,
// so dub_techno briefs MUST use space or hyphen, not underscore. Pre-fix
// versions of these strings used "dub_techno", which silently
// dropped out of the audit (parseBrief returned primary_genre=undefined),
// down-counting smoke-real from 5 prompts to 4 without saying so.
// External audit caught this; the entry below uses "dub techno" so the
// genre is actually exercised.
const SMOKE_BRIEFS: Array<{ brief: string; genre: string }> = [
  { brief: 'peak time techno 132 BPM, 16 bars, hypnotic', genre: 'techno' },
  { brief: 'dub techno 122 BPM, 16 bars, restrained chord stab', genre: 'dub_techno' },
  { brief: 'dnb 174 BPM, 16 bars, rolling reese sub', genre: 'dnb' },
  { brief: 'idm 120 BPM, 16 bars, asymmetric mutation', genre: 'idm' },
  { brief: 'ambient 80 BPM, 16 bars, sustained warm pad', genre: 'ambient' },
];

const MICRO_BRIEFS: Array<{ brief: string; genre: string }> = [
  { brief: 'peak time techno 132 BPM, 16 bars, warehouse', genre: 'techno' },
  { brief: 'dub techno 122 BPM, 16 bars, dub chord stab cold', genre: 'dub_techno' },
];

const CORE_GENRES = new Set(['techno', 'dub_techno', 'dnb', 'idm', 'ambient']);

export async function runRealRenderImpactAudit(opts: RealImpactOptions): Promise<RealImpactResult> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = opts.outDir ?? path.resolve(process.cwd(), 'audits', 'cookbook-impact-real', ts);
  await fs.mkdir(outDir, { recursive: true });

  let briefs = opts.suite === 'smoke-real' ? SMOKE_BRIEFS : MICRO_BRIEFS;
  if (opts.genres && opts.genres.length > 0) {
    const set = new Set(opts.genres);
    briefs = briefs.filter((b) => set.has(b.genre));
  } else {
    briefs = briefs.filter((b) => CORE_GENRES.has(b.genre));
  }

  const modes: CookbookMode[] = opts.suite === 'micro-real'
    ? ['minimal', 'enabled', 'enabled_mutating']
    : ['minimal', 'enabled'];

  const { warmup, shutdown, render } = await import('@cactus/renderer');
  await warmup();

  const perBrief: RealImpactResult['per_brief'] = [];
  const perModeSums = new Map<CookbookMode, CookbookImpactRunSummary>();
  for (const m of modes) {
    perModeSums.set(m, {
      mode: m, prompts_total: 0, rendered: 0,
      render_failures: 0, analyzer_failures: 0,
      gate_pass: 0, gate_fail: 0, critic_issue_count: 0,
    });
  }

  // Per-mode token bag for diversity comparison (n-gram overlap of compiled code).
  const codePerMode = new Map<CookbookMode, string[]>();
  for (const m of modes) codePerMode.set(m, []);

  // G11A audit closeout: --seeds N now iterates N distinct seeds per
  // (brief × mode), not "use N as the seed value". The seed list is
  // [1, 2, ..., N]; each (brief × seed) is treated as an independent prompt
  // for verdict purposes.
  const seedCount = Math.max(1, Math.floor(opts.seeds ?? 1));
  const seedList = Array.from({ length: seedCount }, (_, i) => i + 1);

  // Track parseBrief drop-outs so the report can name them. Pre-G11A this
  // was silently down-counting prompts (the Opus audit caught it).
  const droppedBriefs: Array<{ brief: string; reason: string }> = [];

  try {
    for (const item of briefs) {
      const brief = parseBrief(item.brief);
      if (!brief.primary_genre) {
        droppedBriefs.push({ brief: item.brief, reason: 'parseBrief returned no primary_genre' });
        continue;
      }
      const briefGenre = brief.primary_genre;
      const briefRows: RealImpactResult['per_brief'][number]['rows'] = [];
      for (const seed of seedList) {
      const minimalCode = { code: '' };
      for (const m of modes) {
        // Reset cookbook cache so the new mode's loadCookbookEntries() re-reads.
        const { _resetCookbookCacheForTests } = await import('@cactus/agent-runtime');
        _resetCookbookCacheForTests();
        process.env.CACTUS_COOKBOOK_MODE = m;
        const sum = perModeSums.get(m)!;
        sum.prompts_total += 1;

        let validatorIssues = 0;
        let gatePass = false;
        let hardFails = 0;
        let severeWarnings = 0;
        let lufsDistance: number | null = null;
        let truePeak: number | null = null;
        let nonSilent: number | null = null;
        let arcOk: boolean | null = null;
        let criticIssues = 0;
        let renderOk = false;
        let analyzeOk = false;
        try {
          const graph = await buildSessionGraphFromBrief(brief, { seed });
          const compiled = compileSessionGraph(graph);
          const v = validateStrudelCode(compiled.code);
          validatorIssues = v.issues.length;
          if (m === 'minimal') minimalCode.code = compiled.code;
          codePerMode.get(m)!.push(compiled.code);

          const wavPath = path.join(outDir, `${item.genre}__seed${seed}__${m}.wav`);
          const cps = ((graph.brief.bpm ?? 120) / 240) * graph.song.cycles_per_bar;
          const cycles = Math.min(graph.song.total_bars, 16) * graph.song.cycles_per_bar;
          await render({ code: compiled.code, durationCycles: cycles, cps, outputPath: wavPath });
          renderOk = true;
          sum.rendered += 1;

          const genreSpec = await loadGenre(briefGenre).catch(() => undefined);
          if (genreSpec) {
            await masterTrack({
              inputWavPath: wavPath, outputWavPath: wavPath,
              targets: { lufs: genreSpec.mix_targets.lufs, true_peak_max: genreSpec.mix_targets.true_peak_max ?? -1 },
            });
          }
          const decodedAudio = await readWav(wavPath);
          const features = await analyzeDecoded(decodedAudio);
          analyzeOk = true;

          const gates = await runQualityGates({
            wavPath, graph, features, decodedAudio,
            ...(genreSpec ? { genreTargets: {
              lufs: genreSpec.mix_targets.lufs,
              true_peak_max: genreSpec.mix_targets.true_peak_max,
              ...(genreSpec.mix_targets.stereo_mono_low_compliance_min !== undefined
                ? { stereo_mono_low_compliance_min: genreSpec.mix_targets.stereo_mono_low_compliance_min }
                : {}),
            } } : {}),
          });
          gatePass = gates.overall_pass;
          hardFails = gates.hard_fail_count;
          severeWarnings = gates.severe_warning_count;
          if (gatePass) sum.gate_pass += 1; else sum.gate_fail += 1;

          // Per-metric extraction. Some gates carry a numeric "delta" we surface.
          const findGate = (name: string) => gates.gates.find((g) => g.name === name);
          const lufsGate = findGate('lufs_target_distance');
          if (lufsGate) {
            lufsDistance = typeof lufsGate.value === 'number' ? lufsGate.value : null;
          }
          const peakGate = findGate('true_peak');
          if (peakGate) {
            truePeak = typeof peakGate.value === 'number' ? peakGate.value : null;
          }
          const silenceGate = findGate('non_silent_ratio');
          if (silenceGate) {
            nonSilent = typeof silenceGate.value === 'number' ? silenceGate.value : null;
          }
          const arcGate = findGate('arrangement_arc');
          if (arcGate) arcOk = arcGate.passed;

          const c = await critique({ graph, features, iteration: 0 });
          criticIssues = c.targets.length;
          sum.critic_issue_count += criticIssues;
        } catch (e) {
          if (!renderOk) sum.render_failures += 1;
          else if (!analyzeOk) sum.analyzer_failures += 1;
          // continue collecting other modes
        }

        // Token overlap vs minimal: how similar is enabled's compiled output to
        // minimal's? Lower = more variation introduced.
        let overlap: number | null = null;
        if (m !== 'minimal' && minimalCode.code) {
          const c = codePerMode.get(m)!;
          const enabledCode = c[c.length - 1] ?? '';
          if (enabledCode) {
            const minNg = ngrams(tokenize(minimalCode.code), 3);
            const enNg = ngrams(tokenize(enabledCode), 3);
            overlap = ngramOverlap(minNg, enNg);
          }
        }

        briefRows.push({
          mode: m, ok: renderOk && analyzeOk,
          validator_issues: validatorIssues,
          gate_pass: gatePass,
          hard_fail_count: hardFails,
          severe_warning_count: severeWarnings,
          lufs_distance: lufsDistance,
          true_peak_db: truePeak,
          non_silent_ratio: nonSilent,
          arrangement_arc_ok: arcOk,
          critic_issue_count: criticIssues,
          mini_notation_token_overlap_vs_minimal: overlap,
          seed,
        });
      }
      } // end seedList
      perBrief.push({ brief: item.brief, ...(brief.bpm !== undefined ? { bpm: brief.bpm } : {}), genre: brief.primary_genre, rows: briefRows });
    }
  } finally {
    delete process.env.CACTUS_COOKBOOK_MODE;
    await shutdown();
  }

  // Diversity: mean pairwise n-gram overlap WITHIN each mode's collected codes.
  for (const m of modes) {
    const codes = codePerMode.get(m)!;
    if (codes.length < 2) continue;
    const grams = codes.map((c) => ngrams(tokenize(c), 3));
    let total = 0; let pairs = 0;
    for (let i = 0; i < grams.length; i++) {
      for (let j = i + 1; j < grams.length; j++) {
        total += ngramOverlap(grams[i]!, grams[j]!);
        pairs++;
      }
    }
    perModeSums.get(m)!.diversity_mean_overlap = pairs === 0 ? 0 : total / pairs;
  }

  // Gap4: decideVerdict is the SINGLE owner of verdict reasoning — it is
  // now ceiling-aware (when gate-pass saturates it reasons from
  // critic-issue-per-prompt delta and says so in its notes). The runner
  // used to duplicate that critic tiebreak here; that was double-handling.
  // The runner now only (a) maps decideVerdict's enum to the real-render
  // enum and (b) applies the render-failure insufficiency guard below.
  const summaries = Array.from(perModeSums.values());
  const v = decideVerdict(summaries);
  const notes: string[] = [...v.notes];
  let verdict: RealImpactResult['verdict'];
  if (v.verdict === 'inconclusive') {
    verdict = 'cookbook_inconclusive_insufficient_signal';
    notes.push('verdict downgraded: too few prompts to draw a conclusion');
  } else if (v.verdict === 'cookbook_improves_quality') {
    verdict = 'cookbook_positive';
  } else if (v.verdict === 'cookbook_regresses_quality') {
    verdict = 'cookbook_negative_regression';
  } else if (v.verdict === 'cookbook_neutral_diversity_drop') {
    verdict = 'cookbook_negative_regression';
    notes.push('diversity drop detected — counted as regression');
  } else {
    verdict = 'cookbook_neutral_preserves_diversity';
  }

  // Insufficient signal: any mode failed to render every prompt.
  const totalRenders = summaries.reduce((acc, s) => acc + s.rendered, 0);
  const expected = briefs.length * modes.length;
  if (totalRenders < expected) {
    notes.push(`only ${totalRenders}/${expected} renders succeeded`);
    if (totalRenders < expected * 0.6) {
      verdict = 'cookbook_inconclusive_insufficient_signal';
    }
  }

  if (droppedBriefs.length > 0) {
    notes.push(`dropped ${droppedBriefs.length} brief(s) — parseBrief returned no primary_genre: ${droppedBriefs.map((d) => `"${d.brief.slice(0, 40)}…"`).join(', ')}`);
  }
  notes.push(`seeds per prompt: ${seedCount} (${seedList.join(',')})`);

  const result: RealImpactResult = {
    ok: true, ts, suite: opts.suite, out_dir: outDir, modes,
    per_mode: summaries, per_brief: perBrief,
    dropped_briefs: droppedBriefs,
    seeds_per_prompt: seedCount,
    verdict, notes,
  };
  await fs.writeFile(path.join(outDir, 'cookbook-impact-real-report.json'), JSON.stringify(result, null, 2));
  return result;
}
