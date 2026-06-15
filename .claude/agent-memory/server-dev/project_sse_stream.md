---
name: sse-stream-route
description: GET /erd/stream SSE implementation — patching targets, cache-hit frame count, fake payload node shape
metadata:
  type: project
---

`GET /erd/stream` added at `server/src/dbterd_server/api/routes/erd.py`. Runs `service.build_with_progress` in `asyncio.to_thread`; bridges callbacks via `asyncio.Queue`; emits `event: progress`, terminal `event: result` or `event: error`.

**Why:** Progress bar in webview for big dbt projects; SSE keeps the blocking `GET /erd` route unchanged.

**How to apply:**

- When patching `invoke_dbterd` in builder tests, patch `dbterd_server.erd.builder.invoke_dbterd` (the already-bound name in builder's namespace) via `patch.object(builder, "invoke_dbterd", ...)`, NOT `patch.object(dbterd_client, "invoke_dbterd", ...)` — builder does `from ... import invoke_dbterd`, so the source module patch doesn't reach it.

- Cache-hit emits **3** progress frames (validating → configuring → done), not 1. The spec's "single done immediately" refers to skipping invoking/mapping/postprocessing, not the pre-cache-check setup phases.

- Fake node payloads for mapping tests must use `"id"` (not `"unique_id"`) and fake edge payloads must use `"from_id"`, `"to_id"`, `"from_columns"`, `"to_columns"` — the post-mapping format that dbterd's json target emits, which `map_node`/`map_edge` expect.
