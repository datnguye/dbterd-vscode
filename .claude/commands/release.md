---
description: Cut a release by creating a GitHub Release. CI handles packaging + marketplace publish.
argument-hint: "<bump>   e.g. patch | minor | major | 1.2.3 | 1.2.3-rc.1"
---

Delegate to the `release-manager` agent. Pass along `$ARGUMENTS` as the desired bump.

The agent will:
1. Pre-flight (clean tree, on main, CI green)
2. Propose the version and ask you to confirm
3. Run `gh release create vX.Y.Z --generate-notes` (add `--prerelease` for pre-releases)

CI (`.github/workflows/release.yml`) takes over from the `release: published` event: builds webview, packages `.vsix`, uploads it to the Release, and publishes to the marketplace (skipped for pre-releases).

Release notes come from GitHub's auto-generated notes — we do not maintain a `CHANGELOG.md`.
