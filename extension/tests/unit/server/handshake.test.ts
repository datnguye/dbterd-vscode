import { describe, expect, it } from "vitest";

import { LOG_PATH_RE, READY_RE } from "@/server/handshake";

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

describe("LOG_PATH_RE", () => {
  it("captures a posix log path", () => {
    const m = LOG_PATH_RE.exec("DBTERD_LOG /Users/me/.dbterd/dbterd-server-20260425T010101Z.log");
    expect(m?.[1]).toBe("/Users/me/.dbterd/dbterd-server-20260425T010101Z.log");
  });

  it("captures a windows log path with spaces", () => {
    const m = LOG_PATH_RE.exec("DBTERD_LOG C:\\Users\\Some User\\.dbterd\\dbterd-server.log");
    expect(m?.[1]).toBe("C:\\Users\\Some User\\.dbterd\\dbterd-server.log");
  });

  it("rejects lines without the prefix", () => {
    expect(LOG_PATH_RE.exec("dbterd_log /tmp/x.log")).toBeNull();
  });
});
