# Critic

## Inputs

- `SessionGraph` (the canonical artifact).
- `AnalyzerFeatures` from `@cactus/analyzer`.
- Genre spec from `@cactus/genres` (loaded by `brief.primary_genre`).

## Outputs

`CritiqueEntry` containing:

```
ScoreVector { 9 axes 0..1 }
CritiqueTarget[] { graph_paths, severity, evidence (numeric), revision_instruction }
```

## Score axes

| Axis | Source |
|---|---|
| `technical_validity` | true peak ≤ -0.1 dB, layers > 0, sections > 0 |
| `genre_fit` | BPM in genre.bpm_range; mono_low_compliance vs genre min |
| `groove` | grid_regularity centered at 0.85 (0.6 for IDM) |
| `arrangement_arc` | energy_curve range (max − min) |
| `sound_design` | spectral flatness ≈ 0.12 sweet spot; layer count |
| `mix_translation` | LUFS proximity to genre target; true peak penalty |
| `memorability_hook` | chord/lead activity in drop sections |
| `originality` | (Phase 9+: embedding distance from cookbook) — 0.5 default |
| `user_taste_fit` | preference_graph weighted hits — 0 by default |

## Revision target generators

- LUFS off-target (> 2 LU) → `producer-mix-engineer` patches `/mix_graph/master/gain`.
- True peak > -0.5 dBTP → `producer-mix-engineer` reduces `/mix_graph/master/gain`.
- mono_low_compliance below genre min → mix-engineer narrows orbit width on bass/sub.
- High-band onset density outside range → `producer-composer` swaps hat pattern.
- Drop − intro energy < 0.25 → `producer-arranger` bumps section energies.

## Hard contract

Every `CritiqueTarget` must:
- have ≥ 1 `graph_paths` entry,
- have numeric `evidence` keys (at least one quantity from AnalyzerFeatures),
- have a `revision_instruction` an agent can act on.

Prose-only critique without numeric evidence is rejected by the schema (`CritiqueTargetSchema` requires both).
