import { describe, it, expect } from 'vitest';
import { decideNudge, applyDebounce, type NudgeDecision } from './nudge.js';
import { costTurn } from '../core/costEngine.js';
import { getPricing } from '../core/pricing.js';
import type { TurnCost } from '../core/types.js';
import type { TurnSignals } from '../classifier/signals.js';

const U = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let n = 0;
function turn(model: string): TurnCost {
  return {
    turnId: `t${n++}`, model, tokensIn: 1000, tokensOut: 1000, cacheRead: 0, cacheWrite: 0,
    costEur: costTurn(U, model, getPricing('2026-07-24')), ts: '2026-07-24T00:00:00Z',
  };
}
let s = 0;
function asst(tools: string[], opts: { thinking?: boolean } = {}): TurnSignals {
  return { turnId: `a${s++}`, role: 'assistant', tools, slashCommands: [], bashCommands: [], thinking: opts.thinking ?? false, toolResultErrors: 0 };
}

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5';

const mechanical = [asst(['Edit']), asst(['Edit']), asst(['Edit']), asst(['Edit']), asst(['Edit']), asst(['Edit'])];

describe('decideNudge', () => {
  it('fires on a downshift streak (mechanical edits on Opus → Haiku)', () => {
    const d = decideNudge([turn(OPUS), turn(OPUS), turn(OPUS), turn(OPUS)], mechanical);
    expect(d.due).toBe(true);
    expect(d.recommendedModel).toBe(HAIKU);
    expect(d.text).toContain('/model haiku');
    expect(d.estSavePhaseEur).toBeGreaterThan(0);
    expect(d.streak).toBeGreaterThanOrEqual(3);
  });

  it('is silent when already on the recommended tier', () => {
    const nonMechanical = [asst(['Edit'], { thinking: true }), asst(['Edit']), asst(['Edit']), asst(['Read'])];
    const d = decideNudge([turn(SONNET), turn(SONNET), turn(SONNET)], nonMechanical);
    expect(d.recommendedModel).toBe(SONNET);
    expect(d.due).toBe(false);
  });

  it('is silent below the streak threshold', () => {
    const d = decideNudge([turn(HAIKU), turn(HAIKU), turn(OPUS)], mechanical);
    expect(d.streak).toBe(1);
    expect(d.due).toBe(false);
  });

  it('never nudges toward a costlier tier (downshift-only)', () => {
    const planSignals = [asst(['Read']), asst(['Grep']), asst(['Read'])];
    const d = decideNudge([turn(HAIKU), turn(HAIKU), turn(HAIKU), turn(HAIKU)], planSignals);
    expect(d.recommendedModel).toBe(OPUS); // plan wants Opus, but we're on Haiku
    expect(d.due).toBe(false); // escalation is a nudge we never auto-make
  });

  it('is silent when phase confidence is low', () => {
    const d = decideNudge([turn(OPUS), turn(OPUS), turn(OPUS), turn(OPUS)], [asst([])]);
    expect(d.confidence).toBeLessThan(0.6);
    expect(d.due).toBe(false);
  });
});

describe('applyDebounce', () => {
  const due: NudgeDecision = {
    due: true, currentModel: OPUS, recommendedModel: HAIKU, phase: 'implement',
    confidence: 0.9, streak: 4, estSavePhaseEur: 0.1, text: 'x',
  };

  it('emits when there is no prior nudge', () => {
    const { emit, nextState } = applyDebounce(due, undefined);
    expect(emit).toBe(true);
    expect(nextState).toEqual({ phase: 'implement', fromModel: OPUS, toModel: HAIKU });
  });

  it('suppresses a repeat of the same mismatch', () => {
    const { emit } = applyDebounce(due, { phase: 'implement', fromModel: OPUS, toModel: HAIKU });
    expect(emit).toBe(false);
  });

  it('re-emits when the phase changes', () => {
    const { emit } = applyDebounce(due, { phase: 'debug', fromModel: OPUS, toModel: HAIKU });
    expect(emit).toBe(true);
  });

  it('resets state on a not-due decision so the next mismatch can fire', () => {
    const notDue: NudgeDecision = { ...due, due: false };
    const { emit, nextState } = applyDebounce(notDue, { phase: 'implement', fromModel: OPUS, toModel: HAIKU });
    expect(emit).toBe(false);
    expect(nextState).toEqual({});
  });
});
