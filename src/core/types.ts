/** The four work phases the classifier can detect. */
export type Phase = 'plan' | 'implement' | 'verify' | 'debug';

/** Per-turn cost breakdown derived from a transcript message's usage. */
export interface TurnCost {
  turnId: string;
  /** Model id as it appears in the transcript, e.g. "claude-opus-4-8". */
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  /** Total cost of this turn in EUR, computed from pricing.json. */
  costEur: number;
  /** ISO timestamp of the turn. */
  ts: string;
}

/** Classifier output: what phase we're in and what tier it should run on. */
export interface PhaseVerdict {
  phase: Phase;
  /** A model id (not a fixed enum) — new models slot in without code changes. */
  recommendedModel: string;
  /** 0..1 confidence in the phase detection. */
  confidence: number;
  /** Human-readable reasons, e.g. "6 consecutive Edit turns". */
  signals: string[];
  /**
   * Estimated EUR saved this turn by running at `recommendedModel` instead of
   * the actual model. Negative when the recommendation escalates UP the ladder
   * (added cost, surfaced as a warning — not a saving).
   */
  estSaveEur: number;
}
