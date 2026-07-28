export interface BuildFileEntry {
  path: string;
  type: 'file';
  bytes: number;
  sha256: string;
}

export interface BuildFileSet {
  root?: string;
  sha256: string;
  files: BuildFileEntry[];
}

export interface SourceIdentity {
  schema_version: number;
  observed_head: string | null;
  branch: string | null;
  working_tree_sha256: string;
  landing_state_sha256: string;
  effective_tree_sha256: string;
  tracked_worktree_sha256: string;
  index_tree_sha256: string;
  index_flags_sha256: string;
  untracked_tree_sha256: string;
  staged_state_sha256: string;
  unstaged_state_sha256: string;
  staged_changes: number;
  unstaged_changes: number;
  untracked_files: number;
  dirty_entries: number;
}

export interface BuildReceipt {
  schema_version: 2;
  protocol: {
    name: 'cactus-controlled-vite-build-v1';
    intent_sha256: string;
  };
  surface: string;
  task: {
    command: string;
    package_script: string;
    executed: string[];
  };
  source: SourceIdentity;
  builder: Record<string, unknown> & { sha256: string };
  lock: { path: string; sha256: string };
  inputs: BuildFileSet;
  outputs: BuildFileSet & { root: string };
}

export interface BuildCheck {
  valid: boolean;
  surface: string;
  reasons: string[];
  receipt_sha256?: string;
  receipt_json?: string;
  input_sha256?: string | null;
  output_sha256?: string | null;
  receipt?: BuildReceipt;
  source_working_tree_sha256_current?: string | null;
  source_working_tree_matches_receipt?: boolean | null;
}

export interface ServedBuildCheck {
  valid: boolean;
  surface: string;
  reasons: string[];
  build: BuildCheck;
  served_output_sha256?: string | null;
}

export interface RunBuildOptions {
  environment?: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'ignore' | 'pipe';
}

export const RECEIPT_NAME: string;
export const RECEIPT_SCHEMA_VERSION: number;
export function sourceIdentity(repoRoot?: string, environment?: NodeJS.ProcessEnv): SourceIdentity;
export function runBuild(surface: string, repoRoot?: string, options?: RunBuildOptions): Promise<{receipt: BuildReceipt; receipt_sha256: string}>;
export function clearBuildReceipt(surface: string, repoRoot?: string): Promise<{surface: string; cleared: boolean}>;
export function checkBuildReceipt(surface: string, repoRoot?: string): Promise<BuildCheck>;
export function verifyServedBuild(surface: string, baseUrl: string, repoRoot?: string, timeoutMs?: number): Promise<ServedBuildCheck>;
