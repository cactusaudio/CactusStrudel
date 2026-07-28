// G9B §2: per-snippet render audit. For each cookbook entry, compile a
// minimal harness, render a short WAV, analyze, and classify the entry as
// accepted / accepted_with_warning / rejected_silent / rejected_render_error
// / rejected_validation_error / rejected_wrong_role_signal / experimental_only.
//
// Cost amortization: warmup() the renderer once, render every entry serially,
// shutdown() at end. Rendering ~3-5s per entry × 42 entries ≈ 2-4 min.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  loadCookbookEntries, type CookbookEntry, getEntryCode,
} from '@cactus/cookbook';
import { validateStrudelCode } from '@cactus/strudel-validator';

export type EntryClassification =
  | 'accepted'
  | 'accepted_with_warning'
  | 'rejected_silent'
  | 'rejected_wrong_role_signal'
  | 'rejected_validation_error'
  | 'rejected_render_error'
  | 'experimental_only';

export interface EntryAuditResult {
  entry_id: string;
  genre: string;
  role: string;
  classification: EntryClassification;
  reasons: string[];
  rms_db?: number;
  peak_db?: number;
  duration_sec?: number;
  features?: unknown;
  wav_path?: string;
  features_path?: string;
}

export interface CookbookRenderAuditOptions {
  /** Restrict to one genre. */
  genre?: string;
  /** Restrict to one role. */
  role?: string;
  /** When true, only re-audit entries whose status is unvalidated/diagnostic/experimental. */
  changedOnly?: boolean;
  /** Output directory; default sessions/cookbook-audits/<ts>/. */
  outDir?: string;
  /** When true (test path), don't actually boot the renderer; classify schema/diagnostic only. */
  dryRun?: boolean;
}

export interface CookbookRenderAuditReport {
  ts: string;
  out_dir: string;
  total: number;
  by_classification: Record<EntryClassification, number>;
  results: EntryAuditResult[];
  failures_dir: string;
  renders_dir: string;
  features_dir: string;
}

export async function runCookbookRenderAudit(
  opts: CookbookRenderAuditOptions = {},
): Promise<CookbookRenderAuditReport> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = opts.outDir
    ?? path.resolve(process.cwd(), 'sessions', 'cookbook-audits', ts);
  const rendersDir = path.join(outDir, 'renders');
  const featuresDir = path.join(outDir, 'features');
  const failuresDir = path.join(outDir, 'failures');
  await fs.mkdir(rendersDir, { recursive: true });
  await fs.mkdir(featuresDir, { recursive: true });
  await fs.mkdir(failuresDir, { recursive: true });

  const loaded = await loadCookbookEntries();
  let entries = loaded.entries;
  if (opts.genre) entries = entries.filter((e) => e.genre === opts.genre);
  if (opts.role) entries = entries.filter((e) => e.role === opts.role);
  if (opts.changedOnly) {
    entries = entries.filter((e) =>
      e.validation_status === 'unvalidated'
      || e.validation_status === 'experimental'
      || e.validation_status === 'diagnostic',
    );
  }

  const results: EntryAuditResult[] = [];

  // mix_macro / arrangement_macro are config presets, not playable; skip render.
  // Diagnostic/experimental entries: classified upfront, no render.
  const renderableEntries: CookbookEntry[] = [];
  for (const e of entries) {
    if (e.role === 'mix_macro' || e.role === 'arrangement_macro') {
      results.push({
        entry_id: e.id, genre: e.genre, role: e.role,
        classification: 'experimental_only',
        reasons: ['config preset (mix_macro/arrangement_macro) — not playable, not rendered'],
      });
      continue;
    }
    if (e.validation_status === 'experimental' || e.validation_status === 'diagnostic') {
      results.push({
        entry_id: e.id, genre: e.genre, role: e.role,
        classification: 'experimental_only',
        reasons: [`marked ${e.validation_status} in schema`],
      });
      continue;
    }
    renderableEntries.push(e);
  }

  // dry-run: classify by schema/syntax only.
  if (opts.dryRun) {
    for (const e of renderableEntries) {
      const wrapped = wrapForRender(e);
      const syn = validateStrudelCode(wrapped);
      if (!syn.ok) {
        results.push({
          entry_id: e.id, genre: e.genre, role: e.role,
          classification: 'rejected_validation_error',
          reasons: syn.issues.slice(0, 3).map((i) => `[${i.code}] ${i.message}`),
        });
      } else {
        results.push({
          entry_id: e.id, genre: e.genre, role: e.role,
          classification: 'accepted',
          reasons: ['schema + syntax pass; render skipped (dry-run)'],
        });
      }
    }
    return assembleReport(ts, outDir, rendersDir, featuresDir, failuresDir, results);
  }

  // Live render path.
  const { warmup, shutdown, render } = await import('@cactus/renderer');
  const { analyzeWav } = await import('@cactus/analyzer');
  await warmup();
  try {
    for (const e of renderableEntries) {
      const wavPath = path.join(rendersDir, `${e.id}.wav`);
      const featuresPath = path.join(featuresDir, `${e.id}.features.json`);
      const wrapped = wrapForRender(e);

      const syn = validateStrudelCode(wrapped);
      if (!syn.ok) {
        results.push({
          entry_id: e.id, genre: e.genre, role: e.role,
          classification: 'rejected_validation_error',
          reasons: syn.issues.slice(0, 3).map((i) => `[${i.code}] ${i.message}`),
        });
        await fs.writeFile(
          path.join(failuresDir, `${e.id}.json`),
          JSON.stringify({ entry: e, syntax_issues: syn.issues }, null, 2),
        );
        continue;
      }

      try {
        const cps = (e.bpm_range[0] + e.bpm_range[1]) / 2 / 240;
        await render({ code: wrapped, durationCycles: 4, cps, outputPath: wavPath });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          entry_id: e.id, genre: e.genre, role: e.role,
          classification: 'rejected_render_error',
          reasons: [`render: ${msg.slice(0, 200)}`],
        });
        await fs.writeFile(
          path.join(failuresDir, `${e.id}.json`),
          JSON.stringify({ entry: e, render_error: msg }, null, 2),
        );
        continue;
      }

      let features: unknown;
      try {
        features = await analyzeWav(wavPath);
        await fs.writeFile(featuresPath, JSON.stringify(features, null, 2));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          entry_id: e.id, genre: e.genre, role: e.role,
          classification: 'rejected_render_error',
          reasons: [`analyze: ${msg.slice(0, 200)}`],
          wav_path: wavPath,
        });
        continue;
      }

      // Classify against expected_movement.
      const cls = classifyByMovement(e, features as Record<string, unknown>);
      results.push({
        entry_id: e.id, genre: e.genre, role: e.role,
        classification: cls.classification,
        reasons: cls.reasons,
        ...(cls.rms_db !== undefined ? { rms_db: cls.rms_db } : {}),
        ...(cls.peak_db !== undefined ? { peak_db: cls.peak_db } : {}),
        wav_path: wavPath,
        features_path: featuresPath,
      });
    }
  } finally {
    await shutdown();
  }

  return assembleReport(ts, outDir, rendersDir, featuresDir, failuresDir, results);
}

/**
 * Wrap a cookbook entry's code for rendering. Mirrors validate.ts logic.
 */
export function wrapForRender(e: CookbookEntry): string {
  const code = getEntryCode(e);
  if (e.mini_notation !== undefined) {
    const escaped = code.replace(/"/g, '\\"');
    const tonal = e.role === 'chord_stab' || e.role === 'bass' || e.role === 'lead_hook' || e.role === 'pad_atmo';
    const wrapped = tonal ? `note("${escaped}")` : `s("${escaped}")`;
    return `setcps(0.5)\n${wrapped}.gain(0.7)`;
  }
  // raw: full JS expression. If the entry already has .gain(...) we skip
  // adding our own to avoid the DUPLICATE_SINGLE_USE_EFFECT lint.
  const needsGain = !/\.gain\s*\(/.test(code);
  return needsGain ? `setcps(0.5)\n${code}.gain(0.7)` : `setcps(0.5)\n${code}`;
}

interface MovementResult {
  classification: EntryClassification;
  reasons: string[];
  rms_db?: number;
  peak_db?: number;
}

/**
 * Compare actual analyzer features against the entry's expected_movement.
 * The check is intentionally lenient — we only flag clear contradictions
 * (silence; expected onset_density > 5 but got 0; etc.).
 */
function classifyByMovement(e: CookbookEntry, features: Record<string, unknown>): MovementResult {
  const reasons: string[] = [];
  let warning = false;
  // RMS gate: silence is a hard reject for any audible role.
  const loudness = features.loudness as { lufs_integrated?: number; true_peak_db?: number } | undefined;
  const rmsDb = loudness?.lufs_integrated ?? -100;
  const peakDb = loudness?.true_peak_db ?? -100;
  if (peakDb <= -55) {
    return {
      classification: 'rejected_silent',
      reasons: [`peak_db=${peakDb.toFixed(1)} dB — track is silent`],
      rms_db: rmsDb,
      peak_db: peakDb,
    };
  }

  // Expected onset density check.
  const rhythmic = features.rhythmic as { onset_density?: Record<string, number> } | undefined;
  const onset = rhythmic?.onset_density;
  const overall = onset
    ? ((onset.low ?? 0) + (onset.mid ?? 0) + (onset.high ?? 0))
    : undefined;
  if (e.expected_movement.onset_density_min !== undefined && overall !== undefined) {
    if (overall < e.expected_movement.onset_density_min * 0.5) {
      warning = true;
      reasons.push(`onset density ${overall.toFixed(1)} below expected min ${e.expected_movement.onset_density_min} (warning)`);
    }
  }
  if (e.expected_movement.onset_density_max !== undefined && overall !== undefined) {
    if (overall > e.expected_movement.onset_density_max * 1.5) {
      warning = true;
      reasons.push(`onset density ${overall.toFixed(1)} above expected max ${e.expected_movement.onset_density_max} (warning)`);
    }
  }

  if (reasons.length === 0) reasons.push('rendered + matches expected feature movement');
  return {
    classification: warning ? 'accepted_with_warning' : 'accepted',
    reasons,
    rms_db: rmsDb,
    peak_db: peakDb,
  };
}

function assembleReport(
  ts: string, outDir: string, rendersDir: string, featuresDir: string, failuresDir: string,
  results: EntryAuditResult[],
): CookbookRenderAuditReport {
  const counts: Record<EntryClassification, number> = {
    accepted: 0, accepted_with_warning: 0,
    rejected_silent: 0, rejected_wrong_role_signal: 0,
    rejected_validation_error: 0, rejected_render_error: 0,
    experimental_only: 0,
  };
  for (const r of results) counts[r.classification]++;
  return {
    ts, out_dir: outDir,
    total: results.length,
    by_classification: counts,
    results, failures_dir: failuresDir, renders_dir: rendersDir, features_dir: featuresDir,
  };
}

export async function writeCookbookRenderAuditReport(report: CookbookRenderAuditReport): Promise<void> {
  await fs.writeFile(
    path.join(report.out_dir, 'cookbook-render-summary.json'),
    JSON.stringify(report, null, 2),
  );
  const md: string[] = [];
  md.push(`# Cookbook render audit — ${report.ts}`);
  md.push('');
  md.push(`Total entries audited: **${report.total}**`);
  md.push('');
  md.push('| classification | count |');
  md.push('|---|---|');
  for (const [k, v] of Object.entries(report.by_classification)) {
    md.push(`| ${k} | ${v} |`);
  }
  md.push('');
  md.push('## Per-entry results');
  md.push('');
  for (const r of report.results) {
    md.push(`### ${r.entry_id} — ${r.classification}`);
    md.push(`- genre: ${r.genre}, role: ${r.role}`);
    if (r.rms_db !== undefined) md.push(`- rms_db=${r.rms_db.toFixed(1)}, peak_db=${r.peak_db?.toFixed(1) ?? 'n/a'}`);
    for (const reason of r.reasons) md.push(`- ${reason}`);
    md.push('');
  }
  await fs.writeFile(path.join(report.out_dir, 'cookbook-render-report.md'), md.join('\n'));
}
