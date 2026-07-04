import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsPane } from "@/components/DetailsPane";
import { column, node } from "../_support/erd-factories";

const postMessage = vi.fn();
vi.mock("@/vscode", () => ({
  getVsCodeApi: () => ({ postMessage, getState: vi.fn(), setState: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  postMessage.mockReset();
});

const sampleNode = node("model.demo.orders", {
  schema_name: "analytics",
  database: "warehouse",
  model_path: "/workspace/models/orders.sql",
  compiled_sql: "SELECT id, customer_id, amount FROM orders",
  columns: [
    column("id", { data_type: "int", is_primary_key: true }),
    column("customer_id", { data_type: "int", is_foreign_key: true, description: "FK to customers" }),
    column("amount", { data_type: "numeric" }),
  ],
});

describe("DetailsPane", () => {
  it("renders model metadata and column list", () => {
    render(<DetailsPane node={sampleNode} onClose={() => {}} />);
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByText("model")).toBeTruthy();
    expect(screen.getByText("warehouse")).toBeTruthy();
    expect(screen.getByText("analytics")).toBeTruthy();
    expect(screen.getByText("id")).toBeTruthy();
    expect(screen.getByText("customer_id")).toBeTruthy();
    expect(screen.getByText("FK to customers")).toBeTruthy();
  });

  it("posts openFile when the open model file button is clicked", () => {
    render(<DetailsPane node={sampleNode} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Open model file/i));
    expect(postMessage).toHaveBeenCalledWith({
      type: "openFile",
      path: "/workspace/models/orders.sql",
    });
  });

  it("does not render the open model file button when model_path is missing", () => {
    render(
      <DetailsPane node={{ ...sampleNode, model_path: null }} onClose={() => {}} />,
    );
    expect(screen.queryByText(/Open model file/i)).toBeNull();
  });

  it("posts openCompiledSql when the open compiled SQL button is clicked", () => {
    render(<DetailsPane node={sampleNode} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Open compiled SQL/i));
    expect(postMessage).toHaveBeenCalledWith({
      type: "openCompiledSql",
      name: "orders",
      sql: "SELECT id, customer_id, amount FROM orders",
    });
  });

  it("does not render the open compiled SQL button when compiled_sql is missing", () => {
    render(
      <DetailsPane node={{ ...sampleNode, compiled_sql: null }} onClose={() => {}} />,
    );
    expect(screen.queryByText(/Open compiled SQL/i)).toBeNull();
  });

  it("renders neither action button when both model_path and compiled_sql are missing", () => {
    render(
      <DetailsPane node={{ ...sampleNode, model_path: null, compiled_sql: null }} onClose={() => {}} />,
    );
    expect(screen.queryByText(/Open model file/i)).toBeNull();
    expect(screen.queryByText(/Open compiled SQL/i)).toBeNull();
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<DetailsPane node={sampleNode} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/Close details/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("invokes onClose when ESC is pressed", () => {
    const onClose = vi.fn();
    render(<DetailsPane node={sampleNode} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an empty-state message when columns are missing", () => {
    render(
      <DetailsPane node={{ ...sampleNode, columns: [] }} onClose={() => {}} />,
    );
    expect(screen.getByText(/No columns reported/i)).toBeTruthy();
  });
});
