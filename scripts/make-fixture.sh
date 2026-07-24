#!/usr/bin/env bash
# Produce fixtures/session-sample.jsonl from one of your real sessions.
# Usage: bash scripts/make-fixture.sh <source.jsonl>
#   Source lives under ~/.claude/projects/<project>/<session>.jsonl
#   Prefer a personal session over an employer/proprietary one.
set -euo pipefail

cd "$(dirname "$0")/.."

src="${1:-}"
if [[ -z "$src" ]]; then
  echo "usage: bash scripts/make-fixture.sh <source.jsonl>" >&2
  echo "  (a transcript under ~/.claude/projects/*/)" >&2
  exit 1
fi

node scripts/scrub-transcript.mjs "$src" fixtures/session-sample.jsonl
