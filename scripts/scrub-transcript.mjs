#!/usr/bin/env node
// Scrub a real Claude Code transcript into a safe fixture.
// Keeps cost- and phase-relevant structure (usage, model, timestamps, tool
// names, slash-command tokens); redacts all prose, code, tool inputs/results,
// cwd, and branch names.
//
// Usage: node scripts/scrub-transcript.mjs <source.jsonl> [out.jsonl]
//   With no out path, runs in report-only mode (prints model distribution).

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const src = process.argv[2];
const out = process.argv[3];
if (!src) {
  console.error('usage: node scripts/scrub-transcript.mjs <source.jsonl> [out.jsonl]');
  process.exit(1);
}

const KEEP_TOP = new Set(['type', 'timestamp', 'uuid', 'parentUuid', 'isSidechain']);

function scrubContent(content) {
  if (typeof content === 'string') {
    const t = content.trim();
    if (t.startsWith('/')) return t.split(/\s/)[0]; // keep slash-command token only
    return '[redacted]';
  }
  if (!Array.isArray(content)) return '[redacted]';
  return content.map((b) => {
    if (!b || typeof b !== 'object') return { type: 'unknown' };
    if (b.type === 'tool_use') return { type: 'tool_use', name: b.name };
    if (b.type === 'tool_result') return { type: 'tool_result' };
    if (b.type === 'thinking') return { type: 'thinking' };
    if (b.type === 'text') {
      const t = (b.text || '').trim();
      return { type: 'text', text: t.startsWith('/') ? t.split(/\s/)[0] : '[redacted]' };
    }
    return { type: b.type || 'unknown' };
  });
}

const rl = createInterface({ input: createReadStream(src), crlfDelay: Infinity });
const lines = [];
const models = {};
let total = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  total++;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  const s = {};
  for (const k of KEEP_TOP) if (k in o) s[k] = o[k];
  if (o.message && typeof o.message === 'object') {
    const m = o.message;
    s.message = {
      role: m.role,
      ...(m.model ? { model: m.model } : {}),
      ...(m.type ? { type: m.type } : {}),
      ...(m.stop_reason ? { stop_reason: m.stop_reason } : {}),
      ...(m.usage ? { usage: {
        input_tokens: m.usage.input_tokens ?? 0,
        output_tokens: m.usage.output_tokens ?? 0,
        cache_read_input_tokens: m.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: m.usage.cache_creation_input_tokens ?? 0,
      } } : {}),
      ...(m.content !== undefined ? { content: scrubContent(m.content) } : {}),
    };
    if (m.model) models[m.model] = (models[m.model] || 0) + 1;
  }
  lines.push(JSON.stringify(s));
}

console.log('src lines:', total, '| models:', JSON.stringify(models));
if (out) {
  writeFileSync(out, lines.join('\n') + '\n');
  console.log('wrote', out, '(' + lines.length + ' lines)');
} else {
  console.log('report-only (no out path given) — nothing written');
}
