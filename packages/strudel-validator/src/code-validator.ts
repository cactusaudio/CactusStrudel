import * as acorn from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import type { ValidationIssue, ValidationResult } from './types.js';
import { STRUDEL_FUNCTIONS, SINGLE_USE_EFFECTS } from './registry.js';
import { validateMiniNotation } from './mini-notation.js';

export interface CodeValidatorOptions {
  allowJsGlobals?: boolean; // Math, parseFloat, Number, Boolean, Array, etc.
  extraFunctions?: ReadonlySet<string>;
}

const JS_GLOBALS = new Set([
  'Math','Number','Boolean','Array','Object','String','JSON','console','parseFloat','parseInt',
  'Map','Set','isNaN','isFinite','undefined','NaN','Infinity','Symbol','Date',
]);
const MINI_NOTATION_CALLS = new Set(['s', 'note', 'n', 'struct', 'mask', 'arp']);
const MERGED_ALLOWED_CACHE = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

export function validateStrudelCode(code: string, options: CodeValidatorOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const allowed = getAllowedFunctions(options.extraFunctions);

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    // acorn throws a SyntaxError at runtime but does not export the type.
    // Use a structural shape that matches the runtime fields we read.
    const err = e as Error & { pos?: number; loc?: { offset?: number } };
    issues.push({
      code: 'JS_PARSE_ERROR',
      message: `cannot parse JS: ${err.message}`,
      span: { start: err.pos ?? 0, end: (err.pos ?? 0) + 1 },
    });
    return { ok: false, issues };
  }

  const localFunctionAliases = collectLocalFunctionAliases(ast, allowed);

  // 1. Walk identifiers used in CallExpression callee positions and member expressions.
  walkSimple(ast, {
    CallExpression(node: any) {
      const callee = node.callee;
      if (callee.type === 'Identifier') {
        const name = callee.name as string;
        if (allowed.has(name) || localFunctionAliases.has(name)) return;
        if (options.allowJsGlobals && JS_GLOBALS.has(name)) return;
        issues.push({
          code: 'UNKNOWN_FUNCTION',
          message: `unknown function "${name}" — not in Strudel registry or core constructs`,
          span: { start: callee.start, end: callee.end },
          hint: didYouMean(name, allowed),
        });
      } else if (callee.type === 'MemberExpression') {
        const name = memberPropertyName(callee);
        if (!name) return;
        if (!allowed.has(name)) {
          issues.push({
            code: 'UNKNOWN_METHOD',
            message: `unknown Pattern method ".${name}(...)" — not in Strudel registry`,
            span: { start: callee.property.start, end: callee.property.end },
            hint: didYouMean(name, allowed),
          });
        }
      }
    },
  });

  // 2. Detect duplicate single-use effects in the same chain.
  detectChainDuplicates(ast, issues);

  // 3. Validate string mini-notation at the call sites that actually carry it.
  validateMiniNotationLiterals(ast, issues);

  // 4. Tempo / cycle sanity.
  walkSimple(ast, {
    CallExpression(node: any) {
      const callee = node.callee;
      const calleeName =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
            ? callee.property.name
            : null;
      if (!calleeName) return;
      if (calleeName === 'setcps' || calleeName === 'cps') {
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal' && typeof arg.value === 'number' && arg.value <= 0) {
          issues.push({
            code: 'BAD_CPS',
            message: `${calleeName}(${arg.value}) is invalid — cps must be > 0`,
            span: { start: arg.start, end: arg.end },
          });
        }
      }
      if (calleeName === 'setBpm' || calleeName === 'setbpm') {
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal' && typeof arg.value === 'number' && (arg.value < 30 || arg.value > 300)) {
          issues.push({
            code: 'BAD_BPM',
            message: `${calleeName}(${arg.value}) outside reasonable range 30..300`,
            span: { start: arg.start, end: arg.end },
            hint: 'check whether you meant cps (setcps) instead of bpm',
          });
        }
      }
    },
  });

  return { ok: issues.length === 0, issues };
}

function getAllowedFunctions(extraFunctions?: ReadonlySet<string>): ReadonlySet<string> {
  if (!extraFunctions || extraFunctions.size === 0) return STRUDEL_FUNCTIONS;
  const cached = MERGED_ALLOWED_CACHE.get(extraFunctions);
  if (cached) return cached;
  const merged = new Set<string>([...STRUDEL_FUNCTIONS, ...extraFunctions]);
  MERGED_ALLOWED_CACHE.set(extraFunctions, merged);
  return merged;
}

function collectLocalFunctionAliases(root: acorn.Node, allowed: ReadonlySet<string>): Set<string> {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    walkSimple(root, {
      VariableDeclarator(node: any) {
        if (node.id?.type !== 'Identifier' || node.init?.type !== 'Identifier') return;
        const from = node.init.name as string;
        if (allowed.has(from) || aliases.has(from)) {
          const before = aliases.size;
          aliases.add(node.id.name as string);
          changed ||= aliases.size !== before;
        }
      },
      AssignmentExpression(node: any) {
        if (node.left?.type !== 'Identifier' || node.right?.type !== 'Identifier') return;
        const from = node.right.name as string;
        if (allowed.has(from) || aliases.has(from)) {
          const before = aliases.size;
          aliases.add(node.left.name as string);
          changed ||= aliases.size !== before;
        }
      },
    });
  }
  return aliases;
}

function memberPropertyName(callee: any): string | undefined {
  if (!callee.computed && callee.property.type === 'Identifier') return callee.property.name as string;
  if (callee.computed && callee.property.type === 'Literal' && typeof callee.property.value === 'string') return callee.property.value;
  return undefined;
}

function validateMiniNotationLiterals(root: acorn.Node, issues: ValidationIssue[]): void {
  walkSimple(root, {
    CallExpression(node: any) {
      const callee = node.callee;
      const calleeName =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression'
            ? memberPropertyName(callee)
            : null;
      if (!calleeName || !MINI_NOTATION_CALLS.has(calleeName)) return;
      const arg = node.arguments[0];
      if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return;
      const r = validateMiniNotation(arg.value);
      if (r.ok) return;
      for (const issue of r.issues) {
        issues.push({
          code: `MINI_${issue.code}`,
          message: `${calleeName}(...) mini-notation error: ${issue.message}`,
          span: issue.span
            ? { start: arg.start + 1 + issue.span.start, end: arg.start + 1 + issue.span.end }
            : { start: arg.start, end: arg.end },
          hint: issue.hint,
        });
      }
    },
  });
}

function detectChainDuplicates(root: acorn.Node, issues: ValidationIssue[]): void {
  // Walk every "leaf" CallExpression and walk back along callee MemberExpression chains
  // to collect names. If a SINGLE_USE_EFFECTS name appears twice in a chain → flag.
  const seenChains = new WeakSet<object>();

  walkSimple(root, {
    CallExpression(node: any) {
      // start only from the outermost call in a chain
      if (seenChains.has(node)) return;
      const chain = collectChain(node, seenChains);
      const counts = new Map<string, number>();
      for (const name of chain.methodNames) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      for (const [name, count] of counts) {
        if (count >= 2 && SINGLE_USE_EFFECTS.has(name)) {
          issues.push({
            code: 'DUPLICATE_SINGLE_USE_EFFECT',
            message: `effect ".${name}(...)" used ${count} times in the same chain — likely a mental-model error`,
            span: { start: chain.span.start, end: chain.span.end },
            hint: `if you need a different "${name}" value over time, use modulation (slow/sine) on a single ${name} call`,
          });
        }
      }
    },
  });
}

interface ChainInfo {
  methodNames: string[];
  span: { start: number; end: number };
}

function collectChain(node: any, visited: WeakSet<object>): ChainInfo {
  visited.add(node);
  const names: string[] = [];
  let span = { start: node.start, end: node.end };
  let cur: any = node;
  while (cur && cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression') {
    if (cur.callee.property.type === 'Identifier') {
      names.push(cur.callee.property.name as string);
    }
    visited.add(cur);
    cur = cur.callee.object;
    if (cur) span = { start: Math.min(span.start, cur.start), end: span.end };
  }
  return { methodNames: names, span };
}

function didYouMean(name: string, allowed: ReadonlySet<string>): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const candidate of allowed) {
    const d = levenshtein(name, candidate);
    if (d < bestDist && d <= 2) {
      best = candidate;
      bestDist = d;
    }
  }
  return best ? `did you mean "${best}"?` : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}
