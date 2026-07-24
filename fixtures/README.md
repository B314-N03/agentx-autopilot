# Fixtures

## `cost-math.jsonl`

Tiny **synthetic** fixture with hand-computed token counts, used by
`costEngine.test.ts` to pin the token→cost math. Not real session data.

## `session-sample.jsonl`

A **scrubbed real** Claude Code transcript, produced by
`scripts/scrub-transcript.mjs` (see repo root). The scrubber keeps only the
cost- and phase-relevant structure and redacts everything else:

- **Kept**: `type`, `timestamp`, `uuid`, `parentUuid`, `isSidechain`,
  `message.{role, model, type, stop_reason}`, `message.usage.*`, content-block
  `type` + tool `name`, and slash-command tokens (e.g. `/sv-adlc:plan`).
- **Redacted**: all prose/code text, tool inputs, tool results, `cwd`,
  `gitBranch`, prompts, titles — anything that could carry secrets or
  proprietary content.

> Not committed automatically — run the scrubber against one of your own
> sessions (see repo README / the CHECKLIST 0.3 step). Prefer a *personal*
> project session over employer-proprietary ones.

## Transcript schema (verified against a real session, 2026-07-24)

Each line is one JSON entry. Fields actually present:

**Top level**: `type` (`user` | `assistant` | others), `timestamp` (ISO 8601,
the field is literally `timestamp`), `uuid`, `parentUuid`, `sessionId`, `cwd`,
`gitBranch`, `message`, `toolUseResult`, `isSidechain`, and many more.

**`message`**: `role`, `model` (e.g. `claude-opus-4-8`, `claude-sonnet-5`,
`claude-fable-5` — only on `assistant` turns), `type`, `content`, `usage`,
`stop_reason`.

**`message.usage`** (only on assistant turns — these are the billable turns):

| Field | Meaning |
|-------|---------|
| `input_tokens` | Non-cached input tokens (cached tokens are counted separately) |
| `output_tokens` | Generated tokens |
| `cache_read_input_tokens` | Tokens served from cache (cheap) |
| `cache_creation_input_tokens` | Tokens written to cache (billed as cache-write) |

`usage` also carries `cache_creation.{ephemeral_1h,ephemeral_5m}`,
`service_tier`, `server_tool_use`, etc. — not used for base cost.
