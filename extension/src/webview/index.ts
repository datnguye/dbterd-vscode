import * as vscode from "vscode";

import { isInboundMessage, type OutboundMessage } from "../messaging/protocol";
import type { EventBus, PanelEvents } from "../messaging/bus";
import { renderHtml } from "./html";

export class ErdPanel {
  static current: ErdPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    serverUrl: string,
    bus: EventBus<PanelEvents>,
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
    ErdPanel.current = new ErdPanel(panel, context, serverUrl, bus);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private serverUrl: string,
    private readonly bus: EventBus<PanelEvents>,
  ) {
    this.panel.webview.html = renderHtml(this.panel.webview, this.context.extensionUri, serverUrl);

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

  updateServerUrl(serverUrl: string): void {
    if (serverUrl === this.serverUrl) {
      this.refresh();
      return;
    }
    // CSP's connect-src is baked into the HTML at render time, so a new URL
    // means we must re-render — otherwise the webview can't fetch from it.
    this.serverUrl = serverUrl;
    this.panel.webview.html = renderHtml(this.panel.webview, this.context.extensionUri, serverUrl);
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!isInboundMessage(msg)) return;
    if (msg.type === "openFile") {
      this.bus.emit("openFile", msg.path);
      return;
    }
    if (msg.type === "refresh") {
      this.bus.emit("refresh", undefined);
      return;
    }
    if (msg.type === "reloadServer") {
      this.bus.emit("reloadServer", undefined);
      return;
    }
    if (msg.type === "setTitle") {
      this.panel.title = msg.title;
      return;
    }
    if (msg.type === "parseStarted") {
      this.bus.emit("parseStarted", undefined);
      return;
    }
    if (msg.type === "parseFinished") {
      this.bus.emit("parseFinished", { ok: msg.ok });
    }
  }
}
