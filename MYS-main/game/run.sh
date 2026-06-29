#!/usr/bin/env bash
# Serve MYS Generals locally (macOS / Linux). Open the printed URL in a browser.
# Usage: ./run.sh [port]
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"
if command -v node >/dev/null 2>&1; then
  exec node serve.mjs "$PORT"
elif command -v python3 >/dev/null 2>&1; then
  echo "MYS Generals running at http://localhost:${PORT}/"
  exec python3 -m http.server "$PORT"
else
  echo "Need Node.js (preferred) or Python 3 to serve the game." >&2
  exit 1
fi
