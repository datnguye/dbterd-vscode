// CSP helpers used when rendering the webview HTML. Pure string utilities —
// extracted so they can be unit-tested without spinning up VS Code.

import { SERVER_URL_PATTERN } from "../messaging/protocol";

export interface CspParts {
  webviewCspSource: string;
  serverUrl: string;
  nonce: string;
}

export function buildCsp({ webviewCspSource, serverUrl, nonce }: CspParts): string {
  // 'unsafe-inline' on style-src is required because @xyflow/react injects
  // styles via JavaScript at runtime; nonces don't apply to dynamic styles.
  return [
    `default-src 'none'`,
    `img-src ${webviewCspSource} data:`,
    `style-src ${webviewCspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `connect-src ${serverUrl}`,
    `font-src ${webviewCspSource}`,
    `form-action 'none'`,
    `base-uri 'none'`,
  ].join("; ");
}

// The server URL comes from spawnServer() parsing a DBTERD_READY line. Validate
// shape to defend against a malformed child printing something we'd otherwise
// interpolate verbatim into the HTML/CSP.
export function assertSafeServerUrl(url: string): string {
  if (!SERVER_URL_PATTERN.test(url)) {
    throw new Error(`Refusing to render webview with unsafe server URL: ${url}`);
  }
  return url;
}

export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
