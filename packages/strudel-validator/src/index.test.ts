import { describe, it, expect } from 'vitest';
import {
  validateMiniNotation,
  validateStrudelCode,
  STRUDEL_FUNCTIONS,
  SINGLE_USE_EFFECTS,
  isStrudelFunction,
} from './index.js';

describe('registry', () => {
  it('contains the canonical names from extracted Strudel sources', () => {
    for (const fn of ['s', 'note', 'gain', 'lpf', 'cutoff', 'jux', 'every', 'slow', 'fast', 'stack', 'cat']) {
      expect(isStrudelFunction(fn), `${fn} should be in registry`).toBe(true);
    }
    expect(STRUDEL_FUNCTIONS.size).toBeGreaterThan(400);
  });

  it('marks lpf/hpf/bpf as single-use effects', () => {
    expect(SINGLE_USE_EFFECTS.has('lpf')).toBe(true);
    expect(SINGLE_USE_EFFECTS.has('hpf')).toBe(true);
    expect(SINGLE_USE_EFFECTS.has('every')).toBe(false);
  });
});

describe('validateMiniNotation', () => {
  it('accepts a basic kick pattern', () => {
    expect(validateMiniNotation('bd ~ ~ ~ bd ~ ~ ~').ok).toBe(true);
  });
  it('accepts repeats', () => {
    expect(validateMiniNotation('bd*4').ok).toBe(true);
  });
  it('accepts groups + alternation + euclid', () => {
    expect(validateMiniNotation('[bd sn]*2').ok).toBe(true);
    expect(validateMiniNotation('<a3 c4 e4>').ok).toBe(true);
    expect(validateMiniNotation('bd(3, 8)').ok).toBe(true);
  });
  it('catches unbalanced brackets', () => {
    const r = validateMiniNotation('[bd sn');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'UNCLOSED_OPEN')).toBe(true);
  });
  it('catches unmatched closer', () => {
    const r = validateMiniNotation('bd]');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'UNMATCHED_CLOSE')).toBe(true);
  });
  it('catches mismatched brackets', () => {
    const r = validateMiniNotation('[bd sn>');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'MISMATCHED_BRACKET')).toBe(true);
  });
  it('catches operator without operand', () => {
    const r = validateMiniNotation('*4 bd');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'OPERATOR_WITHOUT_OPERAND')).toBe(true);
  });
  it('catches operator without number', () => {
    const r = validateMiniNotation('bd*');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'OPERATOR_NEEDS_NUMBER')).toBe(true);
  });
});

describe('validateStrudelCode', () => {
  it('accepts a basic stack', () => {
    const r = validateStrudelCode("stack(s('bd*4'), s('hh*8').gain(0.7))");
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('accepts a complex chain with method calls', () => {
    const code = `s("bd*4").every(2, fast(2)).lpf(800).gain(0.9).room(0.3)`;
    expect(validateStrudelCode(code).ok).toBe(true);
  });

  it('flags hallucinated function reverb()', () => {
    const r = validateStrudelCode(`s("bd*4").reverb(0.5)`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'UNKNOWN_METHOD' && i.message.includes('reverb'))).toBe(true);
  });

  it('flags duplicate lpf in same chain', () => {
    const r = validateStrudelCode(`s("bd*4").lpf(800).distort(0.4).lpf(800)`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'DUPLICATE_SINGLE_USE_EFFECT' && i.message.includes('lpf'))).toBe(true);
  });

  it('catches setcps with non-positive value', () => {
    const r = validateStrudelCode('setcps(0)');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'BAD_CPS')).toBe(true);
  });

  it('catches setBpm wildly out of range', () => {
    const r = validateStrudelCode('setBpm(9999)');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'BAD_BPM')).toBe(true);
  });

  it('catches JS parse error', () => {
    const r = validateStrudelCode('s("bd"');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'JS_PARSE_ERROR')).toBe(true);
  });

  it('emits did-you-mean for near-miss method names', () => {
    const r = validateStrudelCode(`s("bd").gainn(0.5)`);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.code === 'UNKNOWN_METHOD');
    expect(issue?.hint).toMatch(/did you mean/);
  });

  it('does not flag fast/slow used as both standalone and method', () => {
    const r = validateStrudelCode(`fast(2, s("bd*4")).slow(2)`);
    expect(r.ok).toBe(true);
  });
});
