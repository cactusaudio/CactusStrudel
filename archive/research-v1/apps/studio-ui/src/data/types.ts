// G11A: artifact-shape types. Mirror the on-disk JSON exactly. The UI must
// surface real fields and never invent.

export type CookbookMode = 'minimal' | 'enabled' | 'enabled_mutating' | 'mutated' | 'hybrid';

/** A single iteration's primary artifacts inside a session dir. */
export interface SessionArtifactInventory {
  iterations: number[];
  has: {
    graph: boolean;
    code: boolean;
    cookbook_trace: boolean;
    report: boolean;
    /** Per-iteration: indices for which we have a wav. */
    wav: number[];
    features: number[];
    quality_gates: number[];
    critique: number[];
    failure_taxonomy: number[];
    revision_plan: number[];
    locality: number[];
    spectrogram: number[];
  };
}

export interface SessionSummary {
  session_id: string;
  brief?: string;
  primary_genre?: string;
  bpm?: number;
  total_bars?: number;
  schema_version?: string;
  created_at?: string;
  cookbook_mode?: CookbookMode | 'unknown';
  inventory: SessionArtifactInventory;
}

export interface QualityGateResult {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
  severity: number;
  severity_tier?: 'hard_fail' | 'severe_warning' | 'calibration_warning' | 'informational' | 'skipped';
  confidence?: 'low' | 'medium' | 'high';
  notes?: string;
}

export interface QualityGatesReport {
  overall_pass: boolean;
  hard_fail_count?: number;
  severe_warning_count?: number;
  calibration_warning_count?: number;
  informational_count?: number;
  skipped_count?: number;
  gates: QualityGateResult[];
}

export interface CookbookTracePick {
  layer_id: string;
  layer_role: string;
  section_id: string;
  section_function: string;
  cookbook_role: string | null;
  query: {
    genre: string; role: string; section: string; energy: string[]; bpm: number;
    prefer_tags: string[]; forbid_tags: string[]; seen_ids: string[];
  };
  candidates_total: number;
  candidates_top_ids: string[];
  selected_id: string | null;
  selection_reason: string | null;
  mutation_applied: { operator: string; before: string; after: string } | null;
  fallback_reason?: string;
  blame?: {
    graph_path: string;
    pre_value: string | null;
    post_value: string;
    contributes_to_orbit: number | null;
    suspected_in_hard_failure: boolean;
  };
}

export interface CookbookTrace {
  mode: CookbookMode;
  genre: string;
  bpm: number;
  picks: CookbookTracePick[];
  baseline_only?: boolean;
}

export interface ImpactReportRow {
  mode: CookbookMode;
  ok: boolean;
  validator_issues: number;
  gate_pass: boolean;
  hard_fail_count: number;
  severe_warning_count: number;
  lufs_distance: number | null;
  true_peak_db: number | null;
  non_silent_ratio: number | null;
  arrangement_arc_ok: boolean | null;
  critic_issue_count: number;
  mini_notation_token_overlap_vs_minimal: number | null;
}

export interface ImpactReport {
  ok: boolean;
  ts: string;
  suite: string;
  out_dir: string;
  modes: CookbookMode[];
  per_mode: Array<{
    mode: CookbookMode;
    prompts_total: number;
    rendered: number;
    render_failures: number;
    analyzer_failures: number;
    gate_pass: number;
    gate_fail: number;
    diversity_mean_overlap?: number;
    critic_issue_count: number;
  }>;
  per_brief: Array<{
    brief: string;
    bpm?: number;
    genre?: string;
    rows: ImpactReportRow[];
  }>;
  verdict: string;
  notes: string[];
}

export interface LedgerSummary {
  promoted: string[];      // ledger entry filenames
  candidates: string[];
  rejected: string[];
  regressions: string[];
}

export type Evidence<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'missing'; missing_path: string; suggested_command: string }
  | { ok: false; reason: 'parse_error'; message: string };
