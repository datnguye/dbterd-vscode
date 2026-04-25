import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  // Minimal OutputChannel stub — createLogger only needs append/appendLine/show/dispose.
  const channel = {
    append: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    window: {
      createOutputChannel: vi.fn(() => channel),
    },
    __channel: channel,
  };
});

import { createLogger, resolveLogDir } from "@/logging";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbterd-logs-"));
  process.env.DBTERD_LOG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DBTERD_LOG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveLogDir", () => {
  it("uses DBTERD_LOG_DIR when set", () => {
    expect(resolveLogDir()).toBe(tmpDir);
  });

  it("falls back to ~/.dbterd when unset", () => {
    delete process.env.DBTERD_LOG_DIR;
    expect(resolveLogDir()).toBe(path.join(os.homedir(), ".dbterd"));
  });
});

describe("createLogger", () => {
  it("writes appendLine output to the log file", () => {
    const logger = createLogger();
    logger.appendLine("hello");
    logger.appendLine("world");
    logger.dispose();
    const contents = fs.readFileSync(logger.logFile, "utf8");
    expect(contents).toContain("hello");
    expect(contents).toContain("world");
  });

  it("rotates the file once it exceeds the size cap", () => {
    const logger = createLogger();
    // 2 MB chunks × 6 = 12 MB — guaranteed to trip the 10 MB rotation.
    const chunk = "x".repeat(2 * 1024 * 1024);
    for (let i = 0; i < 6; i++) logger.append(chunk);
    logger.dispose();
    expect(fs.existsSync(`${logger.logFile}.1`)).toBe(true);
  });

  it("creates the log directory if it does not exist", () => {
    const nested = path.join(tmpDir, "nested", "deep");
    process.env.DBTERD_LOG_DIR = nested;
    const logger = createLogger();
    logger.appendLine("ping");
    logger.dispose();
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(logger.logFile)).toBe(true);
  });

  it("does not create a log file when nothing is logged", () => {
    const logger = createLogger();
    logger.dispose();
    expect(fs.existsSync(logger.logFile)).toBe(false);
  });
});
