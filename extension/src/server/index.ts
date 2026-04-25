import { ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";

import { provisionServer } from "../provision";
import { waitForHandshake } from "./handshake";
import { waitForHealth } from "./health";
import { killProcess } from "./kill";

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_TOTAL_MS = 3_000;
const HEALTH_PROBE_INTERVAL_MS = 100;
const SHUTDOWN_GRACE_MS = 2_000;

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

  get currentUrl(): string | undefined {
    return this.url;
  }

  async ensureRunning(): Promise<string> {
    if (this.url && this.proc && this.proc.exitCode === null) return this.url;
    if (this.starting) return this.starting;
    this.starting = this.spawnServer().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async reload(): Promise<string> {
    // Tear down the running server — the next ensureRunning() spawns fresh.
    // Useful when the user changes something the mtime cache doesn't catch,
    // e.g. a dbterd upgrade or a dependency version bump.
    await this.killCurrent();
    return this.ensureRunning();
  }

  async dispose(): Promise<void> {
    await this.killCurrent();
    this.output.dispose();
  }

  private async spawnServer(): Promise<string> {
    const config = vscode.workspace.getConfiguration("dbterd");
    const projectPath = config.get<string>("dbtProjectPath") ?? "";
    const port = config.get<number>("serverPort") ?? 0;
    const pythonOverride = config.get<string>("pythonPath") ?? "";
    const startupTimeoutMs =
      config.get<number>("serverStartupTimeoutMs") ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const healthTotalMs =
      config.get<number>("healthProbeTotalMs") ?? DEFAULT_HEALTH_TOTAL_MS;

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

    let handshakeUrl: string;
    try {
      handshakeUrl = await waitForHandshake({
        proc,
        output: this.output,
        timeoutMs: startupTimeoutMs,
        onProcExit: () => {
          this.url = undefined;
          if (this.proc === proc) this.proc = undefined;
        },
      });
    } catch (err) {
      await this.killCurrent();
      throw err;
    }

    // DBTERD_READY now prints after uvicorn binds (the server pre-binds the
    // socket), but the brief gap to listening is still possible on slow hosts.
    await waitForHealth({
      url: handshakeUrl,
      totalTimeoutMs: healthTotalMs,
      intervalMs: HEALTH_PROBE_INTERVAL_MS,
    });
    this.url = handshakeUrl;
    this.attachPostStartupWatcher(proc);
    return handshakeUrl;
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

  private async killCurrent(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    this.url = undefined;
    if (!proc) return;
    await killProcess(proc, SHUTDOWN_GRACE_MS);
  }
}
