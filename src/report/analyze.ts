import { costTurn, readEntries, turnsFromEntries } from '../core/costEngine.js';
import { getPricing, tierLadder, type PricingTable } from '../core/pricing.js';
import { attributeVerdicts } from '../classifier/classify.js';
import { extractSignals } from '../classifier/signals.js';
import type { TurnCost } from '../core/types.js';

/** The Opus tier id — the "before autopilot" baseline everyone defaults to. */
const OPUS = 'claude-opus-4-8';

/** Additive per-session totals — safe to sum across many sessions. */
export interface RawTotals {
  turns: number;
  actualEur: number;
  allOpusEur: number;
  idealEur: number;
  actualOpusEur: number;
  idealOpusEur: number;
  byModelEur: Record<string, number>;
  idealByModelEur: Record<string, number>;
}

export interface SavingsReport {
  turns: number;
  actualEur: number;
  allOpusEur: number;
  idealEur: number;
  savedVsBaselineEur: number;
  savedPct: number;
  opusSharePct: number;
  idealOpusSharePct: number;
  /** Actual spend per model (what really ran). */
  byModelEur: Record<string, number>;
  /** Ideal spend per model (what the autopilot would have picked). */
  idealByModelEur: Record<string, number>;
}

function usageOf(t: TurnCost) {
  return {
    input_tokens: t.tokensIn,
    output_tokens: t.tokensOut,
    cache_read_input_tokens: t.cacheRead,
    cache_creation_input_tokens: t.cacheWrite,
  };
}

function zeroTotals(): RawTotals {
  return {
    turns: 0, actualEur: 0, allOpusEur: 0, idealEur: 0,
    actualOpusEur: 0, idealOpusEur: 0, byModelEur: {}, idealByModelEur: {},
  };
}

function addTo(map: Record<string, number>, key: string, v: number): void {
  map[key] = (map[key] ?? 0) + v;
}

/**
 * Accumulate additive totals for a session. Turns are always classified with
 * full-session context; when `sinceMs` is given, only turns at/after that
 * timestamp are counted (undated turns are excluded under a date filter).
 */
export function accumulate(
  turns: TurnCost[],
  signals: ReturnType<typeof extractSignals>,
  table: PricingTable = getPricing(),
  sinceMs?: number,
): RawTotals {
  const verdicts = attributeVerdicts(signals, turns, table);
  const r = zeroTotals();
  turns.forEach((t, i) => {
    if (sinceMs !== undefined) {
      const ms = Date.parse(t.ts);
      if (Number.isNaN(ms) || ms < sinceMs) return;
    }
    const dateTable = getPricing(t.ts.slice(0, 10) || undefined);
    const u = usageOf(t);
    r.turns += 1;
    r.actualEur += t.costEur;
    addTo(r.byModelEur, t.model, t.costEur);
    r.allOpusEur += costTurn(u, OPUS, dateTable);

    const rec = verdicts[i]!.recommendedModel;
    const idealC = costTurn(u, rec, dateTable);
    r.idealEur += idealC;
    addTo(r.idealByModelEur, rec, idealC);

    if (t.model.includes('opus')) r.actualOpusEur += t.costEur;
    if (rec.includes('opus')) r.idealOpusEur += idealC;
  });
  return r;
}

/** Sum two totals (for aggregating across sessions). */
export function mergeTotals(a: RawTotals, b: RawTotals): RawTotals {
  const out = zeroTotals();
  out.turns = a.turns + b.turns;
  out.actualEur = a.actualEur + b.actualEur;
  out.allOpusEur = a.allOpusEur + b.allOpusEur;
  out.idealEur = a.idealEur + b.idealEur;
  out.actualOpusEur = a.actualOpusEur + b.actualOpusEur;
  out.idealOpusEur = a.idealOpusEur + b.idealOpusEur;
  for (const src of [a, b]) {
    for (const [m, v] of Object.entries(src.byModelEur)) addTo(out.byModelEur, m, v);
    for (const [m, v] of Object.entries(src.idealByModelEur)) addTo(out.idealByModelEur, m, v);
  }
  return out;
}

/** Turn additive totals into a presentable report with derived ratios. */
export function finalize(r: RawTotals): SavingsReport {
  const savedVsBaselineEur = r.allOpusEur - r.idealEur;
  return {
    turns: r.turns,
    actualEur: r.actualEur,
    allOpusEur: r.allOpusEur,
    idealEur: r.idealEur,
    savedVsBaselineEur,
    savedPct: r.allOpusEur > 0 ? (savedVsBaselineEur / r.allOpusEur) * 100 : 0,
    opusSharePct: r.actualEur > 0 ? (r.actualOpusEur / r.actualEur) * 100 : 0,
    idealOpusSharePct: r.idealEur > 0 ? (r.idealOpusEur / r.idealEur) * 100 : 0,
    byModelEur: r.byModelEur,
    idealByModelEur: r.idealByModelEur,
  };
}

/** Analyze a single session's turns + signals. */
export function analyze(
  turns: TurnCost[],
  signals: ReturnType<typeof extractSignals>,
  table: PricingTable = getPricing(),
): SavingsReport {
  return finalize(accumulate(turns, signals, table));
}

export interface MonthlyProjection {
  monthlyEur: number;
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

/** Convenience: analyze a single transcript file end-to-end. */
export async function analyzeTranscript(path: string, table: PricingTable = getPricing()): Promise<SavingsReport> {
  const entries = await readEntries(path);
  return analyze(turnsFromEntries(entries), extractSignals(entries), table);
}

export { tierLadder };
