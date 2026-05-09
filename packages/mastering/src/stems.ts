import path from 'node:path';
import { promises as fs } from 'node:fs';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import type { SessionGraph } from '@cactus/ir';

export interface StemRenderInput {
  graph: SessionGraph;
  outputDir: string;
  /** Async render callback. Caller injects @cactus/renderer's render to avoid circular dep. */
  renderFn: (input: { code: string; durationCycles: number; cps: number; outputPath: string }) => Promise<unknown>;
}

export interface StemRenderResult {
  stems: Array<{ orbit: number; layerIds: string[]; wavPath: string }>;
}

export async function renderStemsByOrbit(input: StemRenderInput): Promise<StemRenderResult> {
  await fs.mkdir(input.outputDir, { recursive: true });
  const orbits = new Map<number, string[]>();
  for (const layer of input.graph.layers) {
    const ids = orbits.get(layer.orbit) ?? [];
    ids.push(layer.id);
    orbits.set(layer.orbit, ids);
  }
  const cps = (input.graph.brief.bpm ?? 120) / 240;
  const durationCycles = input.graph.song.total_bars;
  const stems: StemRenderResult['stems'] = [];
  for (const [orbit, layerIds] of orbits) {
    const compiled = compileSessionGraph(input.graph, { solo: orbit });
    const stemName = `stem_orbit_${orbit}__${layerIds.join('_')}.wav`;
    const wavPath = path.join(input.outputDir, stemName);
    await input.renderFn({ code: compiled.code, durationCycles, cps, outputPath: wavPath });
    stems.push({ orbit, layerIds, wavPath });
  }
  return { stems };
}
