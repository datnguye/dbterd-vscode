import { describe, expect, it } from "vitest";

import { READY_RE } from "@/server/handshake";

describe("READY_RE", () => {
  it("captures a localhost URL", () => {
    const m = READY_RE.exec("DBTERD_READY http://127.0.0.1:8581");
    expect(m?.[1]).toBe("http://127.0.0.1:8581");
  });

  it("captures an https URL", () => {
    const m = READY_RE.exec("DBTERD_READY https://example.com:443");
    expect(m?.[1]).toBe("https://example.com:443");
  });

  it("rejects lines without the prefix", () => {
    expect(READY_RE.exec("ready http://127.0.0.1:1")).toBeNull();
    expect(READY_RE.exec("DBTERD_READY")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(READY_RE.exec("DBTERD_READY not-a-url")).toBeNull();
    expect(READY_RE.exec("DBTERD_READY ftp://example.com")).toBeNull();
  });

  it("rejects extra trailing content", () => {
    // Must be at end-of-line — anchored regex.
    expect(READY_RE.exec("DBTERD_READY http://1.2.3.4:5 extra")).toBeNull();
  });
});
