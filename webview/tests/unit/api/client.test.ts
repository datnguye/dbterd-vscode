import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchErd } from "@/api/client";
import { ErdApiError } from "@/api/errors";

const okPayload = {
  nodes: [],
  edges: [],
  metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchErd", () => {
  it("returns the parsed payload on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(okPayload),
    });
    const result = await fetchErd("http://x");
    expect(result).toEqual(okPayload);
  });

  it("throws an ErdApiError for structured server errors", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: () =>
        Promise.resolve({ code: "manifest_missing", detail: "no manifest.json" }),
    });
    await expect(fetchErd("http://x")).rejects.toMatchObject({
      code: "manifest_missing",
      status: 404,
    });
    await expect(fetchErd("http://x")).rejects.toBeInstanceOf(ErdApiError);
  });

  it("throws an unknown ErdApiError when the body isn't JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError("not json")),
    });
    const err = await fetchErd("http://x").catch((e) => e);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("unknown");
    expect(err.status).toBe(500);
  });

  it("forwards the AbortSignal to fetch", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(okPayload) });
    const controller = new AbortController();
    await fetchErd("http://x", controller.signal);
    expect(fetchMock).toHaveBeenCalledWith("http://x/erd", { signal: controller.signal });
  });
});
