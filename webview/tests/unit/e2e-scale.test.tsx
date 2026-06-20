import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reactFlowMock, scalePayload } from "./_support/erd-harness";

vi.mock("@xyflow/react", () => reactFlowMock());
vi.mock("@/components/edgeTypes", () => ({ edgeTypes: {} }));
vi.mock("@/components/nodeTypes", () => ({ nodeTypes: {} }));

const streamErdMock = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, streamErd: streamErdMock };
});

let persistedState: unknown;
vi.mock("@/vscode", () => ({
  getVsCodeApi: () => ({
    postMessage: vi.fn(),
    getState: () => persistedState,
    setState: (next: unknown) => {
      persistedState = next;
    },
  }),
}));

const PAYLOAD = scalePayload();
const NODE_COUNT = PAYLOAD.nodes.length;
const EDGE_COUNT = PAYLOAD.edges.length;
const ISLAND_IDS = PAYLOAD.nodes.filter((n) => n.id.startsWith("source.big.island")).map((n) => n.id);

const NODE_CARD = /^node-(?!header-|body-)/;

function nodeCards(): HTMLElement[] {
  return screen.getAllByTestId(NODE_CARD);
}

function edgeCards(): HTMLElement[] {
  return screen.getAllByTestId(/^edge-/);
}

async function renderApp() {
  streamErdMock.mockResolvedValue(PAYLOAD);
  const { App } = await import("@/App");
  render(<App serverUrl="http://localhost:1" />);
  await waitFor(() => expect(screen.getByTestId("react-flow")).toBeTruthy());
}

beforeEach(() => {
  streamErdMock.mockReset();
  persistedState = undefined;
});

afterEach(() => {
  cleanup();
});

describe("App: large-graph end-to-end", () => {
  it("renders every node and edge of a large graph", async () => {
    await renderApp();
    await waitFor(() =>
      expect(nodeCards()).toHaveLength(NODE_COUNT),
    );
    expect(edgeCards()).toHaveLength(EDGE_COUNT);
  });

  it("keeps every incoming edge of a busy hub on the canvas", async () => {
    await renderApp();
    await waitFor(() => expect(edgeCards().length).toBeGreaterThan(0));
    const hubEdges = edgeCards().filter(
      (el) => el.getAttribute("data-target") === "model.big.hub_0",
    );
    expect(hubEdges.length).toBeGreaterThanOrEqual(12);
  });

  it("drops island tables when hide-unconnected is on and restores them", async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByTestId(`node-${ISLAND_IDS[0]}`)).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));
    await waitFor(() => {
      for (const id of ISLAND_IDS) expect(screen.queryByTestId(`node-${id}`)).toBeNull();
    });
    expect(screen.getByTestId("node-model.big.hub_0")).toBeTruthy();
    expect(edgeCards()).toHaveLength(EDGE_COUNT);

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));
    await waitFor(() => expect(screen.getByTestId(`node-${ISLAND_IDS[0]}`)).toBeTruthy());
  });

  it("re-lays out across every layout engine without losing the graph", async () => {
    await renderApp();
    await waitFor(() => expect(nodeCards()).toHaveLength(NODE_COUNT));

    for (const label of [/Hierarchical layout/i, /Force layout/i, /Radial layout/i]) {
      fireEvent.click(screen.getByLabelText(label));
      await waitFor(() => {
        expect(nodeCards()).toHaveLength(NODE_COUNT);
        expect(edgeCards()).toHaveLength(EDGE_COUNT);
      });
    }
  });

  it("highlights the joined columns when a composite FK edge is selected", async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByTestId("edge-e_composite")).toBeTruthy());

    fireEvent.click(screen.getByTestId("edge-e_composite"));

    await waitFor(() =>
      expect(
        screen.getByTestId("node-model.big.composite_child").getAttribute("data-highlight"),
      ).toBe("part_a,part_b"),
    );
    expect(screen.getByTestId("node-model.big.hub_1").getAttribute("data-highlight")).toBe("id");
  });

  it("expands and collapses every wide table at once", async () => {
    await renderApp();
    await waitFor(() => expect(screen.getByTestId("node-model.big.wide_fact")).toBeTruthy());

    expect(screen.getByTestId("node-model.big.wide_fact").getAttribute("data-expanded")).toBe("false");

    fireEvent.click(screen.getByLabelText(/Expand all columns/i));
    await waitFor(() =>
      expect(screen.getByTestId("node-model.big.wide_fact").getAttribute("data-expanded")).toBe("true"),
    );

    fireEvent.click(screen.getByLabelText(/Collapse all columns/i));
    await waitFor(() =>
      expect(screen.getByTestId("node-model.big.wide_fact").getAttribute("data-expanded")).toBe("false"),
    );
  });
});
