#!/usr/bin/env bash
# Claude Code Stop hook — emits a cost-aware model-switch nudge (systemMessage).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/hook/nudge.ts"
