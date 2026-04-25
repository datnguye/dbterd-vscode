import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// xyflow uses ResizeObserver and other browser APIs jsdom doesn't ship.
// Stub the components/hooks we touch with thin pass-throughs that just expose
// children — App's job is orchestration, not the canvas itself.
// Stable references so React doesn't tag every render as a state change and
// retrigger effects forever. The actual xyflow hooks return stable setters.
const stableNodes: unknown[] = [];
const stableEdges: unknown[] = [];
const noop = (): void => undefined;
vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  useNodesState: () => [stableNodes, noop, noop],
  useEdgesState: () => [stableEdges, noop, noop],
}));

vi.mock("@/components/edgeTypes", () => ({ edgeTypes: {} }));
vi.mock("@/components/nodeTypes", () => ({ nodeTypes: {} }));
vi.mock("@/components/Toolbar", () => ({
  Toolbar: () => <div data-testid="toolbar" />,
}));

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
});
