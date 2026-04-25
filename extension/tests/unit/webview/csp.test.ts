import { describe, expect, it } from "vitest";

import { assertSafeServerUrl, buildCsp, escapeAttribute } from "@/webview/csp";

describe("assertSafeServerUrl", () => {
  it.each([
    "http://127.0.0.1:8581",
    "http://localhost:8000",
    "https://example.com",
    "https://api.local:443",
  ])("accepts %s", (url) => {
    expect(assertSafeServerUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>",
    "ftp://example.com",
    "http://example.com/path",
    "http://example.com?q=1",
    "http://example.com#frag",
    "",
  ])("rejects %s", (url) => {
    expect(() => assertSafeServerUrl(url)).toThrow(/unsafe server URL/);
  });
});

describe("escapeAttribute", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeAttribute(`<a href="x">'&'</a>`)).toBe(
      "&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;",
    );
  });

  it("leaves benign characters untouched", () => {
    expect(escapeAttribute("hello world 123")).toBe("hello world 123");
  });
});

describe("buildCsp", () => {
  it("includes the server URL in connect-src", () => {
    const csp = buildCsp({
      webviewCspSource: "vscode-webview://abc",
      serverUrl: "http://127.0.0.1:1234",
      nonce: "deadbeef",
    });
    expect(csp).toContain("connect-src http://127.0.0.1:1234");
  });

  it("uses the supplied nonce", () => {
    const csp = buildCsp({
      webviewCspSource: "vscode-webview://abc",
      serverUrl: "http://127.0.0.1:1234",
      nonce: "deadbeef",
    });
    expect(csp).toContain("script-src 'nonce-deadbeef'");
  });

  it("locks default-src to none", () => {
    const csp = buildCsp({
      webviewCspSource: "x",
      serverUrl: "http://127.0.0.1:1",
      nonce: "n",
    });
    expect(csp).toMatch(/default-src 'none'/);
  });
});
