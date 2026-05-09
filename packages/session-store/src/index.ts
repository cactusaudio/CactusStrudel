import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SessionGraphSchema, type SessionGraph } from '@cactus/ir';

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
    await fs.writeFile(
      path.join(dir, 'iter_0000.json'),
      JSON.stringify(graph, null, 2),
    );
  }

  async loadIteration(sessionId: string, iter: number): Promise<SessionGraph> {
    const file = path.join(
      this.sessionDir(sessionId),
      `iter_${String(iter).padStart(4, '0')}.json`,
    );
    const raw = await fs.readFile(file, 'utf8');
    return SessionGraphSchema.parse(JSON.parse(raw));
  }

  async appendIteration(graph: SessionGraph): Promise<number> {
    const next = (graph.iteration_log.at(-1)?.iteration_n ?? -1) + 1;
    const file = path.join(
      this.sessionDir(graph.session_id),
      `iter_${String(next).padStart(4, '0')}.json`,
    );
    await fs.writeFile(file, JSON.stringify(graph, null, 2));
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
