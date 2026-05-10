# audit report — suite: smoke

- prompts (with seeds): 1
- champion (rules) pass: 0 / 1 (0.0%)
- champion fail: 1

## failure taxonomy (champion)
- silence_or_near_silence: 1
- mix_mud: 1
- genre_collapse: 1

# genre confusion matrix (1 renders)

top-1 correct: 0/1 (0.0%)
top-3 correct: 0/1 (0.0%)

| intended \ top1 | idm |
| --- | --- |
| techno | 1 |

## actionable failures (top 20)
### smoke-001 seed=1
- brief: peak time techno 130 BPM, 10 seconds
- intent: techno (canonical)
- categories: silence_or_near_silence, mix_mud, genre_collapse
  - non_silent_ratio: 0.38305084745762713
  - true_peak: -0.058937356400047304
  - lufs_distance: 10.323439494781915
  - intended_genre: "techno"
  - actual_top1: "idm"

