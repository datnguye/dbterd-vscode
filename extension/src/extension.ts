import * as vscode from "vscode";
import { DbterdServer } from "./server";
import { ErdPanel } from "./webview";

let server: DbterdServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
}

export function deactivate(): void {
  server?.dispose();
  server = undefined;
}
