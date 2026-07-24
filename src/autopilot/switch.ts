import { spawnSync } from 'node:child_process';
import { shortModelName } from '../core/modelLabel.js';

/**
 * Path 2 auto-switch: inject `/model <tier>` into the LIVE Claude Code TUI by
 * simulating the keystrokes — no API key, subscription auth. This is the
 * "keep chatting, model self-optimizes" path. Fragile by nature (depends on
 * the terminal), opt-in only, and downshift-only (the caller guarantees the
 * recommendation is cheaper than the current tier).
 */
export type SwitcherKind = 'tmux' | 'iterm' | 'none';

export interface SwitchEnv {
  TMUX?: string;
  TMUX_PANE?: string;
  TERM_PROGRAM?: string;
}

/** Pick the available keystroke-injection backend from the environment. */
export function resolveSwitcher(env: SwitchEnv): SwitcherKind {
  if (env.TMUX) return 'tmux';
  if (env.TERM_PROGRAM === 'iTerm.app') return 'iterm';
  return 'none';
}

/** `/model` alias for a model id (e.g. claude-sonnet-5 → "sonnet"). */
export function modelAlias(model: string): string {
  return shortModelName(model).toLowerCase();
}

export interface SwitchCommand {
  cmd: string;
  args: string[];
}

/**
 * Build the argv that types `/model <alias>` + Enter for a backend. The alias
 * is derived from a model id (alphanumeric only), so there is no shell/AppleScript
 * injection surface. Returns null when no backend is available.
 */
export function buildSwitchCommand(
  kind: SwitcherKind,
  alias: string,
  env: SwitchEnv,
): SwitchCommand | null {
  const text = `/model ${alias}`;
  switch (kind) {
    case 'tmux':
      return { cmd: 'tmux', args: ['send-keys', '-t', env.TMUX_PANE ?? '', text, 'Enter'] };
    case 'iterm':
      return {
        cmd: 'osascript',
        args: [
          '-e',
          `tell application "iTerm2" to tell current window to tell current session to write text "${text}"`,
        ],
      };
    case 'none':
      return null;
  }
}

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
function osaEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build one keystroke command per line, for injecting a SEQUENCE into the live
 * TUI — e.g. `/model sonnet` followed by a re-submitted prompt. Each line is
 * typed and submitted (Enter). Single-line entries are reliable; embedded
 * newlines are a known rough edge (they submit early in the TUI).
 */
export function buildInjectCommands(kind: SwitcherKind, lines: string[], env: SwitchEnv): SwitchCommand[] {
  const out: SwitchCommand[] = [];
  for (const line of lines) {
    if (kind === 'tmux') {
      out.push({ cmd: 'tmux', args: ['send-keys', '-t', env.TMUX_PANE ?? '', line, 'Enter'] });
    } else if (kind === 'iterm') {
      out.push({
        cmd: 'osascript',
        args: [
          '-e',
          `tell application "iTerm2" to tell current window to tell current session to write text "${osaEscape(line)}"`,
        ],
      });
    }
  }
  return out;
}

export interface SwitchResult {
  kind: SwitcherKind;
  command: SwitchCommand | null;
  attempted: boolean;
  dryRun: boolean;
  /** True only when the backend actually ran and exited 0. */
  ok: boolean;
}

/**
 * Perform the live model switch. Side-effecting (spawns the backend) unless
 * `dryRun`, which returns the command it would have run without executing it.
 * First real run may trigger a macOS Automation-permission prompt for iTerm;
 * `ok` reflects whether the injection actually succeeded (exit 0).
 */
export function performSwitch(
  model: string,
  env: SwitchEnv = process.env,
  opts: { dryRun?: boolean } = {},
): SwitchResult {
  const kind = resolveSwitcher(env);
  const command = buildSwitchCommand(kind, modelAlias(model), env);
  const dryRun = !!opts.dryRun;
  if (!command) return { kind, command: null, attempted: false, dryRun, ok: false };
  if (dryRun) return { kind, command, attempted: false, dryRun, ok: false };
  const res = spawnSync(command.cmd, command.args, { stdio: 'ignore' });
  return { kind, command, attempted: true, dryRun, ok: res.status === 0 && !res.error };
}
