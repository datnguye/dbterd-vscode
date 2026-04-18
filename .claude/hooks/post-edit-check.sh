#!/usr/bin/env bash
# Runs after Edit/Write. Fast sanity check on the edited file — never blocks.
# Reads the hook payload from stdin, extracts the path, runs the right linter.

set -euo pipefail

payload="$(cat)"
path="$(printf '%s' "$payload" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

[ -z "$path" ] && exit 0
[ ! -f "$path" ] && exit 0

case "$path" in
  */server/*.py)
    (cd server && uv run ruff check --quiet "$path") 2>&1 | head -20 || true
    ;;
  */extension/src/*.ts)
    (cd extension && npx --no-install tsc --noEmit 2>&1 | grep -F "$path" | head -20) || true
    ;;
  */webview/src/*.ts|*/webview/src/*.tsx)
    (cd webview && npx --no-install tsc --noEmit 2>&1 | grep -F "$path" | head -20) || true
    ;;
esac

exit 0
