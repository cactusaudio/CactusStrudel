import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const IntentClass = z.enum([
  'canonical',
  'hybrid',
  'negative-constraint',
  'mix-intent',
  'arrangement-intent',
  'revision',
]);

export const PromptEntrySchema = z.object({
  id: z.string(),
  text: z.string(),
  intent_genre: z.string(),
  bpm_target: z.number().optional(),
  expected_modifiers: z.array(z.string()).default([]),
  forbidden_modifiers: z.array(z.string()).default([]),
  intent_class: IntentClass,
});
export type PromptEntry = z.infer<typeof PromptEntrySchema>;

export const PromptSuiteSchema = z.object({
  genre: z.string(),
  suite_source: z.enum(['holdout_human', 'cookbook_derived']).default('holdout_human'),
  contamination_policy: z.enum(['holdout_only', 'allow_cookbook_derived']).default('holdout_only'),
  prompts: z.array(PromptEntrySchema).min(1),
});
export type PromptSuite = z.infer<typeof PromptSuiteSchema>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES_ROOT = path.resolve(HERE, '..', '..', '..', 'tests', 'fixtures', 'audits');

export interface LoadSuiteOptions {
  /** Override the suite directory (defaults to tests/fixtures/audits/<name>/). */
  rootDir?: string;
}

export async function loadSuite(name: string, options: LoadSuiteOptions = {}): Promise<PromptSuite[]> {
  const root = options.rootDir ?? SUITES_ROOT;
  if (name === 'smoke') {
    const file = path.join(root, 'smoke.yaml');
    return [PromptSuiteSchema.parse(parseYaml(await fs.readFile(file, 'utf8')))];
  }
  const dir = path.join(root, name);
  const stat = await fs.stat(dir).catch(() => undefined);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`audit suite not found: ${dir}`);
  }
  const entries = await fs.readdir(dir);
  const suites: PromptSuite[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml')) continue;
    const text = await fs.readFile(path.join(dir, entry), 'utf8');
    suites.push(PromptSuiteSchema.parse(parseYaml(text)));
  }
  return suites;
}

export interface ExpandedPrompt extends PromptEntry {
  suite_genre: string;
  seed: number;
}

export function expandPrompts(suites: PromptSuite[], seedsPerPrompt: number, seedBase = 1): ExpandedPrompt[] {
  const out: ExpandedPrompt[] = [];
  for (const suite of suites) {
    for (const p of suite.prompts) {
      for (let s = 0; s < seedsPerPrompt; s++) {
        out.push({ ...p, suite_genre: suite.genre, seed: seedBase + s });
      }
    }
  }
  return out;
}

export function assertNoEvalContamination(suites: PromptSuite[]): void {
  const bad = suites.filter((s) => s.suite_source === 'cookbook_derived' && s.contamination_policy === 'holdout_only');
  if (bad.length > 0) {
    throw new Error(`audit suite contamination: cookbook-derived suite(s) cannot run as holdout eval: ${bad.map((s) => s.genre).join(', ')}`);
  }
}
