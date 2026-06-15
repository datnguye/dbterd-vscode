import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErdApiError } from "@/api/errors";
import { streamErd } from "@/api/stream";
import type { ErdPayload, ErdProgress } from "@/types/erd";

const okPayload: ErdPayload = {
  nodes: [],
  edges: [],
  metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
};

const makeProgress = (percent: number, message: string): ErdProgress => ({
  phase: "validating",
  percent,
  message,
});

// Encode SSE frames as Uint8Array chunks for a ReadableStream.
function encodeChunk(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Build a ReadableStream from an array of pre-split chunks (strings).
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encodeChunk(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

// Construct a single-chunk stream containing the full SSE body.
function makeBody(events: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const text = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  return makeStream([text]);
}

function mockOkResponse(body: ReadableStream<Uint8Array>): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    body,
  });
}

function mockErrorResponse(status: number, body: unknown): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamErd", () => {
  it("resolves with the payload on a result event", async () => {
    mockOkResponse(
      makeBody([{ event: "result", data: okPayload }]),
    );
    const result = await streamErd("http://x", { onProgress: vi.fn() });
    expect(result).toEqual(okPayload);
  });

  it("fires onProgress for each progress event in order", async () => {
    const p1 = makeProgress(5, "invoking");
    const p2 = makeProgress(65, "mapping nodes");
    mockOkResponse(
      makeBody([
        { event: "progress", data: p1 },
        { event: "progress", data: p2 },
        { event: "result", data: okPayload },
      ]),
    );
    const onProgress = vi.fn();
    await streamErd("http://x", { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, p1);
    expect(onProgress).toHaveBeenNthCalledWith(2, p2);
  });

  it("rejects with ErdApiError on an error event", async () => {
    mockOkResponse(
      makeBody([
        { event: "error", data: { code: "manifest_missing", detail: "no manifest" } },
      ]),
    );
    const err = await streamErd("http://x", { onProgress: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("manifest_missing");
  });

  it("rejects with an unknown ErdApiError on a malformed terminal frame", async () => {
    // A truncated/garbled result frame must surface a classified error, not a
    // raw SyntaxError bubbling out of JSON.parse.
    mockOkResponse(makeStream(["event: result\ndata: {not valid json\n\n"]));
    const err = await streamErd("http://x", { onProgress: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("unknown");
  });

  it("rejects with ErdApiError on a non-OK initial response", async () => {
    mockErrorResponse(403, { code: "project_not_allowed", detail: "not allowed" });
    const err = await streamErd("http://x", { onProgress: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("project_not_allowed");
    expect(err.status).toBe(403);
  });

  it("rejects with unknown ErdApiError when non-OK body is not JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError("not json")),
    });
    const err = await streamErd("http://x", { onProgress: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("unknown");
    expect(err.status).toBe(500);
  });

  it("rejects when the stream ends without a terminal event", async () => {
    mockOkResponse(makeStream([]));
    const err = await streamErd("http://x", { onProgress: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("unknown");
  });

  it("handles frames split across multiple chunks", async () => {
    // The progress frame is split mid-line across chunks; only the result
    // follows as a third chunk.
    const full = `event: progress\ndata: ${JSON.stringify(makeProgress(5, "start"))}\n\nevent: result\ndata: ${JSON.stringify(okPayload)}\n\n`;
    // Split at position 20 to guarantee a frame crosses a chunk boundary.
    const splitAt = 20;
    const chunks = [full.slice(0, splitAt), full.slice(splitAt)];
    mockOkResponse(makeStream(chunks));

    const onProgress = vi.fn();
    const result = await streamErd("http://x", { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(result).toEqual(okPayload);
  });

  it("forwards the AbortSignal to fetch", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockOkResponse(makeBody([{ event: "result", data: okPayload }]));
    const controller = new AbortController();
    await streamErd("http://x", { onProgress: vi.fn(), signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledWith("http://x/erd/stream", {
      signal: controller.signal,
    });
  });
});
