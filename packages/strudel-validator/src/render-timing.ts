import * as acorn from 'acorn';
import { ancestor as walkAncestor } from 'acorn-walk';

export interface RenderTimingOptions {
  defaultCps?: number;
  defaultCycles?: number;
}

export interface RenderTiming {
  cps: number;
  durationCycles: number;
  tempoSource: 'default' | 'setcps' | 'setcpm';
  durationSource: 'default' | 'arrange';
}

export class RenderTimingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RenderTimingError';
    this.code = code;
  }
}

interface LocatedCall {
  node: any;
  ancestors: any[];
}

const DYNAMIC_EXECUTION_ANCESTORS = new Set([
  'ArrowFunctionExpression',
  'ConditionalExpression',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'FunctionDeclaration',
  'FunctionExpression',
  'IfStatement',
  'LogicalExpression',
  'SwitchCase',
  'TryStatement',
  'WhileStatement',
]);

/**
 * Extract the wall-clock facts needed by the realtime renderer without
 * evaluating model-authored JavaScript.
 *
 * A missing tempo uses `defaultCps`; a missing arrange() uses `defaultCycles`.
 * Once either construct is present, however, it must be unique and statically
 * numeric. Guessing a fallback for a dynamic or ambiguous expression would
 * silently capture the wrong section of the piece.
 */
export function extractRenderTiming(
  code: string,
  options: RenderTimingOptions = {},
): RenderTiming {
  const defaultCps = positiveOption(options.defaultCps ?? 0.5, 'defaultCps');
  const defaultCycles = positiveOption(
    options.defaultCycles ?? 48,
    'defaultCycles',
  );

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RenderTimingError(
      'TIMING_PARSE_ERROR',
      `cannot parse Strudel code for render timing: ${detail}`,
    );
  }

  const tempoCalls: LocatedCall[] = [];
  const arrangeCalls: LocatedCall[] = [];
  walkAncestor(ast, {
    CallExpression(node: any, _state: unknown, ancestors: any[]) {
      if (node.callee?.type !== 'Identifier') return;
      const located = { node, ancestors: [...ancestors] };
      if (node.callee.name === 'setcps' || node.callee.name === 'setcpm') {
        tempoCalls.push(located);
      } else if (node.callee.name === 'arrange') {
        arrangeCalls.push(located);
      }
    },
  });

  if (tempoCalls.length > 1) {
    throw new RenderTimingError(
      'AMBIGUOUS_TEMPO',
      `render timing found ${tempoCalls.length} setcps/setcpm calls; use exactly one`,
    );
  }
  if (arrangeCalls.length > 1) {
    throw new RenderTimingError(
      'AMBIGUOUS_ARRANGE',
      `render timing found ${arrangeCalls.length} arrange() calls; capture duration is ambiguous`,
    );
  }

  let cps = defaultCps;
  let tempoSource: RenderTiming['tempoSource'] = 'default';
  const tempoCall = tempoCalls[0];
  if (tempoCall) {
    assertTopLevelTempo(tempoCall);
    const args = tempoCall.node.arguments as any[];
    if (args.length !== 1 || args[0]?.type === 'SpreadElement') {
      throw new RenderTimingError(
        'DYNAMIC_TEMPO',
        `${tempoCall.node.callee.name}() must have one static numeric argument`,
      );
    }
    const raw = staticNumber(args[0], 'tempo');
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new RenderTimingError(
        'INVALID_TEMPO',
        `${tempoCall.node.callee.name}() must resolve to a finite value greater than zero`,
      );
    }
    tempoSource = tempoCall.node.callee.name;
    cps = tempoSource === 'setcpm' ? raw / 60 : raw;
    if (!Number.isFinite(cps) || cps <= 0) {
      throw new RenderTimingError(
        'INVALID_TEMPO',
        'resolved cycles per second must be finite and greater than zero',
      );
    }
  }

  let durationCycles = defaultCycles;
  let durationSource: RenderTiming['durationSource'] = 'default';
  const arrangeCall = arrangeCalls[0];
  if (arrangeCall) {
    assertStaticExecutionContext(arrangeCall, 'arrange');
    const sections = arrangeCall.node.arguments as any[];
    if (sections.length === 0) {
      throw new RenderTimingError(
        'DYNAMIC_ARRANGE',
        'arrange() must contain at least one [cycles, pattern] section',
      );
    }
    durationCycles = 0;
    for (const section of sections) {
      if (
        section?.type !== 'ArrayExpression'
        || section.elements?.length !== 2
        || section.elements[0] == null
        || section.elements[1] == null
        || section.elements[0].type === 'SpreadElement'
      ) {
        throw new RenderTimingError(
          'DYNAMIC_ARRANGE',
          'every arrange() section must be a static [cycles, pattern] pair',
        );
      }
      const cycles = staticNumber(section.elements[0], 'arrange duration');
      if (!Number.isFinite(cycles) || cycles <= 0) {
        throw new RenderTimingError(
          'INVALID_ARRANGE_DURATION',
          'every arrange() section duration must resolve to a finite value greater than zero',
        );
      }
      durationCycles += cycles;
    }
    if (!Number.isFinite(durationCycles) || durationCycles <= 0) {
      throw new RenderTimingError(
        'INVALID_ARRANGE_DURATION',
        'total arrange() duration must be finite and greater than zero',
      );
    }
    durationSource = 'arrange';
  }

  return { cps, durationCycles, tempoSource, durationSource };
}

function assertTopLevelTempo(call: LocatedCall): void {
  const ancestors = call.ancestors;
  const parent = ancestors[ancestors.length - 2];
  const grandparent = ancestors[ancestors.length - 3];
  if (
    parent?.type !== 'ExpressionStatement'
    || grandparent?.type !== 'Program'
  ) {
    throw new RenderTimingError(
      'DYNAMIC_TEMPO',
      `${call.node.callee.name}() must be one unconditional top-level statement`,
    );
  }
}

function assertStaticExecutionContext(
  call: LocatedCall,
  label: string,
): void {
  const dynamic = call.ancestors
    .slice(0, -1)
    .find((ancestor) => DYNAMIC_EXECUTION_ANCESTORS.has(ancestor.type));
  if (dynamic) {
    throw new RenderTimingError(
      'DYNAMIC_ARRANGE',
      `${label}() appears inside ${dynamic.type}; capture duration cannot be determined statically`,
    );
  }
}

function staticNumber(node: any, label: string): number {
  if (node?.type === 'Literal' && typeof node.value === 'number') {
    return node.value;
  }
  if (
    node?.type === 'UnaryExpression'
    && (node.operator === '+' || node.operator === '-')
  ) {
    const value = staticNumber(node.argument, label);
    return node.operator === '-' ? -value : value;
  }
  if (
    node?.type === 'BinaryExpression'
    && ['+', '-', '*', '/'].includes(node.operator)
  ) {
    const left = staticNumber(node.left, label);
    const right = staticNumber(node.right, label);
    switch (node.operator) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      default: break;
    }
  }
  throw new RenderTimingError(
    label === 'tempo' ? 'DYNAMIC_TEMPO' : 'DYNAMIC_ARRANGE',
    `${label} must use only numeric literals and +, -, *, / arithmetic`,
  );
}

function positiveOption(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RenderTimingError(
      'INVALID_TIMING_DEFAULT',
      `${label} must be finite and greater than zero`,
    );
  }
  return value;
}
