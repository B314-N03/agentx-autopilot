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

**Capability caveat**: a _pure_ hook (JSON-on-stdout only) can _recommend_ but cannot run `/model`. Phases 1–3 + 5 are fully achievable with hooks. Auto-switching (Phase 4) does **not** need an API key: a hook can inject `/model` into the live TUI via `tmux send-keys`/`osascript` (Path 2), or a headless `claude -p --model` loop can switch per turn on subscription auth (Path 1). Both are subscription-authed; still stretch (fragile / autonomous-only respectively).

---

## Phase 0 — Foundation, contracts & core cost lib

> **Context**: This phase is the parallelization enabler. It owns everything the four tracks share: the TS types, the pricing table, real transcript fixtures, and the pure `costEngine` function. Ship the CLI demo so Phase 0 already produces a "wow" (your real session cost printed from your own transcript) before any track starts.

### 0.1 Repo scaffold

- [x] Run `git init` in `~/agentx-autopilot`
- [x] Create `package.json` (name `agentx-autopilot`, `type: module`, scripts: `dev`, `test`, `lint`, `cost`)
- [x] Add dev deps: `typescript`, `tsx`, `vitest`, `@types/node`
- [x] Create `tsconfig.json` (NodeNext module resolution, strict, `src/` root)
- [x] Create folder structure: `src/core/`, `src/statusline/`, `src/classifier/`, `src/hook/`, `src/autopilot/`, `src/report/`, `fixtures/`
- [x] Create `.gitignore` (`node_modules`, `dist`, `.env`)
- [x] Create `README.md` with the one-liner, the parallelization map, and per-track ownership

### 0.2 Data contracts

- [x] Create `src/core/types.ts` defining `TurnCost` (`turnId`, `model`, `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `costEur`, `ts`)
- [x] Add `PhaseVerdict` type to `src/core/types.ts` (`phase: 'plan'|'implement'|'verify'|'debug'`, `recommendedModel: string` (a model id, not a fixed enum), `confidence: number`, `signals: string[]`, `estSaveEur: number`)
- [x] Create `src/core/pricing.json` keyed by model id with `{ in, out, cacheRead, cacheWrite }` per-Mtok rates — seed with the current roster (do not hardcode a 3-tier enum anywhere): `claude-haiku-4-5` `{1, 5}`, `claude-sonnet-5` `{3, 15}` (intro `{2, 10}` through 2026-08-31), `claude-opus-4-8` `{5, 25}`, `claude-fable-5` `{10, 50}`; cache rates ≈ `in × 0.1` (read) and `in × 1.25` (write)
- [x] Add a `tierLadder(pricing) -> string[]` helper to `src/core/pricing.ts` that returns model ids sorted cheapest→priciest by input rate — the tier ordering is **derived**, so Fable (top) and any future model slot in without code changes

> **Note**: Sonnet intro pricing (`{2,10}` through 2026-08-31) is modelled as a date-aware override in `pricing.ts` (`getPricing(onDate)`), not baked into the static JSON — so cost math is correct both during and after the promo. Today (2026-07-24) is inside the window.

> **Context**: The cost ladder is Haiku ($1/$5) < Sonnet ($3/$15) < Opus 4.8 ($5/$25) < **Fable 5 ($10/$50)**. Fable is the _most expensive_ tier (2× Opus), not a downshift target — the autopilot must reserve it for genuinely hard reasoning and treat an over-eager Fable recommendation as a budget risk, not a saving.

### 0.3 Fixtures

- [x] Copy 1 real transcript JSONL from `~/.claude/projects/*/` into `fixtures/session-sample.jsonl` (scrub any sensitive content) — done via `scripts/scrub-transcript.mjs` (+ `scripts/make-fixture.sh` wrapper); a personal session (1038 lines, Fable + Opus). Scrub verified: 0 non-redacted text blocks, 0 secret-pattern hits; tool names kept (Edit 114 / Bash 113 / Read 21).
- [x] Add a `fixtures/README.md` noting the transcript schema fields actually present (`message.usage`, `model`, timestamps) — verify field names by reading the sample, do not assume

### 0.4 Core cost engine + CLI demo

- [x] Create `src/core/costEngine.ts`: `parseTranscript(path) -> TurnCost[]` (read JSONL line-by-line, extract per-message model + usage incl. cache tokens, apply `pricing.json`)
- [x] Add `aggregateByModel(turns) -> Record<model, {costEur, turns}>` to `costEngine.ts`
- [x] Create `src/core/cli.ts`: reads a transcript path arg, prints a per-model cost table + total
- [x] Wire `npm run cost` → `tsx src/core/cli.ts`
- [x] Create `src/core/costEngine.test.ts`: assert token→cost math against a hand-computed fixture row (6 tests: Opus math, Sonnet intro/standard boundary, unknown-model guard, tierLadder order, parse+aggregate)
- [x] Run `npm test` — cost engine tests pass (6/6 green)
- [x] **Demo**: `npm run cost fixtures/session-sample.jsonl` prints your real per-model spend + total — **€76.81 total, Fable €53.36 (69%) + Opus €23.45 (31%)** across 421 billable turns. Real "wow": one session, 69% on the priciest tier.

> 💾 **Checkpoint**: `feat(core): add contracts, pricing, fixtures and cost engine CLI`

---

## Phase 1 — Track A: "See the money" (live statusline meter)

> **Context**: Claude Code runs a `statusLine` command each turn and passes a JSON payload on stdin that includes the running session's transcript path. Read that path, run `costEngine`, and render a compact live meter. Verify the exact stdin field name for the transcript path against the payload (log it once) before hardcoding it.

- [x] Create `src/statusline/statusline.ts`: read stdin JSON, extract transcript path, call `parseTranscript` + `aggregateByModel`
- [x] Render a one-line meter string: `Opus €0.84 · Sonnet €0.09 · total €0.93`
- [x] Render an explicit, clearly-labeled **session total** segment (running sum across all turns, formatted `Σ €0.93`) as the meter's anchor
- [x] Add a `⚠` marker to the meter when Opus share exceeds a threshold (e.g. >60%)
- [x] Handle the cold-start case (empty/short transcript → `Σ €0.00`) without crashing
- [x] Add `bin/statusline.sh` wrapper that invokes `tsx src/statusline/statusline.ts`
- [x] Register the wrapper in `.claude/settings.json` under `statusLine` (in the hackathon repo, not a work repo) — uses `$CLAUDE_PROJECT_DIR/bin/statusline.sh` so no absolute personal path is committed
- [x] Create `src/statusline/statusline.test.ts`: feed a mock stdin payload → assert meter string format (7 tests: label derivation, ordering, ⚠ on/off, cold-start, payload→meter)
- [x] Run `npm test` — statusline tests pass (13/13 total green)
- [x] **Demo**: open a real Claude Code session in this repo, watch the meter tick and the per-model split grow live — verified end-to-end by piping a real statusLine-shaped payload through `statusline.ts` → `Fable €53.36 · Opus €23.45 · Σ €76.81`. Transcript-path field confirmed as `transcript_path`. To watch live, reload this session (settings.json just added); `STATUSLINE_DEBUG=1` logs payload keys to stderr if the field name differs.

> 💾 **Checkpoint**: `feat(statusline): add live per-model cost meter`

---

## Phase 2 — Track B: "Know the phase" (classifier + passive indicator)

> **Context**: Pure function over the last N turns of the transcript → `PhaseVerdict`. Signals to weigh: tool-mix (Edit/Write heavy = implement; Read/Grep/Explore + no edits = plan; Bash test runs = verify; repeated failures/errors = debug), slash-command / ADLC phase markers (`refine`/`plan` vs `execute`), thinking-to-edit ratio. Keep it deterministic and testable — no LLM call in the hot path.

- [X] Create `src/classifier/signals.ts`: extract per-turn signals from `TurnCost[]` + raw transcript entries (tool names used, slash commands, edit count) — `extractSignals` + `summarize`; also captures Bash test commands + tool_result errors when the transcript carries them (verify/debug signals)
- [X] Create `src/classifier/classify.ts`: `classifyPhase(recentTurns) -> PhaseVerdict` with weighted heuristics — takes `{signals, lastTurn}`; deterministic score per phase, safe `implement` default on empty windows
- [X] Map each phase → `recommendedModel` (trivial-mechanical → `claude-haiku-4-5`; implement/verify → `claude-sonnet-5`; plan/hard-debug → `claude-opus-4-8`; reserve `claude-fable-5` only for a high-confidence "hardest reasoning" signal — never a routine recommendation) — `recommendModel` uses `tierLadder` POSITIONS (cheap/mid/high), so it's roster-derived; Fable (top) is never auto-recommended
- [X] Compute `estSaveEur` = current-turn cost minus what it would cost at `recommendedModel` (guard the sign: escalating _up_ the ladder — e.g. to Fable/Opus — yields a negative "saving", so surface it as an added-cost warning, not a saving) — sign verified both directions in tests
- [X] Populate `signals[]` with human-readable reasons (e.g. `"6 consecutive Edit turns"`) — `buildReasons` (e.g. `"3 edit ops"`, `"2 test runs"`, `"plan/refine command"`)
- [X] Add `aggregateByPhase(turns) -> Record<phase, {costEur, turns}>` to `src/core/costEngine.ts` (attribute each turn's cost to its detected phase) — signature is `aggregateByPhase(turns, phaseOf)`: attribution is injected by the classifier via `attributePhases` so **core stays classifier-free** (no core→classifier dependency)
- [X] Extend `src/statusline/statusline.ts` to append the verdict: `… | Implementing → Sonnet recommended`
- [X] Extend the statusline with a **per-phase cost split** segment: `plan €0.55 · impl €0.30 · verify €0.08` (from `aggregateByPhase`)
- [X] Add a **tier badge** to the verdict — emoji + ANSI color per model, driven by `tierLadder` position so it stays correct as the roster changes (`🟢 Haiku` / `🟡 Sonnet` / `🟠 Opus` / `🔴 Fable`); verify Claude Code renders ANSI color escapes in the statusline, fall back to emoji-only if not — shipped **emoji-only** (`tierBadge` in `core/modelLabel.ts`), the documented safe fallback; ANSI can be added once confirmed live
- [X] Create `src/classifier/aggregateByPhase.test.ts`: mixed-phase fixture → assert per-phase totals sum to the session total (3 tests)
- [X] Create `src/classifier/classify.test.ts`: fixtures for each phase (plan-heavy, edit-heavy, test-run, error-loop) → assert phase + tier (10 tests incl. estSave sign, empty-window default, never-Fable)
- [X] Run `npm test` — classifier + aggregation tests pass (26/26 total green)
- [X] **Demo**: do planning then editing in a live session — watch the tier badge flip `🔴 Opus` → `🟡 Sonnet`, the per-phase split grow, and the session total (`Σ €…`) tick up — verified via real fixture: `Fable €53.36 · Opus €23.45 · Σ €76.81 | plan €35.37 · impl €41.44 | Planning → 🟠 Opus recommended`. Live flip needs a session reload; scrubbed fixture can't show verify/debug (tool inputs + errors were redacted) — those need a real transcript.

> 💾 **Checkpoint**: `feat(classifier): add phase detection and tier recommendation`

---

## Phase 3 — Track E: "Nudge me" (recommendation hook)

> **Context**: A `UserPromptSubmit` (or `Stop`) hook receives a JSON payload including the transcript path and can inject context back into the session via stdout. Run the classifier; when the session is on a costlier tier than recommended for K consecutive turns AND confidence is high, inject a concise nudge with the estimated saving. Debounce so it fires at most once per phase transition — a naggy hook gets disabled.

- [X] Create `src/hook/nudge.ts`: read hook stdin, get transcript path, run `classifyPhase`, compare current model vs `recommendedTier` — `decideNudge` (pure); current model derived from the last transcript turn (hook payload has no `model` field, confirmed against docs); **downshift-only** (never nudges toward a costlier tier)
- [X] Add debounce state (e.g. a small JSON marker file keyed by session id) so the nudge fires once per mismatch streak, not every turn — `applyDebounce` (pure) + a marker file under `os.tmpdir()/agentx-autopilot/nudge-<session>.json`; keyed by (phase, from→to), resets when the mismatch clears
- [X] Compose the nudge text: `"N mechanical edits on Opus — switch to /model sonnet, est. save €X.XX this phase."` — e.g. `💸 5 implementation turns on Opus — switch to /model haiku, est. save €0.18 this phase.`
- [X] Emit the nudge as hook additionalContext (verify the exact output contract Claude Code expects; no-op output when no nudge is due) — **contract verified via docs**: UserPromptSubmit `additionalContext` is *model-visible only*; switched to the **`Stop` hook with `systemMessage`** (user-visible, non-blocking) so the human actually sees the nudge. No-op (exit 0, empty) when not due.
- [X] Add `bin/nudge.sh` wrapper and register it under `hooks.UserPromptSubmit` in `.claude/settings.json` — wrapper added; registered under **`hooks.Stop`** (not UserPromptSubmit) per the visibility fix above, via `$CLAUDE_PROJECT_DIR` (no personal path)
- [X] Create `src/hook/nudge.test.ts`: mismatch streak → nudge emitted; matched tier → silent; debounce suppresses repeats — 9 tests (fire, already-on-tier, below-streak, downshift-only, low-confidence, + 4 debounce)
- [X] Run `npm test` — hook tests pass (35/35 total green)
- [X] **Demo**: live session doing mechanical edits on Opus gets nudged; hit `/model sonnet`; statusline meter reacts — verified end-to-end against `fixtures/nudge-demo.jsonl`: emits `{"systemMessage":"💸 5 implementation turns on Opus — switch to /model haiku, …€0.18…"}`, and the immediate repeat is debounced silent. Live firing needs a session reload.

> 💾 **Checkpoint**: `feat(hook): add cost-aware model-switch nudge`

---

## Phase 4 — Track C: "Autopilot" (SDK auto-switch — stretch)

> **Context (reframed 2026-07-24 — no API key required)**: The original "needs an API key" caveat conflated the metered API with the CLI. The `claude` CLI is subscription-authed and exposes `-p/--print`, `--model`, `--resume`. That opens two key-free auto-switch paths:
> - **Path 2 (primary, live session)**: a `Stop`/nudge hook that, on a high-confidence tier mismatch, injects the switch into the *running TUI* via `tmux send-keys -t "$TMUX_PANE" "/model <tier>" Enter` (macOS non-tmux fallback: `osascript`). Visible, fragile (needs tmux/accessibility), but flips your live chat with zero key. This is the "keep chatting, model auto-optimizes" experience.
> - **Path 1 (alt, headless)**: `src/autopilot/harness.ts` drives `claude -p --model <tier> --resume <id>` in an autonomous task loop — genuine per-turn switching, subscription auth, but a *separate* run, not your live chat.
>
> **Safety rule**: auto-switch **downshifts only** (to a cheaper tier). Escalation up the ladder (→ Opus/Fable) stays a nudge, never automatic — no surprise spend. Gated behind an opt-in flag (`AGENTX_AUTOSWITCH=1`) so it never fires unexpectedly. Still a stretch — lands after Phases 2/3, which it reuses.

- [X] Path 2: extend the Phase 3 nudge into a switch trigger — `src/autopilot/switch.ts` (`resolveSwitcher`/`buildSwitchCommand`/`performSwitch`), wired into the Stop hook, guarded by `AGENTX_AUTOSWITCH=1`. tmux path uses `send-keys -t "$TMUX_PANE" "/model <tier>" Enter`
- [X] Path 2 fallback: macOS `osascript` keystroke injection for non-tmux terminals — this env has **no tmux, iTerm on macOS**, so the live path is `osascript … tell iTerm2 … write text "/model <tier>"`. ⚠ First real run triggers a **macOS Automation permission** prompt (System Settings → Privacy → Automation → allow Terminal/iTerm to control iTerm)
- [X] Share the Phase 3 debounce/cooldown so it switches once per phase transition, not every turn; enforce downshift-only — reuses `decideNudge` (downshift-only) + `applyDebounce`; auto-switch only acts when a nudge is already due
- [>] Path 1 (alt): `src/autopilot/harness.ts` headless runner using `claude -p --model <tier> --resume` (subscription auth, no key) — **deferred**: you chose Path 2 (live-session) as the autopilot. CLI flags confirmed present; revisit for fully-autonomous runs
- [>] Reuse `costEngine` to log each switch and accumulate spend — Path 2 logs each switch to stderr (`[autoswitch] …`) and puts the est. saving in the `systemMessage`; full cross-run accumulation is a Path 1 concern (deferred)
- [>] Create a scripted demo task (`src/autopilot/demo-task.ts`) that naturally spans plan → implement → verify — Path 1 only (deferred)
- [>] Print an end-of-run summary: turns per tier, total cost, cost vs all-Opus baseline — Path 1 only (deferred; Phase 5 report covers the savings story on recordings)
- [X] **Demo**: Path 2 — mechanical edits on Opus auto-downshift in your live session — verified end-to-end via **dry-run** against `fixtures/nudge-demo.jsonl`: builds `osascript … write text "/model haiku"` and emits `⚡ would auto-switch → /model haiku · … ~€0.18 saved.` To arm live: set `AGENTX_AUTOSWITCH=1` (drop `AGENTX_AUTOSWITCH_DRYRUN`), reload the session, approve the iTerm Automation prompt.
- [>] SDK-with-`ANTHROPIC_API_KEY` variant — deferred; not needed given the subscription-authed CLI paths above. Revisit only if an org API key is provisioned.

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
