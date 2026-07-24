#!/usr/bin/env bash
# Claude Code UserPromptSubmit hook — current-turn prompt routing (block+reinject).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/hook/route.ts"
