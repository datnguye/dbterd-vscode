// Typed error wrapper around the structured `{code, detail}` response bodies
// the server emits for /erd failures. Lets the UI render differentiated
// remediation hints (e.g. "Run dbt compile" for manifest_missing) instead of
// a generic HTTP error.

export type ErdErrorCode =
  | "manifest_missing"
  | "project_path_missing"
  | "project_path_invalid"
  | "project_not_allowed"
  | "config_invalid"
  | "unknown";

export class ErdApiError extends Error {
  constructor(
    public readonly code: ErdErrorCode,
    public readonly detail: string,
    public readonly status: number,
  ) {
    super(`${code}: ${detail}`);
    this.name = "ErdApiError";
  }
}

export function classifyErdError(body: unknown, status: number): ErdApiError {
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    if (typeof obj.code === "string" && typeof obj.detail === "string") {
      return new ErdApiError(obj.code as ErdErrorCode, obj.detail, status);
    }
  }
  return new ErdApiError("unknown", `HTTP ${status}`, status);
}

const REMEDIATION: Record<ErdErrorCode, string> = {
  manifest_missing: "Run `dbt compile` in the project root, then refresh.",
  project_path_missing: "Set `dbterd.dbtProjectPath` in VS Code settings.",
  project_path_invalid: "The configured project path doesn't exist on disk.",
  project_not_allowed: "Project path not in the allow-list. Restart the server with --allow-project.",
  config_invalid: "Check `.dbterd.yml` (or `[tool.dbterd]` in `pyproject.toml`) for syntax errors.",
  unknown: "See the dbterd output channel for details.",
};

export function remediationHint(code: ErdErrorCode): string {
  return REMEDIATION[code] ?? REMEDIATION.unknown;
}
