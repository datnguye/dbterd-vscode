import { ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";
import * as vscode from "vscode";

const READY_RE = /^DBTERD_READY (https?:\/\/\S+)$/;
const STARTUP_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 2_000;

export class DbterdServer implements vscode.Disposable {
  private proc: ChildProcess | undefined;
  private url: string | undefined;
  private starting: Promise<string> | undefined;
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel("dbterd");
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

  private spawnServer(): Promise<string> {
    const config = vscode.workspace.getConfiguration("dbterd");
    const projectPath = config.get<string>("dbtProjectPath") ?? "";
    const port = config.get<number>("serverPort") ?? 0;
    const pythonPath = config.get<string>("pythonPath") || "python3";

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
        if (match) {
          settle(() => {
            this.url = match[1];
            resolve(match[1]);
          });
        }
      });

      const stderr = createInterface({ input: proc.stderr! });
      stderr.on("line", (line) => this.output.appendLine(`[stderr] ${line}`));

      proc.on("error", (err) => {
        settle(() => {
          this.killProc();
          reject(new Error(`failed to spawn ${pythonPath}: ${err.message}`));
        });
      });

      proc.on("exit", (code, signal) => {
        this.output.appendLine(`[exit] code=${code} signal=${signal}`);
        // Drop refs regardless of when exit fires — a crashed server must not
        // leave us returning a stale URL or process handle next time.
        this.url = undefined;
        if (this.proc === proc) this.proc = undefined;
        settle(() => reject(new Error(`dbterd server exited (code=${code}, signal=${signal})`)));
      });
    });
  }

  private killProc(): void {
    const proc = this.proc;
    if (proc && proc.exitCode === null) {
      proc.kill();
      // SIGTERM may be ignored by the child; escalate to SIGKILL if it lingers.
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, SHUTDOWN_GRACE_MS).unref();
    }
    this.proc = undefined;
    this.url = undefined;
  }

  dispose(): void {
    this.killProc();
    this.output.dispose();
  }
}
