import type { ErdPayload } from "./types/erd";

export async function fetchErd(serverUrl: string, signal?: AbortSignal): Promise<ErdPayload> {
  const res = await fetch(`${serverUrl}/erd`, { signal });
  if (!res.ok) {
    throw new Error(`GET /erd responded ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ErdPayload;
}
