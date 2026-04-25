import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVsCodeApi } from "@/vscode";

const fakeApi = {
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  // Re-import to clear the module-level `cached` between tests.
});

afterEach(() => {
  delete (window as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

describe("getVsCodeApi", () => {
  it("returns undefined when the host helper is missing", async () => {
    const mod = await import("@/vscode");
    expect(mod.getVsCodeApi()).toBeUndefined();
  });

  it("returns the cached API on subsequent calls", async () => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = vi
      .fn()
      .mockReturnValue(fakeApi);
    const mod = await import("@/vscode");
    const first = mod.getVsCodeApi();
    const second = mod.getVsCodeApi();
    expect(first).toBe(fakeApi);
    expect(second).toBe(fakeApi);
    expect(
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi,
    ).toHaveBeenCalledTimes(1);
  });
});

// Exercise the original cached export too — vi.resetModules clears the cache
// across tests, but a single suite-wide test that uses `getVsCodeApi` (the
// original import at the top of this file) covers the import-time path.
describe("default export", () => {
  it("is callable", () => {
    expect(typeof getVsCodeApi).toBe("function");
  });
});
