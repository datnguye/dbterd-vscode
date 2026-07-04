import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "@/components/Toolbar";

const postMessageMock = vi.fn();
vi.mock("@/vscode", () => ({
  getVsCodeApi: () => ({ postMessage: postMessageMock, getState: vi.fn(), setState: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  postMessageMock.mockReset();
});

function renderToolbar(overrides: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  const onFilterChange = vi.fn();
  const onToggleHideUnconnected = vi.fn();
  const onLayoutChange = vi.fn();
  const onToggleExpandAll = vi.fn();
  render(
    <Toolbar
      filter=""
      onFilterChange={onFilterChange}
      matchCount={0}
      totalCount={0}
      hideUnconnected={false}
      onToggleHideUnconnected={onToggleHideUnconnected}
      layout="hierarchical"
      onLayoutChange={onLayoutChange}
      allExpanded={false}
      canExpand={true}
      onToggleExpandAll={onToggleExpandAll}
      {...overrides}
    />,
  );
  return { onFilterChange, onToggleHideUnconnected, onLayoutChange, onToggleExpandAll };
}

describe("Toolbar", () => {
  it("posts refresh and reloadServer messages on button clicks", () => {
    renderToolbar();
    fireEvent.click(screen.getByLabelText(/Refresh ERD/i));
    expect(postMessageMock).toHaveBeenCalledWith({ type: "refresh" });
    fireEvent.click(screen.getByLabelText(/Reload Server/i));
    expect(postMessageMock).toHaveBeenCalledWith({ type: "reloadServer" });
  });

  it("invokes the unconnected-toggle handler on click", () => {
    const { onToggleHideUnconnected } = renderToolbar();
    fireEvent.click(screen.getByLabelText(/Hide unconnected tables/i));
    expect(onToggleHideUnconnected).toHaveBeenCalledTimes(1);
  });

  it("reflects the toggle's pressed state via aria-pressed", () => {
    renderToolbar({ hideUnconnected: true });
    expect(
      screen.getByLabelText(/Hide unconnected tables/i).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("requests a layout change when a layout button is clicked", () => {
    const { onLayoutChange } = renderToolbar({ layout: "hierarchical" });
    fireEvent.click(screen.getByLabelText(/Radial layout/i));
    expect(onLayoutChange).toHaveBeenCalledWith("radial");
  });

  it("offers the force-directed layout as a selectable style", () => {
    const { onLayoutChange } = renderToolbar({ layout: "hierarchical" });
    fireEvent.click(screen.getByLabelText(/Force-directed layout/i));
    expect(onLayoutChange).toHaveBeenCalledWith("force");
  });

  it("marks the active layout button as pressed", () => {
    renderToolbar({ layout: "radial" });
    expect(screen.getByLabelText(/Radial layout/i).getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByLabelText(/Hierarchical layout/i).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("invokes the expand-all handler on click", () => {
    const { onToggleExpandAll } = renderToolbar();
    fireEvent.click(screen.getByLabelText(/Expand all tables/i));
    expect(onToggleExpandAll).toHaveBeenCalledTimes(1);
  });

  it("labels the expand-all button 'Collapse all' when everything is expanded", () => {
    renderToolbar({ allExpanded: true });
    expect(screen.getByLabelText(/Collapse all tables/i)).toBeTruthy();
  });

  it("disables the expand-all button when nothing is collapsible", () => {
    renderToolbar({ canExpand: false });
    expect(
      (screen.getByLabelText(/Expand all tables/i) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
