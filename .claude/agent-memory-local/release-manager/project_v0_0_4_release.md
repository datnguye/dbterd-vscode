---
name: v0.0.4 stable release
description: Fourth stable release cut 2026-04-25; version bump committed directly to main, clean single-attempt publish
type: project
---

Released v0.0.4 on 2026-04-25 as a stable (non-prerelease) GitHub Release.

**Why:** New features in this release: progress notifications, filter highlighting in ERD, and a details pane for node column metadata.

**How to apply:** This release followed the same pattern as v0.0.3 — bump `extension/package.json` version locally, commit directly to main, push, then `gh release create` with `--notes-file`. No pre-release flag. CI workflow `release.yml` triggered immediately and was `in_progress` within seconds of release creation.

Key facts:
- Tag: v0.0.4
- Commit: e1b8ec1 (chore: bump version to 0.0.4)
- Release URL: https://github.com/datnguye/dbterd-vscode/releases/tag/v0.0.4
- CI run ID: 24922728919 (in_progress at time of release cut)
- Highlights: progress notifications, ERD filter highlighting, details pane
