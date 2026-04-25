import { describe, expect, it } from "vitest";

import {
  isInboundMessage,
  isOutboundMessage,
  isValidServerUrl,
  SERVER_URL_PATTERN,
} from "@/messaging/protocol";

describe("isValidServerUrl", () => {
  it.each([
    "http://127.0.0.1:8581",
    "http://localhost:1234",
    "https://example.com",
    "https://server.local:443",
  ])("accepts %s", (url) => {
    expect(isValidServerUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>",
    "ftp://example.com",
    "http://example.com/path",
    "http://example.com?q=1",
    "",
    null,
    undefined,
    42,
  ])("rejects %s", (value) => {
    expect(isValidServerUrl(value)).toBe(false);
  });
});

describe("SERVER_URL_PATTERN", () => {
  it("rejects URLs with paths", () => {
    expect(SERVER_URL_PATTERN.test("http://localhost:1/erd")).toBe(false);
  });
});

describe("isInboundMessage", () => {
  it("accepts openFile with a path", () => {
    expect(isInboundMessage({ type: "openFile", path: "/tmp/x.sql" })).toBe(true);
  });

  it("rejects openFile without a path", () => {
    expect(isInboundMessage({ type: "openFile" })).toBe(false);
  });

  it("accepts setTitle with a string title", () => {
    expect(isInboundMessage({ type: "setTitle", title: "ERD" })).toBe(true);
  });

  it.each([{ type: "refresh" }, { type: "reloadServer" }])("accepts %s", (msg) => {
    expect(isInboundMessage(msg)).toBe(true);
  });

  it.each([null, "string", 42, { type: "unknown" }])("rejects %s", (msg) => {
    expect(isInboundMessage(msg)).toBe(false);
  });
});

describe("isOutboundMessage", () => {
  it("accepts a refresh with a valid url", () => {
    expect(isOutboundMessage({ type: "refresh", serverUrl: "http://127.0.0.1:1" })).toBe(true);
  });

  it("rejects a refresh with javascript: serverUrl", () => {
    expect(isOutboundMessage({ type: "refresh", serverUrl: "javascript:alert(1)" })).toBe(false);
  });

  it("rejects unknown message types", () => {
    expect(isOutboundMessage({ type: "unknown", serverUrl: "http://127.0.0.1:1" })).toBe(false);
  });
});
