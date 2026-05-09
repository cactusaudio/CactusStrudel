import { SCHEMA_VERSION, SessionGraphSchema, type SessionGraph } from '../src/schema.js';

export interface Migration {
  from: string;
  to: string;
  apply(input: unknown): unknown;
}

export const MIGRATIONS: Migration[] = [];

export function migrateToCurrent(input: unknown): SessionGraph {
  if (!input || typeof input !== 'object') {
    throw new Error('migrateToCurrent: input is not an object');
  }
  let cur: unknown = input;
  let version = (cur as { schema_version?: string }).schema_version ?? '0.0.0';
  while (version !== SCHEMA_VERSION) {
    const m = MIGRATIONS.find((x) => x.from === version);
    if (!m) {
      throw new Error(
        `No migration registered from ${version} to ${SCHEMA_VERSION}. Add one to packages/ir/migrations/.`,
      );
    }
    cur = m.apply(cur);
    version = m.to;
  }
  return SessionGraphSchema.parse(cur);
}
