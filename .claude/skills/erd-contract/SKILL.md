---
name: erd-contract
description: Use whenever any change touches the shape of the /erd JSON payload (nodes, edges, columns, relationships) — whether in the FastAPI Pydantic models, the generated TypeScript types, or the React consumers. Ensures all three layers stay in sync.
---

# The /erd contract

The `/erd` endpoint returns one JSON object consumed by the webview. Three layers must agree on its shape:

1. **`server/src/dbterd_server/schemas/erd.py`** — Pydantic models. Source of truth.
2. **`webview/src/types/erd.ts`** — TypeScript types. Generated from #1, never hand-edited. Consumed by the api layer (`webview/src/api/{client,stream}.ts`).
3. **`@datnguye/erd-flow`'s `ErdPayload`** — the renderer's structural type. `App.tsx` casts the fetched payload to it (`next as ErdPayload`), so a contract change must stay compatible with the package's expected shape (or the package must be updated and released first).

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
    name: str                    # display name
    label: str | None = None
    description: str | None = None
    resource_type: Literal["model", "source", "seed", "snapshot"]
    schema_name: str | None = None
    database: str | None = None
    columns: list[Column]
    compiled_sql: str | None = None   # full compiled SQL; webview opens it in an untitled editor

class ErdEdge(BaseModel):
    id: str                      # stable id from dbterd's json target
    from_id: str                 # node id (child / FK-holder side)
    to_id: str                   # node id (parent / referenced side)
    from_column: str | None = None   # primary pair, = from_columns[0]
    to_column: str | None = None     # primary pair, = to_columns[0]
    from_columns: list[str] = []     # full list (composite FKs)
    to_columns: list[str] = []
    relationship_type: Literal["fk", "lineage"] = "fk"
    name: str | None = None          # constraint name
    label: str | None = None         # friendly label from meta.relationship_labels
    cardinality: Literal["n1", "11", "1n", "nn", ""] = ""

class ErdMetadata(BaseModel):
    generated_at: datetime
    dbt_project_name: str

class ErdPayload(BaseModel):
    nodes: list[ErdNode]
    edges: list[ErdEdge]
    metadata: ErdMetadata
```

> Source-of-truth note: dbterd >=1.28's built-in `json` target emits this
> nodes/edges/metadata shape natively. The server maps it near-passthrough
> (deriving the singular `from_column`/`to_column` pair and injecting
> edge-referenced columns missing from partial catalogs); it no longer
> registers a custom dbterd target.

## Rules for changes

1. **Never add a field only to the TS side.** If the webview needs it, add it to `schemas.py` first.
2. **Never rename a field without bumping a version header.** Add `X-Erd-Version: N` to the response and make the webview read it.
3. **After any `schemas.py` change, run `/sync-contract`** to regenerate `webview/src/types/erd.ts`.
4. **Stable edge IDs.** The hash must be deterministic — we use it as a React key.
5. **Optional fields stay optional.** If a field can be missing from the catalog, mark it `| None`.

## Checklist before finishing a contract change

- [ ] `schemas/erd.py` updated
- [ ] `webview/src/types/erd.ts` regenerated (`task sync-contract`)
- [ ] Server tests against the `server/tests/fixtures/jaffle_shop` project updated
- [ ] Webview components compile (`cd webview && npx tsc --noEmit`)
- [ ] Added/updated a test exercising the new field end-to-end
