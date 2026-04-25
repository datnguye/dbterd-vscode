---
description: Build a .vsix locally for ad-hoc testing. Releases are tag-driven (see /release or the release-manager agent).
---

Produce a local `.vsix` for sideloading. This is for testing — real releases happen via CI on tag push.

The canonical recipe lives in `Taskfile.yml` so the slash command and manual workflow stay aligned. The Task target already (a) builds the webview and rsyncs `webview/dist/` into `extension/media/`, (b) rsyncs `server/src/` and copies `pyproject.toml`/`uv.lock` into `extension/server-src/`, and (c) runs `vsce package`. Skipping the `server-src` sync silently ships a stale Python server inside the .vsix — do not reimplement the steps inline.

Steps (sequential):

1. `task install:webview install:extension` — make sure both workspaces have node_modules. (Skip if already installed; `npm ci` is invoked by Task as needed.)
2. `task package` — runs the full build + sync + vsce pipeline.
3. Print the resulting `.vsix` path and size (`ls -lh extension/*.vsix`).
4. Sanity-check that `extension/server-src/src/dbterd_server/logging_setup.py` matches `server/src/dbterd_server/logging_setup.py` (e.g. `diff` them). If they differ, the rsync did not run — investigate before reporting success.

Warnings to show:
- If `extension/package.json` version matches a published tag, warn the user that installing this .vsix may confuse version tracking.
- Do NOT push, tag, or publish. Direct the user to the `release-manager` agent for that.
