---
description: Cut a release by creating a GitHub Release. CI handles packaging + marketplace publish.
argument-hint: "<bump>   e.g. patch | minor | major | 1.2.3 | 1.2.3-rc.1"
---

Delegate to the `release-manager` agent. Pass along `$ARGUMENTS` as the desired bump.

The agent will:
1. Pre-flight (clean tree, on main, CI green)
2. Propose the version and ask you to confirm
3. Build human-readable release notes by reading `git log <prev-tag>..HEAD` and `git diff <prev-tag>..HEAD --stat`, grouping commits into **Highlights**, **Features**, **Fixes**, **Refactors**, **Tests**, and **Docs** sections (omit empty sections). Each entry should explain user-visible impact, not just the commit subject. Append GitHub's `Full Changelog: …compare/<prev>...<new>` link at the bottom.
4. Run `gh release create vX.Y.Z --notes-file <generated-notes>.md` (add `--prerelease` for pre-releases). Do **not** use `--generate-notes` — the agent supplies the notes directly.

CI (`.github/workflows/release.yml`) takes over from the `release: published` event: builds webview, packages `.vsix`, uploads it to the Release, and publishes to the marketplace (skipped for pre-releases).

We do not maintain a `CHANGELOG.md` — the release notes on GitHub are the changelog.
