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
    - [1. Plugin + Registry (via decorator)](#1-plugin--registry-via-decorator)
    - [2. Adapter](#2-adapter)
    - [3. Application Factory](#3-application-factory)
    - [4. Dependency Injection](#4-dependency-injection)
    - [5. Facade / Service Layer](#5-facade--service-layer)
    - [6. Pipeline with a shared index](#6-pipeline-with-a-shared-index)
    - [7. Strategy via context manager (RAII)](#7-strategy-via-context-manager-raii)
    - [8. Polymorphic error mapping](#8-polymorphic-error-mapping)
    - [9. LRU Cache](#9-lru-cache)
    - [10. Registration helpers](#10-registration-helpers)
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

### 1. Plugin + Registry (via decorator)
The JSON output target registers itself with dbterd's global `PluginRegistry`
through a class decorator, so `DbtErd(target="json")` resolves it by name with
no hard import in the call site — the canonical plugin/registry shape.

- `server/src/dbterd_server/plugins/json_target/adapter.py:21` — `@register_target("json", ...)` decorates `JsonAdapter`.
- `server/src/dbterd_server/plugins/json_target/__init__.py:3-4` — importing the subpackage triggers the registration side effect.
- `server/src/dbterd_server/erd/dbterd_client.py:30` — `PluginRegistry.has_algo(algo)` validates against the registry before invoking, turning a registry miss into a clean `ConfigInvalidError` instead of a deep crash.

### 2. Adapter
`JsonAdapter` adapts dbterd's `BaseTargetAdapter` contract to our lossless JSON
shape — translating dbterd's `Table`/`Ref` models into the dicts our schema
expects.

- `server/src/dbterd_server/plugins/json_target/adapter.py:22` — `class JsonAdapter(BaseTargetAdapter)`.
- `server/src/dbterd_server/plugins/json_target/serializers.py` — the per-model translation functions (`table_to_dict`, `relationship_to_dict`).

### 3. Application Factory
`create_app()` builds and wires a fresh `FastAPI` instance (middleware, error
handlers, routes, optional injected service). Tests get an isolated app;
production gets the module-level singleton.

- `server/src/dbterd_server/api/app.py:16` — `def create_app(service: ErdService | None = None) -> FastAPI`.
- `server/src/dbterd_server/api/app.py:28` — module-level `app = create_app()` for `uvicorn` + import-the-singleton tests.

### 4. Dependency Injection
Routes receive the `ErdService` via FastAPI's `Depends`, so they never reach
into `app.state` directly and can be tested with a stub service.

- `server/src/dbterd_server/api/dependencies.py:8` — `get_erd_service(request)` pulls the service off app state in one place.
- `server/src/dbterd_server/api/routes/erd.py:11` — `ServiceDep = Annotated[ErdService, Depends(get_erd_service)]`, reused by `routes/health.py:12`.

### 5. Facade / Service Layer
`ErdService` is a thin facade over the cache + builder, plus project-path
allow-list policy. Routes call `service.build(path)` and stay ignorant of
caching and orchestration.

- `server/src/dbterd_server/api/service.py:7` — `class ErdService` holds the cache and the allow-list.
- `server/src/dbterd_server/api/service.py:37` — `build()` delegates to `build_erd(project_path, self._cache)`.

### 6. Pipeline with a shared index
`build_erd` is a linear pipeline (validate → config → cache check → invoke
dbterd → map → post-process). The post-processing passes share a single
`_NodeIndex` (node-by-id + memoized per-node column-name **set**) so the two
fix-up passes don't each rebuild the index, keeping it O(edges) on wide tables.

- `server/src/dbterd_server/erd/builder.py:27` — `build_erd(...)` orchestrates the stages as thin glue.
- `server/src/dbterd_server/erd/postprocess.py` — `_NodeIndex` plus the single `postprocess(nodes, edges, refs)` entry point that runs both passes over one index. (Introduced by the design review; see git history.)

### 7. Strategy via context manager (RAII)
When the catalog is missing, dbterd still needs a `catalog.json`. A
`@contextmanager` stages a synthetic catalog in a temp dir and tears it down on
exit — the "missing vs present" branch is encapsulated as a resource strategy,
leaving the caller's `with` block clean.

- `server/src/dbterd_server/erd/dbterd_client.py:37` — `@contextmanager _resolved_artifacts_dir(...)` yields either the real `target/` or a temp dir with a synthetic catalog.

### 8. Polymorphic error mapping
Each domain error subclass carries its own `code` + `http_status`, so the
exception handler maps to HTTP with zero `if/elif` string-sniffing — open for
extension (add a subclass), closed for modification (handler untouched).

- `server/src/dbterd_server/erd/errors.py:4` — `ErdBuildError` base with `code` / `http_status` class attributes.
- `server/src/dbterd_server/erd/errors.py:11-37` — subclasses (`ManifestMissingError`, `ProjectPathInvalidError`, …) override the two attributes.
- `server/src/dbterd_server/api/errors.py:10-19` — one handler reads `err.code` / `err.http_status` for any subclass.

### 9. LRU Cache
`ErdCache` is an `OrderedDict`-backed LRU keyed on `(project path, input
mtimes)`, bounding memory for long-lived servers that see many workspaces.

- `server/src/dbterd_server/erd/cache.py:40` — `class ErdCache`, `OrderedDict` + `move_to_end` for recency, `popitem(last=False)` to evict.
- `server/src/dbterd_server/erd/cache.py:15` — `CacheKey` (frozen dataclass) makes the key a value object keyed on mtimes.

### 10. Registration helpers
App wiring is split into small `register_*` functions, each owning one concern.
Keeps `create_app` declarative and each concern independently testable.

- `server/src/dbterd_server/api/middleware.py:36` — `register_middleware(app)`.
- `server/src/dbterd_server/api/errors.py:18` — `register_error_handlers(app)`.
- `server/src/dbterd_server/api/routes/__init__.py:6` — `register_routes(app)`.

---

## Extension (TypeScript / VS Code host)

### 11. Observer (typed event bus)
A minimally-typed `EventBus<PanelEvents>` decouples the webview's user actions
(refresh, openFile, …) from the host's side effects. Publishers and subscribers
never reference each other — avoids callbacks-into-callbacks plumbing.

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
