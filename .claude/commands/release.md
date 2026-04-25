---
description: Cut a release by creating a GitHub Release. CI handles packaging + marketplace publish.
argument-hint: "<bump>   e.g. patch | minor | major | 1.2.3 | 1.2.3-rc.1"
---

Invoke the **`release`** skill — it holds the full procedure (pre-flight, version selection, release-notes generation, the cardinal "never hand-bump `extension/package.json`" rule, and post-publish verification).

Pass `$ARGUMENTS` as the desired bump.

For complex multi-step releases or when you want to delegate the whole flow, use the `release-manager` agent instead — it carries local memory of previous releases and follows the same skill.
