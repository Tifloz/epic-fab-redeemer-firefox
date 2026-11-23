# CI and AMO-Signed GitHub Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add least-privilege CI and automate public GitHub releases so each tag is submitted once to AMO and published only after Mozilla approves and signs the matching XPI.

**Architecture:** Keep storefront code unchanged. Use Node 22, `node:test`, and small pure ESM release-contract helpers; use `web-ext` for linting, packaging, and AMO submission. Three GitHub Actions workflows validate changes, submit tagged versions as drafts, and poll AMO until a SHA-256-verified signed file is available.

**Tech Stack:** Firefox WebExtension, Node.js 22, npm lockfile, `web-ext` 10.x, Node built-in test runner, GitHub Actions, AMO API v5.

## Global Constraints

- Preserve the Firefox extension's classic-script runtime and exact storefront permissions.
- Use no testing framework or runtime dependency; pin `web-ext` as a development dependency and commit `package-lock.json`.
- Write each test before its implementation, run it failing, implement the smallest change, rerun it passing, then refactor.
- Pin GitHub Actions to full commit SHAs and keep a comment with the action release version.
- Never expose AMO secrets or `contents: write` to pull-request validation.
- Never publish a GitHub Release before AMO reports the matching file as `public` and its downloaded XPI passes SHA-256 verification.
- Do not choose a license, create credentials, or publish the `0.1.0` tag as part of this work.

## Planned Files

- `package.json`, `package-lock.json` — private tooling package, pinned `web-ext`, `test`, `lint`, and `build` scripts.
- `.web-ext-config.cjs` — reproducible package exclusions for tests, workflows, scripts, and development files.
- `.amo-metadata.json` — checked-in localized AMO summary and category; the license is supplied only for the first listing.
- `.amo-metadata.json` — checked-in localized listing summary and category; the license is supplied at release time.
- `scripts/release-contract.mjs` — pure validation for manifest invariants, tag/version equality, AMO license slugs, AMO status, version equality, and digest matching.
- `scripts/amo-client.mjs` — AMO v5 authentication and upload/version requests; no secret values in errors or logs.
- `scripts/github-client.mjs` — authenticated, repository-scoped GitHub Releases REST operations for draft and asset handling.
- `scripts/prepare-release.mjs` — validate configuration and tag, detect whether the AMO listing exists, submit or resume one upload, create a draft GitHub Release, attach the source ZIP and upload-state JSON.
- `scripts/poll-amo-release.mjs` — inspect draft state, wait safely for review, validate listed-channel signed-file metadata and bytes, then publish a draft.
- `tests/release-contract.test.mjs`, `tests/amo-client.test.mjs`, `tests/github-client.test.mjs`, `tests/prepare-release.test.mjs`, `tests/poll-amo-release.test.mjs` — offline unit tests using `node:test` and injected HTTP/filesystem/process dependencies where needed.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/poll-amo.yml` — validation, tag submission, and scheduled/manual AMO polling.
- `scripts/package-release.ps1` — remove the Windows-only packager after README migration.
- `README.md`, `.gitignore` — document local commands, AMO configuration, draft/publish lifecycle, and generated artifacts.

## Implementation Tasks

### Task 1: Establish the TDD tooling and extension package contract

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.web-ext-config.cjs`
- Create: `tests/release-contract.test.mjs`
- Create: `scripts/release-contract.mjs`
- Modify: `.gitignore`

**Interfaces:**
- `npm test` runs `node --test`.
- `npm run lint` runs `web-ext lint --source-dir .`.
- `npm run build` runs `web-ext build --source-dir . --artifacts-dir dist`.
- Export pure functions `validateManifest(manifest)`, `versionFromTag(tag, manifestVersion)`, `validateAmoLicense(license)`, `assertPublishableAmoVersion({ tag, manifestVersion, version, fileStatus, fileUrl, sha256 })`, and `verifySha256(buffer, expected)` from `scripts/release-contract.mjs`.

- [x] Add tests first for missing Gecko ID, undeclared no-data collection, changed host permissions, missing manifest paths, invalid tag syntax, mismatched tag/manifest version, missing and invalid AMO license slugs, pending/disabled AMO status, mismatched AMO version, absent signed URL/digest, and valid/invalid SHA-256 bytes. Run `node --test tests/release-contract.test.mjs` and confirm the new tests fail because the module is absent.
- [x] Implement only the pure contract functions needed to pass those tests. Accept AMO's documented license slug set and do not supply a default.
- [x] Run the contract tests to green, then refactor duplicate validation into small private helpers without changing the exported signatures.
- [x] Add a private `package.json` with Node `>=22`, exact `web-ext` 10.8.0 development dependency, and the three scripts above; generate and commit its npm lockfile.
- [x] Configure `web-ext` to package the manifest, `src/**`, `README.md`, and `CHANGELOG.md`, excluding `.git`, `.github`, `docs`, `scripts`, `tests`, `node_modules`, `dist`, and local tooling files.
- [x] Ignore `node_modules/` and generated package artifacts while retaining release outputs in Actions.
- [x] Run `npm ci`, `npm test`, `npm run lint`, and `npm run build`; inspect the ZIP contents and confirm it has `manifest.json` at its root and no tests/workflows/scripts.

### Task 2: Add deterministic AMO API client and test its protocol

**Files:**
- Create: `tests/amo-client.test.mjs`
- Create: `scripts/amo-client.mjs`

**Interfaces:**
- `createAmoClient({ apiKey, apiSecret, fetchImpl, now })` returns `getAddon(addonId)`, `getUpload(uuid)`, and `getVersion(addonId, version)` methods.
- Requests use AMO API v5, `Authorization: JWT <token>`, HMAC-SHA256, `iss`, unique `jti`, and a short-lived `iat`/`exp` window.
- The client validates credentials before sending requests and returns parsed API data; it never logs credentials, authorization headers, or raw responses.

- [x] Write tests first for JWT header/claims/signature, deterministic injected clock and fetch, add-on/upload/version endpoint URLs, 404 listing detection, non-success HTTP handling, malformed JSON, and missing credentials. Run `node --test tests/amo-client.test.mjs` and observe the expected missing-module failures.
- [x] Implement the smallest client that satisfies the tests using Node `crypto` and injected `fetchImpl`; do not add an HTTP library.
- [x] Rerun the tests to green and refactor token creation and safe HTTP error parsing into private helpers.
- [x] Verify failure messages contain status and endpoint context only, never API keys, secrets, JWTs, or response bodies.

### Task 2a: Add repository-scoped GitHub Releases REST client

**Files:**
- Create: `tests/github-client.test.mjs`
- Create: `scripts/github-client.mjs`

**Interfaces:**
- `createGitHubReleaseClient({ token, repository, fetchImpl })` exposes release lookup/creation, asset listing/upload/download/deletion, draft update, and draft listing methods.
- API calls are restricted to `api.github.com` and uploaded assets to `uploads.github.com` for the configured repository; errors omit response bodies and tokens.

- [x] Write fake-fetch tests first for release lookup and 404, binary asset upload, draft listing and asset download, token header, invalid repository, and safe errors. Confirm missing-module red.
- [x] Implement the REST client using built-in `fetch`; paginate release and asset lists and validate upload host/path before attaching credentials.
- [x] Run the focused tests to green and retain no network calls in the test suite.

### Task 3: Implement idempotent tagged AMO submission and draft creation

**Files:**
- Create: `tests/prepare-release.test.mjs`
- Create: `scripts/prepare-release.mjs`

**Interfaces:**
- `prepareRelease({ env, execFile, readFile, writeFile, githubApi, amoClient, now })` validates the tag and AMO credentials before side effects, checks whether the add-on is already listed, and requires the explicit `AMO_LICENSE` variable only for its initial listing.
- State asset schema: `{ schemaVersion: 1, tag: "vX.Y.Z", status: "submitting" | "submitted", uploadUuid: "..." | null, addonId: "..." }`; it contains no credentials or tokens.
- The helper uses `web-ext sign --channel=listed --approval-timeout=0` with generated AMO metadata only for first listing, then stores the UUID from the JSON file `.amo-upload-uuid` in the draft asset. Later versions inherit the AMO listing metadata and license.
- Create the draft and upload a `submitting` state marker before calling AMO. After `web-ext sign` succeeds, replace it with `submitted` state and the upload UUID. A retry with `submitted` state resumes without a second AMO submission; a retry with an interrupted `submitting` marker fails closed for manual AMO reconciliation rather than risk duplicate submission. The draft contains the versioned source ZIP and the internal state JSON. Draft creation/update uses the GitHub Releases REST API.

- [x] Write tests first for tag validation before API calls, `v<manifest version>` equality, absent/invalid license rejection for first listing, existing-listing license inheritance without metadata changes, draft intent marker creation before AMO submission, AMO submission once, JSON upload UUID extraction, source ZIP/state asset creation, matching `submitted` draft resume without re-submit, interrupted `submitting` marker fail-closed behavior, and refusal to overwrite an unrelated release/tag. Use fake process/API adapters; no AMO or GitHub calls in tests. Confirm red with `node --test tests/prepare-release.test.mjs`.
- [x] Implement submission orchestration with dependency injection. Generate first-listing metadata by merging checked-in `.amo-metadata.json` (localized summary and category) with the required `AMO_LICENSE`; omit metadata on later versions so the existing license is inherited.
- [x] Ensure `web-ext` API credentials are passed only through process environment, never command-line arguments or output. Capture the upload UUID without emitting the CLI's potentially sensitive output.
- [x] On first submission create a draft GitHub Release and attach the source ZIP plus `submitting` state before the AMO side effect; after a successful submit, update the asset to `submitted` with its UUID. On retry, resume only when tag, draft, and state schema all match; never resubmit when state is ambiguous.
- [x] Run the focused test file to green, then all tests; inspect generated API payloads and errors using fakes.

### Task 4: Implement approval polling, signed-XPI verification, and publication

**Files:**
- Create: `tests/poll-amo-release.test.mjs`
- Create: `scripts/poll-amo-release.mjs`

**Interfaces:**
- `pollDraftRelease({ release, manifest, amoClient, fetchImpl, githubApi, verifyDigest })` reads the state asset and validates it against the draft tag and manifest.
- `unreviewed` returns a pending result without mutating the release; invalid/disabled or version mismatch throws without publishing.
- `public` plus a matching version, signed-file URL, and valid SHA-256 permits downloading the XPI; verified bytes are uploaded to the same draft, internal state asset is deleted, and only then is the draft published.

- [x] Write tests first for pending state with zero writes, invalid/disabled state with zero writes, unlisted-channel upload, tag/version mismatch with zero writes, no XPI when digest differs, successful XPI attachment/state deletion/publication in that order, and repeat polling of already-published releases. Confirm red with `node --test tests/poll-amo-release.test.mjs`.
- [x] Implement state parsing and the poller with injected AMO/GitHub/download adapters; require the AMO upload channel to be `listed` and constrain signed-file URLs to HTTPS `addons.mozilla.org` hosts before download.
- [x] Use `verifySha256` from the contract module against AMO's reported digest before any GitHub mutation.
- [x] Rerun focused and full tests; refactor common GitHub request handling only if doing so keeps the order and failure behavior explicit.

### Task 5: Wire least-privilege GitHub Actions workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/poll-amo.yml`

- [x] Add PR and `main` push CI on Node 22: `npm ci`, `npm test`, `npm run lint`, and `npm run build`. Grant only `contents: read`; cancel superseded PR runs with workflow/ref concurrency.
- [x] Pin `actions/checkout` and `actions/setup-node` to verified full commit SHAs and add comments with the corresponding release versions.
- [x] Add tag workflow on `v*`: run the same checks first, then invoke `prepare-release.mjs`. Scope `AMO_API_KEY`, `AMO_API_SECRET`, `AMO_LICENSE`, `GITHUB_TOKEN`, and `contents: write` to the release job only. Do not grant secrets to pull requests.
- [x] Add hourly and manual polling workflow. Give only its publish job AMO secrets and `contents: write`; call `poll-amo-release.mjs` for draft releases containing the state asset.
- [x] Validate YAML syntax and check that permissions/secrets are absent from CI and only available in the required jobs.
- [x] Run local checks; inspect workflow event filters to ensure a tag workflow does not recursively trigger a second release from its draft/API operations.

### Task 6: Migrate release documentation and remove Windows-only packaging

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Delete: `scripts/package-release.ps1`

- [x] Document `npm ci`, `npm test`, `npm run lint`, and `npm run build` for local validation.
- [x] Document required GitHub secrets `AMO_API_KEY` and `AMO_API_SECRET` and repository variable `AMO_LICENSE`; list accepted AMO license slug values and make clear that the owner must choose one.
- [x] Explain tag-to-manifest version matching, first-listing review, draft lifecycle, hourly/manual polling, and the signed-XPI verification before publication.
- [x] Replace the PowerShell packaging instructions with the cross-platform npm packaging command; remove the obsolete packaging script.
- [x] Run the complete local CI command sequence and inspect a clean package and README setup instructions.

## Final Verification

- [x] Run `npm ci` from a clean dependency state.
- [x] Run `npm test` and confirm all tests pass without network access.
- [x] Run `npm run lint` and `npm run build`.
- [x] Inspect the built ZIP and confirm it contains only installable extension files and release documentation.
- [x] Review workflow permissions, trigger filters, secret exposure, tag matching, AMO status gating, digest verification, and operation ordering.
- [x] Confirm no secrets, license selection, AMO submission, or release tag were created during implementation.
