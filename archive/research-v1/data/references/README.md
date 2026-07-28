# Reference descriptors (G9 §6)

Each `<genre>.yaml` here describes the **abstract production traits** of a genre
— production trait clusters, mix descriptors, arrangement descriptors,
allowed-influence notes, forbidden-copying notes.

These are **not** track copies, melody clones, or sample dumps. They exist so
the critic and the producer can score and generate against an articulated
target without ingesting copyrighted audio.

If you want the system to learn from a specific reference *track*, place the
WAV under `refs/` (gitignored) and write a `<your_track>.yaml` here that
describes its abstract qualities — never copy melodies, riffs, sample
content, or recognisable phrases into the cookbook.

## Schema (informal)

- `slug`: string, matches a genre slug
- `descriptor_version`: schema version
- `production_trait_clusters`: bullet list of trait clusters
- `arrangement_descriptors`: per-section archetypes
- `mix_descriptors`: target band balance / spatial character
- `allowed_influence_notes`: what the system MAY internalise
- `forbidden_copying_notes`: what the system MUST NOT copy
- `feature_targets`: optional analyzer-side target ranges (LUFS, centroid…)

## Why this layer exists

Direct ingestion of reference WAVs has three problems we won't accept:

1. Copyright risk on commercial work that's not ours to redistribute.
2. The model learning identifiable phrases / drum patterns from a small N.
3. Loss of articulated reasoning — once the system has copied a track, it
   can't explain *why* a choice matches the genre.

A descriptor-only reference layer forces us to write down the *abstract*
quality we're aiming for, which is the only generalisable form.
