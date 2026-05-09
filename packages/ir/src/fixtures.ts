import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionGraphSchema, type SessionGraph } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '..', '..', '..', 'tests', 'fixtures', 'session-graphs');

export const FIXTURE_GENRES = [
  'techno',
  'dub_techno',
  'ambient',
  'dnb',
  'idm',
] as const;
export type FixtureGenre = (typeof FIXTURE_GENRES)[number];

export async function loadFixture(slug: FixtureGenre): Promise<SessionGraph> {
  const file = path.join(FIXTURE_DIR, `${slug}.json`);
  const raw = await fs.readFile(file, 'utf8');
  return SessionGraphSchema.parse(JSON.parse(raw));
}

export function fixturePath(slug: FixtureGenre): string {
  return path.join(FIXTURE_DIR, `${slug}.json`);
}
