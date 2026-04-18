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
  server = new DbterdServer();
  context.subscriptions.push(server);

  context.subscriptions.push(
    vscode.commands.registerCommand("dbterd.openErd", async () => {
      try {
        const url = await server!.ensureRunning();
        ErdPanel.createOrShow(context, url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`dbterd: ${message}`);
      }
    }),
    vscode.commands.registerCommand("dbterd.refresh", () => {
      ErdPanel.current?.refresh();
    }),
  );

  return {
    getServerUrl: () => server?.currentUrl,
    hasPanel: () => ErdPanel.current !== undefined,
  };
}

export function deactivate(): void {
  server?.dispose();
  server = undefined;
}
