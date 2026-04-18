---
description: Run all three test suites (pytest, vitest, extension tests) and report a combined pass/fail.
---

Run all three suites in parallel (separate Bash calls in one message):

1. `cd server && uv run pytest --cov=dbterd_server --cov-report=term-missing`
2. `cd webview && npx vitest run`
3. `cd extension && npm run check-types && npm run compile`

Report a table:

| Suite     | Result | Notes                          |
|-----------|--------|--------------------------------|
| server    | ...    | coverage %, failing tests      |
| webview   | ...    | failing tests                  |
| extension | ...    | typecheck or test result       |

If server coverage is < 100%, list the uncovered lines. Do not attempt to fix failures unless the user asks.
