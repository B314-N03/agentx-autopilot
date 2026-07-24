#!/usr/bin/env bash
# Claude Code statusLine wrapper — reads the payload on stdin, prints the meter.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/statusline/statusline.ts"
