import pricingTable from './pricing.json' with { type: 'json' };

/** Per-Mtok rates for a single model. */
export interface ModelRates {
  /** Input tokens, EUR per million. */
  in: number;
  /** Output tokens, EUR per million. */
  out: number;
  /** Cache-read tokens, EUR per million (≈ in × 0.1). */
  cacheRead: number;
  /** Cache-write tokens, EUR per million (≈ in × 1.25). */
  cacheWrite: number;
}

export type PricingTable = Record<string, ModelRates>;

/**
 * Time-limited promotional rates that override the base table while active.
 * Sonnet 5 intro pricing ({2, 10}) runs through 2026-08-31.
 */
const INTRO_RATES: Array<{ model: string; until: string; rates: ModelRates }> = [
  {
    model: 'claude-sonnet-5',
    until: '2026-08-31',
    rates: { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
];

/**
 * The pricing table, with any active intro rates applied for the given date.
 * @param onDate ISO date (YYYY-MM-DD) to evaluate promos against; defaults to
 *   the base table only (no promo) when omitted — callers pass a real date to
 *   opt into time-sensitive pricing.
 */
export function getPricing(onDate?: string): PricingTable {
  const base = pricingTable as PricingTable;
  if (!onDate) return base;

  const merged: PricingTable = { ...base };
  for (const promo of INTRO_RATES) {
    if (onDate <= promo.until && merged[promo.model]) {
      merged[promo.model] = promo.rates;
    }
  }
  return merged;
}

/** The default base pricing table (no promos applied). */
export const pricing: PricingTable = pricingTable as PricingTable;

/**
 * Model ids sorted cheapest → priciest by input rate. The tier ordering is
 * DERIVED, so Fable (top) and any future model slot in without code changes.
 */
export function tierLadder(table: PricingTable = pricing): string[] {
  return Object.keys(table).sort((a, b) => table[a]!.in - table[b]!.in);
}
