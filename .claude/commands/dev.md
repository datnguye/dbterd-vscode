---
description: Start the server, webview dev build, and extension host in watch mode for a full dev loop.
---

Start the three workspaces in watch mode so I can iterate on the extension end-to-end.

Do this in parallel (use Bash with `run_in_background: true` for each):

1. **Server** — `cd server && uv run uvicorn dbterd_server.main:app --reload --port 8581`
2. **Webview** — `cd webview && npm run dev` (Vite dev server)
3. **Extension watch** — `cd extension && npm run watch` (parallel esbuild bundler + `tsc --noEmit --watch`)

After starting, print:
- the server URL (http://localhost:8581)
- the Vite dev URL
- a reminder to hit F5 in VS Code to launch the Extension Development Host

If any of the three fails to start within ~10 seconds, report which one and its error output. Do not keep the others running if the server fails to boot — kill them.
