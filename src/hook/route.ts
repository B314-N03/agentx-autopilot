import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveSwitcher, buildInjectCommands, modelAlias, type SwitcherKind } from '../autopilot/switch.js';
import { classifyPromptViaHaiku, type RouteVerdict } from '../classifier/promptRoute.js';

/**
 * UserPromptSubmit router: classify the prompt, and if the session is on the
 * wrong tier, BLOCK the prompt and re-inject `/model <tier>` + the prompt so
 * THIS turn runs right-sized. A per-session marker (prompt hash) guarantees the
 * re-injected prompt runs exactly once without re-routing (termination).
 */

const META_ACKS = new Set([
  'ok', 'okay', 'continue', 'go', 'yes', 'no', 'y', 'n', 'yep', 'sure', 'thanks', 'stop', 'wait', 'done', 'next',
]);

/** Prompts we never reroute on (slash commands, empty, single-word acks). */
export function shouldSkip(prompt: string): boolean {
  const t = prompt.trim();
  if (!t || t.startsWith('/')) return true;
  const words = t.split(/\s+/);
  return words.length === 1 && META_ACKS.has(t.toLowerCase());
}

/** Does the session's current model already represent the target tier? */
export function currentIsTier(currentModel: string, targetModel: string): boolean {
  // currentModel may be "opus[1m]", "claude-opus-4-8", "opus", … — match on the
  // family alias word, which is unique per tier (haiku/sonnet/opus/fable).
  return currentModel.toLowerCase().includes(modelAlias(targetModel));
}

export interface RouteDecision {
  action: 'skip' | 'allow' | 'reroute';
  target?: string;
  alias?: string;
  reason?: string;
  via?: string;
}

/**
 * Pure routing decision. `priorHash` is the marker from a prior reroute; when it
 * matches this prompt, this submission IS the re-injected one → allow without
 * reclassifying. Otherwise classify and reroute only on a real tier mismatch.
 */
export function decideRoute(
  prompt: string,
  currentModel: string,
  priorHash: string | undefined,
  classify: (p: string) => RouteVerdict,
  hashFn: (p: string) => string,
): RouteDecision {
  if (shouldSkip(prompt)) return { action: 'skip' };
  if (priorHash && priorHash === hashFn(prompt)) return { action: 'allow' };
  const v = classify(prompt);
  if (currentIsTier(currentModel, v.model)) return { action: 'allow' };
  return { action: 'reroute', target: v.model, alias: modelAlias(v.model), reason: v.reason, via: v.via };
}

// ---- IO layer -------------------------------------------------------------

function promptHash(p: string): string {
  return createHash('sha1').update(p).digest('hex').slice(0, 16);
}

function markerPath(sessionId: string): string {
  const dir = join(tmpdir(), 'agentx-autopilot');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || 'default';
  return join(dir, `route-${safe}`);
}

function readMarker(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
  } catch {
    return undefined;
  }
}

function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Fire the re-injection AFTER this hook exits and the block settles: a detached
 * shell sleeps briefly, types `/model <alias>` (submit), then the prompt (submit).
 */
function scheduleReinject(kind: SwitcherKind, alias: string, prompt: string): boolean {
  const cmds = buildInjectCommands(kind, [`/model ${alias}`, prompt], process.env);
  if (!cmds.length) return false;
  const parts = cmds.map((c) => [c.cmd, ...c.args].map(shq).join(' '));
  const shell = 'sleep 0.4; ' + parts.join('; sleep 0.25; ');
  spawn('bash', ['-c', shell], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

function main(): void {
  if (process.env.AGENTX_ROUTE !== '1') return; // opt-in

  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return;
  }
  let payload: any = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const prompt: string = typeof payload.prompt === 'string' ? payload.prompt : '';
  const currentModel: string = typeof payload.model === 'string' ? payload.model : '';
  const sessionId: string = payload.session_id ?? payload.sessionId ?? 'default';
  if (!prompt) return;

  const kind = resolveSwitcher(process.env);
  if (kind === 'none') return; // no injection backend → run as-is

  const mPath = markerPath(sessionId);
  const prior = readMarker(mPath);
  const decision = decideRoute(prompt, currentModel, prior, classifyPromptViaHaiku, promptHash);

  if (decision.action === 'reroute' && decision.alias) {
    if (process.env.AGENTX_ROUTE_DRYRUN === '1') {
      const cmds = buildInjectCommands(kind, [`/model ${decision.alias}`, prompt], process.env);
      process.stderr.write(
        `[route DRYRUN] would reroute → /model ${decision.alias} (${decision.reason}) via ${decision.via}; ` +
          `backend=${kind}; ${cmds.length} inject cmds\n`,
      );
      return; // no block, no keystrokes
    }
    try {
      writeFileSync(mPath, promptHash(prompt));
    } catch {
      /* best-effort */
    }
    scheduleReinject(kind, decision.alias, prompt);
    process.stderr.write(`↻ AgentX routing → /model ${decision.alias} (${decision.reason})`);
    process.exit(2); // block + erase; the detached re-injector re-runs it on the new tier
  }

  // allow or skip → clear any pending marker and let the prompt run
  try {
    if (existsSync(mPath)) unlinkSync(mPath);
  } catch {
    /* best-effort */
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
