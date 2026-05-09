import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';
import type { SessionGraph } from '@cactus/ir';
import { parseBrief } from './brief-parser.js';
import { buildSessionGraphFromBrief } from './build-graph.js';

export interface ProduceOptions {
  /** Where to write the session bundle. Defaults to ./sessions/<session_id>/. */
  sessionsRoot?: string;
  /** Skip rendering even if available (faster CI). */
  skipRender?: boolean;
  /** Skip analysis even if WAV available. */
  skipAnalyze?: boolean;
  /** Render duration in cycles (overrides brief duration). */
  durationCyclesOverride?: number;
  /** Optional PRNG seed for deterministic graph generation. */
  seed?: number;
}

export interface ProduceResult {
  graph: SessionGraph;
  sessionDir: string;
  compiledCode: string;
  validatorIssues: number;
  wavPath?: string;
  featuresPath?: string;
  reportPath: string;
}

export async function produce(briefText: string, options: ProduceOptions = {}): Promise<ProduceResult> {
  // 1. Parse brief.
  const brief = parseBrief(briefText);
  if (!brief.primary_genre) {
    throw new Error(
      `parseBrief: could not infer primary_genre from brief. Add genre keyword (techno|dub_techno|house|dnb|idm|ambient).`,
    );
  }

  // 2. Build SessionGraph from genre + cookbook.
  const graph = await buildSessionGraphFromBrief(brief, options.seed !== undefined ? { seed: options.seed } : {});

  // 3. Compile.
  const compiled = compileSessionGraph(graph);
  const validation = validateStrudelCode(compiled.code);

  // 4. Set up session dir.
  const sessionsRoot = options.sessionsRoot ?? path.resolve(process.cwd(), 'sessions');
  const sessionDir = path.join(sessionsRoot, graph.session_id);
  await fs.mkdir(sessionDir, { recursive: true });
  const codePath = path.join(sessionDir, 'iter_0000.strudel.js');
  const graphPath = path.join(sessionDir, 'iter_0000.json');
  const reportPath = path.join(sessionDir, 'iter_0000.report.md');

  // 5. Write graph + code.
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2));
  await fs.writeFile(codePath, compiled.code);

  // 6. Optionally render.
  let wavPath: string | undefined;
  if (!options.skipRender) {
    try {
      const { render } = await import('@cactus/renderer');
      wavPath = path.join(sessionDir, 'iter_0000.wav');
      const cps = (graph.brief.bpm ?? 120) / 240;
      const totalBars = graph.song.total_bars;
      const durationCycles = options.durationCyclesOverride ?? totalBars;
      await render({
        code: compiled.code,
        durationCycles,
        cps,
        outputPath: wavPath,
      });
    } catch (e) {
      // Renderer requires Playwright + browser + vite server. Skip silently
      // if unavailable (e.g., CI without CACTUS_RENDER_E2E).
      const msg = e instanceof Error ? e.message : String(e);
      if (process.env.CACTUS_RENDER_VERBOSE) {
        console.error(`[produce] render skipped: ${msg}`);
      }
      wavPath = undefined;
    }
  }

  // 7. Optionally analyze.
  let featuresPath: string | undefined;
  if (wavPath && !options.skipAnalyze) {
    try {
      const { analyzeWav } = await import('@cactus/analyzer');
      const features = await analyzeWav(wavPath);
      featuresPath = path.join(sessionDir, 'iter_0000.features.json');
      await fs.writeFile(featuresPath, JSON.stringify(features, null, 2));
      // Update graph with render artifact.
      graph.render_graph.push({
        iteration: 0,
        artifacts: { wav_path: wavPath, stems_paths: {}, spectrogram_paths: [], compiled_code_path: codePath },
        metadata: {
          sample_rate: 48000,
          duration_sec: graph.song.total_bars / ((graph.brief.bpm ?? 120) / 60),
          channels: 2,
          package_versions: {},
          warnings: [],
          rendered_at: new Date().toISOString(),
        },
        features,
      });
      // Re-write graph with render artifact.
      await fs.writeFile(graphPath, JSON.stringify(graph, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (process.env.CACTUS_RENDER_VERBOSE) {
        console.error(`[produce] analyze skipped: ${msg}`);
      }
    }
  }

  // 8. Write report.
  const report = renderReport(graph, compiled, validation, wavPath, featuresPath);
  await fs.writeFile(reportPath, report);

  return {
    graph,
    sessionDir,
    compiledCode: compiled.code,
    validatorIssues: validation.issues.length,
    wavPath,
    featuresPath,
    reportPath,
  };
}

function renderReport(
  graph: SessionGraph,
  compiled: { code: string; warnings: string[] },
  validation: { ok: boolean; issues: Array<{ code: string; message: string }> },
  wavPath: string | undefined,
  featuresPath: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`# session ${graph.session_id}`);
  lines.push('');
  lines.push(`- created_at: ${graph.created_at}`);
  lines.push(`- brief: ${graph.brief.text}`);
  lines.push(`- genre: ${graph.brief.primary_genre}`);
  lines.push(`- bpm: ${graph.brief.bpm}`);
  lines.push(`- duration: ${graph.song.total_bars} bars (${graph.song.sections.length} sections)`);
  lines.push(`- layers: ${graph.layers.length} (${graph.layers.map((l) => l.role).join(', ')})`);
  lines.push('');
  lines.push('## sections');
  for (const s of graph.song.sections) {
    lines.push(`- ${s.name} [${s.start_bar}-${s.end_bar}] energy=${s.energy.toFixed(2)} fn=${s.function}`);
  }
  lines.push('');
  lines.push('## layers');
  for (const l of graph.layers) {
    lines.push(`- ${l.id} role=${l.role} orbit=${l.orbit}${l.description ? ` (${l.description})` : ''}`);
  }
  lines.push('');
  lines.push('## compiler');
  lines.push(`- code length: ${compiled.code.length} chars`);
  lines.push(`- warnings: ${compiled.warnings.length}`);
  for (const w of compiled.warnings) lines.push(`  - ${w}`);
  lines.push('');
  lines.push('## validator');
  lines.push(`- ok: ${validation.ok}`);
  lines.push(`- issues: ${validation.issues.length}`);
  for (const issue of validation.issues.slice(0, 10)) {
    lines.push(`  - ${issue.code}: ${issue.message}`);
  }
  if (validation.issues.length > 10) {
    lines.push(`  - ... ${validation.issues.length - 10} more`);
  }
  lines.push('');
  lines.push('## artifacts');
  lines.push(`- code: iter_0000.strudel.js`);
  lines.push(`- graph: iter_0000.json`);
  if (wavPath) lines.push(`- audio: ${path.basename(wavPath)}`);
  if (featuresPath) lines.push(`- features: ${path.basename(featuresPath)}`);
  return lines.join('\n') + '\n';
}
