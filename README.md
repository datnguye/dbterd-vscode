<p align="center">
  <img src="./extension/icon.png" alt="dbt ERD logo" width="96" height="96"/>
</p>

<h1 align="center">dbt ERD</h1>

<p align="center">
  A VS Code extension that turns your dbt project into an interactive ERD — zoom,
  pan, click a table to open its SQL, follow FK edges like breadcrumbs. Powered
  by <a href="https://github.com/datnguye/dbterd"><code>dbterd</code></a> under the hood.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=datnguye.dbterd-vscode">
    <img alt="VS Code Marketplace version" src="https://img.shields.io/visual-studio-marketplace/v/datnguye.dbterd-vscode?style=flat-square&color=FF694A&label=marketplace"/>
  </a>
  <a href="https://github.com/datnguye/dbterd-vscode/actions/workflows/ci.yml">
    <img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/datnguye/dbterd-vscode/ci.yml?style=flat-square&label=ci"/>
  </a>
  <a href="https://github.com/datnguye/dbterd-vscode/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/datnguye/dbterd-vscode?style=flat-square&label=release"/>
  </a>
  <a href="https://github.com/datnguye/dbterd-vscode/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/datnguye/dbterd-vscode?style=flat-square"/>
  </a>
  <a href="https://github.com/datnguye/dbterd-vscode/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/datnguye/dbterd-vscode?style=flat-square&color=FF694A"/>
  </a>
</p>

![dbt ERD rendering the jaffle-shop marts with a .dbterd.yml config side-by-side](./docs/images/erd-showcase.png)

## Install

From the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=datnguye.dbterd-vscode):
search for **dbt ERD** and click Install, or run:

```bash
code --install-extension datnguye.dbterd-vscode
```

You'll need Python 3.10+ on `PATH` — the extension spawns a small FastAPI
server that wraps the `dbterd` library.

## Usage

1. Open the Command Palette (`Cmd/Ctrl+Shift+P`).
2. Run **dbterd: Open ERD**.
3. The ERD opens in a new panel. Click a table header to jump to its SQL.
4. Run **dbterd: Refresh ERD** after `dbt compile` / `dbt docs generate` to
   pick up manifest changes, or after editing `.dbterd.yml`.

## Settings

| Setting                  | Default       | Description                                             |
|--------------------------|---------------|---------------------------------------------------------|
| `dbterd.dbtProjectPath`  | `""`          | Absolute path to the dbt project root.                  |
| `dbterd.serverPort`      | `0`           | Port for the local server. `0` = auto-pick.             |
| `dbterd.pythonPath`      | `""`          | Optional override for the base Python interpreter. Leave empty to auto-detect (dbt project `.venv` → `$VIRTUAL_ENV` → `python3` on PATH). |

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

## Support

⭐ **If this extension is useful, please [star the repo on GitHub](https://github.com/datnguye/dbterd-vscode)** — it helps others discover it and keeps the maintainer motivated to keep shipping.

🍰 And if this extension saves you from squinting at `manifest.json` at 2 AM,
consider sponsoring a coffee — or, in 2026 currency, roughly 1M Claude tokens.
Either way, the late-night bug hunts stay fueled and the agents stay fed.

<a href="https://buymeacoffee.com/datnguye">
  <img src="https://img.shields.io/badge/Buy_me_tokens-fuel_an_agent-FF694A?style=flat-square&labelColor=2b1810&logo=buymeacoffee&logoColor=white" alt="Buy me tokens" height="50" />
</a>

<!-- GitAds-Verify: UVZO3GJYWWTVFBTLLX7IJOBV3HYEAXYT -->