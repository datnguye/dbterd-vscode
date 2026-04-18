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
import { nodeTypes } from "./components/nodeTypes";
import { toFlowGraph, type ErdFlowNode } from "./layout";

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
  return m.type === "refresh" && typeof m.serverUrl === "string";
}

export function App({ serverUrl: initialUrl }: AppProps): ReactElement {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | undefined>();

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
  }, [serverUrl, load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (isRefreshMessage(event.data)) {
        setServerUrl(event.data.serverUrl);
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
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
