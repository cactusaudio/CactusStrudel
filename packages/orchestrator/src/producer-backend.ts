import {
  parseBrief,
  buildSessionGraphFromBrief,
} from '@cactus/agent-runtime';
import {
  applyPatch,
  isAgentAllowedToWrite,
  SessionGraphSchema,
  PatchSchema,
  type Patch,
  type SessionGraph,
} from '@cactus/ir';
import { compileSessionGraph } from '@cactus/strudel-compiler';
import { validateStrudelCode } from '@cactus/strudel-validator';

export type BackendName = 'rules' | 'claude-shadow' | 'hybrid';

export interface ProducerBackendInput {
  brief: string;
  seed?: number;
}

export interface ProducerBackendResult {
  backend: BackendName;
  graph: SessionGraph;
  /** Compiled Strudel code emitted by the deterministic compiler. */
  code: string;
  /** Validator issues against the compiled code. */
  validator_issues: number;
  /** Warnings + provenance notes (e.g. "fell back to rules because ..."). */
  warnings: string[];
}

export interface ProducerBackend {
  readonly name: BackendName;
  produce(input: ProducerBackendInput): Promise<ProducerBackendResult>;
}

// ---------------------- rules backend ----------------------

export class RulesBackend implements ProducerBackend {
  readonly name: BackendName = 'rules';
  async produce(input: ProducerBackendInput): Promise<ProducerBackendResult> {
    const brief = parseBrief(input.brief);
    if (!brief.primary_genre) {
      throw new Error(
        `RulesBackend: parseBrief could not infer primary_genre from "${input.brief}". Add a genre keyword.`,
      );
    }
    const graph = await buildSessionGraphFromBrief(
      brief,
      input.seed !== undefined ? { seed: input.seed } : {},
    );
    const compiled = compileSessionGraph(graph);
    const validation = validateStrudelCode(compiled.code);
    return {
      backend: 'rules',
      graph,
      code: compiled.code,
      validator_issues: validation.issues.length,
      warnings: compiled.warnings,
    };
  }
}

// ---------------------- claude-shadow backend ----------------------

/**
 * Function the host injects to dispatch a prompt to Claude (Agent SDK or Messages API).
 * Returning a SessionGraph subtree replaces the rules-built graph;
 * returning Patch[] applies them on top of the rules graph.
 *
 * Implementations MUST return strict JSON (the orchestrator validates it).
 * No prose, no markdown.
 */
export type ClaudeDispatcher = (args: {
  brief: string;
  seed?: number;
  baselineGraph: SessionGraph;
}) => Promise<{ graph?: unknown; patches?: unknown[] }>;

export interface ClaudeShadowOptions {
  /** Dispatcher to call Claude. Required for any non-rules behavior. */
  dispatcher?: ClaudeDispatcher;
  /** If true (default), validate Claude's output and reject anything that fails. */
  strict?: boolean;
}

export class ClaudeShadowBackend implements ProducerBackend {
  readonly name: BackendName = 'claude-shadow';
  constructor(private readonly opts: ClaudeShadowOptions = {}) {}

  async produce(input: ProducerBackendInput): Promise<ProducerBackendResult> {
    if (!this.opts.dispatcher) {
      throw new ClaudeBackendNotConfigured(
        'claude-shadow backend invoked without a dispatcher. Wire one via createBackend({dispatcher:...}) ' +
        'or set the CACTUS_CLAUDE_DISPATCHER env var to a module path.',
      );
    }
    // Establish a deterministic baseline first; Claude's output is anchored to it.
    const baseline = await new RulesBackend().produce(input);
    const dispatched = await this.opts.dispatcher({
      brief: input.brief,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      baselineGraph: baseline.graph,
    });
    const validated = validateClaudeOutput(dispatched, baseline.graph);
    if (validated.kind === 'graph') {
      const compiled = compileSessionGraph(validated.graph);
      const validation = validateStrudelCode(compiled.code);
      return {
        backend: 'claude-shadow',
        graph: validated.graph,
        code: compiled.code,
        validator_issues: validation.issues.length,
        warnings: ['Claude full-graph replacement; baseline retained for comparison.'],
      };
    }
    let next = baseline.graph;
    for (const p of validated.patches) {
      if (p.ops.every((op) => isAgentAllowedToWrite(p.agent, op.path))) {
        next = applyPatch(next, p.ops);
      }
    }
    const compiled = compileSessionGraph(next);
    const validation = validateStrudelCode(compiled.code);
    return {
      backend: 'claude-shadow',
      graph: next,
      code: compiled.code,
      validator_issues: validation.issues.length,
      warnings: [
        `Claude returned ${validated.patches.length} patches; ${validated.skipped} skipped for boundary violations.`,
      ],
    };
  }
}

// ---------------------- hybrid backend ----------------------

export class HybridBackend implements ProducerBackend {
  readonly name: BackendName = 'hybrid';
  constructor(private readonly opts: ClaudeShadowOptions = {}) {}

  async produce(input: ProducerBackendInput): Promise<ProducerBackendResult> {
    const baseline = await new RulesBackend().produce(input);
    if (!this.opts.dispatcher) {
      // Hybrid without dispatcher = rules baseline.
      return { ...baseline, backend: 'hybrid', warnings: [
        ...baseline.warnings,
        'hybrid: no Claude dispatcher configured; returning rules baseline unchanged.',
      ]};
    }
    const dispatched = await this.opts.dispatcher({
      brief: input.brief,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      baselineGraph: baseline.graph,
    });
    const validated = validateClaudeOutput(dispatched, baseline.graph);
    if (validated.kind !== 'patches') {
      // Hybrid only accepts patches; full-graph replacement here is rejected.
      return { ...baseline, backend: 'hybrid', warnings: [
        ...baseline.warnings,
        'hybrid: rejected Claude full-graph replacement (hybrid is patch-only); returning rules baseline.',
      ]};
    }
    let next = baseline.graph;
    let applied = 0;
    let skipped = 0;
    for (const p of validated.patches) {
      if (p.ops.every((op) => isAgentAllowedToWrite(p.agent, op.path))) {
        try { next = applyPatch(next, p.ops); applied++; }
        catch { skipped++; }
      } else { skipped++; }
    }
    const compiled = compileSessionGraph(next);
    const validation = validateStrudelCode(compiled.code);
    return {
      backend: 'hybrid',
      graph: next,
      code: compiled.code,
      validator_issues: validation.issues.length,
      warnings: [
        `hybrid: applied ${applied}/${validated.patches.length} Claude patches (${skipped} skipped).`,
      ],
    };
  }
}

// ---------------------- factory + validation ----------------------

export interface BackendFactoryOptions extends ClaudeShadowOptions {}

export function createBackend(name: BackendName, opts: BackendFactoryOptions = {}): ProducerBackend {
  switch (name) {
    case 'rules': return new RulesBackend();
    case 'claude-shadow': return new ClaudeShadowBackend(opts);
    case 'hybrid': return new HybridBackend(opts);
    default: throw new Error(`unknown backend: ${name}`);
  }
}

export class ClaudeBackendNotConfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeBackendNotConfigured';
  }
}

type ClaudeValidated =
  | { kind: 'graph'; graph: SessionGraph }
  | { kind: 'patches'; patches: Patch[]; skipped: number };

function validateClaudeOutput(raw: unknown, _baseline: SessionGraph): ClaudeValidated {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('claude backend: dispatcher returned non-object');
  }
  const obj = raw as { graph?: unknown; patches?: unknown[] };
  if (obj.graph !== undefined) {
    const parsed = SessionGraphSchema.safeParse(obj.graph);
    if (!parsed.success) {
      throw new Error('claude backend: graph failed zod validation');
    }
    return { kind: 'graph', graph: parsed.data };
  }
  if (Array.isArray(obj.patches)) {
    const valid: Patch[] = [];
    let skipped = 0;
    for (const p of obj.patches) {
      const parsed = PatchSchema.safeParse(p);
      if (parsed.success) valid.push(parsed.data);
      else skipped++;
    }
    return { kind: 'patches', patches: valid, skipped };
  }
  throw new Error('claude backend: dispatcher returned neither graph nor patches');
}
