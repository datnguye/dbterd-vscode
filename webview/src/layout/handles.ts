// Handle id conventions and lookup helpers. Kept here so all "did the catalog
// give us this column?" logic lives in one place — the ErdTableNode renders
// matching ids on the React side.

import type { ErdNode } from "../types/erd";

export const TABLE_OUT = "__table_out";
export const TABLE_IN = "__table_in";

export function outHandle(column: string): string {
  return `${column}__out`;
}

export function inHandle(column: string): string {
  return `${column}__in`;
}

export function buildColumnIndex(nodes: readonly ErdNode[]): Map<string, Set<string>> {
  return new Map(nodes.map((n) => [n.id, new Set(n.columns.map((c) => c.name))]));
}

export function hasHandle(
  index: Map<string, Set<string>>,
  nodeId: string,
  column: string | null,
): boolean {
  return !!column && (index.get(nodeId)?.has(column) ?? false);
}
