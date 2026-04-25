---
name: package
description: Use when building a local .vsix of the VS Code extension for sideloading or ad-hoc testing. Covers the build/sync pipeline, sanity-checking the bundled server source, and the boundary with the release flow (this skill never publishes).
---

# Packaging dbterd-vscode locally

Produce a `.vsix` for sideloading or sharing test builds. **This is for testing — real releases happen via CI on tag push** (see the `release` skill / `release-manager` agent).

## What goes into a .vsix

The extension `.vsix` is not just `extension/`. The build pipeline assembles three sources:

1. **Webview bundle** — `webview/dist/` rsynced into `extension/media/`.
2. **Python server source** — `server/src/` plus `pyproject.toml` and `uv.lock` rsynced into `extension/server-src/`. The extension spawns a local `uv` to run this server at activation; if it's stale, the installed extension talks to an old server.
3. **Extension TS bundle** — esbuild output from `extension/src/`.

Skipping any of these silently ships a broken or stale build. The canonical recipe lives in `Taskfile.yml` so the slash command, the agent, and manual runs stay aligned. **Do not reimplement the steps inline** — call `task` targets.

## Steps (sequential)

1. **Install** — `task install:webview install:extension`. Idempotent; `npm ci` runs only if `node_modules` is missing or out of date.
2. **Package** — `task package`. Runs the full build + sync + `vsce package` pipeline.
3. **Report** — `ls -lh extension/*.vsix`. Print path and size so the user can locate it for sideloading.
4. **Sanity-check the server bundle** — diff a known file from both sides:

   ```bash
   diff -q server/src/dbterd_server/logging_setup.py \
          extension/server-src/src/dbterd_server/logging_setup.py
   ```

   If the files differ, the rsync did not run (or ran against a stale `server/src/`). Investigate before reporting success — a passing `task package` with a stale server bundle is a silent failure.

## Warnings to surface

- **If `extension/package.json` version matches a published tag** (`gh release view v$(node -p "require('./extension/package.json').version")` returns a real release), tell the user that installing this `.vsix` may confuse VS Code's update tracking versus the marketplace build. Suggest bumping the version locally for the test build, or uninstalling the marketplace copy first.
- **If the working tree is dirty**, the .vsix reflects uncommitted changes. Mention this — it's fine for ad-hoc testing but a footgun if the user thinks they're packaging a known commit.

## Boundaries

This skill **never**:

- Pushes commits.
- Creates tags.
- Creates GitHub Releases.
- Runs `vsce publish`.
- Touches `extension/package.json`'s `version` field. (The release workflow does that from the tag — see the `release` skill.)

For any of those, redirect to the `release` skill or the `release-manager` agent.
