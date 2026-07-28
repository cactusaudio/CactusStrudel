import { SCHEMA_VERSION, SessionGraphSchema, type SessionGraph } from './schema.js';

export interface Migration {
  from: string;
  to: string;
  apply(input: Record<string, unknown>): Record<string, unknown>;
}

export const MIGRATIONS: Migration[] = [
  {
    from: '1.0.0',
    to: '1.1.0',
    apply(input) {
      // 1.1.0 only adds optional harmony fields, so persisted 1.0.0 graphs can
      // be promoted without structural edits.
      return { ...input, schema_version: '1.1.0' };
    },
  },
];

export function migrateToCurrent(input: unknown): SessionGraph {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('migrateToCurrent: input is not an object');
  }
  let cur = input as Record<string, unknown>;
  let version = String(cur.schema_version ?? '0.0.0');
  const seen = new Set<string>();
  while (version !== SCHEMA_VERSION) {
    if (seen.has(version)) {
      throw new Error(`migrateToCurrent: migration cycle at ${version}`);
    }
    seen.add(version);
    const migration = MIGRATIONS.find((m) => m.from === version);
    if (!migration) {
      throw new Error(`No migration registered from ${version} to ${SCHEMA_VERSION}`);
    }
    cur = migration.apply(cur);
    version = String(cur.schema_version ?? migration.to);
  }
  return SessionGraphSchema.parse(cur);
}
