import type { ErdPayload } from "../types/erd";
import { classifyErdError } from "./errors";

export async function fetchErd(serverUrl: string, signal?: AbortSignal): Promise<ErdPayload> {
  const res = await fetch(`${serverUrl}/erd`, { signal });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Fallthrough — non-JSON error body is rare but possible (e.g. network
      // appliance interjection). classifyErdError handles `null` gracefully.
    }
    throw classifyErdError(body, res.status);
  }
  return (await res.json()) as ErdPayload;
}
