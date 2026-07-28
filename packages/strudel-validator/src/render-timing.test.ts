import { describe, expect, it } from 'vitest';
import {
  extractRenderTiming,
  RenderTimingError,
} from './render-timing.js';

describe('extractRenderTiming', () => {
  it('supports decimal and simple arithmetic tempo/arrange durations', () => {
    const timing = extractRenderTiming(`
      setcpm(123.5 / 4);
      arrange(
        [0.5, s("bd")],
        [1 / 2, s("sd")],
        [2 * 0.25, s("hh")],
      );
    `);

    expect(timing.tempoSource).toBe('setcpm');
    expect(timing.cps).toBeCloseTo(123.5 / 4 / 60, 12);
    expect(timing.durationSource).toBe('arrange');
    expect(timing.durationCycles).toBeCloseTo(1.5, 12);
  });

  it('ignores tempo and arrange text in comments and strings', () => {
    const timing = extractRenderTiming(`
      // setcps(99); arrange([999, s("noise")])
      const note = "arrange([777, x]) setcpm(2)";
      setcps(1 / 2);
      s("bd");
    `, { defaultCycles: 12 });

    expect(timing).toEqual({
      cps: 0.5,
      durationCycles: 12,
      tempoSource: 'setcps',
      durationSource: 'default',
    });
  });

  it('uses explicit defaults only when tempo or arrange is absent', () => {
    expect(extractRenderTiming('s("bd")', {
      defaultCps: 0.75,
      defaultCycles: 7.5,
    })).toEqual({
      cps: 0.75,
      durationCycles: 7.5,
      tempoSource: 'default',
      durationSource: 'default',
    });
  });

  it('fails instead of guessing a dynamic tempo', () => {
    expect(() => extractRenderTiming(`
      const bpm = 120;
      setcpm(bpm / 4);
      s("bd");
    `)).toThrowError(expect.objectContaining<Partial<RenderTimingError>>({
      code: 'DYNAMIC_TEMPO',
    }));
  });

  it('fails instead of guessing a dynamic arrange duration', () => {
    expect(() => extractRenderTiming(`
      setcpm(120 / 4);
      const bars = 4;
      arrange([bars, s("bd")]);
    `)).toThrowError(expect.objectContaining<Partial<RenderTimingError>>({
      code: 'DYNAMIC_ARRANGE',
    }));
  });

  it('fails on multiple tempo or arrange authorities', () => {
    expect(() => extractRenderTiming(`
      setcps(0.5);
      setcpm(120 / 4);
      s("bd");
    `)).toThrowError(expect.objectContaining<Partial<RenderTimingError>>({
      code: 'AMBIGUOUS_TEMPO',
    }));

    expect(() => extractRenderTiming(`
      setcps(0.5);
      stack(arrange([1, s("bd")]), arrange([2, s("sd")]));
    `)).toThrowError(expect.objectContaining<Partial<RenderTimingError>>({
      code: 'AMBIGUOUS_ARRANGE',
    }));
  });

  it('rejects tempo or arrange calls in conditional execution contexts', () => {
    expect(() => extractRenderTiming(`
      if (Math.random() > 0.5) setcps(0.5);
      s("bd");
    `)).toThrowError(expect.objectContaining<Partial<RenderTimingError>>({
      code: 'DYNAMIC_TEMPO',
    }));

    expect(() => extractRenderTiming(`
      setcps(0.5);
      const form = () => arrange([1, s("bd")]);
      form();
    `)).toThrowError(expect.objectContaining<Partial<RenderTimingError>>({
      code: 'DYNAMIC_ARRANGE',
    }));
  });
});
