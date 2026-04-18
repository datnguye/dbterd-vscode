export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let cached: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi | undefined {
  if (cached) return cached;
  cached = window.acquireVsCodeApi?.();
  return cached;
}
