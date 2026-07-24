# Implementation Checklist: Cost-Aware Model-Split Autopilot (AgentX)

> Granular task list. Each checkbox = one atomic change. Check off as you go.
> "Checkpoint" = create a git commit at that point before continuing.

**One-liner**: Detect the work _phase_ → know the _right_ model tier → surface live cost → nudge/switch → prove the savings. Anchored on a real pattern: **Opus was the dominant slice of last month's bill.**

**Success metric**: € (or tokens) saved per session vs. an all-Opus baseline; % of "mechanical" turns that ran on Opus (target → ~0); projected monthly org spend before vs. after.

**Legend**
| State | Meaning |
|---|---|
| `[ ]` | Not started |
| `[⏳]` | WIP |
| `[X]` | Done |
| `[-]` | Cancelled — explicitly decided not to do |
| `[!]` | Blocked — needs external action to proceed |
| `[/]` | Skipped / N/A — turned out not to apply |
| `[>]` | Deferred — moved to a future plan |

---

## Parallelization map

> **Context**: Phase 0 freezes the two data contracts (`TurnCost`, `PhaseVerdict`) + the shared `costEngine` lib. After Phase 0, four tracks run flat-out with no cross-dependency; only the nudge hook waits on the classifier (and unblocks early via a mock). Each phase is a vertical slice that demos standalone — a slipped later phase never invalidates an earlier demo.

```
Phase 0 (contracts + core lib)  ──┬───────────────────────────────────────
                                  │
   ┌──────────────┬───────────────┼────────────────┬──────────────────┐
   ▼              ▼               ▼                ▼                  ▼
Phase 1        Phase 2         Phase 4          Phase 5           (P3 waits on P2)
Track A         Track B         Track C          Track D
Statusline      Classifier      SDK autopilot    Analytics report
meter           + indicator     (stretch)        (on recordings)
   │              │
   └──────┬───────┘
          ▼
      Phase 3 / Track E: Nudge hook   ← only true cross-dependency (mockable)
```

**Stack decision**: Node + TypeScript (`tsx` for run, `vitest` for tests). Core lib is framework-free. Phase 5 report is a small Vite + React app (frontend-shaped, judge-facing) — downgradeable to a CLI + static chart if time is short.

**Capability caveat**: plain Claude Code hooks can _recommend_ but cannot run `/model` themselves. Phases 1–3 + 5 are fully achievable with hooks. Genuine hands-off switching (Phase 4) needs the Agent SDK — treat as stretch.

---

## Phase 0 — Foundation, contracts & core cost lib

> **Context**: This phase is the parallelization enabler. It owns everything the four tracks share: the TS types, the pricing table, real transcript fixtures, and the pure `costEngine` function. Ship the CLI demo so Phase 0 already produces a "wow" (your real session cost printed from your own transcript) before any track starts.

### 0.1 Repo scaffold

- [X] Run `git init` in `~/agentx-autopilot`
- [X] Create `package.json` (name `agentx-autopilot`, `type: module`, scripts: `dev`, `test`, `lint`, `cost`)
- [X] Add dev deps: `typescript`, `tsx`, `vitest`, `@types/node`
- [X] Create `tsconfig.json` (NodeNext module resolution, strict, `src/` root)
- [X] Create folder structure: `src/core/`, `src/statusline/`, `src/classifier/`, `src/hook/`, `src/autopilot/`, `src/report/`, `fixtures/`
- [X] Create `.gitignore` (`node_modules`, `dist`, `.env`)
- [X] Create `README.md` with the one-liner, the parallelization map, and per-track ownership

### 0.2 Data contracts

- [X] Create `src/core/types.ts` defining `TurnCost` (`turnId`, `model`, `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `costEur`, `ts`)
- [X] Add `PhaseVerdict` type to `src/core/types.ts` (`phase: 'plan'|'implement'|'verify'|'debug'`, `recommendedModel: string` (a model id, not a fixed enum), `confidence: number`, `signals: string[]`, `estSaveEur: number`)
- [X] Create `src/core/pricing.json` keyed by model id with `{ in, out, cacheRead, cacheWrite }` per-Mtok rates — seed with the current roster (do not hardcode a 3-tier enum anywhere): `claude-haiku-4-5` `{1, 5}`, `claude-sonnet-5` `{3, 15}` (intro `{2, 10}` through 2026-08-31), `claude-opus-4-8` `{5, 25}`, `claude-fable-5` `{10, 50}`; cache rates ≈ `in × 0.1` (read) and `in × 1.25` (write)
- [X] Add a `tierLadder(pricing) -> string[]` helper to `src/core/pricing.ts` that returns model ids sorted cheapest→priciest by input rate — the tier ordering is **derived**, so Fable (top) and any future model slot in without code changes

> **Note**: Sonnet intro pricing (`{2,10}` through 2026-08-31) is modelled as a date-aware override in `pricing.ts` (`getPricing(onDate)`), not baked into the static JSON — so cost math is correct both during and after the promo. Today (2026-07-24) is inside the window.

> **Context**: The cost ladder is Haiku ($1/$5) < Sonnet ($3/$15) < Opus 4.8 ($5/$25) < **Fable 5 ($10/$50)**. Fable is the _most expensive_ tier (2× Opus), not a downshift target — the autopilot must reserve it for genuinely hard reasoning and treat an over-eager Fable recommendation as a budget risk, not a saving.

### 0.3 Fixtures

- [X] Copy 1 real transcript JSONL from `~/.claude/projects/*/` into `fixtures/session-sample.jsonl` (scrub any sensitive content) — done via `scripts/scrub-transcript.mjs` (+ `scripts/make-fixture.sh` wrapper); a personal session (1038 lines, Fable + Opus). Scrub verified: 0 non-redacted text blocks, 0 secret-pattern hits; tool names kept (Edit 114 / Bash 113 / Read 21).
- [X] Add a `fixtures/README.md` noting the transcript schema fields actually present (`message.usage`, `model`, timestamps) — verify field names by reading the sample, do not assume

### 0.4 Core cost engine + CLI demo

- [X] Create `src/core/costEngine.ts`: `parseTranscript(path) -> TurnCost[]` (read JSONL line-by-line, extract per-message model + usage incl. cache tokens, apply `pricing.json`)
- [X] Add `aggregateByModel(turns) -> Record<model, {costEur, turns}>` to `costEngine.ts`
- [X] Create `src/core/cli.ts`: reads a transcript path arg, prints a per-model cost table + total
- [X] Wire `npm run cost` → `tsx src/core/cli.ts`
- [X] Create `src/core/costEngine.test.ts`: assert token→cost math against a hand-computed fixture row (6 tests: Opus math, Sonnet intro/standard boundary, unknown-model guard, tierLadder order, parse+aggregate)
- [X] Run `npm test` — cost engine tests pass (6/6 green)
- [X] **Demo**: `npm run cost fixtures/session-sample.jsonl` prints your real per-model spend + total — **€76.81 total, Fable €53.36 (69%) + Opus €23.45 (31%)** across 421 billable turns. Real "wow": one session, 69% on the priciest tier.

> 💾 **Checkpoint**: `feat(core): add contracts, pricing, fixtures and cost engine CLI`

---

## Phase 1 — Track A: "See the money" (live statusline meter)

> **Context**: Claude Code runs a `statusLine` command each turn and passes a JSON payload on stdin that includes the running session's transcript path. Read that path, run `costEngine`, and render a compact live meter. Verify the exact stdin field name for the transcript path against the payload (log it once) before hardcoding it.

- [ ] Create `src/statusline/statusline.ts`: read stdin JSON, extract transcript path, call `parseTranscript` + `aggregateByModel`
- [ ] Render a one-line meter string: `Opus €0.84 · Sonnet €0.09 · total €0.93`
- [ ] Render an explicit, clearly-labeled **session total** segment (running sum across all turns, formatted `Σ €0.93`) as the meter's anchor
- [ ] Add a `⚠` marker to the meter when Opus share exceeds a threshold (e.g. >60%)
- [ ] Handle the cold-start case (empty/short transcript → `Σ €0.00`) without crashing
- [ ] Add `bin/statusline.sh` wrapper that invokes `tsx src/statusline/statusline.ts`
- [ ] Register the wrapper in `.claude/settings.json` under `statusLine` (in the hackathon repo, not a work repo)
- [ ] Create `src/statusline/statusline.test.ts`: feed a mock stdin payload → assert meter string format
- [ ] Run `npm test` — statusline tests pass
- [ ] **Demo**: open a real Claude Code session in this repo, watch the meter tick and the per-model split grow live

> 💾 **Checkpoint**: `feat(statusline): add live per-model cost meter`

---

## Phase 2 — Track B: "Know the phase" (classifier + passive indicator)

> **Context**: Pure function over the last N turns of the transcript → `PhaseVerdict`. Signals to weigh: tool-mix (Edit/Write heavy = implement; Read/Grep/Explore + no edits = plan; Bash test runs = verify; repeated failures/errors = debug), slash-command / ADLC phase markers (`refine`/`plan` vs `execute`), thinking-to-edit ratio. Keep it deterministic and testable — no LLM call in the hot path.

- [ ] Create `src/classifier/signals.ts`: extract per-turn signals from `TurnCost[]` + raw transcript entries (tool names used, slash commands, edit count)
- [ ] Create `src/classifier/classify.ts`: `classifyPhase(recentTurns) -> PhaseVerdict` with weighted heuristics
- [ ] Map each phase → `recommendedModel` (trivial-mechanical → `claude-haiku-4-5`; implement/verify → `claude-sonnet-5`; plan/hard-debug → `claude-opus-4-8`; reserve `claude-fable-5` only for a high-confidence "hardest reasoning" signal — never a routine recommendation)
- [ ] Compute `estSaveEur` = current-turn cost minus what it would cost at `recommendedModel` (guard the sign: escalating _up_ the ladder — e.g. to Fable/Opus — yields a negative "saving", so surface it as an added-cost warning, not a saving)
- [ ] Populate `signals[]` with human-readable reasons (e.g. `"6 consecutive Edit turns"`)
- [ ] Add `aggregateByPhase(turns) -> Record<phase, {costEur, turns}>` to `src/core/costEngine.ts` (attribute each turn's cost to its detected phase)
- [ ] Extend `src/statusline/statusline.ts` to append the verdict: `… | Implementing → Sonnet recommended`
- [ ] Extend the statusline with a **per-phase cost split** segment: `plan €0.55 · impl €0.30 · verify €0.08` (from `aggregateByPhase`)
- [ ] Add a **tier badge** to the verdict — emoji + ANSI color per model, driven by `tierLadder` position so it stays correct as the roster changes (`🟢 Haiku` / `🟡 Sonnet` / `🟠 Opus` / `🔴 Fable`); verify Claude Code renders ANSI color escapes in the statusline, fall back to emoji-only if not
- [ ] Create `src/classifier/aggregateByPhase.test.ts`: mixed-phase fixture → assert per-phase totals sum to the session total
- [ ] Create `src/classifier/classify.test.ts`: fixtures for each phase (plan-heavy, edit-heavy, test-run, error-loop) → assert phase + tier
- [ ] Run `npm test` — classifier + aggregation tests pass
- [ ] **Demo**: do planning then editing in a live session — watch the tier badge flip `🔴 Opus` → `🟡 Sonnet`, the per-phase split grow, and the session total (`Σ €…`) tick up

> 💾 **Checkpoint**: `feat(classifier): add phase detection and tier recommendation`

---

## Phase 3 — Track E: "Nudge me" (recommendation hook)

> **Context**: A `UserPromptSubmit` (or `Stop`) hook receives a JSON payload including the transcript path and can inject context back into the session via stdout. Run the classifier; when the session is on a costlier tier than recommended for K consecutive turns AND confidence is high, inject a concise nudge with the estimated saving. Debounce so it fires at most once per phase transition — a naggy hook gets disabled.

- [ ] Create `src/hook/nudge.ts`: read hook stdin, get transcript path, run `classifyPhase`, compare current model vs `recommendedTier`
- [ ] Add debounce state (e.g. a small JSON marker file keyed by session id) so the nudge fires once per mismatch streak, not every turn
- [ ] Compose the nudge text: `"N mechanical edits on Opus — switch to /model sonnet, est. save €X.XX this phase."`
- [ ] Emit the nudge as hook additionalContext (verify the exact output contract Claude Code expects; no-op output when no nudge is due)
- [ ] Add `bin/nudge.sh` wrapper and register it under `hooks.UserPromptSubmit` in `.claude/settings.json`
- [ ] Create `src/hook/nudge.test.ts`: mismatch streak → nudge emitted; matched tier → silent; debounce suppresses repeats
- [ ] Run `npm test` — hook tests pass
- [ ] **Demo**: live session doing mechanical edits on Opus gets nudged; hit `/model sonnet`; statusline meter reacts

> 💾 **Checkpoint**: `feat(hook): add cost-aware model-switch nudge`

---

## Phase 4 — Track C: "Autopilot" (SDK auto-switch — stretch)

> **Context**: Genuine hands-off switching is impossible from plain hooks (they advise, they can't run `/model`). This phase builds a thin Agent SDK harness (`@anthropic-ai/claude-agent-sdk`) that selects the model per turn from the live `PhaseVerdict`. Highest risk, so it lands last — Phases 1–3 already stand as demos. Requires an API key.

- [!] Add dep `@anthropic-ai/claude-agent-sdk`; add `ANTHROPIC_API_KEY` to `.env.example`
- [!] Create `src/autopilot/harness.ts`: run a task loop, and before each turn call `classifyPhase` to pick the model tier
- [!] Feed the chosen model into the SDK request per turn; log each switch (`turn 12: implement → sonnet`)
- [!] Reuse `costEngine` to accumulate spend across the autonomous run
- [!] Create a scripted demo task (`src/autopilot/demo-task.ts`) that naturally spans plan → implement → verify
- [!] Print an end-of-run summary: turns per tier, total cost, cost vs all-Opus baseline
- [!] **Demo**: run the harness hands-off; watch the tier auto-switch and Opus used only for the planning/debug spikes

> **⚠ Blocked (2026-07-24)**: Entire phase depends on `ANTHROPIC_API_KEY` (metered Anthropic API), which the enterprise/Team subscription does not provide. Unblocking requires org admin to provision API Console access with billing. Phases 1–3 + 5 remain fully demoable without it.

> 💾 **Checkpoint**: `feat(autopilot): add SDK harness with per-turn model selection`

---

## Phase 5 — Track D: "Prove the savings" (analytics report)

> **Context**: Runs entirely on recorded transcripts, so it can be built in parallel with everything from Phase 0 onward (depends only on `costEngine`). This is the judge-facing slide: baseline vs. autopilot, projected monthly org spend. Build as a small Vite + React dashboard; if time is short, downgrade to a CLI that writes a static `report.html`.

### 5.1 Analytics core

- [ ] Create `src/report/analyze.ts`: given `TurnCost[]`, compute (a) actual cost, (b) all-Opus baseline cost, (c) ideal cost if every turn ran at its recommended tier
- [ ] Add monthly projection helper (scale a session/day sample to a month) with a clearly labeled assumption
- [ ] Create `src/report/analyze.test.ts`: assert baseline ≥ actual ≥ ideal on a mixed fixture
- [ ] Run `npm test` — analytics tests pass

### 5.2 Dashboard

- [ ] Scaffold a Vite + React app under `dashboard/` (or a `report.html` generator if downgrading)
- [ ] Load one or more transcript fixtures and render the before/after bar chart (actual vs all-Opus vs ideal)
- [ ] Add the headline stat: `You'd have spent €X on all-Opus. Autopilot: €Y. Saved Z%.`
- [ ] Add the "Opus was the top slice → now N%" split as a second visual
- [ ] **Demo**: open the dashboard, present the savings chart + monthly org projection

> 💾 **Checkpoint**: `feat(report): add savings analytics and dashboard`

---

## Phase Cleanup — Verify & teardown

> **Context**: Mandatory final phase. Enforces that every checkbox is resolved (no `[ ]`, no `[⏳]`). If any `[!]` items remain or the Drift Log has unprocessed rows, the Refine loop kicks in here: trigger Mode C, execute the appended Refine phase, then re-run cleanup until it passes. On success, deletes this checklist file and commits the deletion as the Final checkpoint.

- [ ] Scan for `[ ]` items. For each: either complete the work (→ `[X]`) or mark with the appropriate terminal state (`[-]`, `[/]`, `[>]`)
- [ ] Scan for `[⏳]` items. Each one indicates aborted work — investigate and transition to a terminal state
- [ ] Run `npm test` across all tracks — full suite green
- [ ] Verify the end-to-end demo path once (statusline meter → classifier flip → nudge → savings dashboard)
- [ ] If any `[!]` items remain OR the Drift Log has unprocessed rows: trigger Mode C → Refine, execute the appended `Phase Refine N`, then return to the top of this cleanup phase
- [ ] Delete this checklist file and commit using the Final checkpoint message below (the deletion is the commit)

> 💾 **Final checkpoint**: `chore: complete cost-aware autopilot and remove checklist`

---

## Drift Log

> Append a row whenever you annotate a `⚠ Stale` callout above.
> Keep the original context untouched — this table is the consolidated index.

| Phase                                       | Where (heading or file:line) | Stale claim | Actual | Cause | Detected |
| ------------------------------------------- | ---------------------------- | ----------- | ------ | ----- | -------- |
| _(empty initially — fill during execution)_ |                              |             |        |       |          |
