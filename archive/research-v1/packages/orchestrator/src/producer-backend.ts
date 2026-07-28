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
import { applyArrangementCoverage } from './arrangement-coverage.js';

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
    // Genre-aware arrangement coverage: ensure every section has the layers
    // its function requires (e.g. techno intro must include a hat). Repairs the
    // dead-air-intro failure that Phase 14 smoke surfaced. Honors brief.constraints.
    const coverage = applyArrangementCoverage(graph);
    const compiled = compileSessionGraph(graph);
    const validation = validateStrudelCode(compiled.code);
    const warnings = [...compiled.warnings];
    if (coverage.mutations.length > 0) {
      warnings.push(`coverage: ${coverage.mutations.length} section(s) had layers activated/deactivated to satisfy ${coverage.genre} constraints`);
    }
    return {
      backend: 'rules',
      graph,
      code: compiled.code,
      validator_issues: validation.issues.length,
      warnings,
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
  /**
   * If true (default for claude-shadow), validate Claude's output and reject
   * anything that fails. For hybrid, `strict: true` makes a missing
   * dispatcher throw instead of silently returning the rules baseline.
   */
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
      if (this.opts.strict) {
        throw new ClaudeBackendNotConfigured(
          'hybrid backend: strict mode enabled but no dispatcher configured. ' +
          'Wire one via createBackend({dispatcher:...}) or set CACTUS_CLAUDE_DISPATCHER.',
        );
      }
      // G8: no masquerade — when hybrid falls back, the result reports
      // backend='rules' (the truth), not 'hybrid' (the request).
      return { ...baseline, backend: 'rules', warnings: [
        ...baseline.warnings,
        'hybrid requested but no Claude dispatcher configured; returning rules baseline labeled as rules (no masquerade).',
      ]};
    }
    const dispatched = await this.opts.dispatcher({
      brief: input.brief,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      baselineGraph: baseline.graph,
    });
    const validated = validateClaudeOutput(dispatched, baseline.graph);
    if (validated.kind !== 'patches') {
      // G8: rejected outputs also revert label to 'rules' — the result is
      // rules-baseline, not Claude-modified.
      return { ...baseline, backend: 'rules', warnings: [
        ...baseline.warnings,
        'hybrid rejected Claude full-graph replacement (hybrid is patch-only); returning rules baseline labeled as rules.',
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
    // G8: if zero Claude patches actually applied, label as 'rules' — the
    // graph IS the rules baseline. Only when ≥1 patch landed do we keep the
    // 'hybrid' label.
    const honestLabel: BackendName = applied > 0 ? 'hybrid' : 'rules';
    return {
      backend: honestLabel,
      graph: next,
      code: compiled.code,
      validator_issues: validation.issues.length,
      warnings: [
        `hybrid: applied ${applied}/${validated.patches.length} Claude patches (${skipped} skipped).`,
        ...(honestLabel === 'rules'
          ? ['hybrid result was 100% rules (no Claude patches applied); label downgraded to rules to avoid masquerade.']
          : []),
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

/**
 * G8: load a Claude dispatcher from CACTUS_CLAUDE_DISPATCHER (a module path).
 * The module must export a default function matching the ClaudeDispatcher
 * signature. Returns undefined if the env var is unset; throws if it's set
 * but the import / shape check fails (no silent masquerade — if you ask for
 * Claude, you must get Claude or a clear error).
 */
export async function loadDispatcherFromEnv(): Promise<ClaudeDispatcher | undefined> {
  const modulePath = process.env.CACTUS_CLAUDE_DISPATCHER;
  if (!modulePath) return undefined;
  let imported: unknown;
  try {
    imported = await import(modulePath);
  } catch (e) {
    throw new ClaudeBackendNotConfigured(
      `CACTUS_CLAUDE_DISPATCHER set to "${modulePath}" but import failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const dispatcher =
    (imported as { default?: unknown }).default ??
    (imported as { dispatcher?: unknown }).dispatcher ??
    imported;
  if (typeof dispatcher !== 'function') {
    throw new ClaudeBackendNotConfigured(
      `CACTUS_CLAUDE_DISPATCHER module "${modulePath}" did not export a function (got ${typeof dispatcher})`,
    );
  }
  return dispatcher as ClaudeDispatcher;
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
