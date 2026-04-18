---
description: Scaffold a new server route across all three layers (FastAPI route, Pydantic schema, TS client, webview consumer).
argument-hint: "<METHOD> <path>   e.g. GET /model/{unique_id}"
---

Add a new endpoint end-to-end. Arguments: `$ARGUMENTS` (e.g. `GET /model/{unique_id}`).

Parse the method and path, then:

1. **Server** — delegate to the `server-dev` agent:
   - Add a Pydantic request/response model in `server/src/dbterd_server/schemas.py` (or a sibling file if it's getting crowded)
   - Add the route in `server/src/dbterd_server/main.py`
   - Add a pytest test covering happy path + one error path

2. **Contract sync** — if the response shape is part of the /erd domain, invoke the `erd-contract` skill and run `/sync-contract`.

3. **Webview client** — delegate to the `webview-dev` agent:
   - Add a typed client function in `webview/src/api.ts`
   - If there's a UI consumer, wire it; otherwise leave a TODO with the function exported

4. Report the three files touched and any follow-up the user still needs to do (e.g. "hook up UI button to call the new client").

Do not invent path parameters — use exactly what the user supplied.
