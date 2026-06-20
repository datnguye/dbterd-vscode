import { memo, useCallback, type MouseEvent, type ReactElement } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Column } from "../types/erd";
import type { ErdFlowNode } from "../types/flow";
import { DatabaseIcon, TableIcon } from "./icons";
import { isCollapsible, visibleColumnCount } from "./tableConstants";
import "./ErdTableNode.css";

function columnBadge(col: Column): string {
  if (col.is_primary_key) return "PK";
  if (col.is_foreign_key) return "FK";
  return "";
}

function ColumnRow({ col, highlighted }: { col: Column; highlighted: boolean }): ReactElement {
  const badge = columnBadge(col);
  return (
    <li className="erd-column" data-highlighted={highlighted ? "true" : "false"}>
      <span className={`erd-column-badge badge-${badge.toLowerCase() || "none"}`}>{badge}</span>
      <span className="erd-column-name">{col.name}</span>
      <span className="erd-column-type">{col.data_type ?? ""}</span>
    </li>
  );
}

export const ErdTableNode = memo(function ErdTableNode({ id, data }: NodeProps<ErdFlowNode>) {
  const hasCompiledSql = typeof data.compiled_sql === "string" && data.compiled_sql.length > 0;

  const canCollapse = isCollapsible(data.columns.length);
  // Expand state lives in App so the FK edges can read it and anchor to the
  // right rows; the node just reflects it and forwards the toggle.
  const expanded = data.__expanded === true;
  const onToggleExpand = data.__onToggleExpand as ((id: string) => void) | undefined;
  const toggleExpand = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onToggleExpand?.(id);
    },
    [id, onToggleExpand],
  );

  const visibleColumns = data.columns.slice(0, visibleColumnCount(data.columns.length, expanded));
  const hiddenCount = data.columns.length - visibleColumns.length;

  // Filter highlight: App stamps `__filterState` on data — "match" lights the
  // node up, "dim" fades it. Absent means "no filter active" (default look).
  const filterState = data.__filterState as "match" | "dim" | undefined;
  const isActive = data.__active === true;
  // Columns joined by the selected edge(s) — App stamps the set to light up.
  const highlightColumns = data.__highlightColumns as Set<string> | undefined;

  return (
    <div
      className="erd-table"
      data-resource={data.resource_type}
      data-filter={filterState ?? "off"}
      data-active={isActive ? "true" : "false"}
    >
      {/* Hidden connection points React Flow needs so the FK edges validate.
          They render no visible dot — the custom edges compute their own anchors
          from the column rows, so the cards stay clean. */}
      <Handle type="target" position={Position.Left} id="__node_in" className="erd-hidden-handle" />
      <Handle type="source" position={Position.Right} id="__node_out" className="erd-hidden-handle" />
      <header className="erd-table-header" title={hasCompiledSql ? "Double-click to open compiled SQL" : ""}>
        <span className="erd-table-icon">
          {data.resource_type === "source" ? <DatabaseIcon size={14} /> : <TableIcon size={14} />}
        </span>
        <span className="erd-table-name">{data.name}</span>
      </header>
      <ul className="erd-table-columns">
        {visibleColumns.map((col) => (
          <ColumnRow
            key={col.name}
            col={col}
            highlighted={highlightColumns?.has(col.name) ?? false}
          />
        ))}
      </ul>
      {canCollapse ? (
        <button
          type="button"
          className="erd-table-expand"
          onClick={toggleExpand}
          title={expanded ? "Collapse columns" : `Show ${hiddenCount} more columns`}
        >
          {expanded ? "▲ Collapse" : `▼ ${hiddenCount} more`}
        </button>
      ) : null}
    </div>
  );
});
