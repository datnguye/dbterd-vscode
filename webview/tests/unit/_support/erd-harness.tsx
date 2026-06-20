import { useState, type ReactNode } from "react";

interface MockNode {
  id: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}
interface MockEdge {
  id: string;
  source: string;
  target: string;
  selected?: boolean;
  style?: Record<string, unknown>;
}
interface ReactFlowMockProps {
  children?: ReactNode;
  nodes?: MockNode[];
  edges?: MockEdge[];
  onNodeClick?: (event: unknown, node: MockNode) => void;
  onNodeDoubleClick?: (event: unknown, node: MockNode) => void;
  onNodesChange?: (changes: unknown[]) => void;
  onEdgesChange?: (changes: unknown[]) => void;
  onPaneClick?: () => void;
}

export function reactFlowMock() {
  return {
    Background: () => null,
    Controls: () => null,
    MiniMap: () => <div data-testid="minimap" />,
    ReactFlow: ({
      children,
      nodes,
      edges,
      onNodeClick,
      onNodeDoubleClick,
      onNodesChange,
      onEdgesChange,
      onPaneClick,
    }: ReactFlowMockProps) => (
      <div data-testid="react-flow">
        <button type="button" data-testid="pane" onClick={() => onPaneClick?.()}>
          pane
        </button>
        <button
          type="button"
          data-testid="drag-node"
          onClick={() =>
            onNodesChange?.([
              {
                id: (nodes ?? [])[0]?.id,
                type: "position",
                position: { x: 999, y: 888 },
                dragging: false,
              },
            ])
          }
        >
          drag
        </button>
        {(nodes ?? []).map((n) => (
          <div
            key={n.id}
            data-testid={`node-${n.id}`}
            data-filter={String(n.data.__filterState ?? "off")}
            data-active={String(n.data.__active ?? false)}
            data-expanded={String(n.data.__expanded ?? false)}
            data-highlight={[...((n.data.__highlightColumns as Set<string>) ?? [])].sort().join(",")}
            data-x={String(n.position?.x ?? "")}
            data-y={String(n.position?.y ?? "")}
            onClick={(e) => onNodeClick?.(e, n)}
            onDoubleClick={(e) => onNodeDoubleClick?.(e, n)}
          >
            <div className="erd-table-header" data-testid={`node-header-${n.id}`}>
              {String(n.data.name)}
            </div>
            <div className="erd-table-body" data-testid={`node-body-${n.id}`}>
              body
            </div>
          </div>
        ))}
        {(edges ?? []).map((e) => (
          <div
            key={e.id}
            data-testid={`edge-${e.id}`}
            data-source={e.source}
            data-target={e.target}
            data-selected={String(e.selected ?? false)}
            data-opacity={String(e.style?.opacity ?? "1")}
            onClick={() => onEdgesChange?.([{ id: e.id, type: "select", selected: true }])}
          />
        ))}
        {children}
      </div>
    ),
    useNodesState: <T,>() => {
      const [s, set] = useState<T[]>([]);
      return [s, set, () => undefined] as const;
    },
    useEdgesState: <T extends { id: string }>() => {
      const [s, set] = useState<T[]>([]);
      const applySelect = (changes: Array<{ id: string; type: string; selected?: boolean }>) => {
        const selected = new Map(changes.map((c) => [c.id, c.selected ?? false]));
        set((prev) =>
          prev.map((e) => (selected.has(e.id) ? { ...e, selected: selected.get(e.id) } : e)),
        );
      };
      return [s, set, applySelect] as const;
    },
  };
}

interface ScaleOptions {
  hubs?: number;
  spokesPerHub?: number;
  islands?: number;
  wideTableColumns?: number;
}

export function scalePayload(options: ScaleOptions = {}) {
  const { hubs = 3, spokesPerHub = 12, islands = 5, wideTableColumns = 40 } = options;

  const column = (name: string, fk = false) => ({
    name,
    data_type: "text",
    description: null,
    is_primary_key: name === "id",
    is_foreign_key: fk,
  });

  const node = (
    id: string,
    name: string,
    columns: ReturnType<typeof column>[],
    resourceType = "model",
  ) => ({
    id,
    name,
    resource_type: resourceType,
    schema_name: "s",
    database: "d",
    columns,
  });

  const nodes: ReturnType<typeof node>[] = [];
  const edges: Array<Record<string, unknown>> = [];

  for (let h = 0; h < hubs; h += 1) {
    const hubId = `model.big.hub_${h}`;
    nodes.push(node(hubId, `hub_${h}`, [column("id")]));
    for (let s = 0; s < spokesPerHub; s += 1) {
      const spokeId = `model.big.spoke_${h}_${s}`;
      nodes.push(node(spokeId, `spoke_${h}_${s}`, [column("id"), column("hub_fk", true)]));
      edges.push({
        id: `e_${h}_${s}`,
        from_id: spokeId,
        to_id: hubId,
        from_column: "hub_fk",
        to_column: "id",
        relationship_type: "fk",
      });
    }
  }

  const wideColumns = [column("id")];
  for (let c = 0; c < wideTableColumns; c += 1) wideColumns.push(column(`col_${c}`));
  const wideId = "model.big.wide_fact";
  nodes.push(node(wideId, "wide_fact", wideColumns));
  edges.push({
    id: "e_wide",
    from_id: wideId,
    to_id: "model.big.hub_0",
    from_column: "col_0",
    to_column: "id",
    relationship_type: "fk",
  });

  const compositeId = "model.big.composite_child";
  nodes.push(
    node(compositeId, "composite_child", [
      column("id"),
      column("part_a", true),
      column("part_b", true),
    ]),
  );
  edges.push({
    id: "e_composite",
    from_id: compositeId,
    to_id: "model.big.hub_1",
    from_column: "part_a",
    to_column: "id",
    from_columns: ["part_a", "part_b"],
    to_columns: ["id", "id"],
    relationship_type: "fk",
  });

  for (let i = 0; i < islands; i += 1) {
    nodes.push(node(`source.big.island_${i}`, `island_${i}`, [column("id")], "source"));
  }

  return {
    nodes,
    edges,
    metadata: { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "big" },
  };
}
