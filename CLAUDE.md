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
- TypeScript: `npm run typecheck` and `npm run lint` (ESLint flat config) must pass in both `extension/` and `webview/`. ESLint covers what the strict `tsconfig.json` can't (floating promises, unused vars, react-hooks/exhaustive-deps).
- No relative imports in Python. All imports at module top.
- No backward-compat shims unless explicitly asked.
- Specific exception types in try/except.

## Workspace structure

Both TS workspaces follow the same shape — source under `src/`, tests under `tests/unit/`, mirroring the source tree. Tests are excluded from production bundles (`vite build`, `esbuild`, the `.vsix` via `.vscodeignore`).

```
extension/
├── src/
│   ├── extension.ts                 # activate/deactivate
│   ├── server/{index,handshake,health,kill}.ts
│   ├── provision/{index,discover-python,manifest,run}.ts
│   ├── webview/{index,html,csp}.ts
│   └── messaging/{protocol,bus}.ts  # protocol mirrors webview/src/messaging/protocol.ts
├── tests/unit/                      # vitest, node env, no VS Code dep
└── src/test/suite/e2e.test.ts       # mocha + @vscode/test-electron

webview/
├── src/
│   ├── App.tsx
│   ├── api/{index,client,errors}.ts # ErdApiError, classifyErdError, remediationHint
│   ├── components/{ErdTableNode,Toolbar,icons,...}/
│   ├── components/composite-edge/{index,geometry}.tsx
│   ├── layout/{index,dagre,dimensions,handles}.ts
│   ├── messaging/protocol.ts        # mirrors extension/src/messaging/protocol.ts
│   └── types/{erd,flow}.ts          # erd.ts is auto-generated
└── tests/unit/                      # vitest, jsdom, @testing-library/react
```

### Path aliases

Both workspaces resolve `@/` to `src/` via `tsconfig.json` `paths` + a matching vite/vitest `resolve.alias`. Tests import via `@/api`, `@/server/handshake`, etc., not via `../../../src/...`. esbuild auto-honors the tsconfig paths for the runtime bundle.

### Shared protocol

The webview ↔ extension postMessage protocol lives in **two mirrored files**: `extension/src/messaging/protocol.ts` and `webview/src/messaging/protocol.ts`. They must stay byte-identical (modulo the leading "CANONICAL:" comment direction). Until a shared workspace package exists, treat changes as a contract update — touch both files in the same commit.

### Server URL / CSP coupling

`SERVER_URL_PATTERN` in the protocol module is also the CSP allow-list pattern (`extension/src/webview/csp.ts` imports it). If you loosen the regex, you loosen what `connect-src` will accept in the rendered webview.

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
