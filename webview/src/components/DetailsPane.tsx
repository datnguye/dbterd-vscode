import { memo, useCallback, useEffect, type ReactElement } from "react";
import type { ErdNode } from "../types/erd";
import { getVsCodeApi } from "../vscode";
import { CloseIcon, DatabaseIcon, FileCodeIcon, TableIcon } from "./icons";
import "./DetailsPane.css";

interface DetailsPaneProps {
  node: ErdNode;
  onClose: () => void;
}

function pkOrFkBadge(col: { is_primary_key?: boolean; is_foreign_key?: boolean }): string {
  if (col.is_primary_key) return "PK";
  if (col.is_foreign_key) return "FK";
  return "";
}

export const DetailsPane = memo(function DetailsPane({
  node,
  onClose,
}: DetailsPaneProps): ReactElement {
  // ESC closes the pane. Capture-phase so the details pane wins over the
  // canvas's own ESC handlers (e.g. the EntityFilter's clear-on-ESC).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const path = node.raw_sql_path;
  const openFile = useCallback((): void => {
    if (!path) return;
    getVsCodeApi()?.postMessage({ type: "openFile", path });
  }, [path]);

  const Icon = node.resource_type === "source" ? DatabaseIcon : TableIcon;

  return (
    <aside className="erd-details" role="complementary" aria-label="Entity details">
      <header className="erd-details-header">
        <span className="erd-details-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <h2 className="erd-details-title" title={node.name}>
          {node.name}
        </h2>
        <button
          type="button"
          className="erd-details-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close details"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      <dl className="erd-details-meta">
        <div>
          <dt>Resource</dt>
          <dd>{node.resource_type}</dd>
        </div>
        {node.database ? (
          <div>
            <dt>Database</dt>
            <dd>{node.database}</dd>
          </div>
        ) : null}
        {node.schema_name ? (
          <div>
            <dt>Schema</dt>
            <dd>{node.schema_name}</dd>
          </div>
        ) : null}
        <div>
          <dt>Columns</dt>
          <dd>{node.columns.length}</dd>
        </div>
      </dl>

      {path ? (
        <button
          type="button"
          className="erd-details-open-file"
          onClick={openFile}
          title={path}
        >
          <FileCodeIcon size={14} />
          <span>Open model file</span>
          <span className="erd-details-open-file-path">{path}</span>
        </button>
      ) : null}

      <section className="erd-details-section">
        <h3>Columns</h3>
        {node.columns.length === 0 ? (
          <p className="erd-details-empty">No columns reported in catalog.json.</p>
        ) : (
          <ul className="erd-details-columns">
            {node.columns.map((col) => {
              const badge = pkOrFkBadge(col);
              return (
                <li key={col.name} className="erd-details-column">
                  <div className="erd-details-column-row">
                    <span
                      className={`erd-details-column-badge badge-${badge.toLowerCase() || "none"}`}
                    >
                      {badge}
                    </span>
                    <span className="erd-details-column-name">{col.name}</span>
                    <span className="erd-details-column-type">{col.data_type ?? ""}</span>
                  </div>
                  {col.description ? (
                    <p className="erd-details-column-desc">{col.description}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
});
