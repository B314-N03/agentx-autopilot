import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { getPricing, type PricingTable } from './pricing.js';
import type { TurnCost } from './types.js';

/** Raw transcript usage block (only the fields we cost on). */
interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Cost a single turn's token usage against a pricing table. Rates are per-Mtok
 * EUR. `input_tokens` in the transcript already EXCLUDES cached tokens, which
 * are billed separately at their own read/write rates.
 */
export function costTurn(usage: RawUsage, model: string, table: PricingTable): number {
  const rates = table[model];
  if (!rates) return 0; // unknown model → 0 rather than crash; surfaced elsewhere
  const tokensIn = usage.input_tokens ?? 0;
  const tokensOut = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (tokensIn * rates.in +
      tokensOut * rates.out +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite) /
    1_000_000
  );
}

/**
 * Parse a Claude Code transcript JSONL into per-turn costs. Only assistant
 * messages carry `usage` + `model`, so those are the billable turns. Intro
 * pricing is applied per-turn using the turn's own date.
 */
export async function parseTranscript(path: string): Promise<TurnCost[]> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const turns: TurnCost[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip malformed lines rather than abort the whole session
    }
    const msg = entry.message;
    if (!msg || typeof msg !== 'object' || !msg.usage || !msg.model) continue;

    const ts: string = entry.timestamp ?? '';
    const onDate = ts.slice(0, 10) || undefined; // YYYY-MM-DD for intro pricing
    const table = getPricing(onDate);
    const usage: RawUsage = msg.usage;
    turns.push({
      turnId: entry.uuid ?? `turn-${turns.length}`,
      model: msg.model,
      tokensIn: usage.input_tokens ?? 0,
      tokensOut: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      costEur: costTurn(usage, msg.model, table),
      ts,
    });
  }
  return turns;
}

/** Aggregate per-turn costs by model id. */
export function aggregateByModel(
  turns: TurnCost[],
): Record<string, { costEur: number; turns: number }> {
  const out: Record<string, { costEur: number; turns: number }> = {};
  for (const t of turns) {
    const bucket = (out[t.model] ??= { costEur: 0, turns: 0 });
    bucket.costEur += t.costEur;
    bucket.turns += 1;
  }
  return out;
}
