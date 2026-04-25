// Progress notification shown while the webview is parsing a dbt project via
// dbterd. Tails the server's log file so the popup reflects what dbterd is
// doing in near-real-time — important on big projects where get_erd() runs
// for tens of seconds and the user otherwise sees a static "Loading…".
//
// withProgress doesn't support custom action buttons, so the "Show Logs"
// affordance lives on a sibling info message that fires once at start. The
// user can dismiss it independently; clicking it opens the full transcript.

import * as fs from "fs";
import * as vscode from "vscode";

const SHOW_LOGS_ACTION = "Show Logs";
const TAIL_INTERVAL_MS = 250;
// Cap how much of a long log line we surface in the popup. The notification
// area is narrow; anything past this is truncated with an ellipsis.
const MAX_MESSAGE_CHARS = 140;

export interface ParseProgressDeps {
  getServerLogPath(): string | undefined;
  openLogs(): void;
}

export class ParseProgress {
  private active: { resolve: () => void } | undefined;

  constructor(private readonly deps: ParseProgressDeps) {}

  start(): void {
    if (this.active) return;
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "dbt ERD: parsing project…",
        cancellable: false,
      },
      (progress) => this.run(progress),
    );
    // Sibling action message — withProgress can't host a button. Fires once
    // per parse so a slow project doesn't spam the user with prompts.
    void vscode.window
      .showInformationMessage("dbt ERD is parsing your project.", SHOW_LOGS_ACTION)
      .then((choice) => {
        if (choice === SHOW_LOGS_ACTION) this.deps.openLogs();
      });
  }

  finish(_ok: boolean): void {
    this.active?.resolve();
    this.active = undefined;
  }

  private run(progress: vscode.Progress<{ message?: string }>): Promise<void> {
    const tail = createTail(this.deps.getServerLogPath(), (line) => {
      progress.report({ message: truncate(line, MAX_MESSAGE_CHARS) });
    });
    return new Promise<void>((resolve) => {
      this.active = {
        resolve: () => {
          tail.stop();
          resolve();
        },
      };
    });
  }
}

interface Tail {
  stop(): void;
}

// Polls the file for new bytes since `start()` and surfaces the most recent
// non-empty line. We deliberately avoid fs.watch — it's flaky across platforms
// (especially over network mounts or the symlinked target/ dirs people have
// in monorepos) and tail polling at 4 Hz is cheap.
function createTail(logPath: string | undefined, onLine: (line: string) => void): Tail {
  if (!logPath) {
    return { stop: () => undefined };
  }
  let cursor = safeFileSize(logPath);
  let buffer = "";
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    try {
      const size = safeFileSize(logPath);
      if (size <= cursor) return;
      const fd = fs.openSync(logPath, "r");
      try {
        const length = size - cursor;
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, cursor);
        cursor = size;
        buffer += buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
      const lines = buffer.split(/\r?\n/);
      // Last element is a partial line (no trailing newline yet) — keep it
      // for the next tick so we don't surface it half-formed.
      buffer = lines.pop() ?? "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (trimmed.length > 0) {
          onLine(trimmed);
          break;
        }
      }
    } catch {
      // File rotated mid-read or vanished — start fresh from whatever is on
      // disk now. Better than killing the popup over a transient I/O error.
      cursor = safeFileSize(logPath);
      buffer = "";
    }
  }, TAIL_INTERVAL_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function safeFileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
