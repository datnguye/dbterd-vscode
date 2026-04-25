import { randomBytes } from "crypto";
import * as vscode from "vscode";

import { assertSafeServerUrl, buildCsp, escapeAttribute } from "./csp";

export function renderHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  serverUrl: string,
): string {
  const mediaRoot = vscode.Uri.joinPath(extensionUri, "media");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "index.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "index.css"));
  const nonce = randomBytes(16).toString("hex");
  // Validate the URL before baking it into CSP or attribute. We control the
  // source (spawnServer parses it from DBTERD_READY), but a stray character
  // would silently break CSP matching or attribute-escape in the HTML.
  const safeUrl = assertSafeServerUrl(serverUrl);
  const safeUrlAttr = escapeAttribute(safeUrl);
  const csp = buildCsp({ webviewCspSource: webview.cspSource, serverUrl: safeUrl, nonce });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>dbt ERD</title>
</head>
<body>
  <div id="root" data-server-url="${safeUrlAttr}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
