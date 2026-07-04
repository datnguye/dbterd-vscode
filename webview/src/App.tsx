import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  DEFAULT_LAYOUT,
  ErdFlow,
  isLayoutStyle,
  type ErdNode,
  type ErdPayload,
  type ErdTheme,
  type LayoutStyle,
  type ResourceMeta,
} from "@datnguye/erd-flow";
import "@datnguye/erd-flow/styles.css";
import { ErdApiError, remediationHint, streamErd, type ErdErrorCode } from "./api";
import { DetailsPane } from "./components/DetailsPane";
import { ParseProgressBar } from "./components/ParseProgressBar";
import { Toolbar } from "./components/Toolbar";
import { isOutboundMessage } from "./messaging/protocol";
import { getVsCodeApi } from "./vscode";

interface AppProps {
  serverUrl: string;
}

type LoadState = "loading" | "settled";

interface ErrorState {
  message: string;
  code?: ErdErrorCode;
}

interface ProgressState {
  percent: number;
  message: string;
}

// Persisted webview state shape. VS Code retains this across reloads (and panel
// hide/show) for the lifetime of the panel, so the user's layout choice sticks.
interface PersistedState {
  layout?: LayoutStyle;
}

const VSCODE_THEME = {
  nodeBg: "var(--vscode-editor-background)",
  border: "var(--vscode-focusBorder)",
  accent: "var(--vscode-charts-yellow)",
  fk: "var(--vscode-charts-blue)",
  headerBg: "var(--vscode-sideBarSectionHeader-background)",
  hoverBg: "var(--vscode-list-hoverBackground)",
  mutedFg: "var(--vscode-descriptionForeground)",
  linkFg: "var(--vscode-textLink-foreground)",
  divider: "var(--vscode-widget-border)",
  nodeFg: "var(--vscode-editor-foreground)",
  fontMono: "var(--vscode-editor-font-family)",
  minimapBg: "var(--vscode-editor-background)",
  edge: "var(--vscode-focusBorder)",
  edgeSelected: "var(--vscode-charts-yellow)",
} as const satisfies ErdTheme;

const RESOURCE_META = {
  source: { color: "#FF694A", icon: "database" },
} as const satisfies Record<string, ResourceMeta>;

function loadPersistedLayout(): LayoutStyle {
  const state = getVsCodeApi()?.getState<PersistedState>();
  return state?.layout && isLayoutStyle(state.layout) ? state.layout : DEFAULT_LAYOUT;
}

export function App({ serverUrl: initialUrl }: AppProps): ReactElement {
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [payload, setPayload] = useState<ErdPayload | null>(null);
  const [status, setStatus] = useState<LoadState>("loading");
  const [error, setError] = useState<ErrorState | undefined>();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [filter, setFilter] = useState("");
  const [hideUnconnected, setHideUnconnected] = useState(false);
  const [layout, setLayout] = useState<LayoutStyle>(loadPersistedLayout);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState<boolean | undefined>(undefined);
  const [expandState, setExpandState] = useState({ allExpanded: false, canExpand: false });
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
        const next = await streamErd(url, {
          signal,
          onProgress: ({ percent, message }) => {
            setProgress({ percent, message });
          },
        });
        if (signal.aborted) return;
        setPayload(next);
        setStatus("settled");
        setProgress(null);
        const projectName = next.metadata?.dbt_project_name;
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
        setStatus("settled");
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

  const openNode = useCallback((node: ErdNode): void => {
    const path = node.model_path;
    if (typeof path === "string" && path.length > 0) {
      getVsCodeApi()?.postMessage({ type: "openFile", path });
    }
  }, []);

  const onNodeActivate = useCallback((node: ErdNode | null): void => {
    setActiveNodeId(node?.id ?? null);
  }, []);

  const closeDetails = useCallback((): void => {
    setActiveNodeId(null);
  }, []);

  const toggleHideUnconnected = useCallback((): void => {
    setHideUnconnected((v) => !v);
  }, []);

  const toggleExpandAll = useCallback((): void => {
    setExpandAll(!expandState.allExpanded);
  }, [expandState.allExpanded]);

  const onExpandStateChange = useCallback(
    (state: { allExpanded: boolean; canExpand: boolean }): void => {
      setExpandState(state);
      setExpandAll(undefined);
    },
    [],
  );

  const activeNode = useMemo(
    () => payload?.nodes.find((n) => n.id === activeNodeId) ?? null,
    [payload, activeNodeId],
  );

  const countedNodes = useMemo(() => {
    const allNodes = payload?.nodes ?? [];
    if (!hideUnconnected) return allNodes;
    const connectedIds = new Set(
      (payload?.edges ?? []).flatMap((e) => [e.from_id, e.to_id]),
    );
    return allNodes.filter((n) => connectedIds.has(n.id));
  }, [payload, hideUnconnected]);

  const { matchCount, totalCount } = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const matches = query
      ? countedNodes.filter((n) => n.name.toLowerCase().includes(query)).length
      : 0;
    return { matchCount: matches, totalCount: countedNodes.length };
  }, [countedNodes, filter]);

  if (error) {
    const hint = error.code ? remediationHint(error.code) : undefined;
    return (
      <div className="status error">
        <div>Failed to load ERD: {error.message}</div>
        {hint ? <div className="status-hint">{hint}</div> : null}
      </div>
    );
  }
  if (status === "loading" && !payload) {
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
        onToggleHideUnconnected={toggleHideUnconnected}
        layout={layout}
        onLayoutChange={setLayout}
        allExpanded={expandState.allExpanded}
        canExpand={expandState.canExpand}
        onToggleExpandAll={toggleExpandAll}
      />
      {payload ? (
        <ErdFlow
          data={payload}
          layout={layout}
          filter={filter}
          hideUnconnected={hideUnconnected}
          expandAll={expandAll}
          onExpandStateChange={onExpandStateChange}
          onNodeActivate={onNodeActivate}
          onOpenNode={openNode}
          theme={VSCODE_THEME}
          resourceMeta={RESOURCE_META}
          colorMode="dark"
        />
      ) : null}
      {activeNode ? <DetailsPane node={activeNode} onClose={closeDetails} /> : null}
    </div>
  );
}
