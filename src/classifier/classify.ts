import { getPricing, tierLadder, type PricingTable } from '../core/pricing.js';
import { costTurn } from '../core/costEngine.js';
import type { Phase, PhaseVerdict, TurnCost } from '../core/types.js';
import { summarize, type TurnSignals, type WindowSummary } from './signals.js';

/** Human-facing gerund for each phase. */
export function phaseLabel(phase: Phase): string {
  return { plan: 'Planning', implement: 'Implementing', verify: 'Verifying', debug: 'Debugging' }[phase];
}

/**
 * Map a detected phase + window shape to a recommended model, using ladder
 * POSITIONS (not hardcoded ids) so the roster can change underneath us:
 *   plan / debug → high (Opus)   ·   verify / implement → mid (Sonnet)
 *   trivial-mechanical implement → cheap (Haiku)
 * The top tier (Fable) is intentionally NEVER recommended routinely — it is a
 * budget risk, reserved for a genuine "hardest reasoning" signal we don't
 * deterministically have, so the autopilot never escalates into it on its own.
 */
export function recommendModel(phase: Phase, summary: WindowSummary, table: PricingTable): string {
  const ladder = tierLadder(table);
  const cheap = ladder[0]!;
  const mid = ladder[1] ?? cheap;
  const high = ladder[2] ?? mid;

  const mechanical =
    summary.edits > 0 && summary.reads <= 1 && summary.thinkingTurns === 0 && summary.bashRuns === 0;

  switch (phase) {
    case 'plan':
    case 'debug':
      return high;
    case 'verify':
      return mid;
    case 'implement':
      return mechanical ? cheap : mid;
  }
}

function buildReasons(phase: Phase, s: WindowSummary): string[] {
  const reasons: string[] = [];
  if (s.edits) reasons.push(`${s.edits} edit op${s.edits > 1 ? 's' : ''}`);
  if (s.reads) reasons.push(`${s.reads} read/search op${s.reads > 1 ? 's' : ''}`);
  if (s.testRuns) reasons.push(`${s.testRuns} test run${s.testRuns > 1 ? 's' : ''}`);
  if (s.errors) reasons.push(`${s.errors} tool error${s.errors > 1 ? 's' : ''}`);
  if (s.planMarkers) reasons.push('plan/refine command');
  if (s.executeMarkers) reasons.push('execute command');
  if (!reasons.length) reasons.push('no strong tool signals — defaulting to implement');
  return reasons;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface ClassifyInput {
  /** Signals for the recent window of turns. */
  signals: TurnSignals[];
  /** The latest billable turn, used to compute estSaveEur. */
  lastTurn?: TurnCost;
}

/**
 * Classify the recent window into a phase + tier recommendation. Deterministic
 * weighted heuristics — no LLM. `estSaveEur` is positive for a downshift
 * (a real saving) and negative for an escalation (an added-cost warning).
 */
export function classifyPhase(input: ClassifyInput, table: PricingTable = getPricing()): PhaseVerdict {
  const s = summarize(input.signals);

  const scores: Record<Phase, number> = {
    // "no edits" only reinforces plan when there's actual read/search activity —
    // an empty window must fall through to the safe implement default, not Opus.
    plan: s.reads * 1.0 + s.planMarkers * 4 + s.thinkingTurns * 0.5 + (s.edits === 0 && s.reads > 0 ? 2 : 0),
    implement: s.edits * 2.0 + s.executeMarkers,
    verify: s.testRuns * 3.0 + (s.testRuns > 0 ? 2 : 0),
    debug: s.errors * 3.0 + (s.errors > 1 ? 3 : 0),
  };

  const total = scores.plan + scores.implement + scores.verify + scores.debug;

  let phase: Phase;
  let confidence: number;
  if (total <= 0) {
    phase = 'implement'; // safe middle default when nothing stands out
    confidence = 0.2;
  } else {
    // Tiebreak priority: the more specific/urgent signals win.
    const order: Phase[] = ['debug', 'verify', 'plan', 'implement'];
    phase = order.reduce((best, p) => (scores[p] > scores[best] ? p : best), order[0]!);
    confidence = clamp(scores[phase] / total, 0.3, 0.98);
  }

  const recommendedModel = recommendModel(phase, s, table);

  let estSaveEur = 0;
  if (input.lastTurn) {
    const t = input.lastTurn;
    const dateTable = getPricing(t.ts.slice(0, 10) || undefined);
    const recCost = costTurn(
      {
        input_tokens: t.tokensIn,
        output_tokens: t.tokensOut,
        cache_read_input_tokens: t.cacheRead,
        cache_creation_input_tokens: t.cacheWrite,
      },
      recommendedModel,
      dateTable,
    );
    estSaveEur = t.costEur - recCost; // + = saving (downshift), − = added cost (escalation)
  }

  return {
    phase,
    recommendedModel,
    confidence: Math.round(confidence * 100) / 100,
    signals: buildReasons(phase, s),
    estSaveEur,
  };
}

/**
 * Attribute each billable turn to a phase, using a rolling window of signals
 * ending at that turn. Returns one Phase per turn, index-aligned with `turns`.
 */
export function attributePhases(
  signals: TurnSignals[],
  turns: TurnCost[],
  table: PricingTable = getPricing(),
  windowN = 14,
): Phase[] {
  const idxById = new Map(signals.map((sig, i) => [sig.turnId, i] as const));
  return turns.map((t) => {
    const end = idxById.get(t.turnId) ?? signals.length - 1;
    const window = signals.slice(Math.max(0, end - windowN + 1), end + 1);
    return classifyPhase({ signals: window, lastTurn: t }, table).phase;
  });
}
