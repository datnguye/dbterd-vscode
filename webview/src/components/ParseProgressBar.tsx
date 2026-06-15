import type { ReactElement } from "react";
import "./ParseProgressBar.css";

export interface ParseProgressBarProps {
  percent: number;
  message: string;
}

export function ParseProgressBar({ percent, message }: ParseProgressBarProps): ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="erd-progress-container">
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Parse progress"
        className="erd-progress-bar"
      >
        <div className="erd-progress-fill" style={{ width: `${clamped}%` }} />
      </div>
      <div className="erd-progress-meta">
        <span className="erd-progress-message">{message}</span>
        <span className="erd-progress-percent">{clamped}%</span>
      </div>
    </div>
  );
}
