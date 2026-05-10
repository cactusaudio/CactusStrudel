// G9 §6: reference descriptors. Loads references/<genre>.yaml files —
// abstract trait descriptions, NOT track copies. The producer + critic
// query this layer for genre-specific feature targets and forbidden-copying
// guardrails.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DEFAULT_REFERENCES_DIR = path.join(REPO_ROOT, 'references');

export const ReferenceDescriptorSchema = z.object({
  slug: z.string(),
  descriptor_version: z.string(),
  /**
   * Each item is either a free-text trait line or a {tag: description}
   * single-key object. YAML's `- foo: bar` syntax parses to the latter.
   */
  production_trait_clusters: z.array(z.union([z.string(), z.record(z.string())])),
  arrangement_descriptors: z.record(z.unknown()),
  mix_descriptors: z.record(z.unknown()),
  allowed_influence_notes: z.array(z.string()).default([]),
  forbidden_copying_notes: z.array(z.string()).default([]),
  feature_targets: z.record(z.number()).optional(),
}).strict();
export type ReferenceDescriptor = z.infer<typeof ReferenceDescriptorSchema>;

export interface LoadReferenceOptions {
  referencesDir?: string;
}

export async function loadReferenceDescriptor(
  slug: string,
  opts: LoadReferenceOptions = {},
): Promise<ReferenceDescriptor> {
  const dir = opts.referencesDir ?? DEFAULT_REFERENCES_DIR;
  const file = path.join(dir, `${slug}.yaml`);
  const raw = await fs.readFile(file, 'utf8');
  const parsed = parseYaml(raw) as unknown;
  return ReferenceDescriptorSchema.parse(parsed);
}

export async function listReferenceDescriptors(opts: LoadReferenceOptions = {}): Promise<string[]> {
  const dir = opts.referencesDir ?? DEFAULT_REFERENCES_DIR;
  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  return entries
    .filter((n) => n.endsWith('.yaml'))
    .map((n) => n.slice(0, -5))
    .sort();
}

export function defaultReferencesDir(): string {
  return DEFAULT_REFERENCES_DIR;
}
