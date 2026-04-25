import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import { ErdApiError, fetchErd, remediationHint, type ErdErrorCode } from "./api";
import { DetailsPane } from "./components/DetailsPane";
import { edgeTypes } from "./components/edgeTypes";
import { nodeTypes } from "./components/nodeTypes";
import { Toolbar } from "./components/Toolbar";
import { toFlowGraph } from "./layout";
import { isOutboundMessage } from "./messaging/protocol";
import type { ErdNode } from "./types/erd";
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

function normalize(value: string): string {
  return value.trim().toLowerCase();
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
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<ErrorState | undefined>();
  const [filter, setFilter] = useState("");
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>();
  // Monotonically increasing nonce to force re-fetch on `dbterd.refresh`,
  // even when the serverUrl hasn't changed. Without this, React reuses the
  // cached fetch and the user sees stale data after editing .dbterd.yml.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const load = useCallback(
    async (url: string, signal: AbortSignal): Promise<void> => {
      setStatus("loading");
      setError(undefined);
      try {
        const payload = await fetchErd(url, signal);
        if (signal.aborted) return;
        const flow = toFlowGraph(payload);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setStatus("ready");
        const projectName = payload.metadata?.dbt_project_name;
        const title = projectName ? `ERD of ${projectName}` : "dbt ERD";
        getVsCodeApi()?.postMessage({ type: "setTitle", title });
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ErdApiError) {
          setError({ message: err.detail, code: err.code });
        } else {
          setError({ message: err instanceof Error ? err.message : String(err) });
        }
        setStatus("error");
      }
    },
    [setNodes, setEdges],
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

  // Active node lookup — kept in sync with the canonical `nodes` state so the
  // pane reflects fresh data after a refresh, and clears itself if the node
  // disappears (e.g. user removed the model from dbt).
  const activeNode = useMemo<ErdNode | undefined>(() => {
    if (!activeNodeId) return undefined;
    const found = nodes.find((n) => n.id === activeNodeId);
    return found?.data;
  }, [activeNodeId, nodes]);

  // Decorate nodes/edges with filter state. Matches stay vivid; nodes
  // connected to a match (via any edge) stay as dimmed context. Anything
  // disconnected from the matched set is dropped from the canvas entirely.
  const matchedIds = useMemo<Set<string>>(() => {
    const query = normalize(filter);
    if (!query) return new Set();
    const set = new Set<string>();
    for (const node of nodes) {
      if (normalize(node.data.name).includes(query)) {
        set.add(node.id);
      }
    }
    return set;
  }, [filter, nodes]);

  const matchCount = matchedIds.size;
  const totalCount = nodes.length;
  const filterActive = filter.trim().length > 0;

  // Nodes adjacent to a match — kept (dimmed) so users see the immediate FK
  // context for their search. Truly disconnected nodes get filtered out.
  const connectedIds = useMemo<Set<string>>(() => {
    if (!filterActive) return new Set();
    const set = new Set<string>(matchedIds);
    for (const edge of edges) {
      if (matchedIds.has(edge.source)) set.add(edge.target);
      if (matchedIds.has(edge.target)) set.add(edge.source);
    }
    return set;
  }, [edges, matchedIds, filterActive]);

  const decoratedNodes = useMemo<ErdFlowNode[]>(() => {
    const visible = filterActive ? nodes.filter((n) => connectedIds.has(n.id)) : nodes;
    return visible.map((node) => {
      const isMatch = filterActive ? matchedIds.has(node.id) : false;
      const isActive = node.id === activeNodeId;
      const filterState: "match" | "dim" | undefined = filterActive
        ? isMatch
          ? "match"
          : "dim"
        : undefined;
      const nextData = {
        ...node.data,
        __filterState: filterState,
        __active: isActive,
      };
      return { ...node, data: nextData } as ErdFlowNode;
    });
  }, [nodes, matchedIds, connectedIds, filterActive, activeNodeId]);

  const decoratedEdges = useMemo<Edge[]>(() => {
    if (!filterActive) return edges;
    // Drop edges whose endpoints aren't both visible; otherwise React Flow
    // renders dangling lines into empty space.
    const visibleEdges = edges.filter(
      (e) => connectedIds.has(e.source) && connectedIds.has(e.target),
    );
    return visibleEdges.map((edge) => {
      const touchesMatch = matchedIds.has(edge.source) || matchedIds.has(edge.target);
      return touchesMatch
        ? edge
        : { ...edge, style: { ...(edge.style ?? {}), opacity: 0.2 } };
    });
  }, [edges, matchedIds, connectedIds, filterActive]);

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
    const path = data?.raw_sql_path;
    if (typeof path === "string" && path.length > 0) {
      getVsCodeApi()?.postMessage({ type: "openFile", path });
    }
  }, []);

  const onPaneClick = useCallback((): void => {
    setActiveNodeId(undefined);
  }, []);

  const closeDetails = useCallback((): void => {
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
  if (status === "loading" && nodes.length === 0) {
    return <div className="status">Loading ERD…</div>;
  }

  return (
    <div className="erd-canvas">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        matchCount={matchCount}
        totalCount={totalCount}
      />
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
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
      {activeNode ? <DetailsPane node={activeNode} onClose={closeDetails} /> : null}
    </div>
  );
}
