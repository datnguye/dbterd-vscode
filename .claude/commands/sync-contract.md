---
description: Regenerate TypeScript types in the webview from the Pydantic schemas in the server.
---

Regenerate `webview/src/types/erd.ts` from `server/src/dbterd_server/schemas.py`.

Steps:

1. From `server/`, run `uv run python -m dbterd_server.codegen` (this script dumps the Pydantic models as JSON Schema to stdout).
2. Pipe the output through `npx json-schema-to-typescript` to produce TS definitions.
3. Write the result to `webview/src/types/erd.ts` with a banner header:
   ```ts
   // AUTO-GENERATED from server/src/dbterd_server/schemas.py — do not edit by hand.
   // Regenerate with: /sync-contract
   ```
4. Run `cd webview && npx tsc --noEmit` — report any compile errors in consumers that need manual updates.

If `dbterd_server.codegen` does not exist yet, create it: a tiny module that imports the schemas and prints `ErdPayload.model_json_schema()` as JSON.
