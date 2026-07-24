# AgentX — Cost-Aware Model-Split Autopilot

**Detect the work _phase_ → know the _right_ model tier → surface live cost → nudge/switch → prove the savings.**

Anchored on a real pattern: **Opus was the dominant slice of last month's bill.**

## Why

Every Claude Code turn runs on whatever model you last picked — including mechanical edits burning Opus rates. AgentX watches the live transcript, classifies what you're actually doing (plan / implement / verify / debug), maps that to the right cost tier, and shows you the money in real time. It nudges you to downshift when you're overpaying and proves the savings against an all-Opus baseline.

**Cost ladder** (cheapest → priciest, derived from `pricing.json`, never hardcoded):

`🟢 Haiku ($1/$5)` < `🟡 Sonnet ($3/$15)` < `🟠 Opus 4.8 ($5/$25)` < `🔴 Fable 5 ($10/$50)`

Fable is the _most expensive_ tier (2× Opus) — reserved for the hardest reasoning, treated as a budget risk when over-recommended.

## Stack

Node + TypeScript. `tsx` to run, `vitest` to test. Core lib is framework-free. Phase 5 report is a small Vite + React app (downgradeable to a CLI + static chart).

## Parallelization map

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

## Per-track ownership

| Phase | Track | Owns | Status |
|-------|-------|------|--------|
| 0 | — | Contracts (`TurnCost`, `PhaseVerdict`), `pricing.json`, fixtures, `costEngine` + CLI | in progress |
| 1 | A | Live statusline cost meter (`src/statusline/`) | — |
| 2 | B | Phase classifier + passive tier indicator (`src/classifier/`) | — |
| 3 | E | Model-switch nudge hook (`src/hook/`) — depends on Track B | — |
| 4 | C | SDK auto-switch harness (`src/autopilot/`) — **blocked: needs `ANTHROPIC_API_KEY`** | blocked |
| 5 | D | Savings analytics report + dashboard (`src/report/`, `dashboard/`) | — |

## Commands

```bash
npm run cost fixtures/session-sample.jsonl   # print per-model cost table + total
npm test                                      # run the vitest suite
npm run lint                                  # typecheck (tsc --noEmit)
```
