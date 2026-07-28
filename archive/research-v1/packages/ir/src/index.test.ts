import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  SessionGraphSchema,
  createSessionGraph,
  applyPatch,
  getByPointer,
  isAgentAllowedToWrite,
} from './index.js';

describe('createSessionGraph', () => {
  it('returns a graph that validates against SessionGraphSchema', () => {
    const g = createSessionGraph({ brief: { text: 'dark dub techno 132 bpm' } });
    expect(g.schema_version).toBe(SCHEMA_VERSION);
    expect(SessionGraphSchema.safeParse(g).success).toBe(true);
  });

  it('preserves user-provided brief fields', () => {
    const g = createSessionGraph({
      brief: { text: 'foo', bpm: 174, primary_genre: 'dnb' },
    });
    expect(g.brief.bpm).toBe(174);
    expect(g.brief.primary_genre).toBe('dnb');
  });

  it('produces 3 default sections covering total_bars', () => {
    const g = createSessionGraph({ brief: { text: 'x' } });
    expect(g.song.sections.length).toBe(3);
    expect(g.song.sections[0]!.start_bar).toBe(0);
    expect(g.song.sections.at(-1)!.end_bar).toBe(g.song.total_bars);
  });
});

describe('SessionGraphSchema validation', () => {
  it('rejects missing schema_version', () => {
    const bad: Record<string, unknown> = {
      session_id: '00000000-0000-4000-8000-000000000000',
      brief: { text: 'x', mood: [], references: [], modifiers: [], constraints: {} },
    };
    expect(SessionGraphSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects bpm out of range', () => {
    expect(() =>
      createSessionGraph({ brief: { text: 'x', bpm: 9999 } as never }),
    ).toThrow();
  });

  it('rejects section with end_bar <= start_bar', () => {
    const g = createSessionGraph({ brief: { text: 'x' } });
    g.song.sections[0]!.end_bar = g.song.sections[0]!.start_bar;
    expect(SessionGraphSchema.safeParse(g).success).toBe(false);
  });

  it('rejects unknown top-level IR fields instead of silently dropping them', () => {
    const g = createSessionGraph({ brief: { text: 'x' } }) as Record<string, unknown>;
    g.unmodeled_future_field = { should_not_disappear: true };
    const parsed = SessionGraphSchema.safeParse(g);
    expect(parsed.success).toBe(false);
  });
});

describe('json-pointer + applyPatch', () => {
  it('reads nested value', () => {
    const g = createSessionGraph({ brief: { text: 'hello' } });
    expect(getByPointer(g, '/brief/text')).toBe('hello');
  });

  it('replaces a primitive', () => {
    const g = createSessionGraph({ brief: { text: 'hello' } });
    const next = applyPatch(g, [{ op: 'replace', path: '/brief/text', value: 'goodbye' }]);
    expect(next.brief.text).toBe('goodbye');
    expect(g.brief.text).toBe('hello'); // immutable
  });

  it('copies only the patched branch, preserving untouched references', () => {
    const g = createSessionGraph({ brief: { text: 'hello' } });
    const next = applyPatch(g, [{ op: 'replace', path: '/brief/text', value: 'goodbye' }]);
    expect(next).not.toBe(g);
    expect(next.brief).not.toBe(g.brief);
    expect(next.song).toBe(g.song);
    expect(next.layers).toBe(g.layers);
  });

  it('appends to an array via -', () => {
    const g = createSessionGraph({ brief: { text: 'x' } });
    const next = applyPatch(g, [
      {
        op: 'add',
        path: '/brief/mood/-',
        value: 'haunted',
      },
    ]);
    expect(next.brief.mood).toEqual(['haunted']);
  });

  it('rejects prototype-pollution paths', () => {
    expect(() => applyPatch({}, [{ op: 'add', path: '/__proto__/polluted', value: true }])).toThrow(/forbidden prototype token/);
    expect(() => applyPatch({ song: {} }, [{ op: 'add', path: '/song/constructor/prototype/polluted', value: true }])).toThrow(/forbidden prototype token/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('validates array indices using RFC-6902 bounds', () => {
    expect(() => applyPatch({ list: [1, 2] }, [{ op: 'replace', path: '/list/-1', value: 9 }])).toThrow(/Invalid array index/);
    expect(() => applyPatch({ list: [1, 2] }, [{ op: 'replace', path: '/list/-', value: 9 }])).toThrow(/only valid for add/);
    expect(() => applyPatch({ list: [1, 2] }, [{ op: 'add', path: '/list/3', value: 9 }])).toThrow(/out of bounds/);
  });
});

describe('agent write boundaries', () => {
  it('allows composer on /pattern_bank/', () => {
    expect(isAgentAllowedToWrite('producer-composer', '/pattern_bank/patterns/kick/main')).toBe(true);
  });
  it('forbids composer on /mix_graph/', () => {
    expect(isAgentAllowedToWrite('producer-composer', '/mix_graph/orbits/0')).toBe(false);
  });
  it('forbids unknown agent', () => {
    expect(isAgentAllowedToWrite('rogue-agent', '/brief/text')).toBe(false);
  });
});
