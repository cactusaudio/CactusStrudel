import { describe, it, expect } from 'vitest';
import {
  validateMiniNotation,
  validateStrudelCode,
  STRUDEL_FUNCTIONS,
  isStrudelFunction,
} from './index.js';

describe('registry', () => {
  it('contains the canonical names from extracted Strudel sources', () => {
    for (const fn of ['s', 'note', 'gain', 'lpf', 'cutoff', 'jux', 'every', 'slow', 'fast', 'stack', 'cat']) {
      expect(isStrudelFunction(fn), `${fn} should be in registry`).toBe(true);
    }
    expect(STRUDEL_FUNCTIONS.size).toBeGreaterThan(400);
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
    expect(validateMiniNotation('<g#3 c#4 f#4>').ok).toBe(true);
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

  it('validates mini-notation literals inside Strudel calls', () => {
    const r = validateStrudelCode('stack(s("[bd sn"), note("<g#3 c#4 f#4>"))');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'MINI_UNCLOSED_OPEN')).toBe(true);
  });

  it('accepts a complex chain with method calls', () => {
    const code = `s("bd*4").every(2, fast(2)).lpf(800).gain(0.9).room(0.3)`;
    expect(validateStrudelCode(code).ok).toBe(true);
  });

  it('accepts the installed core Pattern.mask method', () => {
    const code = `stack(s("bd*4"), note("c3 eb3 g3").mask("<1 0 1 1>"))`;
    expect(validateStrudelCode(code).ok).toBe(true);
  });

  it('flags hallucinated function reverb()', () => {
    const r = validateStrudelCode(`s("bd*4").reverb(0.5)`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'UNKNOWN_METHOD' && i.message.includes('reverb'))).toBe(true);
  });

  it('accepts repeated effects as a creative chain', () => {
    const r = validateStrudelCode(`s("bd*4").lpf(800).distort(0.4).lpf(800)`);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('catches setcps with non-positive value', () => {
    const r = validateStrudelCode('setcps(0)');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'BAD_CPS')).toBe(true);
  });

  it('accepts setcpm as the runtime tempo helper', () => {
    const r = validateStrudelCode('setcpm(120/4)\ns("bd*4")');
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('accepts an unconventional positive BPM', () => {
    const r = validateStrudelCode('setBpm(9999)');
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
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

  it('tracks local aliases to Strudel functions', () => {
    const r = validateStrudelCode(`const drums = s; const hats = drums; stack(hats("hh*8"), drums("bd*4"))`);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it('checks computed string-literal method names', () => {
    const ok = validateStrudelCode(`s("bd*4")["lpf"](800)`);
    expect(ok.ok, JSON.stringify(ok.issues)).toBe(true);

    const bad = validateStrudelCode(`s("bd*4")["reverb"](0.8)`);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === 'UNKNOWN_METHOD' && i.message.includes('reverb'))).toBe(true);
  });
});
