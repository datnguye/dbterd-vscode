---
name: erd-contract
description: Use whenever any change touches the shape of the /erd JSON payload (nodes, edges, columns, relationships) — whether in the FastAPI Pydantic models, the generated TypeScript types, or the React consumers. Ensures all three layers stay in sync.
---

# The /erd contract

The `/erd` endpoint returns one JSON object consumed by the webview. Three layers must agree on its shape:

1. **`server/src/dbterd_server/schemas.py`** — Pydantic models. Source of truth.
2. **`webview/src/types/erd.ts`** — TypeScript types. Generated from #1, never hand-edited.
3. **`webview/src/components/*.tsx`** — React consumers of the types.

## The shape

```python
class Column(BaseModel):
    name: str
    data_type: str | None = None
    description: str | None = None
    is_primary_key: bool = False
    is_foreign_key: bool = False

class ErdNode(BaseModel):
    id: str                      # dbt unique_id, e.g. "model.jaffle_shop.dim_customers"
    name: str                    # short display name
    resource_type: Literal["model", "source", "seed", "snapshot"]
    schema_name: str | None = None
    database: str | None = None
    columns: list[Column]
    raw_sql_path: str | None = None   # for click-to-open in VS Code

class ErdEdge(BaseModel):
    id: str                      # stable hash of (from_id, to_id, from_column, to_column)
    from_id: str                 # node id
    to_id: str
    from_column: str | None = None
    to_column: str | None = None
    relationship_type: Literal["fk", "lineage"] = "fk"

class ErdPayload(BaseModel):
    nodes: list[ErdNode]
    edges: list[ErdEdge]
    generated_at: datetime
    dbt_project_name: str
```

## Rules for changes

1. **Never add a field only to the TS side.** If the webview needs it, add it to `schemas.py` first.
2. **Never rename a field without bumping a version header.** Add `X-Erd-Version: N` to the response and make the webview read it.
3. **After any `schemas.py` change, run `/sync-contract`** to regenerate `webview/src/types/erd.ts`.
4. **Stable edge IDs.** The hash must be deterministic — we use it as a React key.
5. **Optional fields stay optional.** If a field can be missing from the catalog, mark it `| None`.

## Checklist before finishing a contract change

- [ ] `schemas.py` updated
- [ ] `webview/src/types/erd.ts` regenerated
- [ ] Pytest fixtures in `server/tests/fixtures/erd_sample.json` updated
- [ ] Webview components compile (`cd webview && npx tsc --noEmit`)
- [ ] Added/updated a test exercising the new field end-to-end
