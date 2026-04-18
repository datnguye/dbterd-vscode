---
description: Build a .vsix locally for ad-hoc testing. Releases are tag-driven (see /release or the release-manager agent).
---

Produce a local `.vsix` for sideloading. This is for testing — real releases happen via CI on tag push.

Steps (sequential):

1. `cd webview && npm ci && npm run build`
2. `rsync -a --delete webview/dist/ extension/media/`
3. `cd extension && npm ci`
4. `cd extension && npx --yes @vscode/vsce package --no-dependencies`
5. Print the resulting `.vsix` path and size.

Warnings to show:
- If `extension/package.json` version matches a published tag, warn the user that installing this .vsix may confuse version tracking.
- Do NOT push, tag, or publish. Direct the user to the `release-manager` agent for that.
