import { tierLadder, pricing, type PricingTable } from './pricing.js';

/**
 * Shorten a model id to its family label: `claude-opus-4-8` → "Opus".
 * Derived from the id, so new models need no lookup table.
 */
export function shortModelName(model: string): string {
  const family = model.split('-')[1] ?? model;
  return family.charAt(0).toUpperCase() + family.slice(1);
}

/** Cheapest → priciest palette; index is the tierLadder position. */
const TIER_EMOJI = ['🟢', '🟡', '🟠', '🔴'];

/**
 * Emoji for a model's tier, driven by its position in the (derived) tier
 * ladder — so 🟢 Haiku / 🟡 Sonnet / 🟠 Opus / 🔴 Fable stays correct as the
 * roster changes. Unknown model → ⚪.
 */
export function tierEmoji(model: string, table: PricingTable = pricing): string {
  const pos = tierLadder(table).indexOf(model);
  if (pos < 0) return '⚪';
  return TIER_EMOJI[Math.min(pos, TIER_EMOJI.length - 1)]!;
}

/** `🟡 Sonnet` — emoji tier badge + short name. */
export function tierBadge(model: string, table: PricingTable = pricing): string {
  return `${tierEmoji(model, table)} ${shortModelName(model)}`;
}
