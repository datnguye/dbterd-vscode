import * as vscode from "vscode";
import { DbterdServer } from "./server";
import { ErdPanel } from "./webview";

// Surface exposed to integration tests (via vscode.extensions.getExtension(...).exports).
// Production callers should not depend on this shape — it exists so e2e tests can verify
// the extension's live state without poking at private instance vars.
export interface DbterdExtensionApi {
  getServerUrl(): string | undefined;
  hasPanel(): boolean;
}

let server: DbterdServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<DbterdExtensionApi> {
  server = new DbterdServer(context);
  context.subscriptions.push(server);

  // When the Python process dies after a successful startup (crash, OOM,
  // manual kill), surface an actionable message instead of leaving the
  // webview silently refusing to connect on its next fetch.
  server.setCallbacks({
    onUnexpectedExit(detail) {
      void vscode.window
        .showWarningMessage(detail, "Reload Server")
        .then((choice) => {
          if (choice === "Reload Server") {
            void vscode.commands.executeCommand("dbterd.reloadServer");
          }
        });
    },
  });

  const panelCallbacks = {
    async onReloadServer(): Promise<void> {
      const url = await server!.reload();
      // Re-render the panel with the (possibly new) URL — updateServerUrl
      // bakes connect-src into the CSP, so this must go through createOrShow
      // to avoid a stale CSP blocking fetches.
      ErdPanel.createOrShow(context, url, panelCallbacks);
      ErdPanel.current?.refresh();
    },
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("dbterd.openErd", async () => {
      try {
        const url = await server!.ensureRunning();
        ErdPanel.createOrShow(context, url, panelCallbacks);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`dbterd: ${message}`);
      }
    }),
    vscode.commands.registerCommand("dbterd.refresh", () => {
      ErdPanel.current?.refresh();
    }),
    vscode.commands.registerCommand("dbterd.reloadServer", async () => {
      try {
        await panelCallbacks.onReloadServer();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`dbterd: reload failed: ${message}`);
      }
    }),
  );

  return {
    getServerUrl: () => server?.currentUrl,
    hasPanel: () => ErdPanel.current !== undefined,
  };
}

export async function deactivate(): Promise<void> {
  // Await the async dispose so the Python child is fully reaped before VS Code
  // considers the extension deactivated (avoids orphan processes on restart).
  await server?.dispose();
  server = undefined;
}
