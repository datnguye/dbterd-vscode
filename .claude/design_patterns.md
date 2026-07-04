# Design Patterns in dbterd-vscode

A catalogue of the design patterns used across the three layers (`server/`,
`extension/`, `webview/`). Each entry is split into **Theory** (the rationale —
why the pattern earns its keep) and **Example** (concrete file:line evidence so
you can verify the claim rather than take it on faith). Patterns are the
load-bearing kind — they survive refactors; this doc should be updated when one
is added or removed.

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
    - [11. Progress callback + SSE bridge (sync build, async stream)](#11-progress-callback--sse-bridge-sync-build-async-stream)
  - [Extension (TypeScript / VS Code host)](#extension-typescript--vs-code-host)
    - [12. Observer (typed event bus)](#12-observer-typed-event-bus)
    - [13. Disposable](#13-disposable)
    - [14. Per-view Singleton](#14-per-view-singleton)
  - [Webview (React / thin shell around @datnguye/erd-flow)](#webview-react--thin-shell-around-datnguyeerd-flow)
    - [15. Custom typed error + classifier](#15-custom-typed-error--classifier)
    - [16. Thin shell around a packaged graph](#16-thin-shell-around-a-packaged-graph)
  - [Cross-cutting](#cross-cutting)

---

## Server (Python / FastAPI)

### 1. Registry validation (fail fast on unknown algo)

**Theory** — dbterd ships a built-in `json` target (since 1.28) that emits the
canonical nodes/edges/metadata payload, so `DbtErd(target="json")` resolves
natively with no plugin registration on our side. We still consult dbterd's
global `PluginRegistry` to pre-validate the configured *algo*, turning a registry
miss into a clean `ConfigInvalidError` instead of a deep crash.

**Example**
- `server/src/dbterd_server/erd/dbterd_client.py:32` — `PluginRegistry.has_algo(algo)` validates against the registry before invoking.

### 2. Application Factory

**Theory** — `create_app()` builds and wires a fresh `FastAPI` instance
(middleware, error handlers, routes, optional injected service). Tests get an
isolated app; production gets the module-level singleton.

**Example**
- `server/src/dbterd_server/api/app.py:16` — `def create_app(service: ErdService | None = None) -> FastAPI`.
- `server/src/dbterd_server/api/app.py:28` — module-level `app = create_app()` for `uvicorn` + import-the-singleton tests.

### 3. Dependency Injection

**Theory** — Routes receive the `ErdService` via FastAPI's `Depends`, so they
never reach into `app.state` directly and can be tested with a stub service.

**Example**
- `server/src/dbterd_server/api/dependencies.py:8` — `get_erd_service(request)` pulls the service off app state in one place.
- `server/src/dbterd_server/api/routes/erd.py:11` — `ServiceDep = Annotated[ErdService, Depends(get_erd_service)]`, reused by `routes/health.py:12`.

### 4. Facade / Service Layer

**Theory** — `ErdService` is a thin facade over the cache + builder, plus
project-path allow-list policy. Routes call `service.build(path)` and stay
ignorant of caching and orchestration.

**Example**
- `server/src/dbterd_server/api/service.py:7` — `class ErdService` holds the cache and the allow-list.
- `server/src/dbterd_server/api/service.py:37` — `build()` delegates to `build_erd(project_path, self._cache)`.

### 5. Pipeline with a shared index

**Theory** — `build_erd` is a linear pipeline (validate → config → cache check →
invoke dbterd → map → post-process). The post-process pass runs three fix-ups
over a single `_NodeIndex` (node-by-id + node-by-name + memoized per-node
**column-by-name map**): reconcile edge endpoints to canonical node ids, inject
edge-referenced columns missing from a node, then flag the FK-holder columns the
edges originate from. All three stages stay O(edges) on wide tables because
every per-edge column touch — membership test (`has_column`), fetch
(`get_column`), and append (`add_column`) — is an O(1) hit on the one
column-by-name map, never a rescan of `node.columns`. The map is the single
column lookup structure (it is what makes the O(edges) claim true); a parallel
name-set would let `get_column` silently regress to a linear scan.

A correctness coupling between stages 2 and 3: an edge's drawn connector and its
FK badge must agree, so `ensure_ref_columns_exist` injects **every** column an
edge references — the full composite `from_columns`/`to_columns` lists via the
shared `_edge_columns` helper, not just the primary `from_column`/`to_column`
pair. The webview's composite edge anchors a tail per `from_column`, so if a
secondary composite column were left un-injected, `flag_foreign_key_columns`
(which iterates the same `_edge_columns` list) would find no column to flag and
the badge would disagree with the tail. Inject-all keeps the two in lockstep.
`flag_foreign_key_columns` is the **single owner** of the `is_foreign_key` flag:
injection writes the flag `False` and lets the flag pass set it, so a synthetic
`to`-side (referenced parent) column never carries a bogus FK badge — only the
`from_id`-side columns the flag pass marks are foreign keys.

**Example**
- `server/src/dbterd_server/erd/builder.py:27` — `build_erd(...)` orchestrates the stages as thin glue.
- `server/src/dbterd_server/erd/postprocess.py` — `_NodeIndex` (by-id, by-name, column-by-name map; `has_column`/`get_column`/`add_column` all O(1)) plus the `postprocess(nodes, edges)` entry point: `reconcile_edge_endpoints` remaps short-name endpoints (the `entity-name-format: model` quirk) to real node ids, `ensure_ref_columns_exist` injects every edge-referenced column missing from a node (full composite lists via `_edge_columns`), and `flag_foreign_key_columns` marks each edge's `from_id`-side columns as foreign keys (same `_edge_columns` list, so injection and flagging never diverge).

### 6. Strategy via context manager (RAII)

**Theory** — When the catalog is missing, dbterd still needs a `catalog.json`. A
`@contextmanager` stages a synthetic catalog in a temp dir and tears it down on
exit — the "missing vs present" branch is encapsulated as a resource strategy,
leaving the caller's `with` block clean.

**Example**
- `server/src/dbterd_server/erd/dbterd_client.py:37` — `@contextmanager _resolved_artifacts_dir(...)` yields either the real `target/` or a temp dir with a synthetic catalog.

### 7. Polymorphic error mapping

**Theory** — Each domain error subclass carries its own `code` + `http_status`,
so the exception handler maps to HTTP with zero `if/elif` string-sniffing — open
for extension (add a subclass), closed for modification (handler untouched).

**Example**
- `server/src/dbterd_server/erd/errors.py:4` — `ErdBuildError` base with `code` / `http_status` class attributes.
- `server/src/dbterd_server/erd/errors.py:11-37` — subclasses (`ManifestMissingError`, `ProjectPathInvalidError`, …) override the two attributes.
- `server/src/dbterd_server/api/errors.py:10-19` — one handler reads `err.code` / `err.http_status` for any subclass.

### 8. LRU Cache

**Theory** — `ErdCache` is an `OrderedDict`-backed LRU keyed on `(project path,
input mtimes)`, bounding memory for long-lived servers that see many workspaces.

**Example**
- `server/src/dbterd_server/erd/cache.py:40` — `class ErdCache`, `OrderedDict` + `move_to_end` for recency, `popitem(last=False)` to evict.
- `server/src/dbterd_server/erd/cache.py:15` — `CacheKey` (frozen dataclass) makes the key a value object keyed on mtimes.

### 9. Registration helpers

**Theory** — App wiring is split into small `register_*` functions, each owning
one concern. Keeps `create_app` declarative and each concern independently
testable.

**Example**
- `server/src/dbterd_server/api/middleware.py:36` — `register_middleware(app)`.
- `server/src/dbterd_server/api/errors.py:18` — `register_error_handlers(app)`.
- `server/src/dbterd_server/api/routes/__init__.py:6` — `register_routes(app)`.

### 10. Graceful literal coercion (one helper, many domains)

**Theory** — dbterd's json target can emit a value outside one of our closed
`Literal` domains (an unmodeled `resource_type`, an unrenderable `cardinality`).
Letting it reach Pydantic would fail validation and crash the whole build over
one stray field. A single generic `coerce_literal(raw, allowed, default,
field=...)` keeps known values and downgrades unknowns to a per-domain default
(logged at debug) — so adding a degradable field is one call with its `(allowed,
default)` pair, not a bespoke `_resolve_*` function per domain.

**Example**
- `server/src/dbterd_server/erd/coerce.py` — `coerce_literal(...)`, the one membership-test-with-fallback used by every degradable field.
- `server/src/dbterd_server/erd/mapping.py:28-30` — the `_RESOURCE_TYPES` / `_RELATIONSHIP_TYPES` / `_CARDINALITIES` domain sets, each fed to `coerce_literal` at its mapping site.

### 11. Progress callback + SSE bridge (sync build, async stream)

**Theory** — The build pipeline is synchronous and CPU-bound; the determinate
progress bar needs incremental updates without blocking the event loop.
`build_erd` takes an optional `on_progress` callback and emits a clamped,
monotonic `ErdProgress` at each weighted phase (the blocking `/erd` route passes
nothing — zero behaviour change). The `/erd/stream` route runs the build in a
thread (`asyncio.to_thread`) and bridges the callback into an `asyncio.Queue`
that an async generator drains into SSE frames (`event: progress` … then a
terminal `event: result` / `event: error`). Cache hits skip the expensive
phases. Phase data (name, kind, start_pct, end_pct) lives in a single registry in
`progress.py`; `ProgressReporter` wraps the callback with three helpers — `emit`
(raw clamped emit), `emit_point` (looks up a point phase's single percent),
`report_mapping` (per-item vs. boundary threshold logic, shared by the node and
edge loops). Adding or retuning a phase means editing the phase registry in
`progress.py` only, not the build loops.

**Example**
- `server/src/dbterd_server/erd/progress.py` — `PHASES` registry, `ProgressReporter` class.
- `server/src/dbterd_server/erd/builder.py` — `build_erd(...)` constructs a `ProgressReporter` and calls its helpers; `_result_from_payload` runs the node/edge loops via `reporter.report_mapping`.
- `server/src/dbterd_server/api/routes/erd.py` — `_sse_generator(...)` bridges the threaded build's callbacks to SSE frames via a single `_sse(event, model)` helper; `get_erd_stream` at `:112`.

---

## Extension (TypeScript / VS Code host)

### 12. Observer (typed event bus)

**Theory** — A minimally-typed `EventBus<PanelEvents>` decouples the webview's
user actions (refresh, openCompiledSql, …) from the host's side effects.
Publishers and subscribers never reference each other — avoids
callbacks-into-callbacks plumbing.

**Example**
- `extension/src/messaging/bus.ts:16` — `class EventBus<TEvents>` with typed `on`/`emit`.
- `extension/src/messaging/bus.ts:19` — `on()` returns a `{ dispose() }` subscription (composes with the Disposable pattern).
- `extension/src/extension.ts:49` — `new EventBus<PanelEvents>()`; subscriptions are tracked in `context.subscriptions` so they're torn down on deactivate (tightened by the design review).

### 13. Disposable

**Theory** — Long-lived resources implement VS Code's `Disposable` and are
registered to `context.subscriptions`, giving deterministic teardown on
deactivate.

**Example**
- `extension/src/server/index.ts:19` — `class DbterdServer implements vscode.Disposable`, `dispose()` kills the child process + output channel.
- `extension/src/webview/index.ts:43` — `ErdPanel` disposes its own subscription array.
- `extension/src/logging/index.ts:93` — the logger exposes `dispose()`.

### 14. Per-view Singleton

**Theory** — `ErdPanel.current` enforces one ERD panel at a time, mirroring VS
Code's one-webview-per-`viewId` constraint. `createOrShow` reveals the existing
panel or creates one. This is a deliberate platform-constraint singleton, not a
global-state smell: the design review confirmed VS Code enforces one panel per
`viewId`, so a `PanelManager` abstraction would be churn without a second-panel
use case.

**Example**
- `extension/src/webview/index.ts:8` — `static current: ErdPanel | undefined`.
- `extension/src/webview/index.ts:10` — `static createOrShow(...)`.

---

## Webview (React / thin shell around @datnguye/erd-flow)

### 15. Custom typed error + classifier

**Theory** — `ErdApiError` wraps the server's structured `{code, detail}` body; a
classifier turns any HTTP failure into that type (falling back to `"unknown"`),
letting the UI render code-specific remediation hints.

**Example**
- `webview/src/api/errors.ts:14` — `class ErdApiError extends Error` (carries `code`, `detail`, `status`).
- `webview/src/api/errors.ts:25` — `classifyErdError(body, status)` parses the structured body or degrades gracefully.
- `webview/src/api/errors.ts:35-46` — `REMEDIATION` map + `remediationHint(code)` (a lookup table, not branching).

### 16. Thin shell around a packaged graph

**Theory** — The graph itself (table-card nodes, self-drawing FK edges, the
pluggable layout engines, overlap relaxation, filter highlighting,
hide-unconnected, per-card expand/collapse) lives in the external
`@datnguye/erd-flow` npm package; `App` is a host shell that owns only what is
genuinely VS Code's business: fetching/streaming the payload, the
webview↔extension postMessage traffic (`openFile`, `setTitle`, `refresh`,
parse-progress notifications), toolbar state, and theming. The boundary rules
that keep the shell honest:

- **Theming crosses the boundary as CSS variables.** `VSCODE_THEME` maps
  `--vscode-*` tokens onto the package's `ErdTheme` keys (which become `--erd-*`
  variables), so the packaged ERD inherits the editor theme without the package
  knowing VS Code exists. The object is declared `as const satisfies ErdTheme` —
  a pre-declared const bypasses excess-property checking at the prop site, so
  `satisfies` is what makes a typo'd or renamed theme key a compile error
  instead of a silent no-op.
- **Resource colors are host overrides.** `RESOURCE_META` overrides only the
  `source` entry (dbt-orange `#FF694A`, `database` icon); the package
  shallow-merges it over its `DEFAULT_RESOURCE_META`, so models/seeds/snapshots
  keep the package scheme while the minimap preserves the orange source signal
  the pre-package shell drew. The merge replaces whole entries, not fields —
  an override must restate the icon it wants to keep.
- **Layout choice is host state.** The style is validated with the package's
  `isLayoutStyle`, defaulted from its `DEFAULT_LAYOUT` (imported, never
  re-declared — a local copy could silently drift from the package default),
  and persisted via the webview state API so a reload restores it.
  `Toolbar`'s `LAYOUT_META` is a `Record<LayoutStyle, …>` over the package's
  `LAYOUT_STYLES`, so a package upgrade that adds a style is a compile error
  until its button is defined.
- **The details pane stores an id, not a node.** `activeNodeId` + a
  `useMemo` over the current payload re-derive the `ErdNode`, so a
  `dbterd.refresh` shows fresh columns and closes the pane if the node
  disappeared — a stored node object would keep rendering the stale snapshot,
  because the package only calls `onNodeActivate` on clicks, never on data
  swaps.
- **The badge counts the rendered universe.** The toolbar's "N/M" filter badge
  counts over connected-only nodes while hide-unconnected is on (connectivity =
  appears as either endpoint of any edge, self-loops included), matching what
  the canvas actually draws.
- **Every prop handed to `memo(Toolbar)` is referentially stable** — `useState`
  setters or `useCallback`-wrapped toggles — so the toolbar skips re-rendering
  on canvas-driven state churn.
- **Expand-all is a one-shot assertion, not a stored toggle.** The package
  applies `expandAll` only on defined value *changes* (`expandAll !== undefined`
  guard inside its sync effect), so the host treats the prop as a command
  channel: `toggleExpandAll` asserts the opposite of the package-reported
  `allExpanded` (the same value the button label reads), and
  `onExpandStateChange` stores the report then resets the prop to `undefined`.
  The reset is inert (undefined never mutates the canvas) but guarantees the
  next click is a genuine prop transition. Both naive alternatives fail after a
  per-card toggle inside the canvas: a blindly-flipped boolean inverts the
  button (label says "Expand all", the flip collapses everything), and syncing
  the prop to the reported state re-fires the package effect and collapses all
  cards on a single manual collapse.

**Example**
- `webview/src/App.tsx` — `VSCODE_THEME` / `RESOURCE_META` (both
  `as const satisfies`), `loadPersistedLayout()` (+ the `[layout]` persist
  effect), `activeNodeId`/`activeNode` memo, the `countedNodes` memo keyed on
  `[payload, hideUnconnected]` feeding the `matchCount`/`totalCount` memo keyed
  on `[countedNodes, filter]` (a keystroke re-runs only the name scan, never
  the edge-set rebuild), `toggleHideUnconnected`/`toggleExpandAll`/
  `onExpandStateChange` callbacks, and the plain `setPayload(next)` assignment
  at the api→package type boundary.
- `webview/src/components/Toolbar.tsx` — `LAYOUT_META` over `LAYOUT_STYLES`,
  `memo(...)` wrapper.
- `webview/src/api/stream.ts` — returns the server-generated `ErdPayload`
  (`webview/src/types/erd.ts`); App hands it to `<ErdFlow>` via plain
  assignment, so the compiler checks it against the package's structural
  `ErdPayload` on every build.

---

## Cross-cutting

- **Shared contract (single JSON shape, three layers).**
  - **Theory** — The `/erd` payload is defined once as Pydantic models and the
    TypeScript types are *generated* from them, so the contract has one source of
    truth. Codegen wraps every exported contract model (`ErdPayload`,
    `ErdProgress`) as a field of a synthetic `_Contract` root so they all land in
    one shared `$defs` block — `json2ts` then emits one TS interface per `$def`.
    To add a model to the generated types, add it as a field on `_Contract`.
    The generated types are consumed by the webview's api layer
    (`webview/src/api/{client,stream}.ts`); the renderer consumes the
    structurally-compatible `ErdPayload` type of `@datnguye/erd-flow`, which App
    assigns to (no cast) at the `setPayload` boundary — the generated type is a
    strict subtype of the package's looser shape, so a contract change that
    breaks the package's expectations fails the webview typecheck instead of
    surfacing as a runtime canvas bug.
  - **Example** — `server/src/dbterd_server/schemas/erd.py` (Pydantic) →
    `webview/src/types/erd.ts` (auto-generated; do not hand-edit) via
    `server/src/dbterd_server/tools/codegen.py` (`_Contract`, `task sync-contract`);
    `webview/src/App.tsx` (`setPayload(next)`) is the api→package assignment site.

- **Mirrored protocol (known DRY exception).**
  - **Theory** — The webview↔extension postMessage protocol lives in two
    byte-identical files (`extension/src/messaging/protocol.ts` +
    `webview/src/messaging/protocol.ts`) pending a shared workspace package. This
    is an *acknowledged* duplication, not a pattern to emulate — the design review
    flagged it as drift risk; treat any change as a contract update touching both
    files.
  - **Example** — `extension/src/messaging/protocol.ts` ↔
    `webview/src/messaging/protocol.ts` (kept byte-identical modulo the leading
    "CANONICAL:" comment direction).
