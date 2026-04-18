import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import { createInterface } from "readline";
import * as vscode from "vscode";

import { provisionServer } from "./provision";

const READY_RE = /^DBTERD_READY (https?:\/\/\S+)$/;
const STARTUP_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 2_000;
const HEALTH_PROBE_INTERVAL_MS = 100;
const HEALTH_PROBE_TOTAL_MS = 3_000;

export interface DbterdServerCallbacks {
  onUnexpectedExit?(detail: string): void;
}

export class DbterdServer implements vscode.Disposable {
  private proc: ChildProcess | undefined;
  private url: string | undefined;
  private starting: Promise<string> | undefined;
  private readonly output: vscode.OutputChannel;
  private callbacks: DbterdServerCallbacks = {};

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("dbterd");
  }

  setCallbacks(callbacks: DbterdServerCallbacks): void {
    this.callbacks = callbacks;
  }

  async ensureRunning(): Promise<string> {
    if (this.url && this.proc && this.proc.exitCode === null) return this.url;
    if (this.starting) return this.starting;
    this.starting = this.spawnServer().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  get currentUrl(): string | undefined {
    return this.url;
  }

  private async spawnServer(): Promise<string> {
    const config = vscode.workspace.getConfiguration("dbterd");
    const projectPath = config.get<string>("dbtProjectPath") ?? "";
    const port = config.get<number>("serverPort") ?? 0;
    const pythonOverride = config.get<string>("pythonPath") ?? "";

    const { pythonPath } = await provisionServer(
      this.context,
      this.output,
      projectPath,
      pythonOverride,
    );

    const args = ["-m", "dbterd_server", "--port", String(port)];
    if (projectPath) args.push("--project", projectPath);

    this.output.appendLine(`spawning: ${pythonPath} ${args.join(" ")}`);
    const proc = spawn(pythonPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // PYTHONUNBUFFERED guards against host-specific stdio buffering so the
      // DBTERD_READY handshake line is delivered before the startup timeout.
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    this.proc = proc;

    const handshakeUrl = await this.waitForHandshake(proc);
    // DBTERD_READY prints before uvicorn binds. Probe /healthz briefly so the
    // webview's first fetch doesn't race the socket open.
    await this.waitForHealth(handshakeUrl);
    this.url = handshakeUrl;
    this.attachPostStartupWatcher(proc);
    return handshakeUrl;
  }

  private waitForHandshake(proc: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          this.killProc();
          reject(new Error(`dbterd server did not start within ${STARTUP_TIMEOUT_MS}ms`));
        });
      }, STARTUP_TIMEOUT_MS);

      const stdout = createInterface({ input: proc.stdout! });
      stdout.on("line", (line) => {
        this.output.appendLine(`[stdout] ${line}`);
        const match = READY_RE.exec(line);
        if (match) settle(() => resolve(match[1]));
      });

      const stderr = createInterface({ input: proc.stderr! });
      stderr.on("line", (line) => this.output.appendLine(`[stderr] ${line}`));

      proc.on("error", (err) => {
        settle(() => {
          this.killProc();
          reject(new Error(`failed to spawn: ${err.message}`));
        });
      });

      proc.on("exit", (code, signal) => {
        this.output.appendLine(`[exit] code=${code} signal=${signal}`);
        this.url = undefined;
        if (this.proc === proc) this.proc = undefined;
        settle(() =>
          reject(new Error(`dbterd server exited (code=${code}, signal=${signal})`)),
        );
      });
    });
  }

  private async waitForHealth(url: string): Promise<void> {
    const deadline = Date.now() + HEALTH_PROBE_TOTAL_MS;
    let lastErr: Error | undefined;
    while (Date.now() < deadline) {
      try {
        await probeHealth(url);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        await sleep(HEALTH_PROBE_INTERVAL_MS);
      }
    }
    throw new Error(
      `dbterd server did not respond on ${url}/healthz within ${HEALTH_PROBE_TOTAL_MS}ms` +
        (lastErr ? `: ${lastErr.message}` : ""),
    );
  }

  private attachPostStartupWatcher(proc: ChildProcess): void {
    // Replace the `exit` listener from waitForHandshake with one that surfaces
    // crashes to the UI instead of only rejecting a long-settled promise.
    proc.removeAllListeners("exit");
    proc.on("exit", (code, signal) => {
      this.output.appendLine(`[exit] code=${code} signal=${signal}`);
      const hadUrl = this.url !== undefined;
      this.url = undefined;
      if (this.proc === proc) this.proc = undefined;
      if (hadUrl) {
        const detail = `dbterd server exited unexpectedly (code=${code}, signal=${signal})`;
        this.callbacks.onUnexpectedExit?.(detail);
      }
    });
  }

  private async killProc(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    this.url = undefined;
    if (!proc || proc.exitCode !== null) return;

    // Await the actual exit so a subsequent spawn doesn't race a pinned port
    // the dying child still holds. SIGTERM → wait → SIGKILL if still alive.
    const exited = new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }
      proc.once("exit", () => resolve());
    });
    proc.kill();
    const timeout = sleep(SHUTDOWN_GRACE_MS).then(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    });
    await Promise.race([exited, timeout]);
    // If SIGKILL was needed, wait a bit more for the final exit.
    if (proc.exitCode === null) await exited;
  }

  async reload(): Promise<string> {
    // Tear down the running server — the next ensureRunning() spawns fresh.
    // Useful when the user changes something the mtime cache doesn't catch,
    // e.g. a dbterd upgrade or a dependency version bump.
    await this.killProc();
    return this.ensureRunning();
  }

  async dispose(): Promise<void> {
    await this.killProc();
    this.output.dispose();
  }
}

function probeHealth(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${url}/healthz`, (res) => {
      res.resume(); // drain so the socket can close
      if (res.statusCode === 200) resolve();
      else reject(new Error(`status ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(1_000, () => req.destroy(new Error("health probe timeout")));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
