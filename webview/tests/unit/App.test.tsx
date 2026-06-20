import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reactFlowMock } from "./_support/erd-harness";

vi.mock("@xyflow/react", () => reactFlowMock());

vi.mock("@/components/edgeTypes", () => ({ edgeTypes: {} }));
vi.mock("@/components/nodeTypes", () => ({ nodeTypes: {} }));

const streamErdMock = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, streamErd: streamErdMock };
});

const postMessageMock = vi.fn();
// A tiny in-memory stand-in for VS Code's webview state so persistence
// (setState) and restore-on-mount (getState) are exercised end-to-end.
let persistedState: unknown;
const getStateMock = vi.fn(() => persistedState);
const setStateMock = vi.fn((next: unknown) => {
  persistedState = next;
});
vi.mock("@/vscode", () => ({
  getVsCodeApi: () => ({
    postMessage: postMessageMock,
    getState: getStateMock,
    setState: setStateMock,
  }),
}));

const okPayload = {
  nodes: [],
  edges: [],
  metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
};

beforeEach(() => {
  streamErdMock.mockReset();
  postMessageMock.mockReset();
  setStateMock.mockClear();
  getStateMock.mockClear();
  persistedState = undefined;
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("posts setTitle with the project name on success", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "setTitle", title: "ERD of demo" });
    });
  });

  it("falls back to a generic title when project name is empty", async () => {
    streamErdMock.mockResolvedValue({ ...okPayload, metadata: { ...okPayload.metadata, dbt_project_name: "" } });
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "setTitle", title: "dbt ERD" });
    });
  });

  it("renders a remediation hint for typed API errors", async () => {
    const { ErdApiError } = await import("@/api");
    streamErdMock.mockRejectedValue(
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
    streamErdMock.mockRejectedValue(new Error("network down"));
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load ERD: network down/)).toBeTruthy();
    });
  });

  it("re-fetches when an outbound refresh message arrives", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalledTimes(1));

    window.postMessage({ type: "refresh", serverUrl: "http://localhost:2" }, "*");
    await waitFor(() => expect(streamErdMock).toHaveBeenCalledTimes(2));
    // Second call uses the new URL.
    expect(streamErdMock.mock.calls[1][0]).toBe("http://localhost:2");
  });

  it("ignores refresh messages with unsafe URLs", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalledTimes(1));

    window.postMessage({ type: "refresh", serverUrl: "javascript:alert(1)" }, "*");
    // Give it a tick — should not trigger a second fetch.
    await new Promise((r) => setTimeout(r, 50));
    expect(streamErdMock).toHaveBeenCalledTimes(1);
  });

  it("shows the progress bar in the loading state initially", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    streamErdMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    // Progress bar with 0% / "Starting…" default renders while loading.
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("Starting…")).toBeTruthy();
    resolve(okPayload);
  });

  it("renders the minimap once data has loaded", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("minimap")).toBeTruthy());
  });
});

// Filter / details integration — drives the real Toolbar + EntityFilter so we
// exercise the App ↔ Toolbar wiring end-to-end. Nodes/edges flow through a real
// ErdPayload (the App lays it out and writes the rendered set into the mocked
// xyflow state), so these tests exercise the true data path. ReactFlow stays
// mocked. `from_id`/`to_id` are node *ids* — the canonical edge endpoints.
type SampleEdge = { id: string; from_id: string; to_id: string };

function samplePayload(edges: SampleEdge[] = []) {
  const col = {
    name: "id",
    data_type: "bigint",
    description: null,
    is_primary_key: false,
    is_foreign_key: false,
  };
  return {
    nodes: [
      {
        id: "model.demo.orders",
        name: "orders",
        resource_type: "model",
        schema_name: "s",
        database: "d",
        columns: [col],
        compiled_sql: "SELECT * FROM orders",
        model_path: "/workspace/models/orders.sql",
      },
      {
        id: "model.demo.customers",
        name: "customers",
        resource_type: "model",
        schema_name: "s",
        database: "d",
        columns: [col],
        compiled_sql: "SELECT * FROM customers",
      },
      {
        id: "source.demo.raw_orders",
        name: "raw_orders",
        resource_type: "source",
        schema_name: "s",
        database: "d",
        columns: [col],
      },
    ],
    edges: edges.map((e) => ({
      ...e,
      from_column: "id",
      to_column: "id",
      relationship_type: "fk",
    })),
    metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
  };
}

describe("App: filter & details integration", () => {

  it("highlights matches and dims the rest, keeping every table on the canvas", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());

    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "order" } });

    // Both nodes whose name contains "order" are matches.
    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-filter")).toBe("match");
      expect(screen.getByTestId("node-source.demo.raw_orders").getAttribute("data-filter")).toBe("match");
    });

    // The filter never removes tables — "customers" stays on the canvas, dimmed,
    // so its connectors are never severed.
    expect(screen.getByTestId("node-model.demo.customers").getAttribute("data-filter")).toBe("dim");

    // Match-count badge still surfaces "matches/total" against the full graph.
    expect(screen.getByText("2/3")).toBeTruthy();
  });

  it("keeps nodes connected (via an edge) to a match as dimmed context", async () => {
    // Wire customers ↔ orders (by node id) so the connected-context path runs.
    streamErdMock.mockResolvedValue(
      samplePayload([
        { id: "e1", from_id: "model.demo.customers", to_id: "model.demo.orders" },
      ]),
    );
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());

    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "order" } });

    // customers is not a match but is wired to orders → kept and dimmed.
    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-filter")).toBe("match");
      expect(screen.getByTestId("node-model.demo.customers").getAttribute("data-filter")).toBe("dim");
    });
  });

  it("clears all dim/match decorations when the filter is emptied", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());

    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "order" } });
    // While filtered, the non-matching customers node stays on canvas, dimmed.
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.customers").getAttribute("data-filter")).toBe("dim"),
    );

    fireEvent.click(screen.getByLabelText(/Clear filter/i));
    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-filter")).toBe("off");
      expect(screen.getByTestId("node-model.demo.customers").getAttribute("data-filter")).toBe("off");
    });
  });

  it("hides FK-less tables when the unconnected toggle is on, and restores them", async () => {
    // Wire orders ↔ customers (by node id); raw_orders stays an island.
    streamErdMock.mockResolvedValue(
      samplePayload([
        { id: "e1", from_id: "model.demo.customers", to_id: "model.demo.orders" },
      ]),
    );
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());

    // All three visible before toggling.
    await waitFor(() =>
      expect(screen.getByTestId("node-source.demo.raw_orders")).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));

    // The island disappears; the connected pair remains.
    await waitFor(() => {
      expect(screen.queryByTestId("node-source.demo.raw_orders")).toBeNull();
      expect(screen.getByTestId("node-model.demo.orders")).toBeTruthy();
      expect(screen.getByTestId("node-model.demo.customers")).toBeTruthy();
    });

    // Toggling off brings the island back.
    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));
    await waitFor(() =>
      expect(screen.getByTestId("node-source.demo.raw_orders")).toBeTruthy(),
    );
  });

  it("keeps a self-referencing table when the unconnected toggle is on", async () => {
    streamErdMock.mockResolvedValue(
      samplePayload([
        { id: "self", from_id: "model.demo.orders", to_id: "model.demo.orders" },
      ]),
    );
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));

    await waitFor(() => {
      expect(screen.getByTestId("node-model.demo.orders")).toBeTruthy();
      expect(screen.queryByTestId("node-model.demo.customers")).toBeNull();
    });
  });

  it("persists the layout choice when a layout button is clicked", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText(/Radial layout/i));
    await waitFor(() =>
      expect(setStateMock).toHaveBeenCalledWith({ layout: "radial" }),
    );
    expect(screen.getByLabelText(/Radial layout/i).getAttribute("aria-pressed")).toBe("true");
  });

  it("restores the persisted layout on mount", async () => {
    persistedState = { layout: "radial" };
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalled());
    // The radial button starts pressed because state was restored from getState.
    expect(screen.getByLabelText(/Radial layout/i).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the details pane on header click and closes on pane click", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-header-model.demo.orders")).toBeTruthy(),
    );

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
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-body-model.demo.orders")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("node-body-model.demo.orders"));
    // No details pane — body clicks shouldn't hijack selection.
    expect(screen.queryByLabelText(/Close details/i)).toBeNull();
  });

  it("posts openFile on double-click for nodes with model_path", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders")).toBeTruthy(),
    );

    fireEvent.doubleClick(screen.getByTestId("node-model.demo.orders"));
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "openFile",
      path: "/workspace/models/orders.sql",
    });
  });

  it("does not post openFile on double-click when model_path is absent", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-source.demo.raw_orders")).toBeTruthy(),
    );

    postMessageMock.mockClear();
    // raw_orders has no model_path — double-click should be a no-op.
    fireEvent.doubleClick(screen.getByTestId("node-source.demo.raw_orders"));
    expect(postMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "openFile" }),
    );
  });
});

// Edge-rendering integration — proves every FK connector is drawn on the canvas
// in EVERY layout, including a shared dimension referenced by multiple facts
// (the `dim_products` case). A shared dimension's edges are long in some
// layouts, but "long" must never mean "dropped".
function star() {
  const col = {
    name: "id",
    data_type: "bigint",
    description: null,
    is_primary_key: false,
    is_foreign_key: false,
  };
  const table = (id: string, name: string) => ({
    id,
    name,
    resource_type: "model" as const,
    schema_name: "s",
    database: "d",
    columns: [col],
    compiled_sql: null,
  });
  // dim_products is referenced by three facts — the shared-dimension shape.
  const facts = ["fact_a", "fact_b", "fact_c"];
  return {
    nodes: [
      table("model.demo.dim_products", "dim_products"),
      ...facts.map((f) => table(`model.demo.${f}`, f)),
      // An island with zero edges, to exercise hide-unconnected alongside.
      table("model.demo.lonely", "lonely"),
    ],
    edges: facts.map((f, i) => ({
      id: `e${i}`,
      from_id: `model.demo.${f}`,
      to_id: "model.demo.dim_products",
      from_column: "id",
      to_column: "id",
      relationship_type: "fk" as const,
    })),
    metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
  };
}

describe("App: edges always render (every layout)", () => {
  const layouts = [
    { name: "hierarchical", label: /Hierarchical layout/i },
    { name: "radial", label: /Radial layout/i },
    { name: "force", label: /Force layout/i },
  ] as const;

  for (const { name, label } of layouts) {
    it(`renders all 3 dim_products edges in the ${name} layout`, async () => {
      streamErdMock.mockResolvedValue(star());
      const { App } = await import("@/App");
      render(<App serverUrl="http://localhost:1" />);
      await waitFor(() =>
        expect(screen.getByTestId("node-model.demo.dim_products")).toBeTruthy(),
      );

      // Switch to the layout under test (hierarchical is the default).
      if (name !== "hierarchical") fireEvent.click(screen.getByLabelText(label));

      // All three FK connectors to the shared dimension are on the canvas at
      // full opacity — none dropped or dimmed, regardless of edge length.
      await waitFor(() => {
        for (const id of ["e0", "e1", "e2"]) {
          const edge = screen.getByTestId(`edge-${id}`);
          expect(edge.getAttribute("data-target")).toBe("model.demo.dim_products");
          expect(edge.getAttribute("data-opacity")).toBe("1");
        }
      });
    });
  }

  it("keeps every edge of a shared dimension when hide-unconnected is on", async () => {
    streamErdMock.mockResolvedValue(star());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.dim_products")).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));

    await waitFor(() => {
      // The island goes away…
      expect(screen.queryByTestId("node-model.demo.lonely")).toBeNull();
      // …but the shared dimension and all three of its edges stay.
      expect(screen.getByTestId("node-model.demo.dim_products")).toBeTruthy();
      for (const id of ["e0", "e1", "e2"]) {
        expect(screen.getByTestId(`edge-${id}`)).toBeTruthy();
      }
    });
  });

  it("never dims or drops edges while the name filter is active", async () => {
    streamErdMock.mockResolvedValue(star());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.dim_products")).toBeTruthy(),
    );

    // Filter to a single fact — dim_products is not a match, but its edges to
    // the other facts must still be drawn at full opacity.
    fireEvent.change(screen.getByLabelText(/Filter entities by name/i), {
      target: { value: "fact_a" },
    });

    await waitFor(() => {
      for (const id of ["e0", "e1", "e2"]) {
        const edge = screen.getByTestId(`edge-${id}`);
        expect(edge).toBeTruthy();
        expect(edge.getAttribute("data-opacity")).toBe("1");
      }
    });
  });
});

// Expand/collapse-all + drag persistence. A "wide" table (more columns than the
// collapse threshold) is the only kind the expand-all action affects.
function widePayload() {
  const columns = Array.from({ length: 8 }, (_, i) => ({
    name: `c${i}`,
    data_type: "text",
    description: null,
    is_primary_key: false,
    is_foreign_key: false,
  }));
  return {
    nodes: [
      {
        id: "model.demo.orders",
        name: "orders",
        resource_type: "model",
        schema_name: "s",
        database: "d",
        columns,
        compiled_sql: null,
      },
    ],
    edges: [],
    metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
  };
}

describe("App: expand/collapse all", () => {
  it("expands every collapsible table, then collapses them again", async () => {
    streamErdMock.mockResolvedValue(widePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders")).toBeTruthy(),
    );
    // Starts collapsed.
    expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-expanded")).toBe(
      "false",
    );

    fireEvent.click(screen.getByLabelText(/Expand all columns/i));
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-expanded")).toBe(
        "true",
      ),
    );

    // The button now offers collapse-all.
    fireEvent.click(screen.getByLabelText(/Collapse all columns/i));
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-expanded")).toBe(
        "false",
      ),
    );
  });

  it("disables expand-all when no table has hidden columns", async () => {
    streamErdMock.mockResolvedValue(samplePayload()); // all 1-column nodes
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders")).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText(/Expand all columns/i) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("App: drag persistence", () => {
  it("keeps a dragged node's position across a re-decoration", async () => {
    streamErdMock.mockResolvedValue(widePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders")).toBeTruthy(),
    );

    // Drag the node to a new position (drag-end).
    fireEvent.click(screen.getByTestId("drag-node"));
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-x")).toBe("999"),
    );

    // Trigger a re-decoration (expand-all rebuilds renderNodes); the position
    // must survive rather than reverting to the laid-out coordinates.
    fireEvent.click(screen.getByLabelText(/Expand all columns/i));
    await waitFor(() =>
      expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-expanded")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-x")).toBe("999");
    expect(screen.getByTestId("node-model.demo.orders").getAttribute("data-y")).toBe("888");
  });
});
