// Single source of truth for the postMessage protocol between the extension
// host and the webview. Both sides import these types and validators so the
// contract can't drift silently.
//
// CANONICAL: webview/src/messaging/protocol.ts mirrors this file verbatim.
// If you change one, change the other. A future shared workspace package will
// collapse the duplication.

// Strict server URL pattern: http(s)://host[:port], no path/query/fragment.
// Used for CSP allow-list matching as well — keep this pattern matchable.
export const SERVER_URL_PATTERN = /^https?:\/\/[\w.-]+(:\d+)?$/;

export function isValidServerUrl(value: unknown): value is string {
  return typeof value === "string" && SERVER_URL_PATTERN.test(value);
}

// Webview → Extension
export type InboundMessage =
  | { type: "openFile"; path: string }
  | { type: "refresh" }
  | { type: "reloadServer" }
  | { type: "setTitle"; title: string };

// Extension → Webview
export type OutboundMessage = { type: "refresh"; serverUrl: string };

export function isInboundMessage(msg: unknown): msg is InboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.type === "openFile") return typeof m.path === "string";
  if (m.type === "setTitle") return typeof m.title === "string";
  return m.type === "refresh" || m.type === "reloadServer";
}

export function isOutboundMessage(msg: unknown): msg is OutboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.type === "refresh" && isValidServerUrl(m.serverUrl);
}
