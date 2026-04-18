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

The `dbterd.api.DbtErd` façade exists, but its `get_erd()` returns **formatted text**
(DBML / Mermaid / etc.) — not structured Python. That's fine for humans, useless
for us.

For structured `(tables, relationships)` tuples, drop one layer down and use the
algo adapter directly:

```python
from dbterd.adapters.algos.test_relationship import TestRelationshipAlgo
from dbterd.adapters.algos.test_relationship import Table, Ref  # dataclasses
# load manifest.json / catalog.json via dbterd's Manifest / Catalog loaders,
# then:
algo = TestRelationshipAlgo()
tables, refs = algo.parse_artifacts(manifest=manifest, catalog=catalog,
                                    select=[], exclude=[],
                                    resource_type=["model", "source", "seed", "snapshot"],
                                    algo="test_relationship")
```

`Table` fields we map: `name`, `database`, `schema`, `columns` (list of `Column`
with `name`/`data_type`/`description`/`is_primary_key`/`is_foreign_key`),
`raw_sql`, `resource_type`, `node_name` (the dbt `unique_id`).

`Ref` fields: `name`, `table_map: (parent_node, child_node)`,
`column_map: ([parent_cols], [child_cols])`, `type`.

## Rules

1. **Do not hand-roll manifest parsing.** Call `TestRelationshipAlgo.parse_artifacts`
   — it already resolves `relationships` tests, merges catalog columns, and
   filters by `resource_type`.
2. **Do not shell out to the `dbterd` CLI.** We're a library consumer, not a
   subprocess orchestrator.
3. **Never write to disk.** The server is read-only on the dbt project.
4. **Cache per target/ mtime.** Parsing `manifest.json` on every `/erd` request
   is slow. Cache keyed on the file's mtime; invalidate when it changes.
5. **Graceful missing catalog.** If `catalog.json` is absent, return nodes with
   `data_type=None` and a warning header `X-Erd-Warnings: catalog-missing`.
   Don't 500.
6. **Absolute paths only** when returning `raw_sql_path` — the extension resolves
   them to VS Code URIs.

## Testing

Fixtures live at `server/tests/fixtures/jaffle_shop/target/` (minimal manifest + catalog). Tests should exercise:
- Happy path: both artifacts present, FK edges generated.
- Missing catalog: nodes have no `data_type`, warning header set.
- Missing manifest: 404 with a clear error body.
- mtime cache: second call within same mtime hits the cache (assert dbterd call count).
