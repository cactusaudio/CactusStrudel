import { v4 as uuid } from 'uuid';
import {
  SCHEMA_VERSION,
  SessionGraphSchema,
  type SessionGraph,
  type BriefGraph,
} from './schema.js';

export interface CreateSessionInit {
  brief: Partial<BriefGraph> & { text: string };
}

export function createSessionGraph(init: CreateSessionInit): SessionGraph {
  const now = new Date().toISOString();
  const draft = {
    schema_version: SCHEMA_VERSION,
    session_id: uuid(),
    created_at: now,
    brief: {
      // Defaults first, then caller's brief spread to override.
      // (init.brief carries the required `text` field via its type.)
      mood: [],
      references: [],
      modifiers: [],
      constraints: {},
      ...init.brief,
    },
    song: {
      cycles_per_bar: 1,
      total_bars: 32,
      sections: [
        {
          id: uuid(),
          name: 'intro',
          start_bar: 0,
          end_bar: 8,
          energy: 0.3,
          function: 'intro' as const,
        },
        {
          id: uuid(),
          name: 'main',
          start_bar: 8,
          end_bar: 24,
          energy: 0.7,
          function: 'main' as const,
        },
        {
          id: uuid(),
          name: 'outro',
          start_bar: 24,
          end_bar: 32,
          energy: 0.3,
          function: 'outro' as const,
        },
      ],
      energy_curve: Array.from({ length: 32 }, (_, i) => {
        if (i < 8) return 0.3;
        if (i < 24) return 0.7;
        return 0.3;
      }),
      layer_activation: {},
    },
    layers: [],
    pattern_bank: { patterns: {} },
    sound_palette: { layers: {} },
    mix_graph: {
      orbits: {},
      master: { gain: 1, lufs_target: -9, true_peak_max: -1 },
      sidechain: [],
      bus_sends: [],
    },
    render_graph: [],
    critique_graph: [],
    preference_graph: {
      decisions: [],
      weights: {
        genre_fit: 0.18,
        groove: 0.16,
        arrangement_arc: 0.13,
        sound_design: 0.1,
        mix_translation: 0.12,
        memorability_hook: 0.08,
        originality: 0.06,
        user_taste_fit: 0.05,
        technical_validity: 0.12,
      },
      motif_likes: [],
      sound_likes: [],
      arrangement_likes: [],
    },
    iteration_log: [],
  };
  return SessionGraphSchema.parse(draft);
}
