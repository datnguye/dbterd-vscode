// File-backed wrapper around vscode.OutputChannel.
//
// Every line written to the channel is also appended to a rotating log file
// under ~/.dbterd/, so support sessions have a persistent transcript even
// after VS Code is restarted. The file path is exposed so the
// `dbterd.showLogs` command can open the directory.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const MAX_BYTES = 10 * 1024 * 1024;
const BACKUP_COUNT = 5;
const FILE_PREFIX = "dbterd-extension-";
const FILE_SUFFIX = ".log";

export interface Logger extends vscode.Disposable {
  appendLine(line: string): void;
  append(text: string): void;
  show(preserveFocus?: boolean): void;
  readonly logFile: string;
  readonly logDir: string;
}

export function resolveLogDir(): string {
  const override = process.env.DBTERD_LOG_DIR;
  return override && override.length > 0 ? override : path.join(os.homedir(), ".dbterd");
}

function timestamp(): string {
  // 20260425T134501Z — sortable, filesystem-safe.
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export function createLogger(channelName = "dbterd"): Logger {
  const channel = vscode.window.createOutputChannel(channelName);
  const logDir = resolveLogDir();
  const logFile = path.join(logDir, `${FILE_PREFIX}${timestamp()}${FILE_SUFFIX}`);

  // Open lazily on first write so a session that never logs anything (e.g.
  // immediate startup crash) does not leave a 0-byte file behind. Synchronous
  // O_APPEND writes keep ordering identical to the OutputChannel.
  let fd: number | undefined;
  let bytes = 0;
  let pendingNewline = false;

  const ensureOpen = (): void => {
    if (fd !== undefined) return;
    fs.mkdirSync(logDir, { recursive: true });
    fd = fs.openSync(logFile, "a");
    bytes = fs.statSync(logFile).size;
  };

  const rotate = (): void => {
    if (fd === undefined) return;
    fs.closeSync(fd);
    fd = undefined;
    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const src = `${logFile}.${i}`;
      const dst = `${logFile}.${i + 1}`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    if (fs.existsSync(logFile)) fs.renameSync(logFile, `${logFile}.1`);
    fd = fs.openSync(logFile, "a");
    bytes = 0;
  };

  const writeBytes = (text: string): void => {
    if (text.length === 0) return;
    ensureOpen();
    if (bytes >= MAX_BYTES) rotate();
    if (fd === undefined) return;
    const buf = Buffer.from(text, "utf8");
    fs.writeSync(fd, buf);
    bytes += buf.length;
  };

  return {
    appendLine(line: string) {
      channel.appendLine(line);
      writeBytes(`${new Date().toISOString()} ${line}\n`);
      pendingNewline = true;
    },
    append(text: string) {
      channel.append(text);
      writeBytes(text);
      pendingNewline = text.endsWith("\n");
    },
    show(preserveFocus?: boolean) {
      channel.show(preserveFocus);
    },
    dispose() {
      // Only flush a trailing newline if we actually opened the file.
      if (fd !== undefined && !pendingNewline) writeBytes("\n");
      channel.dispose();
      if (fd !== undefined) {
        fs.closeSync(fd);
        fd = undefined;
      }
    },
    get logFile() {
      return logFile;
    },
    get logDir() {
      return logDir;
    },
  };
}
