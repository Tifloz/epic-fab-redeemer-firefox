# Epic Fab Redeemer

Firefox desktop extension for processing free PC game giveaways on the Epic Games Store and free digital assets on Fab through their visible storefront pages.

This is an independent implementation inspired by [Game Asset Auto Redeemer](https://github.com/creosB/Game-Asset-Auto-Redeemer). It does not copy that project's code or artwork.

## Load in Firefox

1. Download or clone this repository to your computer.
2. In Firefox, open `about:debugging`.
3. Select **This Firefox**.
4. Select **Load Temporary Add-on…**.
5. Choose this project's `manifest.json`.

Temporary add-ons are removed when Firefox restarts. Load the manifest again after restarting. This project has not been packaged or signed for permanent installation.

## Release package

Use Node.js 22 or later for local checks and packaging:

```sh
npm ci
npm test
npm run lint
npm run build
```

`npm run build` creates `dist/epic-fab-redeemer-v<manifest-version>.zip`. The ZIP contains the extension at its root and is the source package for AMO and the GitHub Release. It is not directly installable until Mozilla signs it.

The manifest includes a stable Gecko add-on ID so Firefox can recognize this extension across versions. Keep that ID unchanged for future updates.

### Automated CI and release flow

The CI workflow runs the tests, `web-ext` lint, and package build for pull requests and pushes to `main`. It uses the committed npm lockfile and grants its validation job read-only repository access.

Pushing a tag matching the exact version in `manifest.json` starts an AMO submission. For example, manifest version `0.1.0` requires tag `v0.1.0`. The workflow validates, tests, lints, and packages before submitting. It creates a **draft** GitHub Release with the source ZIP while Mozilla reviews the AMO submission. An hourly workflow checks approval; you can also run **Publish AMO-approved release** manually from the GitHub Actions tab. Only when AMO reports the matching version as public does the poller download the signed XPI, verify its SHA-256 digest, attach it, remove its internal upload-state file, and publish the GitHub Release.

Before the first tagged submission, configure these values in the repository's **Settings → Secrets and variables → Actions**:

- Secrets `AMO_API_KEY` and `AMO_API_SECRET`, generated in the [AMO Developer Hub](https://addons.mozilla.org/developers/).
- Repository variable `AMO_LICENSE`, using the exact AMO slug for the license you have chosen. The workflow does not select a license for you. Accepted extension license slugs are `all-rights-reserved`, `MPL-2.0`, `Apache-2.0`, `GPL-2.0-only`, `GPL-3.0-only`, `LGPL-2.1-only`, `LGPL-3.0-only`, `AGPL-3.0-only`, `MIT`, `ISC`, `BSD-2-Clause`, and `Unlicense`.

The initial AMO listing uses the checked-in English summary and `other` category from `.amo-metadata.json`; AMO may request changes during its first review. Later versions inherit that listing and its chosen license. If an AMO submission is interrupted after its draft marker is created, automation stops rather than risk submitting the same version twice; inspect both the AMO Developer Hub and the draft before resolving that state.

The workflow does not create a version tag, submit `0.1.0`, or automatically bump the manifest version. After changing `manifest.json` to a new version and pushing the matching `v<version>` tag, the AMO submission workflow starts.

## Use

1. Sign in to Epic and/or Fab in ordinary Firefox tabs. The extension does not collect your password, cookies, or account tokens.
2. For Epic, open the official [Free Games page](https://store.epicgames.com/free-games). The extension targets free PC giveaway offers only. Mobile offers, free-to-play titles, demos, paid products, and other storefront products are excluded.
3. For Fab, open a free-asset listing, such as [Limited-Time Free](https://www.fab.com/limited-time-free), or a Fab free-filtered category. The product page and the selected Personal or Professional license must visibly show a free price before the extension can use **Add to My Library**.
4. Open the toolbar button and choose **Start**, or use the in-page panel. Processing is sequential and uses the configured delay.
5. If Epic or Fab asks for sign-in, CAPTCHA, 2FA, an EULA acknowledgement, checkout, or another confirmation, handle it yourself in the page and choose **Resume** afterward. The extension does not solve, accept, dismiss, or confirm those steps.
6. Use **Stop** to stop before another item is processed. The popup and in-page panel show item results. A click alone is never treated as success; the site must visibly confirm ownership/library status.

Firefox must remain open, and you must be on a supported Epic or Fab page to start or continue a run. This extension does not schedule work while Firefox is closed and does not claim through a server or undocumented API. A new Epic run must start from the Free Games page; a new Fab run must start from a supported free listing. Product pages are supported when resuming a saved item.

## Settings

Open **Settings** from the toolbar popup to configure:

- **Auto-start**: off by default. When enabled, a run may start automatically when a supported listing page loads.
- **Action delay**: 500–10,000 milliseconds between item actions.
- **Fab license preference**: Personal or Professional. The preferred option is used only when the page shows exactly one matching option with a free price.

Settings and the latest run are stored locally in Firefox extension storage. They are not synced to a service.

## Permissions

The manifest requests:

- `storage`: saves settings and the most recent run with `browser.storage.local`.
- `https://store.epicgames.com/*`: reads visible Epic Store pages and interacts with visible giveaway controls.
- `https://www.fab.com/*`: reads visible Fab pages and interacts with visible free asset controls.

The extension does not request broad access to all websites. The host permissions are limited to these two storefront hosts. Firefox's data collection declaration is `none`; settings and run history stay in local extension storage.

## States and limitations

Each item is reported as pending, already owned, claimed, failed, or needs user action. Ambiguous pages and controls fail closed. Epic and Fab can change their page markup and labels, so selectors and confirmation signals may need maintenance; an item may be skipped or paused when the visible evidence no longer matches.

Success means the page displayed positive ownership/library evidence. A failed result can mean that the page changed, the confirmation was not visible, or the extension could not safely identify a control; inspect the storefront before retrying. Rate limits pause a run for a later manual retry.

The manual Firefox validation checklist is at [`docs/validation/firefox-manual-checklist.md`](docs/validation/firefox-manual-checklist.md). Live claim flows have not been validated as part of this implementation.
