---
description: Genre archetype cookbook for electronic music — drum/bass/harmonic patterns, mix targets, BPM ranges. Load when generating per-genre patterns or when a brief specifies a genre. Pulls from packages/genres and cookbook/.
---

# Electronic genre cookbook

Genre data lives at `packages/genres/<slug>.yaml`. Validated snippets live at `cookbook/<genre>/<role>/snippets.jsonl`.

## Available genres (Phase 6 seed list)

`techno`, `dub_techno`, `house`, `deep_house`, `electro`, `acid`, `trance`, `idm`, `ambient`, `drone`, `jungle`, `dnb`, `footwork`, `juke`, `breakcore`, `dubstep`, `garage`, `glitch`, `lo_fi_house`, `melodic_techno`.

## Genre spec shape

```yaml
slug: dub_techno
display_name: Dub techno
bpm_range: [120, 130]
section_template:
  - { name: intro,      function: intro,    length_bars: 16 }
  - { name: drop_a,     function: drop,     length_bars: 32 }
  - { name: breakdown,  function: breakdown, length_bars: 16 }
  - { name: drop_b,     function: drop,     length_bars: 32 }
  - { name: outro,      function: outro,    length_bars: 16 }
drum_archetypes: ['steady-4-on-floor', 'reverb-dub-stab', 'shuffled-hat']
bass_archetypes: ['low-sub-quarter-note', 'dub-bass-offbeat']
harmonic_palette:
  modes: [minor, dorian, aeolian]
  typical_chord_progressions: [['i', 'VI', 'III', 'VII']]
mix_targets:
  lufs: -10
  true_peak_max: -1
critic_rubric_hints:
  - 'reverb tail must not muddy 200-500 Hz'
  - 'kick should not duck the chord stab inaudibly'
```

## Snippet format (cookbook JSONL)

One JSON object per line:

```json
{"id": "dt-kick-001", "genre": "dub_techno", "role": "kick", "mini_notation": "bd ~ ~ ~", "tags": ["4-on-floor", "minimal"], "bpm_range": [120, 130]}
```

## Genre bridging

If brief asks for "dub techno × jungle", the planner can blend:
- BPM: midpoint, biased toward primary genre
- Drum archetype: jungle breaks at lower velocity, dub-techno chord stab on top
- Mix target: average LUFS of both, take stricter true_peak_max

The bridging logic lives in `packages/genres/src/bridge.ts`.

## Files

- `archetypes.md` — drum/bass/harmonic archetypes with mini-notation seeds.
- `mix-targets.md` — LUFS / true peak / spectral target by genre.
- `bridging.md` — how to combine genres without losing identity.
