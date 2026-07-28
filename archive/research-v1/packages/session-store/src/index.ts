import { promises as fs } from 'node:fs';
import path from 'node:path';
import { migrateToCurrent, type SessionGraph } from '@cactus/ir';

export interface StoreConfig {
  rootDir: string;
}

export class SessionStore {
  constructor(private readonly cfg: StoreConfig) {}

  private sessionDir(sessionId: string): string {
    return path.join(this.cfg.rootDir, sessionId);
  }

  async createSession(graph: SessionGraph): Promise<void> {
    const dir = this.sessionDir(graph.session_id);
    await fs.mkdir(dir, { recursive: true });
    await writeJsonAtomic(
      path.join(dir, 'iter_0000.json'),
      graph,
    );
  }

  async loadIteration(sessionId: string, iter: number): Promise<SessionGraph> {
    const file = path.join(
      this.sessionDir(sessionId),
      `iter_${String(iter).padStart(4, '0')}.json`,
    );
    const raw = await fs.readFile(file, 'utf8');
    return migrateToCurrent(JSON.parse(raw));
  }

  async appendIteration(graph: SessionGraph): Promise<number> {
    const existing = await this.listIterations(graph.session_id);
    const nextFromDisk = existing.length > 0 ? Math.max(...existing) + 1 : 0;
    const nextFromGraph = (graph.iteration_log.at(-1)?.iteration_n ?? -1) + 1;
    const next = Math.max(nextFromDisk, nextFromGraph);
    const file = path.join(
      this.sessionDir(graph.session_id),
      `iter_${String(next).padStart(4, '0')}.json`,
    );
    await writeJsonAtomic(file, graph);
    return next;
  }

  async listIterations(sessionId: string): Promise<number[]> {
    const dir = this.sessionDir(sessionId);
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((n) => /^iter_\d{4}\.json$/.test(n))
        .map((n) => Number(n.slice(5, 9)))
        .sort((a, b) => a - b);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.unlink(tmp).catch(() => undefined);
    throw e;
  }
}
