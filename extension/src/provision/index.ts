// Top-level provisioning entrypoint. Bootstraps an isolated venv with
// dbterd-server installed, gated by a sentinel cache so subsequent launches
// skip pip when nothing changed.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import type { Logger } from "../logging";
import {
  discoverBasePython,
  hasDbterdServer,
  pythonBinary,
  readPythonVersion,
  venvBin,
} from "./discover-python";
import { isProvisioned, writeManifest, type InstallManifest } from "./manifest";
import { runStreaming } from "./run";

const SENTINEL_FILE = "install-manifest.json";

export interface ProvisionResult {
  pythonPath: string;
}

export async function provisionServer(
  context: vscode.ExtensionContext,
  output: Logger,
  dbtProjectPath: string,
  pythonOverride: string,
): Promise<ProvisionResult> {
  // Short-circuit: if the override already has dbterd_server importable, use
  // it directly. Lets power users point at a pre-built venv (and keeps the
  // e2e test suite's `pythonPath: server/.venv/bin/python` working without a
  // full provisioning run).
  if (pythonOverride && hasDbterdServer(pythonOverride)) {
    output.appendLine(`[provision] override already has dbterd_server: ${pythonOverride}`);
    return { pythonPath: pythonOverride };
  }

  const basePython = discoverBasePython(dbtProjectPath, pythonOverride);
  if (!basePython) {
    throw new Error(
      "No Python interpreter found. Install Python 3.10+ or set `dbterd.pythonPath`.",
    );
  }
  output.appendLine(`[provision] base python: ${basePython}`);

  const storageDir = context.globalStorageUri.fsPath;
  await fs.promises.mkdir(storageDir, { recursive: true });
  const venvDir = path.join(storageDir, "venv");
  const venvPython = path.join(venvDir, venvBin(), pythonBinary());
  const sentinelPath = path.join(storageDir, SENTINEL_FILE);

  const serverSrcPath = locateBundledServerSrc(context);
  const expected: InstallManifest = {
    extensionVersion: context.extension.packageJSON.version as string,
    basePythonVersion: readPythonVersion(basePython),
    serverWheelName: await hashServerSrc(serverSrcPath),
  };

  if (await isProvisioned(sentinelPath, venvPython, expected)) {
    output.appendLine(`[provision] cache hit — reusing ${venvDir}`);
    return { pythonPath: venvPython };
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "dbterd: setting up server (one-time)…",
      cancellable: false,
    },
    async () => {
      output.appendLine(`[provision] creating venv at ${venvDir}`);
      await runStreaming(basePython, ["-m", "venv", venvDir], output);
      output.appendLine(`[provision] upgrading pip`);
      await runStreaming(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], output);
      output.appendLine(`[provision] installing dbterd-server from ${serverSrcPath}`);
      await runStreaming(venvPython, ["-m", "pip", "install", serverSrcPath], output);
      await writeManifest(sentinelPath, expected);
      output.appendLine(`[provision] done`);
    },
  );

  return { pythonPath: venvPython };
}

function locateBundledServerSrc(context: vscode.ExtensionContext): string {
  // Packaging copies the server source (with pyproject.toml) into
  // extension/server-src/. In development, fall back to the monorepo checkout.
  const bundled = path.join(context.extensionPath, "server-src");
  if (fs.existsSync(path.join(bundled, "pyproject.toml"))) return bundled;
  const devFallback = path.resolve(context.extensionPath, "..", "server");
  if (fs.existsSync(path.join(devFallback, "pyproject.toml"))) return devFallback;
  throw new Error(
    "dbterd server source not found. Package the extension with `task package`.",
  );
}

async function hashServerSrc(serverSrcPath: string): Promise<string> {
  // Coarse cache-busting: use the mtime of pyproject.toml. When we bump the
  // server version or rebuild during dev, pip re-installs.
  const pyproject = path.join(serverSrcPath, "pyproject.toml");
  const stat = await fs.promises.stat(pyproject);
  return `${path.basename(serverSrcPath)}:${stat.mtimeMs}`;
}
