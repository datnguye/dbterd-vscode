import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// xyflow uses ResizeObserver and other browser APIs jsdom doesn't ship.
// Stub the components/hooks we touch with thin pass-throughs that just expose
// children — App's job is orchestration, not the canvas itself.
// Stable references so React doesn't tag every render as a state change and
// retrigger effects forever. The actual xyflow hooks return stable setters.
const stableEdges: unknown[] = [];
const noop = (): void => undefined;

interface ReactFlowMockProps {
  children?: React.ReactNode;
  nodes?: Array<{ id: string; data: Record<string, unknown> }>;
  onNodeClick?: (event: unknown, node: { id: string; data: Record<string, unknown> }) => void;
  onNodeDoubleClick?: (event: unknown, node: { id: string; data: Record<string, unknown> }) => void;
  onPaneClick?: () => void;
}

// Persist the latest sample nodes so tests can drive interactions without
// monkey-patching xyflow internals. The mock surfaces them as data-testid
// buttons so RTL can click them like any other DOM node.
let stableNodes: Array<{ id: string; data: Record<string, unknown> }> = [];
const setSampleNodes = (next: typeof stableNodes): void => {
  stableNodes = next;
};

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MiniMap: () => <div data-testid="minimap" />,
  ReactFlow: ({
    children,
    nodes,
    onNodeClick,
    onNodeDoubleClick,
    onPaneClick,
  }: ReactFlowMockProps) => (
    <div data-testid="react-flow">
      <button type="button" data-testid="pane" onClick={() => onPaneClick?.()}>pane</button>
      {(nodes ?? []).map((n) => (
        <div
          key={n.id}
          data-testid={`node-${n.id}`}
          data-filter={String(n.data.__filterState ?? "off")}
          data-active={String(n.data.__active ?? false)}
          onClick={(e) => onNodeClick?.(e, n)}
          onDoubleClick={(e) => onNodeDoubleClick?.(e, n)}
        >
          <div className="erd-table-header" data-testid={`node-header-${n.id}`}>
            {String(n.data.name)}
          </div>
          <div className="erd-table-body" data-testid={`node-body-${n.id}`}>body</div>
        </div>
      ))}
      {children}
    </div>
  ),
  useNodesState: () => [stableNodes, noop, noop],
  useEdgesState: () => [stableEdges, noop, noop],
}));

vi.mock("@/components/edgeTypes", () => ({ edgeTypes: {} }));
vi.mock("@/components/nodeTypes", () => ({ nodeTypes: {} }));

const fetchErdMock = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, fetchErd: fetchErdMock };
});

const postMessageMock = vi.fn();
vi.mock("@/vscode", () => ({
  getVsCodeApi: () => ({ postMessage: postMessageMock, getState: vi.fn(), setState: vi.fn() }),
}));

const okPayload = {
  nodes: [],
  edges: [],
  metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
};

beforeEach(() => {
  fetchErdMock.mockReset();
  postMessageMock.mockReset();
  setSampleNodes([]);
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("posts setTitle with the project name on success", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "setTitle", title: "ERD of demo" });
    });
  });

  it("falls back to a generic title when project name is empty", async () => {
    fetchErdMock.mockResolvedValue({ ...okPayload, metadata: { ...okPayload.metadata, dbt_project_name: "" } });
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "setTitle", title: "dbt ERD" });
    });
  });

  it("renders a remediation hint for typed API errors", async () => {
    const { ErdApiError } = await import("@/api");
    fetchErdMock.mockRejectedValue(
      new ErdApiError("manifest_missing", "manifest.json not found", 404),
    );
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load ERD/)).toBeTruthy();
      expect(screen.getByText(/Run `dbt compile`/)).toBeTruthy();
    });
  });

  it("renders generic error message for non-API errors", async () => {
    fetchErdMock.mockRejectedValue(new Error("network down"));
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load ERD: network down/)).toBeTruthy();
    });
  });

  it("re-fetches when an outbound refresh message arrives", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalledTimes(1));

    window.postMessage({ type: "refresh", serverUrl: "http://localhost:2" }, "*");
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalledTimes(2));
    // Second call uses the new URL.
    expect(fetchErdMock.mock.calls[1][0]).toBe("http://localhost:2");
  });

  it("ignores refresh messages with unsafe URLs", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalledTimes(1));

    window.postMessage({ type: "refresh", serverUrl: "javascript:alert(1)" }, "*");
    // Give it a tick — should not trigger a second fetch.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchErdMock).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state initially", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    fetchErdMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    expect(screen.getByText(/Loading ERD/)).toBeTruthy();
    resolve(okPayload);
  });

  it("renders the minimap once data has loaded", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("minimap")).toBeTruthy());
  });
});

// Filter / details integration — drives the real Toolbar + EntityFilter so we
// exercise the App ↔ Toolbar wiring end-to-end. ReactFlow stays mocked.
describe("App: filter & details integration", () => {
  beforeEach(() => {
    setSampleNodes([
      {
        id: "model.demo.orders",
        data: { name: "orders", resource_type: "model", columns: [], raw_sql_path: "models/orders.sql" },
      },
      {
        id: "model.demo.customers",
        data: { name: "customers", resource_type: "model", columns: [], raw_sql_path: "models/customers.sql" },
      },
      {
        id: "source.demo.raw_orders",
        data: { name: "raw_orders", resource_type: "source", columns: [] },
      },
    ]);
  });

  it("highlights matches and drops nodes disconnected from the matched set", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "order" } });

    // Both nodes whose name contains "order" are matches.
    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-filter")).toBe("match");
      expect(screen.getByTestId("node-source.demo.raw_orders").getAttribute("data-filter")).toBe("match");
    });

    // "customers" has no edges connecting it to either match → removed from canvas.
    expect(screen.queryByTestId("node-model.demo.customers")).toBeNull();

    // Match-count badge still surfaces "matches/total" against the full graph.
    expect(screen.getByText("2/3")).toBeTruthy();
  });

  it("keeps nodes connected (via an edge) to a match as dimmed context", async () => {
    // Reuse the sample but wire customers ↔ orders so the connected-context
    // path is exercised. The mocked useEdgesState returns this list.
    stableEdges.length = 0;
    stableEdges.push({
      id: "e1",
      source: "model.demo.customers",
      target: "model.demo.orders",
    });
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "order" } });

    // customers is not a match but is wired to orders → kept and dimmed.
    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-filter")).toBe("match");
      expect(screen.getByTestId("node-model.demo.customers").getAttribute("data-filter")).toBe("dim");
    });

    stableEdges.length = 0;
  });

  it("clears all dim/match decorations when the filter is emptied", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "order" } });
    // While filtered, the disconnected customers node disappears entirely.
    await waitFor(() =>
      expect(screen.queryByTestId("node-model.demo.customers")).toBeNull(),
    );

    fireEvent.click(screen.getByLabelText(/Clear filter/i));
    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-filter")).toBe("off");
      expect(screen.getByTestId("node-model.demo.customers").getAttribute("data-filter")).toBe("off");
    });
  });

  it("opens the details pane on header click and closes on pane click", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("node-header-model.demo.orders"));
    await waitFor(() => {
      // The details pane heading shows the model name.
      const heading = screen.getAllByText("orders");
      expect(heading.length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/Close details/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pane"));
    await waitFor(() => {
      expect(screen.queryByLabelText(/Close details/i)).toBeNull();
    });
  });

  it("does not open the details pane on clicks outside the header", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("node-body-model.demo.orders"));
    // No details pane — body clicks shouldn't hijack selection.
    expect(screen.queryByLabelText(/Close details/i)).toBeNull();
  });

  it("posts openFile on double-click for nodes with a raw_sql_path", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    fireEvent.doubleClick(screen.getByTestId("node-model.demo.orders"));
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "openFile",
      path: "models/orders.sql",
    });
  });

  it("does not post openFile on double-click when raw_sql_path is missing", async () => {
    fetchErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(fetchErdMock).toHaveBeenCalled());

    postMessageMock.mockClear();
    fireEvent.doubleClick(screen.getByTestId("node-source.demo.raw_orders"));
    expect(postMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "openFile" }),
    );
  });
});
