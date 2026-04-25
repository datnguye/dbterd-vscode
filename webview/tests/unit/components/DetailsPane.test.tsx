import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsPane } from "@/components/DetailsPane";
import type { ErdNode } from "@/types/erd";

const postMessage = vi.fn();
vi.mock("@/vscode", () => ({
  getVsCodeApi: () => ({ postMessage, getState: vi.fn(), setState: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  postMessage.mockReset();
});

const sampleNode: ErdNode = {
  id: "model.demo.orders",
  name: "orders",
  resource_type: "model",
  schema_name: "analytics",
  database: "warehouse",
  raw_sql_path: "models/orders.sql",
  columns: [
    { name: "id", data_type: "int", is_primary_key: true },
    { name: "customer_id", data_type: "int", is_foreign_key: true, description: "FK to customers" },
    { name: "amount", data_type: "numeric" },
  ],
};

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

  it("posts openFile when the open-file button is clicked", () => {
    render(<DetailsPane node={sampleNode} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Open model file/i));
    expect(postMessage).toHaveBeenCalledWith({ type: "openFile", path: "models/orders.sql" });
  });

  it("does not render the open-file button when raw_sql_path is missing", () => {
    render(
      <DetailsPane node={{ ...sampleNode, raw_sql_path: null }} onClose={() => {}} />,
    );
    expect(screen.queryByText(/Open model file/i)).toBeNull();
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
