// Diagnostic report writer: emits both JSON and Markdown per render so audit
// readers can see WHICH section is silent, WHICH stem is dead, etc., not just
// the global gate result.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SectionDiagnosticsReport, StemDiagnosticsReport } from '@cactus/analyzer';
import type { ExpandedPrompt } from './prompt-suite.js';

export interface DiagnosticReportInput {
  prompt: ExpandedPrompt;
  sections?: SectionDiagnosticsReport;
  stems?: StemDiagnosticsReport;
  outDir: string;
}

export interface DiagnosticReportPaths {
  json: string;
  md: string;
}

export async function writeDiagnosticReport(input: DiagnosticReportInput): Promise<DiagnosticReportPaths> {
  await fs.mkdir(input.outDir, { recursive: true });
  const base = `${input.prompt.id}__seed${input.prompt.seed}`;
  const jsonPath = path.join(input.outDir, `${base}.json`);
  const mdPath = path.join(input.outDir, `${base}.md`);
  await fs.writeFile(jsonPath, JSON.stringify({
    prompt: input.prompt,
    sections: input.sections,
    stems: input.stems,
  }, null, 2));
  await fs.writeFile(mdPath, renderMarkdown(input));
  return { json: jsonPath, md: mdPath };
}

function renderMarkdown(input: DiagnosticReportInput): string {
  const lines: string[] = [];
  lines.push(`# diagnostic — ${input.prompt.id} seed=${input.prompt.seed}`);
  lines.push('');
  lines.push(`brief: ${input.prompt.text}`);
  lines.push(`intended genre: ${input.prompt.intent_genre}`);
  lines.push('');

  if (input.sections) {
    lines.push('## sections');
    lines.push('');
    lines.push('| name | function | start | end | layers | non_silent | rms_db | st_lufs | onsets/s | low_mid/mid |');
    lines.push('| --- | --- | ---:| ---:| ---:| ---:| ---:| ---:| ---:| ---:|');
    for (const s of input.sections.rendered_sections) {
      const lowMid = s.band_rms.low_mid ?? 0;
      const mid = s.band_rms.mid ?? 1e-9;
      const ratio = (lowMid / mid).toFixed(2);
      lines.push(`| ${s.name} | ${s.function} | ${s.start_sec.toFixed(2)} | ${s.end_sec.toFixed(2)} | ${s.active_layer_count} (${s.active_layer_ids.join(',') || '-'}) | ${s.non_silent_ratio.toFixed(2)} | ${s.rms_db.toFixed(1)} | ${Number.isFinite(s.short_term_lufs_proxy) ? s.short_term_lufs_proxy.toFixed(1) : '-'} | ${s.onset_density.toFixed(2)} | ${ratio} |`);
    }
    lines.push('');
    if (input.sections.unrendered_sections.length > 0) {
      lines.push('### unrendered sections (past audio horizon)');
      for (const u of input.sections.unrendered_sections) {
        lines.push(`- ${u.name} (${u.function}) ${u.start_sec.toFixed(2)}-${u.end_sec.toFixed(2)} s`);
      }
      lines.push('');
    }
  }

  if (input.stems) {
    lines.push('## stems');
    lines.push('');
    lines.push('| orbit | layers | rms_db | peak_db | active | duration |');
    lines.push('| ---:| --- | ---:| ---:| ---:| ---:|');
    for (const s of input.stems.stems) {
      lines.push(`| ${s.orbit} | ${s.layer_ids.join(',')} | ${s.rms_db.toFixed(1)} | ${s.peak_db.toFixed(1)} | ${(s.active_ratio * 100).toFixed(1)}% | ${s.duration_sec.toFixed(1)} s |`);
    }
    if (input.stems.missing_orbits.length > 0) {
      lines.push('');
      lines.push(`missing stem renders for orbits: ${input.stems.missing_orbits.join(', ')}`);
    }
    lines.push('');
  }

  // Diagnose silence root-cause: which section pulled non_silent down?
  if (input.sections) {
    const sorted = [...input.sections.rendered_sections].sort((a, b) => a.non_silent_ratio - b.non_silent_ratio);
    const worst = sorted.slice(0, 3).filter((s) => s.non_silent_ratio < 0.6);
    if (worst.length > 0) {
      lines.push('## silence localization');
      lines.push('');
      for (const s of worst) {
        lines.push(`- **${s.name}** (${s.function}, ${s.duration_sec.toFixed(1)} s, ${s.active_layer_count} active layers): non_silent=${s.non_silent_ratio.toFixed(2)} rms=${s.rms_db.toFixed(1)} dB`);
      }
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}
