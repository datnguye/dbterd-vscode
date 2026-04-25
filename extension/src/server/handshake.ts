// Reads the server's startup line from stdout and resolves the URL it
// announces. Pure-ish — depends on a ChildProcess but does not own its
// lifecycle (kill/error handling lives in the caller).

import { ChildProcess } from "child_process";
import { createInterface } from "readline";

import type { Logger } from "../logging";

export const READY_RE = /^DBTERD_READY (https?:\/\/\S+)$/;
export const LOG_PATH_RE = /^DBTERD_LOG (.+)$/;

export interface HandshakeOptions {
  proc: ChildProcess;
  output: Logger;
  timeoutMs: number;
  onProcExit: () => void;
  onServerLogPath?: (logPath: string) => void;
}

export function waitForHandshake(opts: HandshakeOptions): Promise<string> {
  const { proc, output, timeoutMs, onProcExit, onServerLogPath } = opts;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`dbterd server did not start within ${timeoutMs}ms`)));
    }, timeoutMs);

    const stdout = createInterface({ input: proc.stdout! });
    stdout.on("line", (line) => {
      output.appendLine(`[stdout] ${line}`);
      const logMatch = LOG_PATH_RE.exec(line);
      if (logMatch) {
        onServerLogPath?.(logMatch[1]);
        return;
      }
      const match = READY_RE.exec(line);
      if (match) settle(() => resolve(match[1]));
    });

    const stderr = createInterface({ input: proc.stderr! });
    stderr.on("line", (line) => output.appendLine(`[stderr] ${line}`));

    proc.on("error", (err) => {
      settle(() => reject(new Error(`failed to spawn: ${err.message}`)));
    });

    proc.on("exit", (code, signal) => {
      output.appendLine(`[exit] code=${code} signal=${signal}`);
      onProcExit();
      settle(() => reject(new Error(`dbterd server exited (code=${code}, signal=${signal})`)));
    });
  });
}
