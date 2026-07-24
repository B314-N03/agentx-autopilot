import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntries, turnsFromEntries, costTurn } from '../core/costEngine.js';
import { getPricing, tierLadder, type PricingTable } from '../core/pricing.js';
import { shortModelName } from '../core/modelLabel.js';
import { extractSignals, type TurnSignals } from '../classifier/signals.js';
import { classifyPhase } from '../classifier/classify.js';
import { performSwitch, modelAlias } from '../autopilot/switch.js';
import type { Phase, TurnCost } from '../core/types.js';

const VERDICT_WINDOW = 20;

export interface NudgeThresholds {
  /** Minimum trailing turns on a costlier tier before nudging. */
  minStreak: number;
  /** Minimum phase confidence to nudge. */
  minConfidence: number;
  /** Minimum estimated saving (EUR) to bother nudging. */
  minSaveEur: number;
}

export const DEFAULT_THRESHOLDS: NudgeThresholds = {
  minStreak: 3,
  minConfidence: 0.6,
  minSaveEur: 0.01,
};

export interface NudgeDecision {
  due: boolean;
  currentModel: string;
  recommendedModel: string;
  phase: Phase;
  confidence: number;
  streak: number;
  estSavePhaseEur: number;
  text: string;
}

const PHASE_NOUN: Record<Phase, string> = {
  plan: 'planning',
  implement: 'implementation',
  verify: 'verification',
  debug: 'debugging',
};

function ladderPos(model: string, ladder: string[]): number {
  const i = ladder.indexOf(model);
  return i < 0 ? Number.POSITIVE_INFINITY : i; // unknown model → treat as top (don't nudge toward it)
}

function costAt(turn: TurnCost, model: string): number {
  return costTurn(
    {
      input_tokens: turn.tokensIn,
      output_tokens: turn.tokensOut,
      cache_read_input_tokens: turn.cacheRead,
      cache_creation_input_tokens: turn.cacheWrite,
    },
    model,
    getPricing(turn.ts.slice(0, 10) || undefined),
  );
}

/**
 * Decide whether to nudge. Downshift-only: fires only when the session has run
 * K+ consecutive turns on a tier COSTLIER than the classifier recommends, at
 * high confidence, with a real saving on the table. Pure — no IO.
 */
export function decideNudge(
  turns: TurnCost[],
  signals: TurnSignals[],
  table: PricingTable = getPricing(),
  thresholds: NudgeThresholds = DEFAULT_THRESHOLDS,
): NudgeDecision {
  const empty: NudgeDecision = {
    due: false, currentModel: '', recommendedModel: '', phase: 'implement',
    confidence: 0, streak: 0, estSavePhaseEur: 0, text: '',
  };
  if (!turns.length) return empty;

  const last = turns[turns.length - 1]!;
  const currentModel = last.model;
  const verdict = classifyPhase({ signals: signals.slice(-VERDICT_WINDOW), lastTurn: last }, table);
  const recommendedModel = verdict.recommendedModel;

  const ladder = tierLadder(table);
  const recPos = ladderPos(recommendedModel, ladder);
  const curPos = ladderPos(currentModel, ladder);

  const base: NudgeDecision = {
    ...empty,
    currentModel,
    recommendedModel,
    phase: verdict.phase,
    confidence: verdict.confidence,
  };

  // Downshift-only: never nudge toward a costlier tier.
  if (!(curPos > recPos)) return base;

  // Trailing streak of turns costlier than the recommendation.
  let streak = 0;
  let estSave = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (ladderPos(t.model, ladder) <= recPos) break;
    streak += 1;
    estSave += Math.max(0, t.costEur - costAt(t, recommendedModel));
  }

  if (streak < thresholds.minStreak) return { ...base, streak, estSavePhaseEur: estSave };
  if (verdict.confidence < thresholds.minConfidence) return { ...base, streak, estSavePhaseEur: estSave };
  if (estSave < thresholds.minSaveEur) return { ...base, streak, estSavePhaseEur: estSave };

  const alias = shortModelName(recommendedModel).toLowerCase();
  const text =
    `💸 ${streak} ${PHASE_NOUN[verdict.phase]} turns on ${shortModelName(currentModel)} — ` +
    `switch to /model ${alias}, est. save €${estSave.toFixed(2)} this phase.`;

  return { ...base, due: true, streak, estSavePhaseEur: estSave, text };
}

export interface NudgeState {
  phase?: Phase;
  fromModel?: string;
  toModel?: string;
}

/**
 * Debounce: emit at most once per mismatch streak. A new nudge fires only when
 * the (phase, from→to) tuple differs from the last one we emitted; a
 * not-due decision resets state so the next genuine mismatch can fire.
 */
export function applyDebounce(
  decision: NudgeDecision,
  prior: NudgeState | undefined,
): { emit: boolean; nextState: NudgeState } {
  if (!decision.due) return { emit: false, nextState: {} };
  const key: NudgeState = {
    phase: decision.phase,
    fromModel: decision.currentModel,
    toModel: decision.recommendedModel,
  };
  const same =
    prior?.phase === key.phase && prior?.fromModel === key.fromModel && prior?.toModel === key.toModel;
  return same ? { emit: false, nextState: key } : { emit: true, nextState: key };
}

// ---- IO layer -------------------------------------------------------------

function statePath(sessionId: string): string {
  const dir = join(tmpdir(), 'agentx-autopilot');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || 'default';
  return join(dir, `nudge-${safe}.json`);
}

function readState(path: string): NudgeState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as NudgeState;
  } catch {
    return undefined;
  }
}

function writeState(path: string, state: NudgeState): void {
  try {
    writeFileSync(path, JSON.stringify(state));
  } catch {
    /* best-effort; a missed debounce write just means one extra nudge */
  }
}

/**
 * Emit a user-visible, non-blocking nudge via the Stop hook's `systemMessage`.
 * (UserPromptSubmit's `additionalContext` is model-visible only — wrong channel
 * for a nudge the human is meant to read and act on.)
 */
function emitNudge(text: string): void {
  process.stdout.write(JSON.stringify({ systemMessage: text }));
}

async function main(): Promise<void> {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return; // no stdin → nothing to do
  }
  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const path: string | undefined = payload.transcript_path ?? payload.transcriptPath;
  if (!path || !existsSync(path)) return; // no transcript → silent
  const sessionId: string = payload.session_id ?? payload.sessionId ?? 'default';

  const entries = await readEntries(path);
  const turns = turnsFromEntries(entries);
  const signals = extractSignals(entries);

  const decision = decideNudge(turns, signals);
  const sPath = statePath(sessionId);
  const { emit, nextState } = applyDebounce(decision, readState(sPath));
  writeState(sPath, nextState);

  if (!emit) return; // no-op (exit 0, no output) — a silent hook is a non-naggy hook

  // Phase 4 Path 2: opt-in live auto-switch. Off by default (nudge only).
  // Downshift is guaranteed by decideNudge, so this never escalates spend.
  if (process.env.AGENTX_AUTOSWITCH === '1') {
    const dryRun = process.env.AGENTX_AUTOSWITCH_DRYRUN === '1';
    const res = performSwitch(decision.recommendedModel, process.env, { dryRun });
    process.stderr.write(
      `[autoswitch] kind=${res.kind}${res.dryRun ? ' DRYRUN' : ''} ` +
        `${res.command ? `${res.command.cmd} ${res.command.args.join(' ')}` : '(no backend)'}\n`,
    );
    if (res.command && (res.dryRun || res.ok)) {
      const verb = res.dryRun ? 'would auto-switch' : 'auto-switched';
      emitNudge(
        `⚡ ${verb} → /model ${modelAlias(decision.recommendedModel)} · ${decision.streak} ` +
          `${PHASE_NOUN[decision.phase]} turns on ${shortModelName(decision.currentModel)}, ~€${decision.estSavePhaseEur.toFixed(2)} saved.`,
      );
      return;
    }
    if (res.command && !res.ok) {
      // Backend ran but failed — almost always the iTerm Automation permission
      // hasn't been granted yet. Show the manual nudge plus a one-time hint.
      emitNudge(
        `${decision.text} (auto-switch blocked — approve iTerm under System Settings → Privacy → Automation)`,
      );
      return;
    }
    // no injection backend → fall through to the plain visible nudge
  }
  emitNudge(decision.text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(String(err) + '\n');
    // never block the prompt on a hook error
  });
}
