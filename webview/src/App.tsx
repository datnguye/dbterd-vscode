import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
} from "@xyflow/react";
import { ErdApiError, fetchErd, remediationHint, type ErdErrorCode } from "./api";
import { edgeTypes } from "./components/edgeTypes";
import { nodeTypes } from "./components/nodeTypes";
import { Toolbar } from "./components/Toolbar";
import { toFlowGraph } from "./layout";
import { isOutboundMessage } from "./messaging/protocol";
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

export function App({ serverUrl: initialUrl }: AppProps): ReactElement {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<ErrorState | undefined>();
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
