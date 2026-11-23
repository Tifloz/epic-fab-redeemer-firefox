# CI and Automated Firefox Releases Design

## Goal

Add a small, reproducible CI pipeline and automate public GitHub releases for Firefox add-on versions after Mozilla has approved and signed them on AMO.

## Context

The extension is a vanilla JavaScript Firefox Manifest V3 add-on. The repository has no existing CI workflow or automated test suite. It currently has a PowerShell package script, a stable Gecko add-on ID, and a GitHub `main` branch. The user selected public AMO distribution and asked for clean code and TDD.

## Design

### Pull request and main-branch checks

- Run Node.js 22, `npm ci`, the Node built-in test runner, `web-ext lint`, and `web-ext build`.
- Run the same checks for pull requests and pushes to `main`.
- Pin the `web-ext` development dependency in `package.json` and `package-lock.json`.
- Pin every GitHub Action to a full commit SHA and retain a readable version comment.
- Grant validation jobs `contents: read` only. Use concurrency cancellation for superseded pull-request runs.

### Versioned release submission

- A push of a `v*` tag starts the release pipeline. The tag without its leading `v` must exactly match `manifest.json`'s version; otherwise stop before contacting AMO.
- Run tests, lint, and packaging again before any release-side effect.
- Submit a listed AMO version using the pinned `web-ext` CLI and GitHub Actions secrets `AMO_API_KEY` and `AMO_API_SECRET`. Set `--approval-timeout=0` so the workflow does not occupy a runner while Mozilla performs manual review.
- For a first listing, build AMO metadata from the checked-in name, summary, and category plus an explicitly configured `AMO_LICENSE` repository variable. Do not choose or default the license in code. Fail before submission if the variable is missing or is not an accepted AMO license slug.
- Create a **draft** GitHub Release containing the versioned extension ZIP and an internal AMO upload-state asset. The state asset records the tag and AMO upload UUID so later workflow runs can resume without submitting the same version twice.
- Make the submission job idempotent: if the matching draft and state asset already exist for a tag, do not submit that AMO version again.

### AMO approval polling and publication

- A separate scheduled workflow checks draft releases hourly. It also supports manual `workflow_dispatch` so a pending submission can be checked on demand.
- For each draft containing AMO state, query AMO's authenticated v5 upload and version endpoints.
- Leave the GitHub Release in draft while the AMO file is unreviewed. If AMO marks the upload invalid or disabled, fail the check and leave the draft untouched for correction.
- Publish only when the AMO version number matches the draft tag and the AMO file status is `public`, with a signed-file URL and SHA-256 digest.
- Download the signed XPI, verify its SHA-256 against AMO's reported digest, add it to the draft, remove the internal state asset, then publish the GitHub Release.
- Scope `contents: write` and the AMO secrets to release/polling jobs only. Never expose secrets to pull-request jobs.

### Test design and clean code

- Use Node's built-in `node:test` and `node:assert`, with no test framework dependency.
- Put release rules in small ESM modules under `scripts/`; keep workflow YAML limited to orchestration.
- Tests cover manifest path/permission invariants, version-tag matching, AMO license configuration validation, AMO status gating, version matching, and digest verification.
- For each implementation rule, write and run the failing test first, implement the smallest passing change, then refactor while keeping tests green.
- Keep the extension's browser scripts as classic scripts; do not change their runtime module format.
- Replace the Windows-only packaging path with `web-ext build`, using a checked-in config/ignore list so the artifact contains the extension files and release documentation, not tests, workflow files, or development scripts.

## Release Setup

The repository owner must configure these GitHub repository secrets before a version tag can submit to AMO:

- `AMO_API_KEY`
- `AMO_API_SECRET`

The owner must configure the `AMO_LICENSE` repository variable before the initial listed submission. The workflow will fail closed if any required value is absent or invalid.

The first listed AMO version requires its listing metadata and can require Mozilla review. The GitHub Release remains a draft until the signed XPI is available. Later tag pushes use the already-created listing and its stored metadata.

## Alternatives Considered

1. **Single tag workflow that waits for AMO approval:** fewer workflow files, but manual review can outlast a GitHub Actions runner and leave the tag workflow failed.
2. **Manual AMO submission and manual GitHub asset upload:** simpler automation, but it does not meet the request for automated releases.
3. **Draft release plus AMO status polling (selected):** more code than a single workflow, but handles Mozilla's asynchronous review without resubmitting the same version or publishing an unsigned artifact.

## Out of Scope

- Creating AMO API credentials or storing them in GitHub Secrets.
- Choosing an AMO license on the user's behalf.
- Publishing a version tag or submitting the current `0.1.0` candidate to AMO.
- Testing live Epic/Fab claim flows.
- Adding automatic version bumping; release tags must match the manifest version.

## Acceptance Criteria

- Pull requests cannot access AMO secrets or write repository contents.
- CI checks manifest invariants, tests, lints, and creates a package.
- A mismatched version tag fails before AMO upload.
- A valid tag submits exactly once and creates or resumes a draft release.
- No draft is published while AMO approval is pending, invalid, rejected, or version-mismatched.
- A published GitHub Release contains the source ZIP and a SHA-256-verified Mozilla-signed XPI.
- A missing/invalid license variable fails before first public AMO submission.
- CI and release setup steps are documented in the README.
