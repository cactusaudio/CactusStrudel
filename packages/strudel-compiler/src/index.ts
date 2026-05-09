import type { SessionGraph } from '@cactus/ir';

export interface CompileOptions {
  solo?: number | undefined;
}

export interface CompiledStrudel {
  code: string;
  sourceMap: Array<{ codeRange: [number, number]; graphPath: string }>;
  warnings: string[];
}

export function compileSessionGraph(
  _graph: SessionGraph,
  _options: CompileOptions = {},
): CompiledStrudel {
  return {
    code: 'silence',
    sourceMap: [],
    warnings: ['compileSessionGraph stub — Phase 3 not yet implemented'],
  };
}
