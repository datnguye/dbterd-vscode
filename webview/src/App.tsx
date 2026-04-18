import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
} from "@xyflow/react";
import { fetchErd } from "./api";
import { edgeTypes } from "./components/edgeTypes";
import { nodeTypes } from "./components/nodeTypes";
import { Toolbar } from "./components/Toolbar";
import { toFlowGraph, type ErdFlowNode } from "./layout";
import { getVsCodeApi } from "./vscode";

interface AppProps {
  serverUrl: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

interface RefreshMessage {
  type: "refresh";
  serverUrl: string;
}

function isRefreshMessage(data: unknown): data is RefreshMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  if (m.type !== "refresh" || typeof m.serverUrl !== "string") return false;
  // Defense-in-depth: the host always posts http(s) localhost URLs, but
  // reject anything else so a compromised postMessage can't swap in a
  // javascript: or data: scheme that then feeds fetch().
  return /^https?:\/\//.test(m.serverUrl);
}

export function App({ serverUrl: initialUrl }: AppProps): ReactElement {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | undefined>();
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
        const title = payload.dbt_project_name
          ? `ERD of ${payload.dbt_project_name}`
          : "dbt ERD";
        getVsCodeApi()?.postMessage({ type: "setTitle", title });
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
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
      if (isRefreshMessage(event.data)) {
        setServerUrl(event.data.serverUrl);
        setRefreshNonce((n) => n + 1);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (status === "error") return <div className="status error">Failed to load ERD: {error}</div>;
  if (status === "loading" && nodes.length === 0) {
    return <div className="status">Loading ERD…</div>;
  }

  return (
    <div className="erd-canvas">
      <Toolbar />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
