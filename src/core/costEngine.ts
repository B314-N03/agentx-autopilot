import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { getPricing, type PricingTable } from './pricing.js';
import type { TurnCost, Phase } from './types.js';

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
  return turnsFromEntries(await readEntries(path));
}

/** Read a JSONL transcript into raw parsed entries, skipping malformed lines. */
export async function readEntries(path: string): Promise<any[]> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const entries: any[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip malformed line rather than abort the whole session */
    }
  }
  return entries;
}

/** Cost the billable (assistant + usage) entries into per-turn costs. */
export function turnsFromEntries(entries: any[]): TurnCost[] {
  const turns: TurnCost[] = [];
  for (const entry of entries) {
    const msg = entry?.message;
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

/**
 * Aggregate per-turn costs by detected phase. Phase attribution is supplied by
 * the caller (the classifier) via `phaseOf`, so core stays independent of the
 * classifier. All four phase buckets are always present (0 when unused), so
 * their costs sum to the session total.
 */
export function aggregateByPhase(
  turns: TurnCost[],
  phaseOf: (turn: TurnCost, index: number) => Phase,
): Record<Phase, { costEur: number; turns: number }> {
  const out: Record<Phase, { costEur: number; turns: number }> = {
    plan: { costEur: 0, turns: 0 },
    implement: { costEur: 0, turns: 0 },
    verify: { costEur: 0, turns: 0 },
    debug: { costEur: 0, turns: 0 },
  };
  turns.forEach((t, i) => {
    const bucket = out[phaseOf(t, i)];
    bucket.costEur += t.costEur;
    bucket.turns += 1;
  });
  return out;
}
