// Maps the currently-selected FK edges to the columns each table should
// highlight, so clicking a connector lights up the exact fields it joins.

import type { Edge } from "@xyflow/react";

interface EdgeColumns {
  from_column?: string | null;
  to_column?: string | null;
  from_columns?: string[];
  to_columns?: string[];
}

export function columnsForSelectedEdges(edges: readonly Edge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (nodeId: string, column: string | null | undefined): void => {
    if (!column) return;
    const set = map.get(nodeId) ?? new Set<string>();
    set.add(column);
    map.set(nodeId, set);
  };
  for (const edge of edges) {
    if (!edge.selected) continue;
    const d = (edge.data ?? {}) as EdgeColumns;
    add(edge.source, d.from_column);
    add(edge.target, d.to_column);
    for (const c of d.from_columns ?? []) add(edge.source, c);
    for (const c of d.to_columns ?? []) add(edge.target, c);
  }
  return map;
}
