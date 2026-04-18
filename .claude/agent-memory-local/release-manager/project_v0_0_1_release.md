---
name: v0.0.1 stable release
description: First stable release of dbterd-vscode, published 2026-04-18
type: project
---

v0.0.1 was cut as a stable (non-prerelease) GitHub Release on 2026-04-18.

**First attempt** failed in CI at the "Package .vsix" step (vsce `--readme-path ../README.md` walked outside the VSIX root). Fix: added a "Copy root README into extension" step in the release workflow (`04d36bc`). That release was deleted and recut.

**Second attempt** also failed at the "Package .vsix" step — vsce's `--readme-path` flag could not resolve the path even after the copy step. Fix: `c5c42b0` dropped `--readme-path` entirely, relying on vsce auto-detecting the README copied into `extension/`. The release was again deleted (`gh release delete v0.0.1 --yes --cleanup-tag`) and recreated so the tag now points to `c5c42b0`.

**Why:** First public release of the extension. User explicitly chose stable track so it publishes to the VS Code Marketplace.

**How to apply:** Next release should bump from v0.0.1. Pre-flight for that release should confirm CI on main is green and the tree is clean. If a release tag ever needs repointing, use `gh release delete vX.Y.Z --yes --cleanup-tag` then `git tag -d vX.Y.Z` (if local), then recreate with `gh release create vX.Y.Z --target main`.
