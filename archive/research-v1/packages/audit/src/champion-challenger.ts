// Champion / challenger comparison. The deterministic rules backend is the
// permanent champion baseline. A challenger (claude-shadow, hybrid) wins only
// on strict criteria — see `decideWinner` for the contract.

import type { ProducerBackendResult } from '@cactus/orchestrator';
import type { QualityGatesReport } from '@cactus/analyzer';
import type { CritiqueEntry } from '@cactus/ir';
import type { GenreConfusionReport } from './genre-confusion.js';

export interface BackendRunSummary {
  result: ProducerBackendResult;
  rendered: boolean;
  wavPath?: string;
  gates?: QualityGatesReport;
  critique?: CritiqueEntry;
  confusion?: GenreConfusionReport;
  /** Hard failures: render error, analyzer crash, validator non-zero. */
  hard_failures: string[];
}

export interface ChampionChallengerInput {
  prompt_id: string;
  seed: number;
  champion: BackendRunSummary; // always rules
  challenger?: BackendRunSummary;
}

export type WinnerVerdict = 'champion' | 'challenger' | 'tie' | 'challenger-not-run';

export interface ChampionChallengerVerdict {
  prompt_id: string;
  seed: number;
  winner: WinnerVerdict;
  reasons: string[];
  champion_score: number;
  challenger_score: number | null;
}

export function decideWinner(input: ChampionChallengerInput): ChampionChallengerVerdict {
  const reasons: string[] = [];
  if (!input.challenger) {
    return {
      prompt_id: input.prompt_id, seed: input.seed,
      winner: 'challenger-not-run',
      reasons: ['no challenger configured'],
      champion_score: weightedFromRun(input.champion),
      challenger_score: null,
    };
  }
  const champScore = weightedFromRun(input.champion);
  const challScore = weightedFromRun(input.challenger);

  // Strict gate: challenger may NOT have any hard failure.
  if (input.challenger.hard_failures.length > 0) {
    reasons.push(`challenger had ${input.challenger.hard_failures.length} hard failures: ${input.challenger.hard_failures.slice(0, 3).join('; ')}`);
    return v('champion', input.prompt_id, input.seed, reasons, champScore, challScore);
  }

  // Strict gate: genre intent — challenger must be top-1 if champion is top-1; if champion isn't top-1 challenger gains a point only by becoming top-1.
  if (input.champion.confusion?.intended_top1 && !input.challenger.confusion?.intended_top1) {
    reasons.push('challenger lost intended-genre top-1');
    return v('champion', input.prompt_id, input.seed, reasons, champScore, challScore);
  }

  // Strict gate: quality gates must improve or hold.
  const champFails = input.champion.gates?.fail_count ?? 0;
  const challFails = input.challenger.gates?.fail_count ?? 0;
  if (challFails > champFails) {
    reasons.push(`challenger failed ${challFails} gates vs champion's ${champFails}`);
    return v('champion', input.prompt_id, input.seed, reasons, champScore, challScore);
  }

  // Strict gate: critic must not flag a NEW severe issue.
  const champSevere = severeCount(input.champion.critique);
  const challSevere = severeCount(input.challenger.critique);
  if (challSevere > champSevere) {
    reasons.push(`challenger introduced ${challSevere - champSevere} new severe critique target(s)`);
    return v('champion', input.prompt_id, input.seed, reasons, champScore, challScore);
  }

  // Final tie-breaker: weighted score.
  if (challScore > champScore + 0.01) {
    reasons.push(`challenger weighted score ${challScore.toFixed(3)} > champion ${champScore.toFixed(3)}`);
    return v('challenger', input.prompt_id, input.seed, reasons, champScore, challScore);
  }
  if (Math.abs(challScore - champScore) <= 0.01) {
    reasons.push(`scores tied (Δ ≤ 0.01)`);
    return v('tie', input.prompt_id, input.seed, reasons, champScore, challScore);
  }
  reasons.push(`challenger weighted score ${challScore.toFixed(3)} ≤ champion ${champScore.toFixed(3)}`);
  return v('champion', input.prompt_id, input.seed, reasons, champScore, challScore);
}

function v(
  winner: WinnerVerdict, id: string, seed: number, reasons: string[],
  champScore: number, challScore: number | null,
): ChampionChallengerVerdict {
  return { prompt_id: id, seed, winner, reasons, champion_score: champScore, challenger_score: challScore };
}

function weightedFromRun(run: BackendRunSummary): number {
  if (!run.critique) return 0;
  const s = run.critique.scores;
  return Object.values(s).reduce((a, b) => a + b, 0) / Object.keys(s).length;
}

function severeCount(c?: CritiqueEntry): number {
  if (!c) return 0;
  return c.targets.filter((t) => t.severity >= 0.7).length;
}

export interface ChampionChallengerSummary {
  total: number;
  champion_wins: number;
  challenger_wins: number;
  ties: number;
  not_run: number;
  per_prompt: ChampionChallengerVerdict[];
}

export function summarize(verdicts: ChampionChallengerVerdict[]): ChampionChallengerSummary {
  const s: ChampionChallengerSummary = { total: verdicts.length, champion_wins: 0, challenger_wins: 0, ties: 0, not_run: 0, per_prompt: verdicts };
  for (const v of verdicts) {
    switch (v.winner) {
      case 'champion': s.champion_wins++; break;
      case 'challenger': s.challenger_wins++; break;
      case 'tie': s.ties++; break;
      case 'challenger-not-run': s.not_run++; break;
    }
  }
  return s;
}
