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
