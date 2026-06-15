---
name: dbterd-api
description: Use when wrapping, calling, or extending the dbterd Python API from the FastAPI server — parsing manifest.json/catalog.json, extracting nodes and FK relationships, and mapping to the ErdPayload schema.
---

# Wrapping dbterd

`dbterd` is a library for generating ERDs from dbt artifacts. We use it as a library, not via its CLI. The server imports from `dbterd` and converts its output into our `ErdPayload` schema.

## Inputs

A dbt `target/` directory containing:
- `manifest.json` — nodes, sources, tests, refs
- `catalog.json` — column types from the warehouse

Configuration comes from the extension: the user picks a dbt project root; we read `{project}/target/*.json`.

## Public API surface

Use the `dbterd.api.DbtErd` façade with its built-in **`json` target** (shipped
since dbterd 1.28). `get_erd()` then returns the canonical ERD payload as a JSON
string — already the nodes/edges/metadata shape, so there's no need to drop down
to the algo adapter or hand-assemble `(tables, relationships)` tuples:

```python
from dbterd.api import DbtErd

erd_json = DbtErd(target="json", artifacts_dir=str(target_dir), **config).get_erd()
payload = json.loads(erd_json)  # {"nodes": [...], "edges": [...], "metadata": {...}}
```

Native shape (what the server maps near-passthrough into `ErdPayload`):

- **node**: `id` (dbt `unique_id`), `name`, `label`, `description`,
  `resource_type`, `schema_name`, `database`, `columns`, `compiled_sql`.
- **column**: `name`, `data_type`, `description`, `is_primary_key`,
  `is_foreign_key` (the json target already sets the FK flag on child-side
  columns — the server does **not** re-derive it).
- **edge**: `id`, `from_id` (child), `to_id` (parent), `from_columns`,
  `to_columns`, `relationship_type`, `name`, `label`, `cardinality`.
- **metadata**: `generated_at`, `dbt_project_name` (the json target may emit
  more, e.g. `dbterd_version`, but `ErdMetadata` maps only these two).

## Rules

1. **Do not hand-roll manifest parsing.** Let `DbtErd(target="json")` parse the
   artifacts — it resolves `relationships` tests, merges catalog columns, and
   filters by `resource_type` for you.
2. **Do not shell out to the `dbterd` CLI.** We're a library consumer, not a
   subprocess orchestrator.
3. **Never write to disk.** The server is read-only on the dbt project. (The one
   exception: when `catalog.json` is missing, a synthetic catalog is staged in a
   temp dir via a context manager — the user's `target/` stays untouched.)
4. **Cache per target/ mtime.** Parsing `manifest.json` on every `/erd` request
   is slow. Cache keyed on the file's mtime; invalidate when it changes.
5. **Graceful missing catalog.** If `catalog.json` is absent, return nodes with
   `data_type=None` and a warning header `X-Erd-Warnings: catalog-missing`.
   Don't 500.
6. **Surface `compiled_sql`, not file paths.** The webview opens a node's
   compiled SQL in an untitled editor; the json target supplies it directly.

## Testing

Fixtures live at `server/tests/fixtures/jaffle_shop/target/` (minimal manifest + catalog). Tests should exercise:
- Happy path: both artifacts present, FK edges generated.
- Missing catalog: nodes have no `data_type`, warning header set.
- Missing manifest: 404 with a clear error body.
- mtime cache: second call within same mtime hits the cache (assert dbterd call count).
