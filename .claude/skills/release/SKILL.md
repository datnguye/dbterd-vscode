---
name: release
description: Use when cutting a release of the VS Code extension — creating a GitHub Release that triggers the marketplace publish workflow. Covers version selection, the "do not hand-bump package.json" rule, release-notes generation, and post-publish verification.
---

# Releasing dbterd-vscode

Releases are **GitHub-Release-driven**. You create a GitHub Release (which also creates the git tag); CI fires on the `release: published` event and does everything else. Your job is to set up the Release correctly. The automation does the rest.

What CI does on `release: published` (`.github/workflows/release.yml`):

1. Checks out the tag.
2. Builds the webview and rsyncs `webview/dist/` into `extension/media/`.
3. Bundles `server/src/` and `pyproject.toml`/`uv.lock` into `extension/server-src/`.
4. Runs `npm version --no-git-tag-version <version-from-tag>` against `extension/package.json`.
5. Packages the `.vsix` (passing `--pre-release` if the Release is marked pre-release).
6. Uploads the `.vsix` as a Release asset.
7. Publishes to the VS Code Marketplace — **skipped** when the Release is marked pre-release.

Release notes live in the GitHub Release body — we do not maintain a `CHANGELOG.md`.

## The cardinal rule: never hand-bump `extension/package.json`

The release workflow is the **only** thing that should write to `extension/package.json`'s `version` field. The tag is the source of truth; the workflow runs `npm version --no-git-tag-version <tag>` to set it.

If you pre-bump the file before tagging, `npm version` errors with `Version not changed` and the entire publish job aborts. The .vsix is never built; the marketplace is never updated.

This is exactly how **v0.0.4 broke** (2026-04-25, CI run 24922728919): commit `e1b8ec1` set `extension/package.json` to `0.0.4`, the tag was created at that commit, the workflow checked it out, and the bump step failed. The Release object exists but is empty.

**Expected pre-release state:** `extension/package.json` is at `0.0.0` (or any version *strictly less than* the new tag). Leave the file untouched between releases.

## Pre-flight (do these in order, stop on the first failure)

1. `git status` — must be clean.
2. Current branch is `main` (unless the user explicitly says otherwise).
3. `git pull --ff-only` — avoid tagging a stale commit.
4. `gh run list --branch main --limit 1` — most recent CI run on `main` is green.
5. `node -p "require('./extension/package.json').version"` — record this. It MUST be different from (and ideally lower than) the version you are about to release. If it equals the target version, **stop and tell the user to revert the bump first**.
6. `git fetch --tags && git describe --tags --abbrev=0` — read the latest existing tag. The new version must be greater than this.

## Choosing the version

- Read the user's argument (e.g. `patch`, `minor`, `major`, or an explicit `1.2.3` / `1.2.3-rc.1`).
- For `patch`/`minor`/`major`, compute against the latest existing tag (not against `package.json`).
- **Always confirm the exact version string with the user before creating the Release.** Show them: latest tag → proposed new tag.

## Building release notes

Generate notes from the diff vs the previous tag — do NOT use `gh release create --generate-notes` (it produces a wall of commit subjects).

1. `git fetch --tags` so all tags are local.
2. `git log <prev-tag>..HEAD --pretty=format:"%h|%s" --no-merges` — commit list.
3. `git diff <prev-tag>..HEAD --stat` — gauge scope (server/webview/extension/docs).
4. Group commits by Conventional-Commit prefix into the sections below; omit empty sections:
   - **Highlights** — 2–4 bullets on user-visible wins, written in plain language. This is the part a maintainer would post in Slack — not commit subjects.
   - **Features** (`feat:`)
   - **Fixes** (`fix:`)
   - **Refactors** (`refactor:`)
   - **Tests** (`test:` or test-only commits)
   - **Docs** (`docs:`)
5. Each entry should explain user-visible impact, not paste the commit subject. Append the commit short SHA in parentheses for traceability.
6. End with: `**Full Changelog**: https://github.com/datnguye/dbterd-vscode/compare/<prev-tag>...vX.Y.Z`.
7. Write the notes to `/tmp/vX.Y.Z-notes.md`.

## Cutting the release

Show the user the proposed notes and **ask once more** before creating the Release (this is what triggers publishing).

```bash
# Stable
gh release create vX.Y.Z --notes-file /tmp/vX.Y.Z-notes.md --title "vX.Y.Z"

# Pre-release (skips marketplace publish, passes --pre-release to vsce)
gh release create vX.Y.Z --notes-file /tmp/vX.Y.Z-notes.md --prerelease --title "vX.Y.Z"
```

If a Release was already created with auto-generated notes, edit it in place rather than recreating:

```bash
gh release edit vX.Y.Z --notes-file /tmp/vX.Y.Z-notes.md
```

## Post-publish verification

1. Print the Release URL: `gh release view vX.Y.Z --web` (or non-web for the user to click).
2. Watch the workflow: `gh run list --workflow release.yml --limit 1`.
3. Once it completes, confirm the `.vsix` is attached to the Release and the marketplace listing shows the new version (skip marketplace check for pre-releases).

## Recovering from a failed publish

If the workflow fails:

1. **Read the failure** — `gh run view <run-id> --log-failed`.
2. The most likely cause is the "Install & version extension" step failing on `Version not changed`. That means `extension/package.json` was pre-bumped on the commit the tag points at.
3. Do **not** force-move a published tag or delete a published Release casually — these are public refs. Prefer cutting a new patch version (e.g. v0.0.4 broken → ship v0.0.5 from a clean `main`) over rewriting history.
4. Document the failure in agent memory so the same trap doesn't catch the next release.

## Pre-releases

Tick the "pre-release" checkbox (`--prerelease` flag). The CI workflow reads `github.event.release.prerelease` and:

- Passes `--pre-release` to `vsce package`.
- **Skips** the marketplace publish step.

Useful for sharing a test build without shipping to the stable marketplace channel.

## Never

- Create the Release without explicit user confirmation.
- Force-push or delete a published tag / Release.
- Tag from a dirty working tree.
- Hand-bump `extension/package.json` (see "cardinal rule" above).
- Use `--generate-notes` — supply notes via `--notes-file`.
- Maintain or commit a `CHANGELOG.md` — release notes are the Release body.
