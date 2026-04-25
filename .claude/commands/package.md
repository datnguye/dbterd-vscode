---
description: Build a .vsix locally for ad-hoc testing. Releases are tag-driven (see /release or the release-manager agent).
---

Invoke the **`package`** skill — it holds the full procedure (build/sync pipeline via `task package`, sanity-checking the bundled server source, and the boundary with the release flow).

This produces a local `.vsix` for sideloading. It does not push, tag, or publish — for that, use `/release` or the `release-manager` agent.
