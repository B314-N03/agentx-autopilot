import { costTurn } from '../core/costEngine.js';
import { getPricing, tierLadder, type PricingTable } from '../core/pricing.js';
import { attributeVerdicts } from '../classifier/classify.js';
import { extractSignals } from '../classifier/signals.js';
import { readEntries, turnsFromEntries } from '../core/costEngine.js';
import type { TurnCost } from '../core/types.js';

/** The Opus tier id — the "before autopilot" baseline everyone defaults to. */
const OPUS = 'claude-opus-4-8';

export interface SavingsReport {
  turns: number;
  /** What the session actually cost, as run. */
  actualEur: number;
  /** Baseline: every turn re-priced as if it ran on Opus. */
  allOpusEur: number;
  /** Ideal: every turn re-priced at its classifier-recommended tier. */
  idealEur: number;
  /** allOpus − ideal: what the autopilot saves vs the all-Opus baseline. */
  savedVsBaselineEur: number;
  savedPct: number;
  /** Opus's share of ACTUAL spend, %. */
  opusSharePct: number;
  /** Opus's share of the IDEAL (autopilot) spend, %. */
  idealOpusSharePct: number;
  /** Per-model actual spend, for the breakdown chart. */
  byModelEur: Record<string, number>;
}

function usageOf(t: TurnCost) {
  return {
    input_tokens: t.tokensIn,
    output_tokens: t.tokensOut,
    cache_read_input_tokens: t.cacheRead,
    cache_creation_input_tokens: t.cacheWrite,
  };
}

/**
 * Compute the savings story for a session: actual vs all-Opus baseline vs the
 * ideal cost if every turn had run at its recommended tier.
 */
export function analyze(
  turns: TurnCost[],
  signals: ReturnType<typeof extractSignals>,
  table: PricingTable = getPricing(),
): SavingsReport {
  const verdicts = attributeVerdicts(signals, turns, table);

  let actualEur = 0;
  let allOpusEur = 0;
  let idealEur = 0;
  let actualOpusEur = 0;
  let idealOpusEur = 0;
  const byModelEur: Record<string, number> = {};

  turns.forEach((t, i) => {
    const dateTable = getPricing(t.ts.slice(0, 10) || undefined);
    const u = usageOf(t);
    actualEur += t.costEur;
    byModelEur[t.model] = (byModelEur[t.model] ?? 0) + t.costEur;
    allOpusEur += costTurn(u, OPUS, dateTable);

    const rec = verdicts[i]!.recommendedModel;
    const idealC = costTurn(u, rec, dateTable);
    idealEur += idealC;

    if (t.model.includes('opus')) actualOpusEur += t.costEur;
    if (rec.includes('opus')) idealOpusEur += idealC;
  });

  const savedVsBaselineEur = allOpusEur - idealEur;
  return {
    turns: turns.length,
    actualEur,
    allOpusEur,
    idealEur,
    savedVsBaselineEur,
    savedPct: allOpusEur > 0 ? (savedVsBaselineEur / allOpusEur) * 100 : 0,
    opusSharePct: actualEur > 0 ? (actualOpusEur / actualEur) * 100 : 0,
    idealOpusSharePct: idealEur > 0 ? (idealOpusEur / idealEur) * 100 : 0,
    byModelEur,
  };
}

export interface MonthlyProjection {
  monthlyEur: number;
  /** Human-readable statement of the scaling assumption. */
  assumption: string;
}

/**
 * Scale a per-session cost to a monthly figure. The assumption is explicit and
 * returned alongside the number so the report never presents it as fact.
 */
export function projectMonthly(
  costPerSessionEur: number,
  sessionsPerWorkday = 4,
  workdaysPerMonth = 21,
): MonthlyProjection {
  return {
    monthlyEur: costPerSessionEur * sessionsPerWorkday * workdaysPerMonth,
    assumption: `assumes ${sessionsPerWorkday} sessions/workday × ${workdaysPerMonth} workdays/month`,
  };
}

/** Convenience: analyze a transcript file end-to-end. */
export async function analyzeTranscript(path: string, table: PricingTable = getPricing()): Promise<SavingsReport> {
  const entries = await readEntries(path);
  return analyze(turnsFromEntries(entries), extractSignals(entries), table);
}

/** Re-exported for the dashboard's tier ordering. */
export { tierLadder };
