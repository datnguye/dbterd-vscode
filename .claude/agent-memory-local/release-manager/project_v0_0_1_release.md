---
name: v0.0.1 stable release
description: First stable release of dbterd-vscode, published 2026-04-18
type: project
---

v0.0.1 was cut as a stable (non-prerelease) GitHub Release on 2026-04-18. The first attempt failed in CI at the "Package .vsix" step (vsce `--readme-path ../README.md` walked outside the VSIX root). The fix — a "Copy root README into extension" step in `.github/workflows/release.yml` — was committed to main at `04d36bc`. The release was deleted and recreated so the tag now points to `04d36bc`.

**Why:** First public release of the extension. User explicitly chose stable track so it publishes to the VS Code Marketplace.

**How to apply:** Next release should bump from v0.0.1. Pre-flight for that release should confirm CI on main is green and the tree is clean. If a release tag ever needs repointing, use `gh release delete vX.Y.Z --yes --cleanup-tag` then `git tag -d vX.Y.Z` (if local), then recreate with `gh release create vX.Y.Z --target main`.
