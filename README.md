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

Run `./scripts/package-release.ps1` from PowerShell to create a versioned ZIP in `dist/`. The ZIP contains the extension at its root for AMO submission or as a GitHub Release source asset. It is not a directly installable Firefox add-on until Mozilla signs it. Submit it through the [AMO Developer Hub](https://addons.mozilla.org/developers/), then distribute the signed `.xpi` from AMO or attach that signed file to a GitHub Release.

The manifest includes a stable Gecko add-on ID so Firefox can recognize this extension across versions. Keep that ID unchanged for future updates.

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

The extension does not request broad access to all websites. The host permissions are limited to these two storefront hosts.

## States and limitations

Each item is reported as pending, already owned, claimed, failed, or needs user action. Ambiguous pages and controls fail closed. Epic and Fab can change their page markup and labels, so selectors and confirmation signals may need maintenance; an item may be skipped or paused when the visible evidence no longer matches.

Success means the page displayed positive ownership/library evidence. A failed result can mean that the page changed, the confirmation was not visible, or the extension could not safely identify a control; inspect the storefront before retrying. Rate limits pause a run for a later manual retry.

The manual Firefox validation checklist is at [`docs/validation/firefox-manual-checklist.md`](docs/validation/firefox-manual-checklist.md). Live claim flows have not been validated as part of this implementation.
