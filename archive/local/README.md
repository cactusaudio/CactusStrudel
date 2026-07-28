# Local-only archive

This directory is gitignored. It preserves bulky machine-local evidence moved
out of the active repository topology during the 2026-07-28 cleanup.

Current batch: `2026-07-28-repo-cleanup/`

| Original area | Archived content |
|---|---|
| `apps/cli/audits/` | historical cookbook-impact render reports/WAVs |
| `refs/` | old Strudel clones/song corpora plus keygen/MIDI research |
| `producer-brain/archive-v0/` | prototype audio/history |
| `producer-brain/checkpoints/` | old prompt-system checkpoints |
| `output/`, `.playwright-cli/` | cutover screenshots and browser traces |

The live renderer uses npm `@strudel/*` source entrypoints and does not depend
on the archived `refs/strudel-monorepo`.

Because this archive is local-only, it is not a portable product dependency.
