import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ParseProgressBar } from "@/components/ParseProgressBar";

afterEach(() => {
  cleanup();
});

describe("ParseProgressBar", () => {
  it("renders the message text", () => {
    render(<ParseProgressBar percent={42} message="mapping nodes" />);
    expect(screen.getByText("mapping nodes")).toBeTruthy();
  });

  it("renders the percent value", () => {
    render(<ParseProgressBar percent={42} message="mapping nodes" />);
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("sets correct aria attributes on the progressbar", () => {
    render(<ParseProgressBar percent={75} message="almost done" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("75");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("clamps percent below 0 to 0", () => {
    render(<ParseProgressBar percent={-5} message="start" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("clamps percent above 100 to 100", () => {
    render(<ParseProgressBar percent={110} message="done" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("100%")).toBeTruthy();
  });
});
