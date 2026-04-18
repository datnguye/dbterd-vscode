import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const SENTINEL_FILE = "install-manifest.json";

export interface ProvisionResult {
  pythonPath: string;
}

interface InstallManifest {
  extensionVersion: string;
  basePythonVersion: string;
  serverWheelName: string;
}

/**
 * Discover a usable "base" Python interpreter. Priority:
 *   1. User override `dbterd.pythonPath` (any non-empty value wins)
 *   2. `<dbtProjectPath>/.venv/bin/python` or `Scripts/python.exe`
 *   3. `<dbtProjectPath>/venv/bin/python`
 *   4. `$VIRTUAL_ENV/bin/python`
 *   5. `python3`, then `python` from PATH
 *
 * We only *borrow* this Python as the base for `python -m venv`; we never install
 * dbterd-server into the user's dbt venv. That keeps their dbt-core pins clean
 * and ours isolated.
 */
export function discoverBasePython(dbtProjectPath: string, override: string): string | undefined {
  const candidates: string[] = [];
  // Explicit override beats auto-discovery. An empty override means "auto"
  // per the setting's default; any non-empty value is the user telling us
  // exactly which Python to use (including `python3` itself).
  if (override) candidates.push(override);
  if (dbtProjectPath) {
    candidates.push(
      path.join(dbtProjectPath, ".venv", venvBin(), pythonBinary()),
      path.join(dbtProjectPath, "venv", venvBin(), pythonBinary()),
    );
  }
  const shellVenv = process.env.VIRTUAL_ENV;
  if (shellVenv) candidates.push(path.join(shellVenv, venvBin(), pythonBinary()));

  for (const candidate of candidates) {
    if (isUsablePython(candidate)) return candidate;
  }
  for (const name of ["python3", "python"]) {
    if (isUsablePython(name)) return name;
  }
  return undefined;
}

function venvBin(): string {
  return process.platform === "win32" ? "Scripts" : "bin";
}

function pythonBinary(): string {
  return process.platform === "win32" ? "python.exe" : "python";
}

function isUsablePython(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function hasDbterdServer(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["-c", "import dbterd_server"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function readPythonVersion(cmd: string): string {
  const result = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output || "unknown";
}

/**
 * Ensure a managed venv with `dbterd-server` installed exists under
 * `context.globalStorageUri`. Cache key = (extensionVersion, basePythonVersion).
 * Runs pip install only when the cache is cold or invalidated.
 */
export async function provisionServer(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  dbtProjectPath: string,
  pythonOverride: string,
): Promise<ProvisionResult> {
  // Short-circuit: if the override already has dbterd_server importable, use
  // it directly. Lets power users point at a pre-built venv (and keeps the e2e
  // test suite's `pythonPath: server/.venv/bin/python` working without a full
  // provisioning run).
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
      await fs.promises.writeFile(sentinelPath, JSON.stringify(expected, null, 2));
      output.appendLine(`[provision] done`);
    },
  );

  return { pythonPath: venvPython };
}

async function isProvisioned(
  sentinelPath: string,
  venvPython: string,
  expected: InstallManifest,
): Promise<boolean> {
  if (!fs.existsSync(venvPython) || !fs.existsSync(sentinelPath)) return false;
  try {
    const raw = await fs.promises.readFile(sentinelPath, "utf-8");
    const manifest = JSON.parse(raw) as InstallManifest;
    return (
      manifest.extensionVersion === expected.extensionVersion &&
      manifest.basePythonVersion === expected.basePythonVersion &&
      manifest.serverWheelName === expected.serverWheelName
    );
  } catch {
    return false;
  }
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

function runStreaming(
  command: string,
  args: string[],
  output: vscode.OutputChannel,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout?.on("data", (d: Buffer) => output.append(d.toString()));
    proc.stderr?.on("data", (d: Buffer) => output.append(d.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
