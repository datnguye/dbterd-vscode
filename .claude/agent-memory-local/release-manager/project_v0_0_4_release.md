---
name: v0.0.4 stable release (republished after initial failure)
description: First publish 2026-04-25 failed because extension/package.json was hand-bumped before tagging; redone same day after deleting the empty release and tag
type: project
---

v0.0.4 was eventually published successfully on 2026-04-25 — but only on the second attempt. The first attempt failed publicly visible as an empty Release with no .vsix and nothing on the marketplace.

## What happened

**First attempt (failed):** A pre-release commit `e1b8ec1` ("chore: bump version to 0.0.4") manually set `extension/package.json` to `0.0.4`. The release tag was created at that commit. The workflow's `npm version --no-git-tag-version "0.0.4"` step then errored with `Version not changed` because the file already held that value, and the entire job aborted before packaging. CI run: 24922728919.

**Recovery:** Reverted (well, an unrelated `chore: mem` commit `aab79e3` accidentally reverted `package.json` back to `0.0.0`). Deleted the empty `v0.0.4` Release + tag with `gh release delete v0.0.4 --yes --cleanup-tag`. Re-created the Release at `aab79e3` with the same notes via `gh release create v0.0.4 --target aab79e3 --notes-file ...`. The second workflow run (24922929778) succeeded — .vsix uploaded, marketplace published.

**Why deleting the public tag was acceptable here:** The first attempt produced no shipped artifact. No user could have downloaded the v0.0.4 .vsix or installed it from the marketplace because neither existed. Force-rewriting a tag that *had* shipped artifacts would not be acceptable — prefer cutting a new patch version in that case.

## How to apply

- The release workflow is the **only** thing that should write to `extension/package.json`'s `version` field. Never hand-bump it before cutting a release. This is now codified in the `release` skill (`.claude/skills/release/SKILL.md`) as the cardinal rule.
- Expected pre-release state: `extension/package.json` is at `0.0.0` (or the previous shipped version) — anything *less than* the target tag.
- If a publish fails and produced no artifacts, delete + recreate is safe. If it shipped anything, prefer rolling forward to the next patch version instead.

Key facts:
- Tag: v0.0.4 (now at commit aab79e3)
- Final Release URL: https://github.com/datnguye/dbterd-vscode/releases/tag/v0.0.4
- Failed CI run: 24922728919
- Successful CI run: 24922929778
- .vsix: dbterd-vscode-0.0.4.vsix, 243 KB, sha256:699a8cc9edcc330d7a4e178e0731ecd204f9e6602f068f0c8f6183a3c67ed5c9
