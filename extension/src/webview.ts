import { randomBytes } from "crypto";
import * as vscode from "vscode";

type InboundMessage =
  | { type: "openFile"; path: string }
  | { type: "refresh" }
  | { type: "reloadServer" }
  | { type: "setTitle"; title: string };
type OutboundMessage = { type: "refresh"; serverUrl: string };

function isInboundMessage(msg: unknown): msg is InboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.type === "openFile") return typeof m.path === "string";
  if (m.type === "setTitle") return typeof m.title === "string";
  return m.type === "refresh" || m.type === "reloadServer";
}

export interface ErdPanelCallbacks {
  onReloadServer(): Promise<void>;
}

export class ErdPanel {
  static current: ErdPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    serverUrl: string,
    callbacks: ErdPanelCallbacks,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;
    if (ErdPanel.current) {
      ErdPanel.current.panel.reveal(column);
      ErdPanel.current.updateServerUrl(serverUrl);
      return;
    }
    const panel = vscode.window.createWebviewPanel("dbterdErd", "dbt ERD", column, {
      enableScripts: true,
      enableForms: false,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    });
    ErdPanel.current = new ErdPanel(panel, context, serverUrl, callbacks);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private serverUrl: string,
    private readonly callbacks: ErdPanelCallbacks,
  ) {
    this.panel.webview.html = this.renderHtml();

    this.panel.onDidDispose(
      () => {
        ErdPanel.current = undefined;
        this.disposables.forEach((d) => d.dispose());
      },
      null,
      this.disposables,
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: unknown) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  refresh(): void {
    const message: OutboundMessage = { type: "refresh", serverUrl: this.serverUrl };
    void this.panel.webview.postMessage(message);
  }

  private updateServerUrl(serverUrl: string): void {
    if (serverUrl === this.serverUrl) {
      this.refresh();
      return;
    }
    // CSP's connect-src is baked into the HTML at render time, so a new URL
    // means we must re-render — otherwise the webview can't fetch from it.
    this.serverUrl = serverUrl;
    this.panel.webview.html = this.renderHtml();
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!isInboundMessage(msg)) return;
    if (msg.type === "openFile") {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showWarningMessage(`dbterd: cannot open ${msg.path} (${message})`);
      }
      return;
    }
    if (msg.type === "refresh") {
      this.refresh();
      return;
    }
    if (msg.type === "reloadServer") {
      try {
        await this.callbacks.onReloadServer();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`dbterd: reload failed: ${message}`);
      }
      return;
    }
    if (msg.type === "setTitle") {
      this.panel.title = msg.title;
    }
  }

  private renderHtml(): string {
    const { webview } = this.panel;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "index.css"));
    const nonce = randomBytes(16).toString("hex");
    // Validate the URL before baking it into CSP or attribute. We control the
    // source (spawnServer parses it from DBTERD_READY), but a stray character
    // would silently break CSP matching or attribute-escape in the HTML.
    const safeUrl = assertSafeServerUrl(this.serverUrl);
    const safeUrlAttr = escapeAttribute(safeUrl);
    // 'unsafe-inline' on style-src is required because @xyflow/react injects
    // styles via JavaScript at runtime; nonces don't apply to dynamic styles.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `connect-src ${safeUrl}`,
      `font-src ${webview.cspSource}`,
      `form-action 'none'`,
      `base-uri 'none'`,
    ].join("; ");

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
}

// The server URL comes from spawnServer() parsing a DBTERD_READY line. Validate
// shape to defend against a malformed child printing something we'd otherwise
// interpolate verbatim into the HTML/CSP.
function assertSafeServerUrl(url: string): string {
  if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(url)) {
    throw new Error(`Refusing to render webview with unsafe server URL: ${url}`);
  }
  return url;
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
