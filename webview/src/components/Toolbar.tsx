import { memo, type ReactElement } from "react";
import { getVsCodeApi } from "../vscode";
import { RefreshIcon, ServerCogIcon } from "./icons";
import "./Toolbar.css";

export const Toolbar = memo(function Toolbar(): ReactElement {
  const post = (type: "refresh" | "reloadServer"): void => {
    getVsCodeApi()?.postMessage({ type });
  };

  return (
    <div className="erd-toolbar" role="toolbar" aria-label="ERD actions">
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
