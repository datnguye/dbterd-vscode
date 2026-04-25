import { describe, expect, it } from "vitest";

import { classifyErdError, ErdApiError, remediationHint } from "@/api/errors";

describe("classifyErdError", () => {
  it("returns a typed error when the body is well-formed", () => {
    const err = classifyErdError({ code: "manifest_missing", detail: "no manifest" }, 404);
    expect(err).toBeInstanceOf(ErdApiError);
    expect(err.code).toBe("manifest_missing");
    expect(err.detail).toBe("no manifest");
    expect(err.status).toBe(404);
  });

  it("falls back to 'unknown' for non-conforming bodies", () => {
    expect(classifyErdError("not json", 500).code).toBe("unknown");
    expect(classifyErdError(null, 500).code).toBe("unknown");
    expect(classifyErdError({ code: "x" }, 500).code).toBe("unknown"); // missing detail
  });
});

describe("remediationHint", () => {
  it("returns a hint for each known code", () => {
    for (const code of [
      "manifest_missing",
      "project_path_missing",
      "project_path_invalid",
      "project_not_allowed",
      "config_invalid",
      "unknown",
    ] as const) {
      expect(remediationHint(code)).toBeTruthy();
    }
  });
});
