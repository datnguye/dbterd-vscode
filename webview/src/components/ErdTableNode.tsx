import {
  memo,
  useCallback,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Column } from "../types/erd";
import type { ErdFlowNode } from "../layout";
import { getVsCodeApi } from "../vscode";
import { DatabaseIcon, TableIcon } from "./icons";
import { COLLAPSE_THRESHOLD, COLLAPSED_VISIBLE } from "./tableConstants";
import "./ErdTableNode.css";

function columnBadge(col: Column): string {
  if (col.is_primary_key) return "PK";
  if (col.is_foreign_key) return "FK";
  return "";
}

function ColumnRow({ col }: { col: Column }): ReactElement {
  const badge = columnBadge(col);
  return (
    <li className="erd-column">
      <Handle type="target" position={Position.Left} id={`${col.name}__in`} />
      <span className={`erd-column-badge badge-${badge.toLowerCase() || "none"}`}>{badge}</span>
      <span className="erd-column-name">{col.name}</span>
      <span className="erd-column-type">{col.data_type ?? ""}</span>
      <Handle type="source" position={Position.Right} id={`${col.name}__out`} />
    </li>
  );
}

export const ErdTableNode = memo(function ErdTableNode({ data }: NodeProps<ErdFlowNode>) {
  const path = data.raw_sql_path;
  const onHeaderClick = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.stopPropagation();
      if (!path) return;
      getVsCodeApi()?.postMessage({ type: "openFile", path });
    },
    [path],
  );

  const canCollapse = data.columns.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const toggleExpand = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  const visibleColumns =
    canCollapse && !expanded ? data.columns.slice(0, COLLAPSED_VISIBLE) : data.columns;
  const hiddenCount = data.columns.length - visibleColumns.length;

  return (
    <div className="erd-table" data-resource={data.resource_type}>
      {/* Default table-level handles — edges fall back to these when the FK
          column isn't in the catalog-sourced columns list. Without these, any
          edge whose sourceHandle/targetHandle references a missing column is
          silently dropped by React Flow. */}
      <Handle type="target" position={Position.Left} id="__table_in" />
      <Handle type="source" position={Position.Right} id="__table_out" />
      <header className="erd-table-header" onClick={onHeaderClick} title={path ?? ""}>
        <span className="erd-table-icon">
          {data.resource_type === "source" ? <DatabaseIcon size={14} /> : <TableIcon size={14} />}
        </span>
        <span className="erd-table-name">{data.name}</span>
      </header>
      <ul className="erd-table-columns">
        {visibleColumns.map((col) => (
          <ColumnRow key={col.name} col={col} />
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
