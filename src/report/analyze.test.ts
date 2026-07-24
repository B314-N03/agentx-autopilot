import { describe, it, expect } from 'vitest';
import { analyze, projectMonthly } from './analyze.js';
import { turnsFromEntries } from '../core/costEngine.js';
import { extractSignals } from '../classifier/signals.js';

const TS = '2026-07-24T10:00:00.000Z';
const usage = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function asst(uuid: string, model: string): any {
  return { type: 'assistant', timestamp: TS, uuid, message: { role: 'assistant', model, usage, content: [{ type: 'tool_use', name: 'Edit' }] } };
}

// Mixed session, all mechanical edits: some ran on Opus, some on Sonnet.
// Recommended tier for mechanical edits is Haiku, so ideal downshifts both.
const entries = [
  asst('a1', 'claude-opus-4-8'),
  asst('a2', 'claude-opus-4-8'),
  asst('a3', 'claude-opus-4-8'),
  asst('a4', 'claude-opus-4-8'),
  asst('a5', 'claude-sonnet-5'),
  asst('a6', 'claude-sonnet-5'),
  asst('a7', 'claude-sonnet-5'),
];

describe('analyze', () => {
  const turns = turnsFromEntries(entries);
  const report = analyze(turns, extractSignals(entries));

  it('holds baseline ≥ actual ≥ ideal', () => {
    expect(report.allOpusEur).toBeGreaterThanOrEqual(report.actualEur);
    expect(report.actualEur).toBeGreaterThanOrEqual(report.idealEur);
  });

  it('reports a positive, bounded saving vs the all-Opus baseline', () => {
    expect(report.savedVsBaselineEur).toBeGreaterThan(0);
    expect(report.savedPct).toBeGreaterThan(0);
    expect(report.savedPct).toBeLessThan(100);
  });

  it('drives the ideal Opus share to zero for mechanical work', () => {
    expect(report.opusSharePct).toBeGreaterThan(0); // Opus was used for real
    expect(report.idealOpusSharePct).toBe(0); // autopilot would use none
  });

  it('breaks actual spend down by model', () => {
    expect(report.turns).toBe(7);
    expect(Object.keys(report.byModelEur).sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
  });

  it('reports the ideal allocation by model (mechanical → all Haiku)', () => {
    expect(Object.keys(report.idealByModelEur)).toEqual(['claude-haiku-4-5']);
  });
});

describe('projectMonthly', () => {
  it('scales a per-session cost with an explicit assumption', () => {
    const p = projectMonthly(1, 4, 21);
    expect(p.monthlyEur).toBe(84);
    expect(p.assumption).toContain('4 sessions');
  });
});
