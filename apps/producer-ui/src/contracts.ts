export type RouteId =
  | 'studio'
  | 'library'
  | 'research'
  | 'activity'
  | 'settings-agent'
  | 'settings-generation'
  | 'settings-system';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type JobState =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'done'
  | 'interrupted'
  | 'cancelled_after_commit';
export type BrainJobState = JobState | 'waiting_for_tool';
export type TransportState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type OrchestrationMode = 'standard' | 'ultra';

export interface Provenance {
  route?: string | null;
  model_id?: string | null;
  reasoning_effort?: ReasoningEffort | string | null;
  orchestration?: OrchestrationMode | string | null;
  kernel_hash?: string | null;
  validator_mode?: string | null;
  repair_applied?: boolean;
  job_id?: string;
  config_revision_id?: string;
  legacy?: boolean;
}

export interface PieceRevision {
  id: string;
  piece_id: string;
  label?: string;
  created_at: string;
  code: string;
  js_url?: string;
  audio_url: string;
  audio_sha: string;
  prompt_url?: string;
  receipt_url?: string;
  prompt_summary?: PromptSummary;
  source_revision_id?: string;
  duration_seconds?: number;
  score?: number | null;
  note?: string;
  provenance: Provenance;
  promoted?: boolean;
  preview?: boolean;
}

export interface PromptSummary {
  mode?: string;
  producer_brief?: string;
  legacy_name?: string;
  kernel_hash?: string;
  model_id?: string;
}

export interface Piece {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
  archived: boolean;
  collection?: string;
  tags: string[];
  active_revision_id: string;
  active_revision: PieceRevision;
  revisions: PieceRevision[];
  duplicate_of?: string;
  recovery?: boolean;
}

export interface GenerationJob {
  id: string;
  state: JobState;
  created_at: string;
  updated_at?: string;
  progress?: number;
  stage?: string;
  count: number;
  completed_count: number;
  prompt?: string;
  profile_id?: string;
  piece_ids: string[];
  error?: string;
  receipt?: OperationReceipt;
}

export interface BrainMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  created_at: string;
  tool_name?: string;
  receipt?: OperationReceipt;
}

export interface BrainJob {
  id: string;
  state: BrainJobState;
  created_at: string;
  updated_at?: string;
  piece_id?: string;
  revision_id?: string;
  audio_sha?: string;
  score?: number | null;
  config_revision_id?: string;
  messages: BrainMessage[];
  error?: string;
  receipt?: OperationReceipt;
}

export interface ActivityEvent {
  seq: number;
  id: string;
  at: string;
  kind: string;
  title: string;
  detail?: string;
  status?: 'info' | 'ok' | 'warn' | 'error';
  job_id?: string;
  piece_id?: string;
}

export interface OperationReceipt {
  id: string;
  kind: string;
  status: string;
  at: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface AgentConnectionDraft {
  base_url: string;
  key_present: boolean;
  credential_ref?: string;
  api_key?: string;
  model_id: string;
  reasoning_effort: ReasoningEffort | null;
  orchestration: OrchestrationMode;
}

export interface ModelCatalogItem {
  id: string;
  owned_by?: string;
  label?: string;
  reasoning_efforts: ReasoningEffort[];
  default_reasoning_effort?: ReasoningEffort | null;
  supports_ultra: boolean;
  capability_source: 'live+manifest' | 'live' | 'unknown';
}

export interface ConnectionTest {
  id: string;
  ok: boolean;
  tested_at: string;
  fingerprint: string;
  latency_ms?: number;
  model_id?: string;
  response_excerpt?: string;
  error?: string;
}

export interface AgentSettings {
  revision_id?: string;
  active: AgentConnectionDraft;
  draft: AgentConnectionDraft;
  draft_fingerprint: string;
  draft_is_active?: boolean;
  test?: ConnectionTest;
  catalog: ModelCatalogItem[];
  managed_overrides?: string[];
  status?: {
    ready: boolean;
    detail?: string;
  };
}

export interface GenerationProfile {
  id: string;
  label: string;
  model_id: string;
  reasoning_effort: ReasoningEffort | null;
  orchestration: OrchestrationMode;
  description?: string;
  active?: boolean;
}

export interface GenerationSettings {
  profiles: GenerationProfile[];
  default_profile_id?: string;
  validator_mode: 'deterministic' | 'off';
  kernel_hash?: string;
  kernel_fragments?: string[];
}

export interface SystemSettings {
  api_version?: string;
  server_started_at?: string;
  database_path?: string;
  asset_root?: string;
  migrations?: Array<{ id: string; status: string; detail?: string }>;
  legacy_routes_enabled?: boolean;
  legacy_api_enabled?: boolean;
  legacy_snapshot_available?: boolean;
  recovery_candidate_count?: number;
  recovery_candidates?: RecoveryCandidate[];
}

export interface RecoveryCandidate {
  task_id: string;
  source_line: number;
  js: string;
  mp3: string;
  code_sha: string;
  audio_sha: string;
  human_decision_required: boolean;
}

export interface BootstrapPayload {
  pieces: Piece[];
  jobs: GenerationJob[];
  brain_jobs: BrainJob[];
  activity: ActivityEvent[];
  settings: {
    agent: AgentSettings;
    generation: GenerationSettings;
    system: SystemSettings;
  };
  cursor: number;
  server_time?: string;
}

export interface EventEnvelope {
  seq: number;
  type:
    | 'bootstrap'
    | 'job.updated'
    | 'piece.updated'
    | 'piece.created'
    | 'brain.updated'
    | 'settings.updated'
    | 'activity.created';
  data: unknown;
}

export interface GenerationJobInput {
  count: 1 | 2 | 4;
  prompt: string;
  profile_id?: string;
}

export interface PreviewInput {
  code: string;
  source_revision_id: string;
  intent?: string;
}

export interface ScoreInput {
  score: number;
  note?: string;
  audio_sha: string;
}

export interface BrainJobInput {
  message: string;
  piece_id?: string;
  revision_id?: string;
  audio_sha?: string;
  score?: number | null;
}
