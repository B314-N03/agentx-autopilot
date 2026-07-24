import { describe, it, expect } from 'vitest';
import { resolveSwitcher, modelAlias, buildSwitchCommand, buildInjectCommands, performSwitch } from './switch.js';

describe('resolveSwitcher', () => {
  it('prefers tmux when $TMUX is set', () => {
    expect(resolveSwitcher({ TMUX: '/tmp/tmux-501/default,1,0', TERM_PROGRAM: 'iTerm.app' })).toBe('tmux');
  });
  it('falls back to iterm on macOS iTerm', () => {
    expect(resolveSwitcher({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm');
  });
  it('is none when no backend is available', () => {
    expect(resolveSwitcher({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('none');
    expect(resolveSwitcher({})).toBe('none');
  });
});

describe('modelAlias', () => {
  it('derives the /model alias from the id', () => {
    expect(modelAlias('claude-sonnet-5')).toBe('sonnet');
    expect(modelAlias('claude-haiku-4-5')).toBe('haiku');
  });
});

describe('buildSwitchCommand', () => {
  it('builds a tmux send-keys command targeting the pane', () => {
    const cmd = buildSwitchCommand('tmux', 'haiku', { TMUX_PANE: '%3' });
    expect(cmd).toEqual({ cmd: 'tmux', args: ['send-keys', '-t', '%3', '/model haiku', 'Enter'] });
  });
  it('builds an osascript write-text command for iTerm', () => {
    const cmd = buildSwitchCommand('iterm', 'sonnet', {});
    expect(cmd?.cmd).toBe('osascript');
    expect(cmd?.args[0]).toBe('-e');
    expect(cmd?.args[1]).toContain('iTerm2');
    expect(cmd?.args[1]).toContain('write text "/model sonnet"');
  });
  it('returns null when there is no backend', () => {
    expect(buildSwitchCommand('none', 'haiku', {})).toBeNull();
  });
});

describe('buildInjectCommands', () => {
  it('emits one submit-per-line for tmux', () => {
    const cmds = buildInjectCommands('tmux', ['/model haiku', 'fix the bug'], { TMUX_PANE: '%1' });
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toEqual({ cmd: 'tmux', args: ['send-keys', '-t', '%1', '/model haiku', 'Enter'] });
    expect(cmds[1]!.args).toContain('fix the bug');
  });

  it('emits osascript write-text per line for iterm, escaping quotes', () => {
    const cmds = buildInjectCommands('iterm', ['/model sonnet', 'say "hi"'], {});
    expect(cmds).toHaveLength(2);
    expect(cmds[0]!.args[1]).toContain('write text "/model sonnet"');
    expect(cmds[1]!.args[1]).toContain('write text "say \\"hi\\""'); // quotes escaped for AppleScript
  });

  it('returns nothing when there is no backend', () => {
    expect(buildInjectCommands('none', ['/model haiku'], {})).toEqual([]);
  });
});

describe('performSwitch (dry-run never executes)', () => {
  it('returns the intended command without spawning', () => {
    const res = performSwitch('claude-haiku-4-5', { TERM_PROGRAM: 'iTerm.app' }, { dryRun: true });
    expect(res.attempted).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.kind).toBe('iterm');
    expect(res.command?.args[1]).toContain('write text "/model haiku"');
  });
  it('reports no backend without attempting', () => {
    const res = performSwitch('claude-haiku-4-5', {}, { dryRun: true });
    expect(res.command).toBeNull();
    expect(res.attempted).toBe(false);
  });
});
