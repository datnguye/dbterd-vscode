// Probes /healthz until it answers 200. Compensates for the (now-rare)
// window between DBTERD_READY and uvicorn accepting connections.

import * as http from "http";

export interface HealthOptions {
  url: string;
  totalTimeoutMs: number;
  intervalMs: number;
  perRequestTimeoutMs?: number;
}

export async function waitForHealth(opts: HealthOptions): Promise<void> {
  const { url, totalTimeoutMs, intervalMs, perRequestTimeoutMs = 1_000 } = opts;
  const deadline = Date.now() + totalTimeoutMs;
  let lastErr: Error | undefined;
  while (Date.now() < deadline) {
    try {
      await probeHealth(url, perRequestTimeoutMs);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await sleep(intervalMs);
    }
  }
  throw new Error(
    `dbterd server did not respond on ${url}/healthz within ${totalTimeoutMs}ms` +
      (lastErr ? `: ${lastErr.message}` : ""),
  );
}

export function probeHealth(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${url}/healthz`, (res) => {
      res.resume(); // drain so the socket can close
      if (res.statusCode === 200) resolve();
      else reject(new Error(`status ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("health probe timeout")));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
