import { memo, type ReactElement } from "react";
import { getVsCodeApi } from "../vscode";
import { EntityFilter } from "./EntityFilter";
import { RefreshIcon, ServerCogIcon } from "./icons";
import "./Toolbar.css";

interface ToolbarProps {
  filter: string;
  onFilterChange: (next: string) => void;
  matchCount: number;
  totalCount: number;
}

export const Toolbar = memo(function Toolbar({
  filter,
  onFilterChange,
  matchCount,
  totalCount,
}: ToolbarProps): ReactElement {
  const post = (type: "refresh" | "reloadServer"): void => {
    getVsCodeApi()?.postMessage({ type });
  };

  return (
    <div className="erd-toolbar" role="toolbar" aria-label="ERD actions">
      <EntityFilter
        value={filter}
        onChange={onFilterChange}
        matchCount={matchCount}
        totalCount={totalCount}
      />
      <span className="erd-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="erd-toolbar-btn"
        title="Refresh ERD (re-read manifest.json and .dbterd.yml)"
        onClick={() => post("refresh")}
      >
        <RefreshIcon size={16} />
      </button>
      <button
        type="button"
        className="erd-toolbar-btn"
        title="Reload Server (kill Python process and respawn)"
        onClick={() => post("reloadServer")}
      >
        <ServerCogIcon size={16} />
      </button>
    </div>
  );
});
