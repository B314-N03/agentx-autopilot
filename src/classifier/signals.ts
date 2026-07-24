/**
 * Deterministic signal extraction from raw transcript entries. No LLM call —
 * this runs in the statusline/hook hot path, so it must stay cheap and pure.
 */

export interface TurnSignals {
  turnId: string;
  role: 'user' | 'assistant' | 'other';
  /** tool_use names invoked in this turn. */
  tools: string[];
  /** Slash-command tokens found in user text (e.g. "/sv-adlc:plan"). */
  slashCommands: string[];
  /** Bash command strings, when the transcript carries tool inputs. */
  bashCommands: string[];
  /** Whether this assistant turn contained a thinking block. */
  thinking: boolean;
  /** tool_result blocks flagged is_error (failures → debug signal). */
  toolResultErrors: number;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const TEST_RE = /\b(vitest|jest|pytest|npm (run )?test|yarn test|pnpm test|just test|go test|cargo test|mvn test|gradle test)\b/i;

function firstToken(s: string): string {
  return s.trim().split(/\s+/)[0] ?? '';
}

/** Extract per-turn signals from raw transcript entries. */
export function extractSignals(entries: any[]): TurnSignals[] {
  const out: TurnSignals[] = [];
  for (const entry of entries) {
    const msg = entry?.message;
    if (!msg || typeof msg !== 'object') continue;

    const role: TurnSignals['role'] =
      msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'other';
    const sig: TurnSignals = {
      turnId: entry.uuid ?? `turn-${out.length}`,
      role,
      tools: [],
      slashCommands: [],
      bashCommands: [],
      thinking: false,
      toolResultErrors: 0,
    };

    const content = msg.content;
    if (typeof content === 'string') {
      if (content.trim().startsWith('/')) sig.slashCommands.push(firstToken(content));
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        switch (block.type) {
          case 'tool_use':
            if (typeof block.name === 'string') sig.tools.push(block.name);
            if (block.name === 'Bash' && typeof block.input?.command === 'string') {
              sig.bashCommands.push(block.input.command);
            }
            break;
          case 'thinking':
            sig.thinking = true;
            break;
          case 'tool_result':
            if (block.is_error) sig.toolResultErrors += 1;
            break;
          case 'text':
            if (typeof block.text === 'string' && block.text.trim().startsWith('/')) {
              sig.slashCommands.push(firstToken(block.text));
            }
            break;
        }
      }
    }
    out.push(sig);
  }
  return out;
}

export interface WindowSummary {
  edits: number;
  reads: number;
  bashRuns: number;
  testRuns: number;
  errors: number;
  planMarkers: number;
  executeMarkers: number;
  thinkingTurns: number;
  assistantTurns: number;
}

const PLAN_MARKER_RE = /(refine|plan|breakdown)/i;
const EXECUTE_MARKER_RE = /(execute|quick|bug-fix|chore|address-feedback)/i;

/** Roll a window of per-turn signals up into the counts the classifier weighs. */
export function summarize(signals: TurnSignals[]): WindowSummary {
  const s: WindowSummary = {
    edits: 0,
    reads: 0,
    bashRuns: 0,
    testRuns: 0,
    errors: 0,
    planMarkers: 0,
    executeMarkers: 0,
    thinkingTurns: 0,
    assistantTurns: 0,
  };
  for (const t of signals) {
    for (const tool of t.tools) {
      if (EDIT_TOOLS.has(tool)) s.edits += 1;
      else if (READ_TOOLS.has(tool)) s.reads += 1;
      else if (tool === 'Bash') s.bashRuns += 1;
    }
    for (const cmd of t.bashCommands) if (TEST_RE.test(cmd)) s.testRuns += 1;
    for (const slash of t.slashCommands) {
      if (PLAN_MARKER_RE.test(slash)) s.planMarkers += 1;
      if (EXECUTE_MARKER_RE.test(slash)) s.executeMarkers += 1;
    }
    s.errors += t.toolResultErrors;
    if (t.thinking) s.thinkingTurns += 1;
    if (t.role === 'assistant') s.assistantTurns += 1;
  }
  return s;
}
