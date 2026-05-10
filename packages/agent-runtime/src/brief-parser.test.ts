import { describe, it, expect } from 'vitest';
import { parseBrief } from './brief-parser.js';

describe('parseBrief — English (regression)', () => {
  it('extracts BPM, genre, mood from a dub techno brief', () => {
    const b = parseBrief('dark spacious dub techno; Burial rain texture; 132 BPM; haunted; 909 core');
    expect(b.bpm).toBe(132);
    expect(b.primary_genre).toBe('dub_techno');
    expect(b.mood).toEqual(expect.arrayContaining(['dark', 'spacious', 'haunted']));
    expect(b.references.find((r) => r.value.toLowerCase() === 'burial')).toBeDefined();
  });
});

describe('parseBrief — Chinese', () => {
  it('extracts BPM and genre from a pure-Chinese dub techno brief', () => {
    const b = parseBrief('黑暗空灵的迷雾科技舞，132 BPM，鬼魅，909核心');
    expect(b.bpm).toBe(132);
    expect(b.primary_genre).toBe('dub_techno');
    expect(b.mood).toEqual(expect.arrayContaining(['dark', 'spacious', 'haunted']));
    expect(b.modifiers).toEqual(expect.arrayContaining(['909-core']));
  });

  it('extracts Chinese BPM phrasing 速度', () => {
    const b = parseBrief('科技舞曲，速度 132，强劲');
    expect(b.bpm).toBe(132);
    expect(b.primary_genre).toBe('techno');
    expect(b.energy).toBe('high');
  });

  it('extracts Chinese BPM phrasing 拍/分', () => {
    const b = parseBrief('环境音乐，60拍/分，冥想');
    expect(b.bpm).toBe(60);
    expect(b.primary_genre).toBe('ambient');
    expect(b.energy).toBe('low');
  });

  it('extracts neurofunk modifier from Chinese', () => {
    const b = parseBrief('翻滚的神经放克鼓贝斯，174 BPM，黑暗');
    expect(b.primary_genre).toBe('dnb');
    expect(b.modifiers).toEqual(expect.arrayContaining(['neurofunk']));
    expect(b.bpm).toBe(174);
  });

  it('extracts duration in Chinese', () => {
    const b = parseBrief('巅峰科技舞，132 BPM，4 分钟');
    expect(b.duration_target_sec).toBe(240);
  });

  it('extracts Chinese key 大调/小调', () => {
    const b = parseBrief('环境氛围音乐，60拍，C小调');
    expect(b.key).toEqual({ tonic: 'C', mode: 'minor' });
  });

  it('extracts ambient drone from Chinese 漂移', () => {
    const b = parseBrief('漂移氛围 60BPM，失重');
    expect(b.primary_genre).toBe('ambient');
    expect(b.modifiers).toEqual(expect.arrayContaining(['drone']));
    expect(b.mood).toEqual(expect.arrayContaining(['weightless']));
  });
});

describe('parseBrief — mixed Chinese/English', () => {
  it('extracts genre from English even when most of brief is Chinese', () => {
    const b = parseBrief('我想要一首 dub techno，黑暗空灵，132 BPM，雨声纹理');
    expect(b.primary_genre).toBe('dub_techno');
    expect(b.bpm).toBe(132);
    expect(b.mood).toEqual(expect.arrayContaining(['dark', 'spacious']));
    expect(b.modifiers).toEqual(expect.arrayContaining(['rain-texture']));
  });

  it('handles English mood with Chinese genre', () => {
    const b = parseBrief('迷雾科技舞 130BPM, haunted and spacious, evolving chords');
    expect(b.primary_genre).toBe('dub_techno');
    expect(b.mood).toEqual(expect.arrayContaining(['haunted', 'spacious']));
    expect(b.modifiers).toEqual(expect.arrayContaining(['evolving-chords']));
  });
});

describe('parseBrief — constraints', () => {
  it('captures no-kick constraint (English)', () => {
    const b = parseBrief('ambient drone 60 BPM, no kick');
    expect(b.constraints?.no_kick).toBe(true);
  });

  it('captures no-kick constraint (Chinese)', () => {
    const b = parseBrief('环境氛围 60BPM，不要底鼓');
    expect(b.constraints?.no_kick).toBe(true);
  });

  it('captures mono-low constraint', () => {
    const b = parseBrief('dub techno 130 BPM, mono low end');
    expect(b.constraints?.mono_low).toBe(true);
  });

  it('captures no-rhythmic-grid', () => {
    const b = parseBrief('ambient drone, no rhythm, slow evolving');
    expect(b.constraints?.no_rhythmic_grid).toBe(true);
  });
});

describe('parseBrief — energy detection (regression)', () => {
  it('peak time techno → high energy', () => {
    expect(parseBrief('peak time techno 134 BPM').energy).toBe('high');
  });
  it('巅峰科技舞 → high energy', () => {
    expect(parseBrief('巅峰科技舞 134BPM').energy).toBe('high');
  });
  it('ambient drone → low energy', () => {
    expect(parseBrief('ambient drone 60 BPM').energy).toBe('low');
  });
  it('环境氛围 → low energy', () => {
    expect(parseBrief('环境氛围 60BPM').energy).toBe('low');
  });
});
