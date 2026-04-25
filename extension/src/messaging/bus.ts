// A minimally-typed event bus. The webview panel publishes user actions
// (refresh, reloadServer, openFile); the extension host subscribes and
// orchestrates side-effects (server.reload, vscode.workspace.openTextDocument,
// etc). Avoids a circular callbacks-into-callbacks plumbing pattern.

type Listener<T> = (payload: T) => void;

export interface PanelEvents {
  refresh: void;
  reloadServer: void;
  openFile: string;
}

export class EventBus<TEvents> {
  private readonly listeners: { [K in keyof TEvents]?: Listener<TEvents[K]>[] } = {};

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): { dispose(): void } {
    const arr = (this.listeners[event] ??= []);
    arr.push(listener);
    return {
      dispose: () => {
        const i = arr.indexOf(listener);
        if (i >= 0) arr.splice(i, 1);
      },
    };
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    for (const listener of this.listeners[event] ?? []) listener(payload);
  }

  clear(): void {
    for (const key of Object.keys(this.listeners) as (keyof TEvents)[]) {
      delete this.listeners[key];
    }
  }
}
