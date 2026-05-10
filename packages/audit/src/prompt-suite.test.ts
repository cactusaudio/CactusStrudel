import { describe, it, expect } from 'vitest';
import { loadSuite, expandPrompts } from './index.js';

describe('loadSuite — smoke', () => {
  it('loads the smoke suite as a single PromptSuite', async () => {
    const suites = await loadSuite('smoke');
    expect(suites.length).toBe(1);
    expect(suites[0]!.prompts.length).toBeGreaterThan(0);
    expect(suites[0]!.prompts[0]!.intent_genre).toBe('techno');
  });
});

describe('loadSuite — genre-core', () => {
  it('loads all 5 genre suites', async () => {
    const suites = await loadSuite('genre-core');
    const genres = suites.map((s) => s.genre).sort();
    expect(genres).toEqual(['ambient', 'dnb', 'dub_techno', 'idm', 'techno']);
  });

  it('every genre has 10 prompts', async () => {
    const suites = await loadSuite('genre-core');
    for (const s of suites) {
      expect(s.prompts.length, `${s.genre} should have 10 prompts`).toBe(10);
    }
  });

  it('every prompt has a valid intent_class', async () => {
    const suites = await loadSuite('genre-core');
    const allowed = new Set(['canonical', 'hybrid', 'negative-constraint', 'mix-intent', 'arrangement-intent', 'revision']);
    for (const s of suites) {
      for (const p of s.prompts) {
        expect(allowed.has(p.intent_class), `${p.id} class=${p.intent_class}`).toBe(true);
      }
    }
  });

  it('contains at least one Chinese-language prompt per genre', async () => {
    const suites = await loadSuite('genre-core');
    const HAS_CHINESE = /[一-龥]/;
    for (const s of suites) {
      const cn = s.prompts.filter((p) => HAS_CHINESE.test(p.text));
      expect(cn.length, `${s.genre} should have ≥1 Chinese prompt`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('expandPrompts', () => {
  it('multiplies prompts by seed count', async () => {
    const suites = await loadSuite('smoke');
    const expanded = expandPrompts(suites, 3);
    expect(expanded.length).toBe(suites[0]!.prompts.length * 3);
    expect(expanded.map((p) => p.seed).sort()).toEqual([1, 2, 3]);
  });

  it('full genre-core × 3 seeds = 150 expanded prompts', async () => {
    const suites = await loadSuite('genre-core');
    const expanded = expandPrompts(suites, 3);
    expect(expanded.length).toBe(150);
  });
});
