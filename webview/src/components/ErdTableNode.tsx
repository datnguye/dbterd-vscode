import { memo, useCallback, type MouseEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Column } from "../types/erd";
import type { ErdFlowNode } from "../layout";
import { getVsCodeApi } from "../vscode";
import "./ErdTableNode.css";

function columnBadge(col: Column): string {
  if (col.is_primary_key) return "PK";
  if (col.is_foreign_key) return "FK";
  return "";
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

  return (
    <div className="erd-table" data-resource={data.resource_type}>
      <header className="erd-table-header" onClick={onHeaderClick} title={path ?? ""}>
        <span className="erd-table-icon" aria-hidden="true">
          {data.resource_type === "source" ? "◈" : "▤"}
        </span>
        <span className="erd-table-name">{data.name}</span>
      </header>
      <ul className="erd-table-columns">
        {data.columns.map((col) => (
          <li key={col.name} className="erd-column">
            <Handle type="target" position={Position.Left} id={`${col.name}__in`} />
            <span className={`erd-column-badge badge-${columnBadge(col).toLowerCase() || "none"}`}>
              {columnBadge(col)}
            </span>
            <span className="erd-column-name">{col.name}</span>
            <span className="erd-column-type">{col.data_type ?? ""}</span>
            <Handle type="source" position={Position.Right} id={`${col.name}__out`} />
          </li>
        ))}
      </ul>
    </div>
  );
});
