import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderMeter, buildStatusline, shortModelName } from './statusline.js';
import type { TurnCost } from '../core/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '..', '..', 'fixtures', 'cost-math.jsonl');

function turn(model: string, costEur: number): TurnCost {
  return { turnId: 't', model, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costEur, ts: '' };
}

describe('shortModelName', () => {
  it('derives the family label from the model id', () => {
    expect(shortModelName('claude-opus-4-8')).toBe('Opus');
    expect(shortModelName('claude-sonnet-5')).toBe('Sonnet');
    expect(shortModelName('claude-haiku-4-5')).toBe('Haiku');
    expect(shortModelName('claude-fable-5')).toBe('Fable');
  });
});

describe('renderMeter', () => {
  it('lists models priciest-first with a session-total anchor', () => {
    const meter = renderMeter([turn('claude-sonnet-5', 0.09), turn('claude-fable-5', 0.5)]);
    expect(meter).toBe('Fable €0.50 · Sonnet €0.09 · Σ €0.59');
  });

  it('flags ⚠ when Opus share exceeds 60%', () => {
    const meter = renderMeter([turn('claude-opus-4-8', 0.8), turn('claude-sonnet-5', 0.1)]);
    expect(meter).toContain('⚠');
  });

  it('does not flag ⚠ when Opus is a minority of spend', () => {
    const meter = renderMeter([turn('claude-fable-5', 0.7), turn('claude-opus-4-8', 0.3)]);
    expect(meter).not.toContain('⚠');
  });

  it('cold-starts to Σ €0.00 on no turns', () => {
    expect(renderMeter([])).toBe('Σ €0.00');
  });
});

describe('buildStatusline', () => {
  it('parses a payload transcript path into meter | phase split | verdict', async () => {
    const meter = await buildStatusline({ transcript_path: fixture });
    // cost-math fixture has no tool signals → safe implement default (Sonnet).
    // Opus 86% share → ⚠; both turns attribute to impl; total €0.10.
    expect(meter).toBe(
      'Opus €0.09 · Sonnet €0.01 · Σ €0.10 ⚠ | impl €0.10 | Implementing → 🟡 Sonnet recommended',
    );
  });

  it('cold-starts on a missing transcript path without crashing', async () => {
    expect(await buildStatusline({})).toBe('Σ €0.00');
    expect(await buildStatusline({ transcript_path: '/no/such/file.jsonl' })).toBe('Σ €0.00');
    expect(await buildStatusline(null)).toBe('Σ €0.00');
  });
});
