---
description: Audio critic rubrics — how to interpret AnalyzerFeatures into score axes and graph-path-targeted revision targets. Load when scoring a render or producing critique targets. The contract is "every critique cites measurable evidence."
---

# Audio critic rubrics

## Scoring axes

| Axis | Maps to features |
|---|---|
| `genre_fit` | bpm vs genre.bpm_range; centroid in genre's typical band; section template match |
| `groove` | onset_density per band, grid_regularity, syncopation_proxy |
| `arrangement_arc` | per-section LUFS curve vs `song.energy_curve`; layer activation density progression |
| `sound_design` | spectral flatness range; presence of timbral identity in `sound_palette` |
| `mix_translation` | mono_low_compliance; band_rms balance; LUFS proximity to genre target; true_peak ≤ -1 |
| `memorability_hook` | repeated motif detection (presence of strong hook in /pattern_bank); pitch contour entropy |
| `originality` | distance from cookbook snippets in same genre |
| `user_taste_fit` | embedding distance to PreferenceGraph.sound_likes / motif_likes |
| `technical_validity` | validator pass + render succeeded + no AnalyzerFeatures missing |

## Critique target contract

Every target must be of the shape:

```json
{
  "target_id": "<uuid>",
  "severity": 0.74,
  "agent": "producer-mix-engineer",
  "graph_paths": ["/mix_graph/orbits/2", "/mix_graph/sidechain"],
  "problem": "chord_stab building 200-500Hz mud against kick",
  "evidence": {
    "band_rms_low_mid_db": -8.1,
    "reference_band_rms_low_mid_db": -14,
    "kick_overlap_correlation": 0.61
  },
  "revision_instruction": "increase kick→chord sidechain depth from 0.32 to 0.45 with attack_ms=8, release_ms=180; or carve 220-450Hz on chord_stab via lpf or notch"
}
```

**Forbidden**: prose-only critique without `evidence` numerics; `graph_paths` empty; `revision_instruction` vague ("make it punchier").

## Severity scale

- 0.0–0.3 — nice-to-have polish.
- 0.3–0.6 — affects vibe but track is acceptable.
- 0.6–0.85 — mix issue or arrangement weakness; user will notice.
- 0.85–1.0 — broken render or hard genre-fit miss; should not ship.

## When features are missing

If `AnalyzerFeatures` is partially populated, emit only targets you can cite numerically. Note the gap in `CritiqueEntry.notes` so the orchestrator knows to retry analysis.

## Files

- `score-rubric.md` — per-axis scoring formula with thresholds.
- `target-templates.md` — common critique target shapes by problem type.
- `genre-baselines.md` — per-genre evidence reference ranges.
