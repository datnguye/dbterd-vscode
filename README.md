# dbterd-vscode

A VS Code extension that turns your dbt project into an interactive ERD — zoom,
pan, click a table to open its SQL, follow FK edges like breadcrumbs. Powered
by [`dbterd`](https://github.com/datnguye/dbterd) under the hood.

## Install

From the VS Code Marketplace: search for **dbterd ERD** and click Install.

Or grab a `.vsix` from the [Releases page](https://github.com/datnguye/dbterd-vscode/releases)
and install with:

```bash
code --install-extension dbterd-vscode-<version>.vsix
```

You'll need Python 3.10+ on `PATH` — the extension spawns a small FastAPI
server that wraps the `dbterd` library.

## Usage

1. Open the Command Palette (`Cmd/Ctrl+Shift+P`).
2. Run **dbterd: Open ERD**.
3. The ERD opens in a new panel. Click a table header to jump to its SQL.
4. Run **dbterd: Refresh ERD** after `dbt compile` / `dbt docs generate` to
   pick up manifest changes.

## Settings

| Setting                  | Default       | Description                                             |
|--------------------------|---------------|---------------------------------------------------------|
| `dbterd.dbtProjectPath`  | `""`          | Absolute path to the dbt project root.                  |
| `dbterd.serverPort`      | `0`           | Port for the local server. `0` = auto-pick.             |
| `dbterd.pythonPath`      | `"python3"`   | Python interpreter used to launch the server.           |

## How it works

Three layers dressed up as one extension:

1. A **FastAPI server** wraps `dbterd` and serves `/erd` as JSON.
2. A **React + `@xyflow/react` webview** renders that JSON as draggable table
   cards with FK edges between columns.
3. A **TypeScript extension host** spawns the server on activate, hosts the
   webview, and pipes click-to-open-SQL messages back to VS Code.

```
┌──────────────────────────────┐
│   VS Code Extension Host     │  activate() → spawn server, open webview
└──────────────┬───────────────┘
               │ child_process
               ▼
┌──────────────────────────────┐
│   dbterd-server (FastAPI)    │  GET /erd → { nodes, edges, … }
└──────────────▲───────────────┘
               │ fetch
┌──────────────┴───────────────┐
│   Webview (React + reactflow)│  renders custom table-card nodes
└──────────────────────────────┘
```

## Contributing

PRs welcome. This repo is built for **agentic development** (Claude Code is a
first-class contributor), but regular human PRs work just as well. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions, the `/erd`
contract rules, and release process.

A standing ovation to the humans who steer the agents (and occasionally remind
them which file the contributor list belongs in). Agents may write the code,
but merges still need a human to click the button — well done, human drivers ❤️

<a href="https://github.com/datnguye/dbterd-vscode/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=datnguye/dbterd-vscode" />
</a>

