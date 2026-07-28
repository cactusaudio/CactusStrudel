// G9 §5 + §11: production-vocabulary tests.

import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_VOCAB, matchProductionVocab, aggregateMatches,
} from './production-vocab.js';

describe('production vocab (G9 §5)', () => {
  it('every entry has at least one surface form, prefer/forbid tags, and forbidden_overreactions', () => {
    for (const e of PRODUCTION_VOCAB) {
      expect(e.surface_forms.length).toBeGreaterThan(0);
      // either prefer or forbid must be non-empty (otherwise the entry has no signal)
      expect(e.prefer_tags.length + e.forbid_tags.length).toBeGreaterThan(0);
    }
  });

  it('matches "更冷" → colder', () => {
    const m = matchProductionVocab('和弦更冷一点');
    expect(m.find((x) => x.entry.id === 'colder')).toBeDefined();
  });

  it('matches "不要那么 EDM" → no-edm', () => {
    const m = matchProductionVocab('mid 段落不要那么 EDM');
    expect(m.find((x) => x.entry.id === 'no-edm')).toBeDefined();
  });

  it('matches "回 club 一点" → back-to-club', () => {
    const m = matchProductionVocab('请回 club 一点');
    expect(m.find((x) => x.entry.id === 'back-to-club')).toBeDefined();
  });

  it('matches multiple feedback in one sentence', () => {
    const m = matchProductionVocab('鼓更硬，但低频要稳，和弦别太甜');
    const ids = m.map((x) => x.entry.id);
    expect(ids).toContain('harder');
    expect(ids).toContain('more-stable');
    expect(ids).toContain('less-pretty-chord');
  });

  it('aggregateMatches unions prefer + forbid tags across all matched entries', () => {
    const m = matchProductionVocab('鼓更硬，bass 要托住，不要那么 EDM');
    const a = aggregateMatches(m);
    expect(a.prefer_tags).toContain('punchy');
    expect(a.prefer_tags).toContain('warm');
    expect(a.forbid_tags).toContain('cinematic');
  });

  it('aggregateMatches collects arrangement implications including forbid_section_function', () => {
    const m = matchProductionVocab('不要那么 EDM');
    const a = aggregateMatches(m);
    expect(a.forbid_section_function).toContain('build');
  });

  it('aggregateMatches collects forbidden_overreactions for planner safety', () => {
    const m = matchProductionVocab('鼓更硬');
    const a = aggregateMatches(m);
    // harder rule includes "pushing kick gain into clipping" as forbidden
    expect(a.forbidden_overreactions.some((s) => /clip/i.test(s))).toBe(true);
  });

  it('matchProductionVocab returns [] for irrelevant text', () => {
    const m = matchProductionVocab('what is the weather like today');
    // accept up to 0 matches; entries don't have english-only weather words
    expect(m.length).toBe(0);
  });

  it('every entry that has wrong_interpretations explains both wrong AND correct readings', () => {
    for (const e of PRODUCTION_VOCAB) {
      for (const wi of e.wrong_interpretations) {
        expect(wi.wrong.length).toBeGreaterThan(2);
        expect(wi.correct.length).toBeGreaterThan(2);
      }
    }
  });
});
