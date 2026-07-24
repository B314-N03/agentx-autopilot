import { spawnSync } from 'node:child_process';
import { getPricing, tierLadder, type PricingTable } from '../core/pricing.js';

/**
 * Prompt-level routing: classify a raw natural-language prompt into a difficulty
 * bucket and map it to a model tier — used BEFORE a turn runs (unlike the
 * transcript classifier, which reads tool usage AFTER turns execute).
 */
export type Bucket = 'trivial' | 'standard' | 'hard';

export interface RouteVerdict {
  /** Recommended model id. */
  model: string;
  bucket: Bucket;
  reason: string;
  via: 'haiku' | 'heuristic';
}

const HAIKU = 'claude-haiku-4-5';

/** Map a difficulty bucket to a model id by ladder position (never the top/Fable). */
export function bucketToModel(bucket: Bucket, table: PricingTable = getPricing()): string {
  const ladder = tierLadder(table); // cheapest → priciest
  const cheap = ladder[0]!;
  const mid = ladder[1] ?? cheap;
  const high = ladder[2] ?? mid;
  return bucket === 'trivial' ? cheap : bucket === 'hard' ? high : mid;
}

const HARD_RE = /\b(design|architect(?:ure)?|why|debug|investigate|root ?cause|race|deadlock|strategy|trade-?off|approach|plan|reason|analy[sz]e)\b/i;
const TRIVIAL_RE = /\b(typo|rename|reformat|format|prettier|lint|bump|comment|whitespace|spelling|indent)\b/i;
const STANDARD_RE = /\b(add|implement|write|create|build|update|fix|test|refactor|wire|integrate)\b/i;

/**
 * Deterministic keyword heuristic — the no-LLM fallback used when the Haiku
 * call is unavailable/slow/unparseable. Order matters: hard > trivial > standard.
 */
export function classifyPromptHeuristic(prompt: string, table: PricingTable = getPricing()): RouteVerdict {
  const p = prompt.toLowerCase();
  let bucket: Bucket;
  let reason: string;
  if (HARD_RE.test(p)) {
    bucket = 'hard';
    reason = 'design/reasoning keywords';
  } else if (TRIVIAL_RE.test(p)) {
    bucket = 'trivial';
    reason = 'mechanical keywords';
  } else if (STANDARD_RE.test(p)) {
    bucket = 'standard';
    reason = 'implementation keywords';
  } else {
    bucket = 'standard';
    reason = 'no strong signal — default';
  }
  return { model: bucketToModel(bucket, table), bucket, reason, via: 'heuristic' };
}

/** Extract the first difficulty word from free-form model output. */
function parseBucket(out: string): Bucket | null {
  const t = out.toLowerCase();
  if (/\btrivial\b/.test(t)) return 'trivial';
  if (/\bhard\b/.test(t)) return 'hard';
  if (/\bstandard\b/.test(t)) return 'standard';
  return null;
}

/**
 * Classify a prompt via a cheap Haiku call (subscription auth, no API key),
 * falling back to the heuristic on any failure/timeout. Synchronous so the hook
 * stays simple; the ~8s cap sits well inside the 30s UserPromptSubmit budget.
 */
export function classifyPromptViaHaiku(prompt: string, table: PricingTable = getPricing()): RouteVerdict {
  const instruction =
    'You are a model-tier router for a coding agent. Classify the request below by difficulty ' +
    'as exactly one word: trivial (mechanical, no reasoning), standard (normal implementation), ' +
    'or hard (design, debugging, or multi-step reasoning). Answer with only the word.\nRequest: ' +
    JSON.stringify(prompt);
  try {
    const res = spawnSync('claude', ['-p', '--model', HAIKU, instruction], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status === 0 && typeof res.stdout === 'string') {
      const bucket = parseBucket(res.stdout);
      if (bucket) return { model: bucketToModel(bucket, table), bucket, reason: `haiku:${bucket}`, via: 'haiku' };
    }
  } catch {
    /* fall through to heuristic */
  }
  return classifyPromptHeuristic(prompt, table);
}
