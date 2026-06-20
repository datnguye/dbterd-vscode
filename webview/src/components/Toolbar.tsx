import { memo, type ReactElement } from "react";
import { LAYOUT_STYLES, type LayoutStyle } from "../layout";
import { getVsCodeApi } from "../vscode";
import { EntityFilter } from "./EntityFilter";
import {
  FoldVerticalIcon,
  HierarchyIcon,
  OrganicIcon,
  RefreshIcon,
  ServerCogIcon,
  StarIcon,
  UnfoldVerticalIcon,
  UnlinkIcon,
} from "./icons";
import "./Toolbar.css";

interface ToolbarProps {
  filter: string;
  onFilterChange: (next: string) => void;
  matchCount: number;
  totalCount: number;
  hideUnconnected: boolean;
  onToggleHideUnconnected: () => void;
  layout: LayoutStyle;
  onLayoutChange: (next: LayoutStyle) => void;
  // True when every collapsible table is currently expanded (button collapses
  // all next); false means the button expands all next.
  allExpanded: boolean;
  // Whether any table has hidden columns to expand at all — disables the button
  // when no table is collapsible.
  canExpand: boolean;
  onToggleExpandAll: () => void;
}

// Display metadata per layout. Keyed by LayoutStyle (a Record, so a new style
// added to LAYOUT_STYLES is a compile error here until its button is defined);
// the button order comes from LAYOUT_STYLES, the single source of truth.
const LAYOUT_META: Record<LayoutStyle, { label: string; tooltip: string; Icon: typeof RefreshIcon }> = {
  hierarchical: {
    label: "Hierarchical layout",
    tooltip: "Hierarchical (left-to-right) layout",
    Icon: HierarchyIcon,
  },
  radial: {
    label: "Radial layout",
    tooltip: "Radial (star) layout — hubs in the centre",
    Icon: StarIcon,
  },
  force: {
    label: "Force layout",
    tooltip: "Force (organic) layout — shared dimensions settle among their facts",
    Icon: OrganicIcon,
  },
};

export const Toolbar = memo(function Toolbar({
  filter,
  onFilterChange,
  matchCount,
  totalCount,
  hideUnconnected,
  onToggleHideUnconnected,
  layout,
  onLayoutChange,
  allExpanded,
  canExpand,
  onToggleExpandAll,
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
      <div className="erd-toolbar-group" role="group" aria-label="Layout style">
        {LAYOUT_STYLES.map((value) => {
          const { label, tooltip, Icon } = LAYOUT_META[value];
          return (
            <button
              key={value}
              type="button"
              className="erd-toolbar-btn"
              aria-label={label}
              aria-pressed={layout === value}
              data-active={layout === value || undefined}
              data-tooltip={tooltip}
              onClick={() => onLayoutChange(value)}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>
      <span className="erd-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="erd-toolbar-btn"
        aria-label="Hide unconnected tables"
        aria-pressed={hideUnconnected}
        data-active={hideUnconnected || undefined}
        data-tooltip="Hide tables with no relationships"
        onClick={onToggleHideUnconnected}
      >
        <UnlinkIcon size={16} />
      </button>
      <button
        type="button"
        className="erd-toolbar-btn"
        aria-label={allExpanded ? "Collapse all columns" : "Expand all columns"}
        data-tooltip={
          allExpanded
            ? "Collapse all columns (hide rows past the first few)"
            : "Expand all columns (show every column on every table)"
        }
        disabled={!canExpand}
        onClick={onToggleExpandAll}
      >
        {allExpanded ? <FoldVerticalIcon size={16} /> : <UnfoldVerticalIcon size={16} />}
      </button>
      <button
        type="button"
        className="erd-toolbar-btn"
        aria-label="Refresh ERD"
        data-tooltip="Refresh ERD (re-read manifest.json and .dbterd.yml)"
        onClick={() => post("refresh")}
      >
        <RefreshIcon size={16} />
      </button>
      <button
        type="button"
        className="erd-toolbar-btn"
        aria-label="Reload Server"
        data-tooltip="Reload Server (kill Python process and respawn)"
        onClick={() => post("reloadServer")}
      >
        <ServerCogIcon size={16} />
      </button>
    </div>
  );
});
