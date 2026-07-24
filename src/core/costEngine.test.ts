import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { costTurn, parseTranscript, aggregateByModel } from './costEngine.js';
import { getPricing, tierLadder } from './pricing.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '..', '..', 'fixtures', 'cost-math.jsonl');

describe('costTurn', () => {
  it('computes Opus cost from hand-verified rates', () => {
    // Opus: in 5, out 25, cacheRead 0.5, cacheWrite 6.25 (per Mtok)
    // (1000*5 + 2000*25 + 10000*0.5 + 4000*6.25) / 1e6 = 85000/1e6 = 0.085
    const cost = costTurn(
      { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 4000 },
      'claude-opus-4-8',
      getPricing(),
    );
    expect(cost).toBeCloseTo(0.085, 6);
  });

  it('applies Sonnet intro pricing before 2026-08-31', () => {
    // intro: in 2, out 10, cacheRead 0.2, cacheWrite 2.5
    // (500*2 + 1000*10 + 2000*0.2 + 800*2.5)/1e6 = 13400/1e6 = 0.0134
    const cost = costTurn(
      { input_tokens: 500, output_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 800 },
      'claude-sonnet-5',
      getPricing('2026-07-24'),
    );
    expect(cost).toBeCloseTo(0.0134, 6);
  });

  it('reverts to standard Sonnet pricing after the intro window', () => {
    // standard: in 3, out 15, cacheRead 0.3, cacheWrite 3.75
    // (500*3 + 1000*15 + 2000*0.3 + 800*3.75)/1e6 = 20100/1e6 = 0.0201
    const cost = costTurn(
      { input_tokens: 500, output_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 800 },
      'claude-sonnet-5',
      getPricing('2026-09-01'),
    );
    expect(cost).toBeCloseTo(0.0201, 6);
  });

  it('returns 0 for an unknown model rather than crashing', () => {
    expect(costTurn({ input_tokens: 100 }, 'claude-unknown-9', getPricing())).toBe(0);
  });
});

describe('tierLadder', () => {
  it('sorts cheapest → priciest by input rate, Fable on top', () => {
    expect(tierLadder()).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-fable-5',
    ]);
  });
});

describe('parseTranscript + aggregateByModel', () => {
  it('skips non-billable turns and aggregates by model', async () => {
    const turns = await parseTranscript(fixture);
    expect(turns).toHaveLength(2); // the user line has no usage → skipped

    const byModel = aggregateByModel(turns);
    expect(byModel['claude-opus-4-8']!.turns).toBe(1);
    expect(byModel['claude-opus-4-8']!.costEur).toBeCloseTo(0.085, 6);
    expect(byModel['claude-sonnet-5']!.costEur).toBeCloseTo(0.0134, 6); // intro pricing via turn date

    const total = turns.reduce((s, t) => s + t.costEur, 0);
    expect(total).toBeCloseTo(0.0984, 6);
  });
});
