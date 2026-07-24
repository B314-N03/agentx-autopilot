import { describe, it, expect } from 'vitest';
import { classifyPromptHeuristic, bucketToModel } from './promptRoute.js';

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-5';
const OPUS = 'claude-opus-4-8';
const FABLE = 'claude-fable-5';

describe('bucketToModel', () => {
  it('maps buckets to ladder positions, never the top tier', () => {
    expect(bucketToModel('trivial')).toBe(HAIKU);
    expect(bucketToModel('standard')).toBe(SONNET);
    expect(bucketToModel('hard')).toBe(OPUS);
    expect([HAIKU, SONNET, OPUS]).not.toContain(FABLE);
  });
});

describe('classifyPromptHeuristic', () => {
  it('routes mechanical prompts to Haiku', () => {
    expect(classifyPromptHeuristic('fix a typo in the README').model).toBe(HAIKU);
    expect(classifyPromptHeuristic('rename this variable').model).toBe(HAIKU);
  });

  it('routes normal implementation to Sonnet', () => {
    expect(classifyPromptHeuristic('add a loading spinner to the button').model).toBe(SONNET);
    expect(classifyPromptHeuristic('write tests for the parser').model).toBe(SONNET);
  });

  it('routes design/debug/reasoning to Opus', () => {
    expect(classifyPromptHeuristic('design the auth architecture').model).toBe(OPUS);
    expect(classifyPromptHeuristic('why is this test flaky, investigate the race').model).toBe(OPUS);
  });

  it('defaults ambiguous prompts to Sonnet (mid), never the top tier', () => {
    const v = classifyPromptHeuristic('hmm what about this');
    expect(v.model).toBe(SONNET);
    expect(v.model).not.toBe(FABLE);
  });
});
