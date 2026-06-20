import type { ReactElement } from "react";

// Lucide icon paths (MIT) — https://lucide.dev. Inlined to avoid a runtime
// dependency and keep the webview bundle small. Stroke uses `currentColor` so
// each caller can theme via CSS.
//
// Convention: 24x24 viewBox, 2px stroke, rounded caps/joins — matches Lucide
// defaults so icons stay visually consistent if we swap later.

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number): {
  width: number;
  height: number;
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: "round";
  strokeLinejoin: "round";
} {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
}

export function RefreshIcon({ size = 16, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function ServerCogIcon({ size = 16, className }: IconProps): ReactElement {
  // Lucide "server-cog": stacked-servers glyph with a gear ring — reads as
  // "restart the server" at a glance.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M5 10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2" />
      <path d="M5 14a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h4" />
      <path d="M6 6h.01" />
      <path d="M6 18h.01" />
      <circle cx="16" cy="17" r="3" />
      <path d="M16 11v1" />
      <path d="M16 22v-1" />
      <path d="M21 17h-1" />
      <path d="M12 17h-1" />
      <path d="m19.5 14.5-.7.7" />
      <path d="m13.2 20.8-.7.7" />
      <path d="m19.5 19.5-.7-.7" />
      <path d="m13.2 13.2-.7-.7" />
    </svg>
  );
}

export function UnlinkIcon({ size = 16, className }: IconProps): ReactElement {
  // Lucide "unlink": broken chain — toggles whether tables with no FK
  // relationships are shown on the canvas.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
      <line x1="8" x2="8" y1="2" y2="5" />
      <line x1="2" x2="5" y1="8" y2="8" />
      <line x1="16" x2="16" y1="19" y2="22" />
      <line x1="19" x2="22" y1="16" y2="16" />
    </svg>
  );
}

export function HierarchyIcon({ size = 16, className }: IconProps): ReactElement {
  // Lucide "network": a root box linked down to two children — reads as the
  // left-to-right / hierarchical (dagre) arrangement.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <path d="M12 8v4" />
      <path d="M5 16v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function StarIcon({ size = 16, className }: IconProps): ReactElement {
  // A central node with spokes to four satellites — the radial / star layout.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="3" r="1.5" />
      <circle cx="12" cy="21" r="1.5" />
      <circle cx="3" cy="12" r="1.5" />
      <circle cx="21" cy="12" r="1.5" />
      <path d="M12 9.5V4.5" />
      <path d="M12 19.5v-5" />
      <path d="M9.5 12h-5" />
      <path d="M19.5 12h-5" />
    </svg>
  );
}

export function OrganicIcon({ size = 16, className }: IconProps): ReactElement {
  // Three linked nodes in a loose web — the force-directed ("organic") layout
  // where connected tables cluster and shared ones settle between them.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="8" r="2" />
      <circle cx="11" cy="18" r="2" />
      <path d="M6.7 7.4 9.3 16.6" />
      <path d="M17.3 9.4 12.7 16.6" />
      <path d="M7 6.4 17 7.8" />
    </svg>
  );
}

// The dashed fold line shared by the fold/unfold icons — they differ only in
// chevron direction, so the frame lives in one place.
const foldFrame = (
  <>
    <path d="M12 22v-6" />
    <path d="M12 8V2" />
    <path d="M4 12H2" />
    <path d="M10 12H8" />
    <path d="M16 12h-2" />
    <path d="M22 12h-2" />
  </>
);

export function UnfoldVerticalIcon({ size = 16, className }: IconProps): ReactElement {
  // Lucide "unfold-vertical": chevrons pushing apart from the fold line — reads
  // as "expand all columns".
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      {foldFrame}
      <path d="m15 19-3 3-3-3" />
      <path d="m15 5-3-3-3 3" />
    </svg>
  );
}

export function FoldVerticalIcon({ size = 16, className }: IconProps): ReactElement {
  // Lucide "fold-vertical": chevrons pulling toward the fold line — reads as
  // "collapse all columns".
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      {foldFrame}
      <path d="m15 13-3 3-3-3" />
      <path d="m15 11-3-3-3 3" />
    </svg>
  );
}

export function TableIcon({ size = 14, className }: IconProps): ReactElement {
  // Lucide "table-2": 3-row grid. Reads clearly as a data table at small sizes.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
    </svg>
  );
}

export function DatabaseIcon({ size = 14, className }: IconProps): ReactElement {
  // Lucide "database": cylinder — the universal "source table" glyph.
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

export function SearchIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function FileCodeIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M14.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l6 6v3" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m9 18-3-3 3-3" />
      <path d="m15 12 3 3-3 3" />
    </svg>
  );
}

export function FileIcon({ size = 14, className }: IconProps): ReactElement {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}
