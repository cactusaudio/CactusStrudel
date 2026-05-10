export {
  loadSuite,
  expandPrompts,
  PromptSuiteSchema,
  PromptEntrySchema,
  IntentClass,
  type PromptSuite,
  type PromptEntry,
  type ExpandedPrompt,
  type LoadSuiteOptions,
} from './prompt-suite.js';
export {
  scoreGenreConfusion,
  aggregateConfusion,
  renderConfusionMarkdown,
  type GenreConfusionInput,
  type GenreConfusionReport,
  type GenreConfusionMatrix,
  type GenreDistance,
} from './genre-confusion.js';
export {
  classifyFailure,
  type ClassifyFailureInput,
  type ClassifiedFailure,
  type FailureCategory,
} from './failure-taxonomy.js';
export {
  decideWinner,
  summarize as summarizeChampionChallenger,
  type BackendRunSummary,
  type ChampionChallengerInput,
  type ChampionChallengerVerdict,
  type ChampionChallengerSummary,
  type WinnerVerdict,
} from './champion-challenger.js';
export {
  runAudit,
  type RunAuditOptions,
  type RunAuditResult,
} from './run-audit.js';
