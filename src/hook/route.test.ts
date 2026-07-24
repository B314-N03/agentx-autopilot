import { describe, it, expect } from 'vitest';
import { decideRoute, shouldSkip, currentIsTier } from './route.js';
import type { RouteVerdict } from '../classifier/promptRoute.js';

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5';

const classifyTo =
  (model: string) =>
  (_p: string): RouteVerdict => ({ model, bucket: 'standard', reason: 'test', via: 'heuristic' });
const hash = (p: string) => `h:${p}`;

describe('shouldSkip', () => {
  it('skips slash commands, empties, and single-word acks', () => {
    expect(shouldSkip('/model opus')).toBe(true);
    expect(shouldSkip('   ')).toBe(true);
    expect(shouldSkip('ok')).toBe(true);
    expect(shouldSkip('continue')).toBe(true);
  });
  it('does not skip meaningful prompts', () => {
    expect(shouldSkip('fix this typo')).toBe(false);
    expect(shouldSkip('design the architecture')).toBe(false);
  });
});

describe('currentIsTier', () => {
  it('matches on the tier family regardless of id format', () => {
    expect(currentIsTier('opus[1m]', OPUS)).toBe(true);
    expect(currentIsTier('claude-opus-4-8', OPUS)).toBe(true);
    expect(currentIsTier('sonnet', SONNET)).toBe(true);
    expect(currentIsTier('opus[1m]', SONNET)).toBe(false);
  });
});

describe('decideRoute', () => {
  it('skips slash commands without classifying', () => {
    let called = false;
    const spy = (_p: string): RouteVerdict => {
      called = true;
      return classifyTo(SONNET)('');
    };
    expect(decideRoute('/foo', OPUS, undefined, spy, hash).action).toBe('skip');
    expect(called).toBe(false);
  });

  it('allows the re-injected submission (marker matches) without reclassifying', () => {
    let called = false;
    const spy = (_p: string): RouteVerdict => {
      called = true;
      return classifyTo(SONNET)('');
    };
    const d = decideRoute('fix the bug', OPUS, hash('fix the bug'), spy, hash);
    expect(d.action).toBe('allow');
    expect(called).toBe(false);
  });

  it('allows when already on the recommended tier', () => {
    const d = decideRoute('add a feature', 'opus[1m]', undefined, classifyTo(OPUS), hash);
    expect(d.action).toBe('allow');
  });

  it('reroutes on a tier mismatch, exposing the /model alias', () => {
    const d = decideRoute('add a feature', 'opus[1m]', undefined, classifyTo(SONNET), hash);
    expect(d.action).toBe('reroute');
    expect(d.target).toBe(SONNET);
    expect(d.alias).toBe('sonnet');
  });
});
