// Mini-notation validator. Not a full parser — it tokenizes, then checks
// bracket balance, operator placement, and a few well-known malformed shapes.
// Strudel itself is permissive; we mirror that and only flag clear errors.

import type { ValidationIssue, ValidationResult } from './types.js';

const BRACKET_PAIRS: Record<string, string> = { '[': ']', '<': '>', '{': '}', '(': ')' };
const OPENERS = new Set(Object.keys(BRACKET_PAIRS));
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));

const TOKEN_RE = /[a-zA-Z_][a-zA-Z0-9_#]*(?::[a-zA-Z0-9_#]+)*|[0-9]+(?:\.[0-9]+)?|~|\*|\/|@|\?|!|\||,|[\[\]<>{}()]|\s+|./g;

export interface MiniToken {
  text: string;
  start: number;
  end: number;
  kind: 'word' | 'number' | 'rest' | 'op' | 'open' | 'close' | 'choice' | 'comma' | 'space' | 'unknown';
}

export function tokenizeMini(input: string): MiniToken[] {
  const out: MiniToken[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    const t = m[0];
    let kind: MiniToken['kind'] = 'unknown';
    if (/^\s+$/.test(t)) kind = 'space';
    else if (t === '~') kind = 'rest';
    else if (t === '|') kind = 'choice';
    else if (t === ',') kind = 'comma';
    else if (OPENERS.has(t)) kind = 'open';
    else if (CLOSERS.has(t)) kind = 'close';
    else if (/^[0-9]+(\.[0-9]+)?$/.test(t)) kind = 'number';
    else if (/^[a-zA-Z_]/.test(t)) kind = 'word';
    else if (/^[*/@?!]$/.test(t)) kind = 'op';
    out.push({ text: t, start: m.index, end: m.index + t.length, kind });
  }
  return out;
}

export function validateMiniNotation(input: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const tokens = tokenizeMini(input).filter((t) => t.kind !== 'space');

  if (tokens.length === 0) {
    return { ok: true, issues };
  }

  // 1. bracket balance
  const stack: { token: string; idx: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'open') {
      stack.push({ token: t.text, idx: i });
    } else if (t.kind === 'close') {
      const top = stack.pop();
      if (!top) {
        issues.push({ code: 'UNMATCHED_CLOSE', message: `unmatched ${t.text}`, span: { start: t.start, end: t.end } });
      } else if (BRACKET_PAIRS[top.token] !== t.text) {
        issues.push({
          code: 'MISMATCHED_BRACKET',
          message: `expected ${BRACKET_PAIRS[top.token]} but got ${t.text}`,
          span: { start: t.start, end: t.end },
        });
      }
    }
  }
  for (const s of stack) {
    issues.push({ code: 'UNCLOSED_OPEN', message: `unclosed ${s.token}`, span: { start: tokens[s.idx]!.start, end: tokens[s.idx]!.end } });
  }

  // 2. unknown chars (other than allowed punctuation)
  for (const t of tokens) {
    if (t.kind === 'unknown') {
      issues.push({ code: 'UNKNOWN_CHAR', message: `unrecognized token "${t.text}"`, span: { start: t.start, end: t.end } });
    }
  }

  // 3. operators must follow an atom (word/number/rest/close)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'op') continue;
    const prev = tokens[i - 1];
    const ok = prev && (prev.kind === 'word' || prev.kind === 'number' || prev.kind === 'rest' || prev.kind === 'close');
    if (!ok) {
      issues.push({ code: 'OPERATOR_WITHOUT_OPERAND', message: `operator "${t.text}" without preceding atom`, span: { start: t.start, end: t.end } });
    }
    if (t.text === '*' || t.text === '/' || t.text === '@' || t.text === '!') {
      const next = tokens[i + 1];
      if (!next || next.kind !== 'number') {
        issues.push({ code: 'OPERATOR_NEEDS_NUMBER', message: `operator "${t.text}" must be followed by a number`, span: { start: t.start, end: t.end } });
      }
    }
  }

  // 4. choice ('|') must have neighbors on both sides
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'choice') continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (!prev || !next || prev.kind === 'open' || next.kind === 'close') {
      issues.push({ code: 'CHOICE_BAD_PLACEMENT', message: '"|" must have an atom on each side', span: { start: t.start, end: t.end } });
    }
  }

  return { ok: issues.length === 0, issues };
}
