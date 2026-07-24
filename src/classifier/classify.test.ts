import { describe, it, expect } from 'vitest';
import { classifyPhase, recommendModel } from './classify.js';
import { summarize, type TurnSignals } from './signals.js';
import { getPricing } from '../core/pricing.js';
import type { TurnCost } from '../core/types.js';

let seq = 0;
function asst(tools: string[], opts: { thinking?: boolean; bash?: string[] } = {}): TurnSignals {
  return {
    turnId: `a${seq++}`,
    role: 'assistant',
    tools,
    slashCommands: [],
    bashCommands: opts.bash ?? [],
    thinking: opts.thinking ?? false,
    toolResultErrors: 0,
  };
}
function userSlash(slash: string): TurnSignals {
  return { turnId: `u${seq++}`, role: 'user', tools: [], slashCommands: [slash], bashCommands: [], thinking: false, toolResultErrors: 0 };
}
function userErr(n: number): TurnSignals {
  return { turnId: `u${seq++}`, role: 'user', tools: [], slashCommands: [], bashCommands: [], thinking: false, toolResultErrors: n };
}

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5';
const FABLE = 'claude-fable-5';

describe('classifyPhase — phase + tier per work shape', () => {
  it('plan-heavy (reads, no edits, /plan) → plan → Opus', () => {
    const v = classifyPhase({
      signals: [userSlash('/sv-adlc:plan'), asst(['Read']), asst(['Grep', 'Read']), asst(['Read'])],
    });
    expect(v.phase).toBe('plan');
    expect(v.recommendedModel).toBe(OPUS);
  });

  it('non-mechanical implement (edits + read + thinking) → implement → Sonnet', () => {
    const v = classifyPhase({
      signals: [asst(['Edit'], { thinking: true }), asst(['Edit']), asst(['Edit']), asst(['Read'])],
    });
    expect(v.phase).toBe('implement');
    expect(v.recommendedModel).toBe(SONNET);
  });

  it('trivial-mechanical edits (no reads/thinking/bash) → implement → Haiku', () => {
    const v = classifyPhase({ signals: [asst(['Edit']), asst(['Edit']), asst(['Edit']), asst(['Edit']), asst(['Edit']), asst(['Edit'])] });
    expect(v.phase).toBe('implement');
    expect(v.recommendedModel).toBe(HAIKU);
  });

  it('test runs → verify → Sonnet', () => {
    const v = classifyPhase({ signals: [asst(['Bash'], { bash: ['npm test'] }), asst(['Bash'], { bash: ['npx vitest run'] }), asst(['Edit'])] });
    expect(v.phase).toBe('verify');
    expect(v.recommendedModel).toBe(SONNET);
  });

  it('error loop → debug → Opus', () => {
    const v = classifyPhase({ signals: [userErr(2), asst(['Edit']), userErr(1), asst(['Bash'], { bash: ['npm test'] }), userErr(2)] });
    expect(v.phase).toBe('debug');
    expect(v.recommendedModel).toBe(OPUS);
  });

  it('empty window → safe implement default (Sonnet), not Opus', () => {
    const v = classifyPhase({ signals: [{ turnId: 'x', role: 'assistant', tools: [], slashCommands: [], bashCommands: [], thinking: false, toolResultErrors: 0 }] });
    expect(v.phase).toBe('implement');
    expect(v.recommendedModel).toBe(SONNET);
    expect(v.confidence).toBeLessThan(0.3);
  });

  it('never routinely recommends the top tier (Fable)', () => {
    const windows: TurnSignals[][] = [
      [asst(['Read']), asst(['Grep'])],
      [asst(['Edit']), asst(['Edit'])],
      [asst(['Bash'], { bash: ['npm test'] })],
      [userErr(3), asst(['Edit'])],
    ];
    for (const w of windows) expect(classifyPhase({ signals: w }).recommendedModel).not.toBe(FABLE);
  });
});

describe('estSaveEur sign', () => {
  const lastTurn = (model: string, costEur: number): TurnCost => ({
    turnId: 't', model, tokensIn: 1000, tokensOut: 2000, cacheRead: 5000, cacheWrite: 1000, costEur, ts: '2026-07-24T00:00:00Z',
  });

  it('is positive when downshifting (Opus turn, mechanical → Haiku)', () => {
    const v = classifyPhase({ signals: [asst(['Edit']), asst(['Edit']), asst(['Edit'])], lastTurn: lastTurn(OPUS, 0.06) });
    expect(v.recommendedModel).toBe(HAIKU);
    expect(v.estSaveEur).toBeGreaterThan(0);
  });

  it('is negative when escalating (Sonnet turn, plan → Opus)', () => {
    const v = classifyPhase({ signals: [asst(['Read']), asst(['Grep']), asst(['Read'])], lastTurn: lastTurn(SONNET, 0.02) });
    expect(v.recommendedModel).toBe(OPUS);
    expect(v.estSaveEur).toBeLessThan(0);
  });
});

describe('recommendModel is roster-derived', () => {
  it('picks ladder positions, not hardcoded names', () => {
    const table = getPricing();
    const planSummary = summarize([asst(['Read']), asst(['Read'])]);
    expect(recommendModel('plan', planSummary, table)).toBe(OPUS);
    expect(recommendModel('verify', planSummary, table)).toBe(SONNET);
  });
});
