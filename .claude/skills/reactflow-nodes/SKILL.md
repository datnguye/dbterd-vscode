---
name: reactflow-nodes
description: Use when building or modifying custom React Flow node components in the webview — especially the table-card node that lists columns inside. Covers registration, handle placement, theming, and performance patterns. Targets @xyflow/react v12 (the successor to the old `reactflow` package).
---

# Custom React Flow nodes (@xyflow/react v12)

We're on `@xyflow/react` v12 — the v11 `reactflow` package is legacy. Imports come from `@xyflow/react`, styles from `@xyflow/react/dist/style.css`.

Each node is a React component. We register them in one `nodeTypes` map passed to `<ReactFlow />`. Do not inline-define node components — that breaks React reconciliation and causes node flicker on every render.

## The table card shape

```
┌─────────────────────────┐
│ 📦 dim_customer          │  ← header: resource icon + name, click → open SQL
├─────────────────────────┤
│ customer_key   varchar  │  ← row per column; PK/FK badge on left
│ customer_name  varchar  │
│ region         varchar  │
└─────────────────────────┘
```

## Rules

1. **Register once.** `nodeTypes = { erdTable: ErdTableNode } as const` declared at module scope. Never inside a component body.
2. **Memoize.** Wrap node components in `React.memo`. React Flow re-renders a lot.
3. **v12 typing.** Custom node components receive `NodeProps<TFlowNode>` where `TFlowNode = Node<YourData, "erdTable">`. The string literal is the `type` key registered in `nodeTypes`.
4. **Handles on columns, not the node.** Edges connect column-to-column. Each column row owns a left and right `<Handle>` with `id={column.name}`. The edge's `sourceHandle` / `targetHandle` references that id.
5. **Theme with CSS variables.** Never hardcode colors. Use `var(--vscode-editor-background)`, `var(--vscode-editor-foreground)`, `var(--vscode-focusBorder)`, etc.
6. **Click-to-open.** Clicking the header posts a message to the extension: `{ type: "openFile", path: node.data.raw_sql_path }`. The extension resolves and opens it.
7. **No layout logic inside nodes.** Positioning is computed once by dagre/elkjs in `layout.ts` before nodes hit React Flow.

## File layout

```
webview/src/components/
├── ErdTableNode.tsx        # the custom node
├── ErdTableNode.css        # scoped styles
├── ColumnRow.tsx           # one row, with PK/FK badge + handles
└── nodeTypes.ts            # the registry
```

## Performance notes

- Don't put the full columns list in `data` if nodes have thousands of columns — virtualize inside the card.
- Use `onlyRenderVisibleElements` on `<ReactFlow />` for large graphs.
- Use the v12 `useNodesState` / `useEdgesState` hooks only when nodes are locally mutable. For read-only ERDs, keep state in a parent `useState`.

## Upstream primitive: `DatabaseSchemaNode`

React Flow ships a ready-made `DatabaseSchemaNode` component (see https://reactflow.dev/ui/components/database-schema-node) that renders exactly our table-card shape: header, row per column, `LabeledHandle` on each side. It's shadcn-flavored and comes with `DatabaseSchemaNodeHeader` / `DatabaseSchemaNodeBody` / `DatabaseSchemaTableRow` / `DatabaseSchemaTableCell` primitives.

We currently hand-roll `ErdTableNode.tsx` so we can theme everything with VS Code CSS variables and avoid pulling shadcn in. If a future feature needs non-trivial node internals (hoverable cells, inline editing, expandable groups), reconsider migrating to the upstream primitive rather than growing ours — the upstream version is maintained by the xyflow team and tracks their API changes.

## Common migration pitfalls from v11 `reactflow`

- `import { Handle, ... } from "reactflow"` → `from "@xyflow/react"`.
- `import "reactflow/dist/style.css"` → `"@xyflow/react/dist/style.css"`.
- `NodeProps<Data>` → `NodeProps<Node<Data, "typeKey">>`.
- Default-exported `ReactFlow` is now a named export: `import { ReactFlow } from "@xyflow/react"`.
