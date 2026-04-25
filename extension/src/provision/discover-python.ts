// Find a usable "base" Python interpreter. We only borrow this Python as the
// base for `python -m venv`; we never install dbterd-server into the user's
// dbt venv. That keeps their dbt-core pins clean and ours isolated.

import { spawnSync } from "child_process";
import * as path from "path";

export function venvBin(): string {
  return process.platform === "win32" ? "Scripts" : "bin";
}

export function pythonBinary(): string {
  return process.platform === "win32" ? "python.exe" : "python";
}

export function isUsablePython(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function hasDbterdServer(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["-c", "import dbterd_server"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function readPythonVersion(cmd: string): string {
  const result = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output || "unknown";
}

/**
 * Discover a usable "base" Python interpreter. Priority:
 *   1. User override `dbterd.pythonPath` (any non-empty value wins)
 *   2. `<dbtProjectPath>/.venv/bin/python` or `Scripts/python.exe`
 *   3. `<dbtProjectPath>/venv/bin/python`
 *   4. `$VIRTUAL_ENV/bin/python`
 *   5. `python3`, then `python` from PATH
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
