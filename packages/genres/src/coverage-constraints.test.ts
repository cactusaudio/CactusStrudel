import { describe, it, expect } from 'vitest';
import { getCoverageConstraints } from './coverage-constraints.js';

describe('getCoverageConstraints', () => {
  it('returns techno constraints with kick mandatory in intro', () => {
    const c = getCoverageConstraints('techno');
    expect(c.per_function.intro?.mandatory).toContain('kick');
  });

  it('returns ambient constraints that forbid kick', () => {
    const c = getCoverageConstraints('ambient');
    expect(c.per_function.intro?.forbidden).toContain('kick');
  });

  it('returns dnb constraints that mandate snare in main', () => {
    const c = getCoverageConstraints('dnb');
    expect(c.per_function.main?.mandatory).toContain('snare');
  });

  it('falls back to techno for unknown genre', () => {
    const c = getCoverageConstraints('not_a_genre');
    expect(c.per_function.intro?.mandatory).toContain('kick');
  });
});
