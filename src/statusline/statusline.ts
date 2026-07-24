import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  readEntries,
  turnsFromEntries,
  aggregateByModel,
  aggregateByPhase,
} from '../core/costEngine.js';
import { getPricing, type PricingTable } from '../core/pricing.js';
import { shortModelName, tierBadge } from '../core/modelLabel.js';
import { extractSignals } from '../classifier/signals.js';
import { classifyPhase, attributePhases, phaseLabel } from '../classifier/classify.js';
import type { Phase, TurnCost } from '../core/types.js';

/** Opus cost-share above which the meter shows a ⚠ overspend marker. */
const OPUS_SHARE_WARN = 0.6;
/** How many recent turns of signal feed the live phase verdict. */
const VERDICT_WINDOW = 20;

// Re-exported so existing imports keep working after the label helper moved to core.
export { shortModelName };

function eur(n: number): string {
  return '€' + n.toFixed(2);
}

/**
 * Render the one-line cost meter from already-parsed turns. Per-model segments
 * (priciest first) followed by an explicit session-total anchor, plus a ⚠ when
 * Opus dominates spend. Pure — no IO — so it's trivially testable.
 */
export function renderMeter(turns: TurnCost[]): string {
  const byModel = aggregateByModel(turns);
  const total = turns.reduce((s, t) => s + t.costEur, 0);

  const segments = Object.entries(byModel)
    .sort((a, b) => b[1].costEur - a[1].costEur)
    .map(([model, { costEur }]) => `${shortModelName(model)} ${eur(costEur)}`);

  const opusCost = Object.entries(byModel)
    .filter(([model]) => model.includes('opus'))
    .reduce((s, [, v]) => s + v.costEur, 0);
  const warn = total > 0 && opusCost / total > OPUS_SHARE_WARN ? ' ⚠' : '';

  const body = segments.length ? segments.join(' · ') + ' · ' : '';
  return `${body}Σ ${eur(total)}${warn}`;
}

const PHASE_ABBREV: Record<Phase, string> = {
  plan: 'plan',
  implement: 'impl',
  verify: 'verify',
  debug: 'debug',
};

/** `plan €0.55 · impl €0.30 · verify €0.08` — omits phases with no turns. */
export function renderPhaseSplit(byPhase: Record<Phase, { costEur: number; turns: number }>): string {
  const order: Phase[] = ['plan', 'implement', 'verify', 'debug'];
  return order
    .filter((p) => byPhase[p].turns > 0)
    .map((p) => `${PHASE_ABBREV[p]} ${eur(byPhase[p].costEur)}`)
    .join(' · ');
}

/**
 * Compose the full statusline: money meter | per-phase split | live verdict.
 * Pure over parsed turns + signals so it can be asserted without IO.
 */
export function composeStatusline(
  turns: TurnCost[],
  signals: ReturnType<typeof extractSignals>,
  table: PricingTable = getPricing(),
): string {
  const meter = renderMeter(turns);
  if (!turns.length) return meter;

  const phases = attributePhases(signals, turns, table);
  const split = renderPhaseSplit(aggregateByPhase(turns, (_t, i) => phases[i]!));

  const verdict = classifyPhase(
    { signals: signals.slice(-VERDICT_WINDOW), lastTurn: turns[turns.length - 1] },
    table,
  );
  const verdictStr = `${phaseLabel(verdict.phase)} → ${tierBadge(verdict.recommendedModel, table)} recommended`;

  return [meter, split, verdictStr].filter(Boolean).join(' | ');
}

/** Locate the transcript path across known/likely payload field names. */
function transcriptPathFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const candidate = p.transcript_path ?? p.transcriptPath ?? p.transcript;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Build the statusline string from a (parsed) statusLine stdin payload.
 * Cold-start safe: a missing/short/absent transcript renders `Σ €0.00`.
 */
export async function buildStatusline(payload: unknown): Promise<string> {
  const path = transcriptPathFrom(payload);
  if (!path || !existsSync(path)) return renderMeter([]);
  const entries = await readEntries(path);
  const turns = turnsFromEntries(entries);
  if (!turns.length) return renderMeter([]);
  return composeStatusline(turns, extractSignals(entries));
}

async function main(): Promise<void> {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8'); // fd 0 = stdin, piped by Claude Code
  } catch {
    /* no stdin → cold start */
  }
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* malformed → cold start */
  }
  // One-shot payload-shape debug: `STATUSLINE_DEBUG=1` logs the field names to
  // stderr so the transcript-path key can be confirmed against a real payload.
  if (process.env.STATUSLINE_DEBUG && payload && typeof payload === 'object') {
    process.stderr.write('statusline payload keys: ' + Object.keys(payload).join(', ') + '\n');
  }
  process.stdout.write(await buildStatusline(payload));
}

// Only run when executed directly — importing (e.g. from tests) must not block
// on reading stdin.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(String(err) + '\n');
    process.stdout.write('Σ €0.00');
  });
}
