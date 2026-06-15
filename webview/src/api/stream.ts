import type { ErdPayload, ErdProgress } from "../types/erd";
import { classifyErdError } from "./errors";

export interface StreamErdOptions {
  onProgress: (progress: ErdProgress) => void;
  signal?: AbortSignal;
}

// Frame-level failures have no HTTP status of their own (the response was 200
// OK; the error rides in the SSE body). 0 signals "not an HTTP-status error".
const NO_HTTP_STATUS = 0;

// Splits buffered SSE text into complete frames (delimited by blank lines) and
// returns both the parsed frames and the leftover incomplete frame.
function extractFrames(buffer: string): { frames: string[]; remainder: string } {
  const parts = buffer.split("\n\n");
  // Last element is always the incomplete trailing fragment (possibly "").
  const remainder = parts.pop() ?? "";
  return { frames: parts, remainder };
}

// Parses a single SSE frame into its event name and data string.
function parseFrame(frame: string): { event: string; data: string } | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
  }
  if (!data) return null;
  return { event, data };
}

// Parse a frame's data payload, turning malformed JSON into a classified error
// so a truncated/garbled frame surfaces a remediation hint, not a raw SyntaxError.
function parseData<T>(data: string, event: string): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    throw classifyErdError(
      { code: "unknown", detail: `Malformed '${event}' frame from server` },
      NO_HTTP_STATUS,
    );
  }
}

export async function streamErd(
  serverUrl: string,
  { onProgress, signal }: StreamErdOptions,
): Promise<ErdPayload> {
  const res = await fetch(`${serverUrl}/erd/stream`, { signal });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body — classifyErdError handles null gracefully.
    }
    throw classifyErdError(body, res.status);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw classifyErdError(null, NO_HTTP_STATUS);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (value !== undefined) {
      buffer += decoder.decode(value, { stream: !done });
    }

    const { frames, remainder } = extractFrames(buffer);
    buffer = remainder;

    for (const rawFrame of frames) {
      const parsed = parseFrame(rawFrame);
      if (!parsed) continue;

      if (parsed.event === "progress") {
        onProgress(parseData<ErdProgress>(parsed.data, "progress"));
      } else if (parsed.event === "result") {
        reader.cancel().catch(() => undefined);
        return parseData<ErdPayload>(parsed.data, "result");
      } else if (parsed.event === "error") {
        reader.cancel().catch(() => undefined);
        throw classifyErdError(parseData<unknown>(parsed.data, "error"), NO_HTTP_STATUS);
      }
    }

    if (done) break;
  }

  // Stream ended without a terminal event.
  throw classifyErdError(
    { code: "unknown", detail: "Stream ended without a result" },
    NO_HTTP_STATUS,
  );
}
