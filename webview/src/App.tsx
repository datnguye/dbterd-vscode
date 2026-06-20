import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from "@xyflow/react";
import { ErdApiError, remediationHint, streamErd, type ErdErrorCode } from "./api";
import { columnsForSelectedEdges } from "./components/column-highlight";
import { DetailsPane } from "./components/DetailsPane";
import { edgeTypes } from "./components/edgeTypes";
import { nodeTypes } from "./components/nodeTypes";
import { ParseProgressBar } from "./components/ParseProgressBar";
import { isCollapsible } from "./components/tableConstants";
import { Toolbar } from "./components/Toolbar";
import { DEFAULT_LAYOUT, isLayoutStyle, toFlowGraph, type LayoutStyle } from "./layout";
import { buildAdjacency } from "./layout/graph";
import { isOutboundMessage } from "./messaging/protocol";
import type { ErdNode, ErdPayload } from "./types/erd";
import type { ErdFlowNode } from "./types/flow";
import { getVsCodeApi } from "./vscode";

interface AppProps {
  serverUrl: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

interface ErrorState {
  message: string;
  code?: ErdErrorCode;
}

interface ProgressState {
  percent: number;
  message: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Persisted webview state shape. VS Code retains this across reloads (and panel
// hide/show) for the lifetime of the panel, so the user's layout choice sticks.
interface PersistedState {
  layout?: LayoutStyle;
}

type FilterHighlight = "match" | "dim" | undefined;

// One slot in the per-node decoration cache (see renderNodes).
interface DecorationEntry {
  source: ErdFlowNode;
  filterState: FilterHighlight;
  active: boolean;
  expanded: boolean;
  // Sorted comma-joined highlighted columns — value signature for the cache.
  highlightKey: string;
  decorated: ErdFlowNode;
}

function loadPersistedLayout(): LayoutStyle {
  const state = getVsCodeApi()?.getState<PersistedState>();
  return state?.layout && isLayoutStyle(state.layout)
    ? state.layout
    : DEFAULT_LAYOUT;
}

// MiniMap node fill: surface resource_type at a glance + dim non-matches so
// the minimap mirrors the canvas highlight state. Reads from data we stamp
// in `decorate()` below.
function miniMapNodeColor(node: { data?: Record<string, unknown> }): string {
  const data = node.data ?? {};
  const filterState = data.__filterState as "match" | "dim" | undefined;
  if (filterState === "dim") return "rgba(120, 120, 120, 0.45)";
  if (data.resource_type === "source") return "#FF694A";
  return "var(--vscode-focusBorder, #007acc)";
}

export function App({ serverUrl: initialUrl }: AppProps): ReactElement {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  // The full laid-out graph (every node/edge). The decorate+filter pass derives
  // the rendered set from this; React Flow's own state (`nodes`/`edges`) is the
  // *rendered* set, written via setNodes/setEdges so removals go through React
  // Flow's store (a controlled `nodes` prop alone does not drop nodes in v12).
  const [baseNodes, setBaseNodes] = useState<ErdFlowNode[]>([]);
  const [baseEdges, setBaseEdges] = useState<Edge[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<ErrorState | undefined>();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [filter, setFilter] = useState("");
  const [hideUnconnected, setHideUnconnected] = useState(false);
  const [layout, setLayout] = useState<LayoutStyle>(loadPersistedLayout);
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>();
  // Per-table expand state, lifted here (not local to ErdTableNode) so the FK
  // edges can read it via node data and anchor to the right rows.
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = useCallback((nodeId: string): void => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);
  const flowRef = useRef<ReactFlowInstance<ErdFlowNode, Edge> | null>(null);
  // Last successful payload, kept so a layout-style switch re-runs positioning
  // without a network round-trip. `payloadVersion` bumps on each fresh fetch so
  // the single layout effect re-runs against the new payload.
  const payloadRef = useRef<ErdPayload | null>(null);
  const [payloadVersion, setPayloadVersion] = useState(0);
  // Monotonically increasing nonce to force re-fetch on `dbterd.refresh`,
  // even when the serverUrl hasn't changed. Without this, React reuses the
  // cached fetch and the user sees stale data after editing .dbterd.yml.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const load = useCallback(
    async (url: string, signal: AbortSignal): Promise<void> => {
      setStatus("loading");
      setError(undefined);
      setProgress(null);
      const vscodeApi = getVsCodeApi();
      // Notify the extension so it can show a progress notification with a
      // "Show Logs" action — useful for big dbt projects where dbterd runs
      // for tens of seconds and the user otherwise sees only a spinner.
      vscodeApi?.postMessage({ type: "parseStarted" });
      let ok = false;
      try {
        const payload = await streamErd(url, {
          signal,
          onProgress: ({ percent, message }) => {
            setProgress({ percent, message });
          },
        });
        if (signal.aborted) return;
        // Hand the payload to the layout effect (below) rather than laying it
        // out here — one owner of toFlowGraph avoids a double layout pass when
        // a style switch races an in-flight fetch.
        payloadRef.current = payload;
        setPayloadVersion((v) => v + 1);
        setStatus("ready");
        setProgress(null);
        const projectName = payload.metadata?.dbt_project_name;
        const title = projectName ? `ERD of ${projectName}` : "dbt ERD";
        vscodeApi?.postMessage({ type: "setTitle", title });
        ok = true;
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ErdApiError) {
          setError({ message: err.detail, code: err.code });
        } else {
          setError({ message: err instanceof Error ? err.message : String(err) });
        }
        setStatus("error");
      } finally {
        if (!signal.aborted) {
          vscodeApi?.postMessage({ type: "parseFinished", ok });
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(serverUrl, controller.signal);
    return () => controller.abort();
  }, [serverUrl, load, refreshNonce]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (isOutboundMessage(event.data)) {
        setServerUrl(event.data.serverUrl);
        setRefreshNonce((n) => n + 1);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Persist the layout choice so a reload restores it.
  useEffect(() => {
    getVsCodeApi()?.setState<PersistedState>({ layout });
  }, [layout]);

  // Sole owner of positioning: run toFlowGraph whenever the layout style or the
  // payload changes, reusing the cached payload (no refetch), then refit. Both
  // a fresh fetch (payloadVersion bump) and a style switch flow through here, so
  // a switch during an in-flight fetch lays out exactly once when both settle.
  const pendingRefit = useRef(false);
  useEffect(() => {
    const payload = payloadRef.current;
    if (!payload) return;
    const flow = toFlowGraph(payload, layout);
    setBaseNodes(flow.nodes);
    setBaseEdges(flow.edges);
    pendingRefit.current = true;
  }, [layout, payloadVersion]);

  // Active node lookup — reads the full base graph so the pane reflects fresh
  // data after a refresh even if the node is currently filtered off the canvas,
  // and clears itself if the node disappears (e.g. user removed the model).
  const activeNode = useMemo<ErdNode | undefined>(() => {
    if (!activeNodeId) return undefined;
    const found = baseNodes.find((n) => n.id === activeNodeId);
    return found?.data;
  }, [activeNodeId, baseNodes]);

  // Matches against the full graph — search finds tables regardless of whether
  // a previous filter/toggle is hiding them.
  const matchedIds = useMemo<Set<string>>(() => {
    const query = normalize(filter);
    if (!query) return new Set();
    const set = new Set<string>();
    for (const node of baseNodes) {
      if (normalize(node.data.name).includes(query)) {
        set.add(node.id);
      }
    }
    return set;
  }, [filter, baseNodes]);

  const matchCount = matchedIds.size;
  const totalCount = baseNodes.length;
  const filterActive = filter.trim().length > 0;

  // Undirected neighbour map over the full edge set, rebuilt only on reload /
  // layout change (not per keystroke). Reuses the layout engines' shared
  // `buildAdjacency` (self-loops skipped) so the connected-set definition can't
  // drift from the one positioning uses.
  const adjacency = useMemo<Map<string, Set<string>>>(
    () =>
      buildAdjacency(baseEdges.map((e) => ({ from_id: e.source, to_id: e.target }))),
    [baseEdges],
  );

  // Nodes that participate in at least one edge. `adjacency` omits self-loops
  // (they carry no positioning information), so a table whose only edge is a
  // self-reference must be folded back in here or "hide unconnected" would drop
  // a genuinely related table. Drives the "hide unconnected" toggle.
  const connectedNodeIds = useMemo<Set<string>>(() => {
    const ids = new Set(adjacency.keys());
    for (const e of baseEdges) {
      if (e.source === e.target) ids.add(e.source);
    }
    return ids;
  }, [adjacency, baseEdges]);

  // Per-table FK columns of the selected edge(s), derived from the live `edges`
  // (which carry `selected`); feeds node decoration so the joined fields light up.
  const highlightedColumns = useMemo<Map<string, Set<string>>>(
    () => columnsForSelectedEdges(edges),
    [edges],
  );

  const highlightKeys = useMemo<Map<string, string>>(() => {
    const keys = new Map<string, string>();
    for (const [nodeId, columns] of highlightedColumns) {
      keys.set(nodeId, [...columns].sort().join(","));
    }
    return keys;
  }, [highlightedColumns]);

  // Nodes with enough columns to show the "N more" collapse toggle — the only
  // ones the expand/collapse-all action affects (others have no hidden rows).
  const collapsibleIds = useMemo<string[]>(
    () => baseNodes.filter((n) => isCollapsible(n.data.columns.length)).map((n) => n.id),
    [baseNodes],
  );

  // "All expanded" iff every collapsible table is in the expanded set; drives
  // whether the toolbar button collapses-all or expands-all next.
  const allExpanded =
    collapsibleIds.length > 0 && collapsibleIds.every((id) => expandedNodeIds.has(id));

  const toggleExpandAll = useCallback((): void => {
    setExpandedNodeIds(allExpanded ? new Set() : new Set(collapsibleIds));
  }, [allExpanded, collapsibleIds]);

  // The visible node set: every table unless "hide unconnected" drops the
  // zero-edge islands. Kept separate from decoration so a filter keystroke
  // (which only changes highlight state) doesn't re-derive membership.
  const visibleNodes = useMemo<ErdFlowNode[]>(
    () =>
      hideUnconnected
        ? baseNodes.filter((n) => connectedNodeIds.has(n.id))
        : baseNodes,
    [baseNodes, connectedNodeIds, hideUnconnected],
  );

  const visibleIds = useMemo<Set<string>>(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );

  // Per-node decoration cache: reuse the previous decorated object when a node's
  // base data and (filterState, active) signature are all unchanged, so a filter
  // keystroke only allocates new objects for the handful of nodes whose state
  // actually flipped. React Flow then re-renders only those nodes, not the whole
  // canvas. We key on the *source* node identity since the cached node's own
  // `data` is the decorated copy, not the base.
  const decoratedCache = useRef(new Map<string, DecorationEntry>());

  // Decorate the visible base graph into the rendered set. This is pushed into
  // React Flow's own state via setNodes/setEdges (below) rather than passed as a
  // prop, because a controlled `nodes` prop alone does not drop removed nodes
  // from React Flow v12's internal store.
  //
  // The name filter only *highlights* — every table stays on the canvas (matches
  // bright, the rest dimmed) so its connectors are never severed. The only node
  // removal is the "hide unconnected" toggle, which drops tables with zero edges
  // (true islands). Both leave every remaining edge fully drawn.
  const renderNodes = useMemo<ErdFlowNode[]>(() => {
    const cache = decoratedCache.current;
    const next = new Map<string, DecorationEntry>();
    const result = visibleNodes.map((node) => {
      const isMatch = filterActive ? matchedIds.has(node.id) : false;
      const isActive = node.id === activeNodeId;
      const filterState: FilterHighlight = filterActive
        ? isMatch
          ? "match"
          : "dim"
        : undefined;
      const highlightSet = highlightedColumns.get(node.id);
      const highlightKey = highlightKeys.get(node.id) ?? "";
      const isExpanded = expandedNodeIds.has(node.id);
      const prev = cache.get(node.id);
      let entry: DecorationEntry;
      if (
        prev &&
        prev.source === node &&
        prev.filterState === filterState &&
        prev.active === isActive &&
        prev.expanded === isExpanded &&
        prev.highlightKey === highlightKey
      ) {
        entry = prev;
      } else {
        entry = {
          source: node,
          filterState,
          active: isActive,
          expanded: isExpanded,
          highlightKey,
          decorated: {
            ...node,
            data: {
              ...node.data,
              __filterState: filterState,
              __active: isActive,
              __highlightColumns: highlightSet,
              __expanded: isExpanded,
              __onToggleExpand: toggleExpanded,
            },
          } as ErdFlowNode,
        };
      }
      next.set(node.id, entry);
      return entry.decorated;
    });
    decoratedCache.current = next;
    return result;
  }, [
    visibleNodes,
    matchedIds,
    filterActive,
    activeNodeId,
    highlightedColumns,
    highlightKeys,
    expandedNodeIds,
    toggleExpanded,
  ]);

  const renderEdges = useMemo<Edge[]>(
    () => baseEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [baseEdges, visibleIds],
  );

  // Push the derived render set into React Flow's controlled state. Going
  // through setNodes/setEdges (not the prop) ensures node *removals* take effect
  // — the documented behaviour for controlled flows in v12.
  const prevVisibleIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    setNodes(renderNodes);
    const prev = prevVisibleIds.current;
    const membershipChanged =
      prev !== null &&
      (prev.size !== visibleIds.size || [...visibleIds].some((id) => !prev.has(id)));
    prevVisibleIds.current = visibleIds;
    const relaidOut = pendingRefit.current;
    pendingRefit.current = false;
    if (membershipChanged || relaidOut) {
      void flowRef.current?.fitView({ duration: 200 });
    }
  }, [renderNodes, setNodes, visibleIds]);

  useEffect(() => {
    setEdges((prev) => {
      const selectedIds = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return renderEdges.map((e) =>
        selectedIds.has(e.id) ? { ...e, selected: true } : e,
      );
    });
  }, [renderEdges, setEdges]);

  // Single click only opens the details pane when it lands on the table
  // header — clicks on columns, the expand toggle, or whitespace shouldn't
  // hijack the user's selection. Double-click anywhere on the node opens the
  // backing file (handled below).
  const onNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".erd-table-header")) return;
    setActiveNodeId(node.id);
  }, []);

  const onNodeDoubleClick = useCallback<NodeMouseHandler>((_event, node) => {
    const data = node.data as Record<string, unknown> | undefined;
    const path = data?.model_path;
    if (typeof path === "string" && path.length > 0) {
      getVsCodeApi()?.postMessage({ type: "openFile", path });
    }
  }, []);

  // Wrap React Flow's node-change handler so the *end* of a drag writes the
  // final position back into `baseNodes` — the single source of truth
  // `renderNodes` derives from. Without this, any re-decoration (an edge click,
  // a filter keystroke, the hide toggle) rebuilds `renderNodes` from the
  // original laid-out positions and `setNodes` clobbers the user's manual
  // arrangement. React Flow's own `nodes` state still updates per-frame via
  // `onNodesChange(changes)`, so dragging stays smooth; we only sync the base
  // graph on drop (`dragging === false`) to avoid recomputing renderNodes every
  // mousemove.
  const onNodesChangeWithSync = useCallback(
    (changes: NodeChange<ErdFlowNode>[]): void => {
      onNodesChange(changes);
      const dropped = new Map<string, { x: number; y: number }>();
      for (const change of changes) {
        if (change.type === "position" && change.dragging === false && change.position) {
          dropped.set(change.id, change.position);
        }
      }
      if (dropped.size === 0) return;
      setBaseNodes((prev) =>
        prev.map((n) => {
          const pos = dropped.get(n.id);
          return pos ? { ...n, position: pos } : n;
        }),
      );
    },
    [onNodesChange],
  );

  const clearActiveNode = useCallback((): void => {
    setActiveNodeId(undefined);
  }, []);

  if (status === "error" && error) {
    const hint = error.code ? remediationHint(error.code) : undefined;
    return (
      <div className="status error">
        <div>Failed to load ERD: {error.message}</div>
        {hint ? <div className="status-hint">{hint}</div> : null}
      </div>
    );
  }
  if (status === "loading" && baseNodes.length === 0) {
    const pct = progress?.percent ?? 0;
    const msg = progress?.message ?? "Starting…";
    return (
      <div className="status">
        <ParseProgressBar percent={pct} message={msg} />
      </div>
    );
  }

  return (
    <div className="erd-canvas">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        matchCount={matchCount}
        totalCount={totalCount}
        hideUnconnected={hideUnconnected}
        onToggleHideUnconnected={() => setHideUnconnected((v) => !v)}
        layout={layout}
        onLayoutChange={setLayout}
        allExpanded={allExpanded}
        canExpand={collapsibleIds.length > 0}
        onToggleExpandAll={toggleExpandAll}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeWithSync}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={clearActiveNode}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        fitView
        onlyRenderVisibleElements={false}
        minZoom={0.05}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          ariaLabel="Mini-map"
          nodeColor={miniMapNodeColor}
          nodeStrokeColor="var(--vscode-focusBorder, #007acc)"
          nodeStrokeWidth={2}
          nodeBorderRadius={4}
          maskColor="rgba(0, 0, 0, 0.4)"
          style={{
            background: "var(--vscode-editor-background, #1e1e1e)",
            border: "1px solid var(--vscode-widget-border, #3c3c3c)",
            borderRadius: 6,
          }}
        />
      </ReactFlow>
      {activeNode ? <DetailsPane node={activeNode} onClose={clearActiveNode} /> : null}
    </div>
  );
}
