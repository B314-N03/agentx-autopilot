import { describe, it, expect } from 'vitest';
import { turnsFromEntries, aggregateByPhase } from '../core/costEngine.js';
import { extractSignals } from './signals.js';
import { attributePhases } from './classify.js';
import type { Phase } from '../core/types.js';

const TS = '2026-07-24T10:00:00.000Z';
const usage = { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function asst(uuid: string, model: string, tools: string[], bash?: string): any {
  const content: any[] = tools.map((name) => ({ type: 'tool_use', name, ...(name === 'Bash' && bash ? { input: { command: bash } } : {}) }));
  return { type: 'assistant', timestamp: TS, uuid, message: { role: 'assistant', model, usage, content } };
}
function userSlash(uuid: string, slash: string): any {
  return { type: 'user', timestamp: TS, uuid, message: { role: 'user', content: slash } };
}

// A deliberately mixed session: plan (reads) → implement (edits) → verify (test run).
const entries = [
  userSlash('u1', '/sv-adlc:plan'),
  asst('a1', 'claude-opus-4-8', ['Read']),
  asst('a2', 'claude-opus-4-8', ['Grep', 'Read']),
  asst('a3', 'claude-sonnet-5', ['Edit']),
  asst('a4', 'claude-sonnet-5', ['Edit']),
  asst('a5', 'claude-sonnet-5', ['Edit']),
  asst('a6', 'claude-sonnet-5', ['Bash'], 'npm test'),
];

describe('aggregateByPhase', () => {
  const turns = turnsFromEntries(entries);
  const signals = extractSignals(entries);
  const phases = attributePhases(signals, turns, undefined, 3);
  const byPhase = aggregateByPhase(turns, (_t, i) => phases[i]!);

  it('has all four phase buckets', () => {
    expect(Object.keys(byPhase).sort()).toEqual(['debug', 'implement', 'plan', 'verify']);
  });

  it('per-phase costs sum exactly to the session total', () => {
    const total = turns.reduce((s, t) => s + t.costEur, 0);
    const phaseSum = (Object.keys(byPhase) as Phase[]).reduce((s, p) => s + byPhase[p].costEur, 0);
    expect(phaseSum).toBeCloseTo(total, 10);
    const turnSum = (Object.keys(byPhase) as Phase[]).reduce((s, p) => s + byPhase[p].turns, 0);
    expect(turnSum).toBe(turns.length);
  });

  it('spreads a mixed session across more than one phase', () => {
    const active = (Object.keys(byPhase) as Phase[]).filter((p) => byPhase[p].turns > 0);
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(byPhase.debug.turns).toBe(0); // no errors in this session
  });
});
