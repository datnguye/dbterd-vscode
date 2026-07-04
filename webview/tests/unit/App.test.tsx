import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErdFlowProps } from "@datnguye/erd-flow";
import { node, payload } from "./_support/erd-factories";

let lastErdFlowProps: ErdFlowProps | null = null;
vi.mock("@datnguye/erd-flow", async () => {
  const actual = await vi.importActual<typeof import("@datnguye/erd-flow")>("@datnguye/erd-flow");
  return {
    ...actual,
    ErdFlow: (props: ErdFlowProps) => {
      lastErdFlowProps = props;
      const first = props.data.nodes[0] ?? null;
      return (
        <div data-testid="erd-flow" data-layout={props.layout} data-filter={props.filter}>
          <button
            type="button"
            data-testid="activate-first"
            onClick={() => props.onNodeActivate?.(first)}
          >
            activate
          </button>
          <button
            type="button"
            data-testid="clear-active"
            onClick={() => props.onNodeActivate?.(null)}
          >
            clear
          </button>
          <button
            type="button"
            data-testid="open-first"
            onClick={() => first && props.onOpenNode?.(first)}
          >
            open
          </button>
        </div>
      );
    },
  };
});

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

function samplePayload() {
  return payload([
    node("model.demo.orders", {
      compiled_sql: "SELECT * FROM orders",
      model_path: "/workspace/models/orders.sql",
    }),
    node("source.demo.raw_orders", { resource_type: "source" }),
  ]);
}

const okPayload = payload([]);

beforeEach(() => {
  streamErdMock.mockReset();
  postMessageMock.mockReset();
  setStateMock.mockClear();
  getStateMock.mockClear();
  persistedState = undefined;
  lastErdFlowProps = null;
});

afterEach(() => {
  cleanup();
});

describe("App: load lifecycle", () => {
  it("posts setTitle with the project name on success", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "setTitle", title: "ERD of demo" });
    });
  });

  it("falls back to a generic title when project name is empty", async () => {
    streamErdMock.mockResolvedValue({
      ...okPayload,
      metadata: { ...okPayload.metadata, dbt_project_name: "" },
    });
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "setTitle", title: "dbt ERD" });
    });
  });

  it("posts parseStarted then parseFinished(ok) around a successful load", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith({ type: "parseStarted" });
      expect(postMessageMock).toHaveBeenCalledWith({ type: "parseFinished", ok: true });
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
    expect(streamErdMock.mock.calls[1][0]).toBe("http://localhost:2");
  });

  it("ignores refresh messages with unsafe URLs", async () => {
    streamErdMock.mockResolvedValue(okPayload);
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(streamErdMock).toHaveBeenCalledTimes(1));

    window.postMessage({ type: "refresh", serverUrl: "javascript:alert(1)" }, "*");
    await new Promise((r) => setTimeout(r, 50));
    expect(streamErdMock).toHaveBeenCalledTimes(1);
  });

  it("shows the progress bar in the loading state initially", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    streamErdMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("Starting…")).toBeTruthy();
    resolve(okPayload);
  });

  it("mounts ErdFlow with the fetched payload once loaded", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());
    expect(lastErdFlowProps?.data.nodes).toHaveLength(2);
  });
});

describe("App: shell ↔ ErdFlow wiring", () => {
  it("passes filter, layout, and hideUnconnected through to ErdFlow", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Filter entities by name/i), {
      target: { value: "raw" },
    });
    await waitFor(() => expect(lastErdFlowProps?.filter).toBe("raw"));
    expect(screen.getByText("1/2")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));
    await waitFor(() => expect(lastErdFlowProps?.hideUnconnected).toBe(true));
  });

  it("counts only connected tables in the filter badge while hiding unconnected", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Filter entities by name/i), {
      target: { value: "raw" },
    });
    await waitFor(() => expect(screen.getByText("1/2")).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));
    await waitFor(() => expect(screen.getByText("0/0")).toBeTruthy());
  });

  it("switches layout via the toolbar and persists the choice", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/Hierarchical layout/i));
    await waitFor(() => expect(lastErdFlowProps?.layout).toBe("hierarchical"));
    expect(setStateMock).toHaveBeenCalledWith({ layout: "hierarchical" });
  });

  it("restores the persisted layout on mount", async () => {
    persistedState = { layout: "force" };
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());
    expect(lastErdFlowProps?.layout).toBe("force");
  });

  it("opens the details pane on node activation and closes it on clear", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());

    fireEvent.click(screen.getByTestId("activate-first"));
    await waitFor(() => expect(screen.getByLabelText(/Close details/i)).toBeTruthy());

    fireEvent.click(screen.getByTestId("clear-active"));
    await waitFor(() => expect(screen.queryByLabelText(/Close details/i)).toBeNull());
  });

  it("closes the details pane when a refresh drops the active node", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());

    fireEvent.click(screen.getByTestId("activate-first"));
    await waitFor(() => expect(screen.getByLabelText(/Close details/i)).toBeTruthy());

    streamErdMock.mockResolvedValue(okPayload);
    window.postMessage({ type: "refresh", serverUrl: "http://localhost:2" }, "*");
    await waitFor(() => expect(screen.queryByLabelText(/Close details/i)).toBeNull());
  });

  it("posts openFile when ErdFlow requests opening a node with a model_path", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());

    fireEvent.click(screen.getByTestId("open-first"));
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "openFile",
      path: "/workspace/models/orders.sql",
    });
  });

  it("asserts expand-all one-shot so the button matches its label after manual toggles", async () => {
    streamErdMock.mockResolvedValue(samplePayload());
    const { App } = await import("@/App");
    render(<App serverUrl="http://localhost:1" />);
    await waitFor(() => expect(screen.getByTestId("erd-flow")).toBeTruthy());
    expect(lastErdFlowProps?.expandAll).toBeUndefined();

    act(() => lastErdFlowProps?.onExpandStateChange?.({ allExpanded: false, canExpand: true }));
    fireEvent.click(screen.getByLabelText(/Expand all tables/i));
    await waitFor(() => expect(lastErdFlowProps?.expandAll).toBe(true));

    act(() => lastErdFlowProps?.onExpandStateChange?.({ allExpanded: true, canExpand: true }));
    await waitFor(() => expect(lastErdFlowProps?.expandAll).toBeUndefined());

    act(() => lastErdFlowProps?.onExpandStateChange?.({ allExpanded: false, canExpand: true }));
    fireEvent.click(screen.getByLabelText(/Expand all tables/i));
    await waitFor(() => expect(lastErdFlowProps?.expandAll).toBe(true));
  });
});
