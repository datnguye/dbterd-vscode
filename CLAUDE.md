# dbterd-vscode

VS Code extension that visualizes dbt projects as an interactive ERD. Spins up a local FastAPI server wrapping the `dbterd` Python API, renders nodes/edges in a React + `@xyflow/react` webview.

## Repo layout

```
dbterd-vscode/
├── extension/   # VS Code extension host (TypeScript) — activates server, opens webview
├── webview/     # React + @xyflow/react UI, bundled into extension at package time
├── server/      # FastAPI shim around the dbterd Python API (uv-managed)
└── .claude/     # Agents, skills, commands for agentic development
```

Each workspace is independently buildable. The extension bundles `webview/dist/` into `extension/media/` during packaging.

## The /erd contract

All three layers share one JSON shape for nodes and edges. Before modifying the contract in any layer, read `.claude/skills/erd-contract/SKILL.md` and update the other two layers in the same change. Drift between layers is the single most likely source of bugs.

## Workflows

Day-to-day work is driven by `task` (root-level `Taskfile.yml`). Slash commands wrap the same targets so the agentic and manual paths stay aligned.

| Goal                                  | Task                       | Slash command     |
|---------------------------------------|----------------------------|-------------------|
| Install all three workspaces          | `task install`             | —                 |
| Run all watchers (server/webview/ext) | `task dev`                 | `/dev`            |
| Run every test suite                  | `task test`                | `/test`           |
| Lint + typecheck                      | `task lint`                | —                 |
| Build the `.vsix` locally             | `task package`             | `/package`        |
| Regenerate TS types from schemas      | `task sync-contract`       | `/sync-contract`  |
| Scaffold a new endpoint               | —                          | `/new-endpoint`   |

`task --list` shows everything. Per-workspace targets exist too (`task test:server`, `task dev:webview`, etc.).

## Conventions

- Python: `uv run ruff format && uv run ruff check` must pass. 100% test coverage.
- TypeScript: `npm run typecheck` must pass in both `extension/` and `webview/` (no ESLint layer yet — the strict `tsconfig.json` is the lint budget).
- No relative imports in Python. All imports at module top.
- No backward-compat shims unless explicitly asked.
- Specific exception types in try/except.

## Agent memory

The three layer agents (`extension-dev`, `webview-dev`, `server-dev`) use `memory: project` — their scratchpads are committed to this repo and shared with teammates. The `release-manager` uses `memory: local` — personal, gitignored. Because project memory lands in git:

- Never write secrets, tokens, or customer data into agent memory.
- Never write information that's only true for your local setup (port numbers you picked, paths to personal dbt projects).
- Write things that remain true across sessions: contract versions, architectural decisions, dbterd quirks you discovered, recurring pitfalls.

Agents curate their own `MEMORY.md` index — do not hand-edit it.

## External docs via context7 MCP

`context7` is configured in `.mcp.json`. Use it to pull up-to-date docs for `@xyflow/react`, the VS Code extension API, FastAPI, and `dbterd` before writing non-trivial integration code. Prefer context7 over guessing from training data when library behavior matters.

## Delegating work

- Cross-layer refactors: delegate to the relevant per-layer agent (`extension-dev`, `webview-dev`, `server-dev`).
- Contract changes: always invoke the `erd-contract` skill first.
- Release cuts: `release-manager` agent.
