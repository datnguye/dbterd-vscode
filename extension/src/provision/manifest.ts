// Cache-key file describing the provisioned venv. Compared by exact equality
// on three string fields; any drift triggers a re-provision.

import * as fs from "fs";

export interface InstallManifest {
  extensionVersion: string;
  basePythonVersion: string;
  serverWheelName: string;
}

function isInstallManifest(value: unknown): value is InstallManifest {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.extensionVersion === "string" &&
    typeof obj.basePythonVersion === "string" &&
    typeof obj.serverWheelName === "string"
  );
}

export async function isProvisioned(
  sentinelPath: string,
  venvPython: string,
  expected: InstallManifest,
): Promise<boolean> {
  if (!fs.existsSync(venvPython) || !fs.existsSync(sentinelPath)) return false;
  try {
    const raw = await fs.promises.readFile(sentinelPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isInstallManifest(parsed)) return false;
    return (
      parsed.extensionVersion === expected.extensionVersion &&
      parsed.basePythonVersion === expected.basePythonVersion &&
      parsed.serverWheelName === expected.serverWheelName
    );
  } catch {
    return false;
  }
}

export async function writeManifest(sentinelPath: string, manifest: InstallManifest): Promise<void> {
  await fs.promises.writeFile(sentinelPath, JSON.stringify(manifest, null, 2));
}
