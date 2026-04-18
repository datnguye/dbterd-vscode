---
name: v0.0.2 stable release
description: Second stable release of dbterd-vscode, published 2026-04-18
type: project
---

v0.0.2 was cut as a stable (non-prerelease) GitHub Release on 2026-04-18.

Release was created cleanly in a single attempt. The `release.yml` workflow started immediately on `release: published` event (run 24599125319).

**Why:** Patch bump from v0.0.1 to ship the fixes and docs changes committed after the first release (notably `fix(ci): drop --readme-path in release packaging` and initial release documentation).

**How to apply:** Next release should bump from v0.0.2. Pre-flight: confirm CI on main is green and working tree is clean.
