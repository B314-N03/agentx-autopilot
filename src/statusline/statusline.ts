import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTranscript, aggregateByModel } from '../core/costEngine.js';
import type { TurnCost } from '../core/types.js';

/** Opus cost-share above which the meter shows a ⚠ overspend marker. */
const OPUS_SHARE_WARN = 0.6;

function eur(n: number): string {
  return '€' + n.toFixed(2);
}

/**
 * Shorten a model id to its family label for the meter:
 * `claude-opus-4-8` → "Opus". Derived from the id, so new models need no map.
 */
export function shortModelName(model: string): string {
  const family = model.split('-')[1] ?? model;
  return family.charAt(0).toUpperCase() + family.slice(1);
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

/** Locate the transcript path across known/likely payload field names. */
function transcriptPathFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const candidate = p.transcript_path ?? p.transcriptPath ?? p.transcript;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Build the meter string from a (parsed) statusLine stdin payload. Cold-start
 * safe: a missing/short/absent transcript renders `Σ €0.00` rather than crash.
 */
export async function buildStatusline(payload: unknown): Promise<string> {
  const path = transcriptPathFrom(payload);
  if (!path || !existsSync(path)) return renderMeter([]);
  const turns = await parseTranscript(path);
  return renderMeter(turns);
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
