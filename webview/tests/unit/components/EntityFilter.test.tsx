import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityFilter } from "@/components/EntityFilter";

afterEach(cleanup);

describe("EntityFilter", () => {
  it("renders the input with placeholder hint and no count when empty", () => {
    render(<EntityFilter value="" onChange={() => {}} matchCount={0} totalCount={10} />);
    const input = screen.getByLabelText(/Filter entities by name/i) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toMatch(/\//);
    expect(screen.queryByText(/0\/10/)).toBeNull();
  });

  it("calls onChange when the user types", () => {
    const onChange = vi.fn();
    render(<EntityFilter value="" onChange={onChange} matchCount={0} totalCount={10} />);
    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.change(input, { target: { value: "ord" } });
    expect(onChange).toHaveBeenCalledWith("ord");
  });

  it("shows the match-count badge when a query is present", () => {
    render(<EntityFilter value="ord" onChange={() => {}} matchCount={3} totalCount={10} />);
    expect(screen.getByText("3/10")).toBeTruthy();
  });

  it("flags the no-matches case via the empty modifier class", () => {
    const { container } = render(
      <EntityFilter value="zzz" onChange={() => {}} matchCount={0} totalCount={10} />,
    );
    expect(container.querySelector(".erd-filter-empty")).not.toBeNull();
  });

  it("clears the filter when the clear button is clicked", () => {
    const onChange = vi.fn();
    render(<EntityFilter value="ord" onChange={onChange} matchCount={3} totalCount={10} />);
    fireEvent.click(screen.getByLabelText(/Clear filter/i));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("clears on ESC when there is a query", () => {
    const onChange = vi.fn();
    render(<EntityFilter value="ord" onChange={onChange} matchCount={3} totalCount={10} />);
    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not call onChange on ESC when the query is already empty", () => {
    const onChange = vi.fn();
    render(<EntityFilter value="" onChange={onChange} matchCount={0} totalCount={10} />);
    const input = screen.getByLabelText(/Filter entities by name/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("focuses the input when `/` is pressed outside an input", () => {
    render(<EntityFilter value="" onChange={() => {}} matchCount={0} totalCount={10} />);
    const input = screen.getByLabelText(/Filter entities by name/i) as HTMLInputElement;
    document.body.focus();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("ignores `/` when the user is already typing in another input", () => {
    const other = document.createElement("input");
    document.body.appendChild(other);
    render(<EntityFilter value="" onChange={() => {}} matchCount={0} totalCount={10} />);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});
