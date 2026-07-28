// G3: Chinese / mixed feedback parsing fixtures, including the exact phrases
// the dispatch listed as required support.

import { describe, it, expect } from 'vitest';
import { parseFeedback } from './feedback.js';

describe('parseFeedback — Chinese / mixed (G3)', () => {
  it('"鼓更碎，但低频要稳" emits chopped-drums-stable-low target', () => {
    const f = parseFeedback('鼓更碎，但低频要稳');
    expect(f.language).toBe('zh');
    expect(f.synthetic_targets.find((t) => t.target_id.includes('broken-drums-stable-low'))).toBeDefined();
    expect(f.attribute_preferences.chopped_drums_stable_low).toBeGreaterThan(0);
  });

  it('"不要那么 EDM" emits no-edm target with energy ceiling', () => {
    const f = parseFeedback('不要那么 EDM');
    expect(f.language).toBe('mixed');
    const t = f.synthetic_targets.find((x) => x.target_id.includes('no-edm'));
    expect(t).toBeDefined();
    expect(t!.intended_movement.max_energy).toBe(0.85);
  });

  it('"更空，但不要变成没东西" emits more-space-not-empty target', () => {
    const f = parseFeedback('更空，但不要变成没东西');
    const t = f.synthetic_targets.find((x) => x.target_id.includes('more-space-not-empty'));
    expect(t).toBeDefined();
    expect(t!.graph_paths).toContain('/mix_graph/orbits');
  });

  it('"hat 刺耳，低频糊" emits hat-harsh + low-mid-mud targets', () => {
    const f = parseFeedback('hat 刺耳，低频糊');
    expect(f.synthetic_targets.find((t) => t.target_id.includes('hat-harsh'))).toBeDefined();
    expect(f.synthetic_targets.find((t) => t.target_id.includes('low-mid-mud'))).toBeDefined();
  });

  it('"breakdown 短一点，回 club 一点" emits breakdown-shorter + back-to-club', () => {
    const f = parseFeedback('breakdown 短一点，回 club 一点');
    expect(f.synthetic_targets.find((t) => t.target_id.includes('breakdown-shorter'))).toBeDefined();
    expect(f.synthetic_targets.find((t) => t.target_id.includes('back-to-club'))).toBeDefined();
  });

  it('"和弦别太甜" emits chord-less-pretty target', () => {
    const f = parseFeedback('和弦别太甜');
    const t = f.synthetic_targets.find((x) => x.target_id.includes('chord-less-pretty'));
    expect(t).toBeDefined();
    expect(t!.intended_movement.chord_orbit_gain_db).toBe(-3);
  });

  it('"底鼓更硬" emits kick-harder target with +2 dB delta', () => {
    const f = parseFeedback('底鼓更硬');
    const t = f.synthetic_targets.find((x) => x.target_id.includes('kick-harder'));
    expect(t).toBeDefined();
    expect(t!.intended_movement.kick_orbit_gain_db).toBe(+2);
    expect(t!.graph_paths).toEqual(['/mix_graph/orbits/0/gain']);
  });

  it('feedback that does not mention BPM/genre/key adds them as invariants', () => {
    const f = parseFeedback('鼓更硬');
    const paths = f.invariants.map((i) => i.path);
    expect(paths).toContain('/brief/bpm');
    expect(paths).toContain('/brief/primary_genre');
    expect(paths).toContain('/brief/key');
  });

  it('feedback mentioning tempo does NOT add BPM as invariant', () => {
    const f = parseFeedback('改成 140 BPM');
    const paths = f.invariants.map((i) => i.path);
    expect(paths).not.toContain('/brief/bpm');
  });

  it('feedback that mentions key (大调/小调) does NOT add key as invariant', () => {
    const f = parseFeedback('换到 D 小调');
    const paths = f.invariants.map((i) => i.path);
    expect(paths).not.toContain('/brief/key');
  });

  it('mixed-language feedback labeled as "mixed"', () => {
    const f = parseFeedback('kick 更硬，bass stable');
    expect(f.language).toBe('mixed');
    expect(f.synthetic_targets.find((t) => t.target_id.includes('kick-harder'))).toBeDefined();
    expect(f.synthetic_targets.find((t) => t.target_id.includes('bass-stable'))).toBeDefined();
  });

  it('English-only feedback labeled as "en"', () => {
    const f = parseFeedback('hat is too harsh, low-mid is muddy');
    expect(f.language).toBe('en');
    expect(f.synthetic_targets.length).toBeGreaterThan(0);
  });
});
