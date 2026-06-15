# Design Patterns in dbterd-vscode

A catalogue of the design patterns used across the three layers (`server/`,
`extension/`, `webview/`), each with a one-line rationale and concrete
file:line evidence so you can verify the claim rather than take it on faith.
Patterns are the load-bearing kind — they survive refactors; this doc should be
updated when one is added or removed.

Line numbers are accurate as of this commit; if they drift, grep the cited
symbol — the pattern is the point, not the exact line.

## Table of Contents

- [Design Patterns in dbterd-vscode](#design-patterns-in-dbterd-vscode)
  - [Table of Contents](#table-of-contents)
  - [Server (Python / FastAPI)](#server-python--fastapi)
    - [1. Registry validation (fail fast on unknown algo)](#1-registry-validation-fail-fast-on-unknown-algo)
    - [2. Application Factory](#2-application-factory)
    - [3. Dependency Injection](#3-dependency-injection)
    - [4. Facade / Service Layer](#4-facade--service-layer)
    - [5. Pipeline with a shared index](#5-pipeline-with-a-shared-index)
    - [6. Strategy via context manager (RAII)](#6-strategy-via-context-manager-raii)
    - [7. Polymorphic error mapping](#7-polymorphic-error-mapping)
    - [8. LRU Cache](#8-lru-cache)
    - [9. Registration helpers](#9-registration-helpers)
    - [10. Graceful literal coercion (one helper, many domains)](#10-graceful-literal-coercion-one-helper-many-domains)
  - [Extension (TypeScript / VS Code host)](#extension-typescript--vs-code-host)
    - [11. Observer (typed event bus)](#11-observer-typed-event-bus)
    - [12. Disposable](#12-disposable)
    - [13. Per-view Singleton](#13-per-view-singleton)
  - [Webview (React / @xyflow/react)](#webview-react--xyflowreact)
    - [14. Strategy registry (node/edge types)](#14-strategy-registry-nodeedge-types)
    - [15. Custom typed error + classifier](#15-custom-typed-error--classifier)
    - [16. Memoized derivation](#16-memoized-derivation)
  - [Cross-cutting](#cross-cutting)

---

## Server (Python / FastAPI)

### 1. Registry validation (fail fast on unknown algo)
dbterd ships a built-in `json` target (since 1.28) that emits the canonical
nodes/edges/metadata payload, so `DbtErd(target="json")` resolves natively with
no plugin registration on our side. We still consult dbterd's global
`PluginRegistry` to pre-validate the configured *algo*, turning a registry miss
into a clean `ConfigInvalidError` instead of a deep crash.

- `server/src/dbterd_server/erd/dbterd_client.py:32` — `PluginRegistry.has_algo(algo)` validates against the registry before invoking.

### 2. Application Factory
`create_app()` builds and wires a fresh `FastAPI` instance (middleware, error
handlers, routes, optional injected service). Tests get an isolated app;
production gets the module-level singleton.

- `server/src/dbterd_server/api/app.py:16` — `def create_app(service: ErdService | None = None) -> FastAPI`.
- `server/src/dbterd_server/api/app.py:28` — module-level `app = create_app()` for `uvicorn` + import-the-singleton tests.

### 3. Dependency Injection
Routes receive the `ErdService` via FastAPI's `Depends`, so they never reach
into `app.state` directly and can be tested with a stub service.

- `server/src/dbterd_server/api/dependencies.py:8` — `get_erd_service(request)` pulls the service off app state in one place.
- `server/src/dbterd_server/api/routes/erd.py:11` — `ServiceDep = Annotated[ErdService, Depends(get_erd_service)]`, reused by `routes/health.py:12`.

### 4. Facade / Service Layer
`ErdService` is a thin facade over the cache + builder, plus project-path
allow-list policy. Routes call `service.build(path)` and stay ignorant of
caching and orchestration.

- `server/src/dbterd_server/api/service.py:7` — `class ErdService` holds the cache and the allow-list.
- `server/src/dbterd_server/api/service.py:37` — `build()` delegates to `build_erd(project_path, self._cache)`.

### 5. Pipeline with a shared index
`build_erd` is a linear pipeline (validate → config → cache check → invoke
dbterd → map → post-process). The post-process pass runs two fix-ups over a
single `_NodeIndex` (node-by-id + node-by-name + memoized per-node column-name
**set**): first reconcile edge endpoints to canonical node ids, then inject
edge-referenced columns missing from a node. Both stay O(edges) on wide tables
via the index's O(1) lookups instead of rescanning nodes.

- `server/src/dbterd_server/erd/builder.py:27` — `build_erd(...)` orchestrates the stages as thin glue.
- `server/src/dbterd_server/erd/postprocess.py` — `_NodeIndex` (by-id, by-name, column-name set) plus the `postprocess(nodes, edges)` entry point: `reconcile_edge_endpoints` remaps short-name endpoints (the `entity-name-format: model` quirk) to real node ids, then `ensure_ref_columns_exist` injects edge-referenced columns missing from a node's column list.

### 6. Strategy via context manager (RAII)
When the catalog is missing, dbterd still needs a `catalog.json`. A
`@contextmanager` stages a synthetic catalog in a temp dir and tears it down on
exit — the "missing vs present" branch is encapsulated as a resource strategy,
leaving the caller's `with` block clean.

- `server/src/dbterd_server/erd/dbterd_client.py:37` — `@contextmanager _resolved_artifacts_dir(...)` yields either the real `target/` or a temp dir with a synthetic catalog.

### 7. Polymorphic error mapping
Each domain error subclass carries its own `code` + `http_status`, so the
exception handler maps to HTTP with zero `if/elif` string-sniffing — open for
extension (add a subclass), closed for modification (handler untouched).

- `server/src/dbterd_server/erd/errors.py:4` — `ErdBuildError` base with `code` / `http_status` class attributes.
- `server/src/dbterd_server/erd/errors.py:11-37` — subclasses (`ManifestMissingError`, `ProjectPathInvalidError`, …) override the two attributes.
- `server/src/dbterd_server/api/errors.py:10-19` — one handler reads `err.code` / `err.http_status` for any subclass.

### 8. LRU Cache
`ErdCache` is an `OrderedDict`-backed LRU keyed on `(project path, input
mtimes)`, bounding memory for long-lived servers that see many workspaces.

- `server/src/dbterd_server/erd/cache.py:40` — `class ErdCache`, `OrderedDict` + `move_to_end` for recency, `popitem(last=False)` to evict.
- `server/src/dbterd_server/erd/cache.py:15` — `CacheKey` (frozen dataclass) makes the key a value object keyed on mtimes.

### 9. Registration helpers
App wiring is split into small `register_*` functions, each owning one concern.
Keeps `create_app` declarative and each concern independently testable.

- `server/src/dbterd_server/api/middleware.py:36` — `register_middleware(app)`.
- `server/src/dbterd_server/api/errors.py:18` — `register_error_handlers(app)`.
- `server/src/dbterd_server/api/routes/__init__.py:6` — `register_routes(app)`.

### 10. Graceful literal coercion (one helper, many domains)
dbterd's json target can emit a value outside one of our closed `Literal`
domains (an unmodeled `resource_type`, an unrenderable `cardinality`). Letting
it reach Pydantic would fail validation and crash the whole build over one stray
field. A single generic `coerce_literal(raw, allowed, default, field=...)`
keeps known values and downgrades unknowns to a per-domain default (logged at
debug) — so adding a degradable field is one call with its `(allowed, default)`
pair, not a bespoke `_resolve_*` function per domain.

- `server/src/dbterd_server/erd/coerce.py` — `coerce_literal(...)`, the one membership-test-with-fallback used by every degradable field.
- `server/src/dbterd_server/erd/mapping.py:28-30` — the `_RESOURCE_TYPES` / `_RELATIONSHIP_TYPES` / `_CARDINALITIES` domain sets, each fed to `coerce_literal` at its mapping site.

---

## Extension (TypeScript / VS Code host)

### 11. Observer (typed event bus)
A minimally-typed `EventBus<PanelEvents>` decouples the webview's user actions
(refresh, openCompiledSql, …) from the host's side effects. Publishers and
subscribers never reference each other — avoids callbacks-into-callbacks plumbing.

- `extension/src/messaging/bus.ts:16` — `class EventBus<TEvents>` with typed `on`/`emit`.
- `extension/src/messaging/bus.ts:19` — `on()` returns a `{ dispose() }` subscription (composes with the Disposable pattern).
- `extension/src/extension.ts:49` — `new EventBus<PanelEvents>()`; subscriptions are tracked in `context.subscriptions` so they're torn down on deactivate (tightened by the design review).

### 12. Disposable
Long-lived resources implement VS Code's `Disposable` and are registered to
`context.subscriptions`, giving deterministic teardown on deactivate.

- `extension/src/server/index.ts:19` — `class DbterdServer implements vscode.Disposable`, `dispose()` kills the child process + output channel.
- `extension/src/webview/index.ts:43` — `ErdPanel` disposes its own subscription array.
- `extension/src/logging/index.ts:93` — the logger exposes `dispose()`.

### 13. Per-view Singleton
`ErdPanel.current` enforces one ERD panel at a time, mirroring VS Code's
one-webview-per-`viewId` constraint. `createOrShow` reveals the existing panel
or creates one.

- `extension/src/webview/index.ts:8` — `static current: ErdPanel | undefined`.
- `extension/src/webview/index.ts:10` — `static createOrShow(...)`.

> Note: this is a deliberate platform-constraint singleton, not a global-state
> smell. The design review confirmed VS Code enforces one panel per `viewId`, so
> a `PanelManager` abstraction would be churn without a second-panel use case.

---

## Webview (React / @xyflow/react)

### 14. Strategy registry (node/edge types)
Custom React Flow renderers are registered by string key in a type map, so the
canvas picks the renderer per node/edge `type` — adding a renderer is a map
entry, not a `switch`.

- `webview/src/components/nodeTypes.ts:4` — `nodeTypes = { erdTable: ErdTableNode }`.
- `webview/src/components/edgeTypes.ts:4` — `edgeTypes = { composite: CompositeEdge }`.
- Consumed at `webview/src/App.tsx` via `nodeTypes={nodeTypes} edgeTypes={edgeTypes}`.

### 15. Custom typed error + classifier
`ErdApiError` wraps the server's structured `{code, detail}` body; a classifier
turns any HTTP failure into that type (falling back to `"unknown"`), letting the
UI render code-specific remediation hints.

- `webview/src/api/errors.ts:14` — `class ErdApiError extends Error` (carries `code`, `detail`, `status`).
- `webview/src/api/errors.ts:25` — `classifyErdError(body, status)` parses the structured body or degrades gracefully.
- `webview/src/api/errors.ts:35-46` — `REMEDIATION` map + `remediationHint(code)` (a lookup table, not branching).

### 16. Memoized derivation
View state (filter matches, connected set, decorated nodes/edges) is derived via
`useMemo` chains keyed on their real inputs, so a filter keystroke doesn't
rebuild work that only depends on the (reload-only) edge set.

- `webview/src/App.tsx` — `adjacency` memo keyed on `[edges]` builds the neighbour map once per reload; `connectedIds` / `decoratedNodes` / `decoratedEdges` then traverse it. (The `[edges]`-keyed adjacency was introduced by the design review to drop the per-keystroke O(edges) scan.)

---

## Cross-cutting

- **Shared contract (single JSON shape, three layers).** The `/erd` payload is
  defined once as Pydantic models and the TypeScript types are *generated* from
  them, so the contract has one source of truth.
  - `server/src/dbterd_server/schemas/erd.py` (Pydantic) →
    `webview/src/types/erd.ts` (auto-generated; do not hand-edit) via
    `server/src/dbterd_server/tools/codegen.py` (`task sync-contract`).

- **Mirrored protocol (known DRY exception).** The webview↔extension postMessage
  protocol lives in two byte-identical files
  (`extension/src/messaging/protocol.ts` + `webview/src/messaging/protocol.ts`)
  pending a shared workspace package. This is an *acknowledged* duplication, not
  a pattern to emulate — the design review flagged it as drift risk; treat any
  change as a contract update touching both files.
