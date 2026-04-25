# Contributing to dbterd-vscode

Thanks for your interest in making dbt ERDs less painful to look at. This repo
is built for **agentic development** — Claude Code is a first-class contributor
alongside humans. You can work either way; the tooling is the same.

- [Contributing to dbterd-vscode](#contributing-to-dbterd-vscode)
  - [Code of Conduct](#code-of-conduct)
  - [Ways to Contribute](#ways-to-contribute)
  - [Development Setup](#development-setup)
  - [Repo Layout](#repo-layout)
  - [The /erd Contract](#the-erd-contract)
  - [Daily Workflows](#daily-workflows)
  - [Coding Conventions](#coding-conventions)
    - [Python (server/)](#python-server)
    - [TypeScript (extension/ and webview/)](#typescript-extension-and-webview)
    - [General](#general)
  - [Tests](#tests)
  - [Commit \& PR Guidelines](#commit--pr-guidelines)
  - [Releases](#releases)
  - [Agentic Development](#agentic-development)
    - [Agent memory](#agent-memory)
    - [External docs via context7](#external-docs-via-context7)
  - [Reporting Issues](#reporting-issues)

## Code of Conduct

Be kind, be specific, assume good faith. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/). If something
feels off, open an issue or reach out to the maintainer privately.

## Ways to Contribute

- **Bug reports** — with a minimal reproducing dbt project if possible
- **Feature requests** — describe the ERD workflow you want, not the
  implementation
- **Pull requests** — see below; start small if it's your first time in the
  repo
- **Docs** — humanized prose with the occasional dry joke is encouraged

## Development Setup

You need:

- **Node 20+**
- **Python 3.10+** and [`uv`](https://github.com/astral-sh/uv)
- [`task`](https://taskfile.dev) (a.k.a. go-task)
- VS Code (for the Extension Development Host)

```bash
git clone https://github.com/datnguye/dbterd-vscode.git
cd dbterd-vscode
task install          # installs all three workspaces
task dev              # runs server + webview + extension watchers
# Hit F5 in VS Code to launch the Extension Development Host.
```

`task --list` shows everything else.

## Repo Layout

```
dbterd-vscode/
├── extension/   # VS Code extension host (TypeScript, esbuild-bundled)
├── webview/     # React + @xyflow/react UI, bundled into extension/media/
├── server/      # FastAPI shim around the dbterd Python API (uv-managed)
└── .claude/     # Agents, skills, commands, hooks — see "Agentic Development"
```

Each workspace is independently buildable. The extension bundles `webview/dist/`
into `extension/media/` at package time.

## The /erd Contract

All three layers share one JSON shape. The Pydantic models in
`server/src/dbterd_server/schemas.py` are the **source of truth** — TypeScript
types in `webview/src/types/erd.ts` are generated, never hand-edited.

Before modifying the contract in any layer, read
`.claude/skills/erd-contract/SKILL.md` and update the other two layers in the
same PR. Drift between layers is the single most likely source of bugs.

After changing `schemas.py`, regenerate the TS types:

```bash
task sync-contract
```

## Daily Workflows

| Goal                                  | Task                       | Slash command     |
|---------------------------------------|----------------------------|-------------------|
| Install all three workspaces          | `task install`             | —                 |
| Run all watchers (server/webview/ext) | `task dev`                 | `/dev`            |
| Run every test suite                  | `task test`                | `/test`           |
| Lint + typecheck                      | `task lint`                | —                 |
| Build the `.vsix` locally             | `task package`             | `/package`        |
| Regenerate TS types from schemas      | `task sync-contract`       | `/sync-contract`  |
| Scaffold a new endpoint               | —                          | `/new-endpoint`   |
| Cut a release                         | —                          | `/release`        |

## Coding Conventions

### Python (server/)

- `uv run ruff format && uv run ruff check` must pass.
- **100% test coverage** — enforced in CI.
- No relative imports. All imports at module top.
- One class per file (exception: related exception classes may share a file).
- Specific exception types in `try/except`, never bare `except:` or
  `except Exception:`.
- Pydantic v2. Use `model_dump()`, not `dict()`.
- Routes are `async def` even when the body is synchronous — consistent surface.
- No nested functions or classes; define at module level.

### TypeScript (extension/ and webview/)

- `npm run typecheck` must pass in both workspaces.
- No `any`. Model webview↔extension messages with a discriminated union.
- The strict `tsconfig.json` is the lint budget — there's no ESLint layer (yet).
- For React Flow nodes: module-scoped `nodeTypes` registry, `React.memo`
  components, typing via `Node<Data, 'typeKey'>` + `NodeProps<NodeType>`. See
  `.claude/skills/reactflow-nodes/SKILL.md`.
- Theme with VS Code CSS variables (`--vscode-*`), not hardcoded colors.

### General

- **No backwards-compatibility shims** unless explicitly requested — this is a
  fresh codebase.
- **Don't add features, refactor, or introduce abstractions beyond what the
  task requires.**
- **Default to no code comments.** Only add a comment when the *why* is
  non-obvious (a hidden constraint, a workaround for a known bug). Well-named
  identifiers already explain the *what*.

## Tests

Run everything at once:

```bash
task test
```

Or individually:

```bash
task test:server       # pytest, 100% coverage gate
task test:webview      # vitest
task test:extension    # typecheck (no runtime tests yet)
```

CI runs all three on every PR.

## Commit & PR Guidelines

- Keep commits focused and small. Prefer a new commit over amending a pushed
  one.
- Commit message style: imperative mood, present tense ("Add X", not "Added X"
  / "Adds X"). A short subject plus a body explaining *why* if the change isn't
  obvious.
- PRs should explain the *why* in the description and reference any related
  issue. GitHub's auto-generated release notes pick up PR titles — make them
  readable.
- If your change touches the `/erd` contract, the PR must include updates to
  all three layers.
- CI must be green before merge.

## Releases

Release-driven — creating a GitHub Release creates the tag and triggers CD:

```bash
gh release create v0.1.0 --generate-notes --title "v0.1.0"
# pre-release (skips marketplace publish):
gh release create v0.1.0-rc.1 --generate-notes --prerelease --title "v0.1.0-rc.1"
```

CD (`.github/workflows/release.yml`) builds the webview, packages the `.vsix`,
uploads it to the Release, and publishes to the VS Code Marketplace (skipped
for pre-releases). Release notes come from `--generate-notes` — we don't keep
a `CHANGELOG.md`.

Maintainers can also invoke the `release-manager` agent or `/release` slash
command from Claude Code, which handles pre-flight checks and version bumping.

## Agentic Development

This repo is wired up for Claude Code. The mental model is three tools:

- **Agents** (`.claude/agents/`) — delegated workers with their own context
  window. One per layer (`extension-dev`, `webview-dev`, `server-dev`) plus a
  `release-manager`. Cross-layer refactors: delegate to the relevant per-layer
  agent.
- **Skills** (`.claude/skills/`) — knowledge Claude pulls in automatically when
  relevant. `erd-contract` is the important one: it keeps all three layers
  honest when the JSON shape changes.
- **Commands** (`.claude/commands/`) — user-invoked workflows: `/dev`, `/test`,
  `/package`, `/release`, `/new-endpoint`, `/sync-contract`.
- **Hooks** (`.claude/hooks/`) — shell scripts the harness runs on tool events.
  `block-secrets.sh` is a PreToolUse guard that prevents reads/writes/greps
  against `.env`, `*.pem`, `*.key`, `id_rsa`, etc. `post-edit-check.sh` runs a
  fast linter on the file just edited.

### Agent memory

Per-layer agents use `memory: project` — their scratchpads are committed to
this repo and shared with teammates. The `release-manager` uses `memory: local`
— personal, gitignored. Because project memory lands in git:

- **Never** write secrets, tokens, or customer data into agent memory.
- **Never** write information that's only true for your local setup (ports
  you picked, paths to personal dbt projects).
- **Do** write durable knowledge: contract versions, architectural decisions,
  dbterd quirks you discovered, recurring pitfalls.

Agents curate their own `MEMORY.md` index — don't hand-edit it.

### External docs via context7

`context7` is wired in `.mcp.json`. Prefer it over guessing from training data
when library behavior matters (reactflow, VS Code API, FastAPI, dbterd).

## Reporting Issues

- **Bug**: include VS Code version, OS, dbt adapter, and a minimal repro if you
  can. The smaller the manifest.json, the faster the fix.
- **Security**: don't file a public issue. Email the maintainer directly
  (see `package.json`) or open a GitHub Security Advisory.

Thanks for contributing.
