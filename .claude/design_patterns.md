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
  - [Webview (React / @xyflow/react)](#webview-react--xyflowreact)
    - [15. Strategy registry (node/edge types)](#15-strategy-registry-nodeedge-types)
    - [16. Custom typed error + classifier](#16-custom-typed-error--classifier)
    - [17. Memoized derivation + write-through to React Flow's store](#17-memoized-derivation--write-through-to-react-flows-store)
    - [18. Layout strategy (pluggable arrangement engines)](#18-layout-strategy-pluggable-arrangement-engines)
    - [19. Self-drawing FK edges (auto side + collapse-safe)](#19-self-drawing-fk-edges-auto-side--collapse-safe)
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

## Webview (React / @xyflow/react)

### 15. Strategy registry (node/edge types)

**Theory** — Custom React Flow renderers are registered by string key in a type
map, so the canvas picks the renderer per node/edge `type` — adding a renderer is
a map entry, not a `switch`.

**Example**
- `webview/src/components/nodeTypes.ts:4` — `nodeTypes = { erdTable: ErdTableNode }`.
- `webview/src/components/edgeTypes.ts:5` — `edgeTypes = { composite: CompositeEdge, single: SingleEdge }`.
- Consumed at `webview/src/App.tsx` via `nodeTypes={nodeTypes} edgeTypes={edgeTypes}`.

### 16. Custom typed error + classifier

**Theory** — `ErdApiError` wraps the server's structured `{code, detail}` body; a
classifier turns any HTTP failure into that type (falling back to `"unknown"`),
letting the UI render code-specific remediation hints.

**Example**
- `webview/src/api/errors.ts:14` — `class ErdApiError extends Error` (carries `code`, `detail`, `status`).
- `webview/src/api/errors.ts:25` — `classifyErdError(body, status)` parses the structured body or degrades gracefully.
- `webview/src/api/errors.ts:35-46` — `REMEDIATION` map + `remediationHint(code)` (a lookup table, not branching).

### 17. Memoized derivation + write-through to React Flow's store

**Theory** — View state (filter matches, connected set, render nodes/edges) is
derived via `useMemo` chains keyed on real inputs, so a filter keystroke doesn't
rebuild work that only depends on the (reload-only) edge set. The derived render
set is then **written into React Flow's own state via `setNodes`/`setEdges`**
rather than passed as a prop, because a controlled `nodes` prop alone does not
drop removed nodes from React Flow v12's internal store — the one node *removal*
(the "hide unconnected" toggle, which drops zero-edge islands) only takes effect
through the setter. The name filter only *highlights* (match/dim via
`__filterState`) and never removes a table, and edges are never dimmed or
dropped — every connector between two visible tables renders at full strength.
Because `renderNodes` always re-derives positions from `baseNodes`, `baseNodes`
must stay the one source of truth for positions: a drag writes the final
coordinates *back* into `baseNodes` on drop (`onNodesChange` wrapper), so a later
re-decoration (edge click, filter keystroke, hide toggle) can't clobber the
user's manual arrangement with the original layout coordinates.

Two consequences of the write-through fall out of this and are easy to get
wrong:

- **Refit timing.** Every viewport `fitView` — after a hide-unconnected toggle
  *and* after a layout relayout (style switch / fresh payload) — must fire from
  *inside* the `setNodes` effect, not from the layout effect or a separate effect
  keyed on the toggle. A sibling/earlier effect runs before the new node set is
  committed to React Flow's store, framing the stale graph (a pure style switch
  doesn't change membership, so it would otherwise never refit the new positions
  at all). The layout effect therefore only raises a `pendingRefit` ref; the
  `setNodes` effect refits when that flag is set *or* a visible-membership change
  is detected (a `prevVisibleIds` ref), so a filter keystroke (which changes
  neither) doesn't reframe.
- **Connected set counts self-loops.** `connectedNodeIds` reuses the layout
  engines' `buildAdjacency`, which skips self-loops (they carry no positioning
  information). A table whose only edge is a self-reference is therefore absent
  from the adjacency map, so App folds self-loop endpoints back into
  `connectedNodeIds` directly — otherwise "hide unconnected" would drop a
  genuinely related table.
- **Selection survives re-derivation.** `renderEdges` is a pure derivation from
  `baseEdges` and carries no `selected` flag, so writing it through `setEdges`
  on a hide-toggle would drop the user's selected edge and silently clear the
  column highlight it drives. The `setEdges` effect therefore re-applies the
  live `selected` ids (read from the functional-updater's `prev`) onto the
  freshly derived edges.

**Example**
- `webview/src/App.tsx` — `baseNodes`/`baseEdges` hold the full laid-out graph; `adjacency` memo keyed on `[baseEdges]` builds the neighbour map once per reload; `connectedNodeIds` (adjacency keys plus self-loop endpoints) drives the hide toggle; `renderNodes` (filter highlights, hide-toggle removes islands) / `renderEdges` (keep every edge between visible nodes) feed two effects that push into the `useNodesState`/`useEdgesState` setters; the layout effect raises `pendingRefit` and the `setNodes` effect refits on that flag or a `prevVisibleIds`-tracked membership change; the `setEdges` effect re-applies the live `selected` ids; `onNodesChangeWithSync` writes drag-end positions back into `baseNodes` so manual arrangement survives re-decoration.

### 18. Layout strategy (pluggable arrangement engines)

**Theory** — The canvas arrangement is a strategy selected by a `LayoutStyle`
string: `toFlowGraph(payload, style)` dispatches to one positioning engine, each
taking `(nodes, edges)` and returning `LaidOutNode[]`. Adding an arrangement is a
new engine module plus one `runLayout` branch — no caller changes. The set of
styles is a single source of truth (`LAYOUT_STYLES`): the `LayoutStyle` union,
the persisted-state validator (`isLayoutStyle`), and the Toolbar's button list
all derive from it, so adding a style is one edit plus an engine and an icon. The
choice is persisted via the webview state API so a reload restores it. Three
engines: hierarchical (dagre LR), radial (tidy-tree star), and force (spring
simulation). The force engine is the best fit for star/snowflake schemas — a
dimension shared by many facts settles *among* them so every edge stays short,
which a tree/radial layout structurally can't do (it only shortens one
spanning-tree edge per node). Both radial and force finish with the shared
`relaxOverlaps` sweep (in `overlap.ts`) that guarantees no two cards collide —
the one place the anti-overlap logic lives, fed by either layout's near-resolved
positions. The radial and force engines also share their graph + geometry
primitives (undirected adjacency, connected/island split, BFS components, island
grid packer, `buildDimensions`, the `centreToTopLeft` half-dimension offset, and
centre→top-left bbox normalisation) from `graph.ts` — adding a graph engine
composes those helpers rather than re-deriving them. The hierarchical engine
shares the same two — dagre also pre-sizes via `buildDimensions` and converts its
centre coordinates with `centreToTopLeft`, so the one offset lives in a single
helper rather than once per engine. The default is
`radial`. The repulsion divisor in `force.ts` is floored (`MIN_DIST`) so two
near-coincident bodies can't blow it up to Infinity/NaN.

**Example**
- `webview/src/layout/index.ts` — `LAYOUT_STYLES` (the one ordered list of styles; `LayoutStyle` is `typeof LAYOUT_STYLES[number]`, `isLayoutStyle` is its type guard), `DEFAULT_LAYOUT` (`radial`), `runLayout(payload, style)` dispatch, `toFlowGraph(payload, style)`.
- `webview/src/layout/dagre.ts` — `runDagreLayout` (hierarchical LR; pre-sizes via `buildDimensions`, converts via `centreToTopLeft`).
- `webview/src/layout/radial.ts` — `runRadialLayout` (`layoutCluster` tidy-tree + `relaxOverlaps`).
- `webview/src/layout/force.ts` — `runForceLayout` (`simulate` spring/repulsion + `relaxOverlaps`).
- `webview/src/layout/overlap.ts` — `relaxOverlaps(ids, centres, dims, pad)`, shared by radial + force; also the canonical `Point` type (re-exported from `composite-edge/geometry`, so the layout engines and the FK-edge geometry share one `{x, y}`).
- `webview/src/layout/graph.ts` — `buildAdjacency` / `splitConnected` / `findComponents` / `layoutIslandGrid` / `buildDimensions` / `centreToTopLeft` / `normalizeToOrigin`, shared by dagre + radial + force.
- `webview/src/components/Toolbar.tsx` — `LAYOUT_META` (a `Record<LayoutStyle, …>` of per-style label/tooltip/icon) iterated over `LAYOUT_STYLES`, so a new style is a compile error until its button is defined.
- `webview/src/App.tsx` — `layout` state seeded from `loadPersistedLayout()` (validated via `isLayoutStyle`), persisted in the `[layout]` effect via `getVsCodeApi().setState`; `payloadVersion` + the `[layout, payloadVersion]` effect make positioning single-owner so a fetch and a style switch can't both lay out the same payload.

### 19. Self-drawing FK edges (auto side + collapse-safe)

**Theory** — Both FK edge kinds are custom React Flow edge types that paint their
own SVG `<path>` from node geometry rather than binding to a static
`sourceHandle`/`targetHandle`. Each endpoint anchors on the FK column's **row**,
computed from the column's *index* in the rendered list (not React Flow's
`handleBounds`, which only exist for visible rows and lag re-measurement after an
expand/collapse). A column hidden under the "N more" collapse anchors at the
collapse boundary, so its edge sits on the card edge instead of piling many edges
onto one table-level handle. The side (left/right card edge) each endpoint faces
is picked from the two nodes' relative X by the **single** `endpointSides(from,
to)` helper in `edge-anchor.ts` — it returns `{fromIsLeft, toIsLeft}` so neither
edge component reimplements the comparison. This matters because the boolean is
polarity-sensitive (`resolveAnchor`'s `sideIsLeft` means the left card edge,
while `bundlePoint`'s flag means the right one): one shared helper that hands
back both already-resolved sides is the only place the comparison lives, so the
single- and composite-column edges can't end up with inverted polarity. Both
edge kinds also build their `AnchorNode` view through one shared `anchorNodeOf`
adapter, so they can't drift in how they read node geometry either. Because the anchor needs the live collapse
state, expand state is **lifted to App** (`expandedNodeIds`) and stamped onto node
data (`__expanded` + `__onToggleExpand`) so both `ErdTableNode` and the edge read
one source of truth. Lifting it also makes a global expand/collapse-all a one-line
set operation in App (set to all collapsible ids, or clear) rather than messaging
each card. `mapEdge` emits only `source`/`target` + column refs in
`data`. Both edges render through React Flow's interaction layer (`BaseEdge` / an
invisible hit-path) so a click selects them, and a selected edge feeds back the
*other* way: App derives the FK columns of the selected edge(s) and stamps
`__highlightColumns` so `ErdTableNode` lights up the exact joined rows. The shared
row metrics (`HEADER_HEIGHT`, `COLUMN_HEIGHT`, …) live in `tableConstants.ts`,
pinned to the card CSS (`box-sizing: border-box` fixed heights) and reused by
dagre pre-sizing, so the index-based row Y lands exactly on the rendered row.

**Example**
- `webview/src/components/edge-anchor.ts` — `anchorNodeOf(internalNode)` (the shared React-Flow-node → `AnchorNode` adapter, used by both edge kinds so they can't drift), `resolveAnchor(node, column, sideIsLeft)` (an O(1) row anchor via the node's precomputed `columnIndex` map with a collapse-boundary fallback), and `endpointSides(from, to)` (the single source of truth for which card edge each endpoint faces, so the two edge kinds can't disagree on polarity).
- `webview/src/components/single-edge/index.tsx` — `SingleEdge` (single-column FK), `type: "single"`, `BaseEdge`-rendered.
- `webview/src/components/composite-edge/index.tsx` — `CompositeEdge` (multi-column FK), `type: "composite"`.
- `webview/src/components/column-highlight.ts` — `columnsForSelectedEdges(edges)`, selected-edge → per-table columns map.
- `webview/src/components/tableConstants.ts` — shared card pixel metrics + collapse knobs, pinned to the node CSS (and reused by dagre + the edge anchor in lockstep).
- `webview/src/layout/index.ts` — `mapEdge(edge)` tags each edge `single`/`composite` and passes column refs via `data`, no static handles.
- `webview/src/App.tsx` — `collapsibleIds`/`allExpanded` derive from `baseNodes`; `toggleExpandAll` sets `expandedNodeIds` to all collapsible ids or clears it, surfaced through `Toolbar`'s expand/collapse-all button.

---

## Cross-cutting

- **Shared contract (single JSON shape, three layers).**
  - **Theory** — The `/erd` payload is defined once as Pydantic models and the
    TypeScript types are *generated* from them, so the contract has one source of
    truth. Codegen wraps every exported contract model (`ErdPayload`,
    `ErdProgress`) as a field of a synthetic `_Contract` root so they all land in
    one shared `$defs` block — `json2ts` then emits one TS interface per `$def`.
    To add a model to the generated types, add it as a field on `_Contract`.
  - **Example** — `server/src/dbterd_server/schemas/erd.py` (Pydantic) →
    `webview/src/types/erd.ts` (auto-generated; do not hand-edit) via
    `server/src/dbterd_server/tools/codegen.py` (`_Contract`, `task sync-contract`).

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
