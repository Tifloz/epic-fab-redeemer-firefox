# Firefox Epic and Fab Redeemer Design

## Goal

Create a Firefox add-on that helps the signed-in user claim free PC games from the Epic Games Store and free digital assets from Fab, with visible per-item outcomes and a human-controlled path through verification challenges.

## Scope

### Included

- Firefox desktop extension using Firefox's Manifest V3 WebExtension model.
- Epic Games Store free PC game promotions, limited to the official free-games storefront flow.
- Fab assets that the site presents as free, with a configurable Personal or Professional license preference where Fab offers a choice.
- A small toolbar popup to detect the active supported site, start or stop processing, and show progress and results.
- In-page site adapters for scanning eligible cards and carrying out the site's normal claim flow.
- Per-item states: pending, already owned, claimed, failed, or needs user action.
- User-configurable action delay and auto-start-on-supported-page setting; auto-start defaults off.
- Persisted settings and recent run results using Firefox extension storage.
- Manual handling for CAPTCHA, login, 2FA, EULA prompts, or any checkout step requiring user confirmation.

### Excluded

- Epic mobile games, console offers, paid offers, demos, free-to-play catalog items, and non-game storefront products.
- Automatic CAPTCHA solving, authentication bypass, or credential collection.
- Scheduling while Firefox is closed, remote execution, or server-side claiming.
- Unity Asset Store, Superhive, downloads, purchases, or any background API calls to undocumented claim endpoints.

## User experience

1. The user installs or temporarily loads the unpacked extension in Firefox and signs into Epic and/or Fab in ordinary browser tabs.
2. On the official Epic free-games page or a Fab free-assets listing, the extension shows supported-site status in its toolbar popup. A compact in-page panel may show item-level results.
3. The user presses Start, or enables opt-in auto-start for future supported pages. The extension scans visible eligible items, skips items marked owned by the site, and processes the remaining items sequentially with a configurable delay.
4. The adapter uses the site's visible controls and waits for explicit UI evidence of success, ownership, or a blocking prompt. A CAPTCHA, sign-in, 2FA, EULA, or unexpected checkout state pauses the run and asks the user to handle it in the page. After the user acts, they can resume.
5. The popup and in-page panel show aggregate counts and individual outcomes. The extension must never report a claim as successful based only on a click or navigation.

Epic claims and Fab claims use separate adapters and result records. A failure on one site must not prevent the other adapter from working.

## Architecture

- `manifest.json`: Firefox MV3 metadata, narrow `host_permissions` for `https://store.epicgames.com/*` and `https://www.fab.com/*`, `storage` permission, toolbar action, options page, and ordered content-script bundles. No broad `<all_urls>` access.
- `src/background/background.js`: Firefox event-driven background script for extension lifecycle, popup messaging, storage access, and tab status. It must not assume a persistent worker or Chrome-only APIs.
- `src/shared/`: settings defaults, message names, run/item status types, and bounded delay/retry utilities that contain no site selectors.
- `src/sites/epic/`: Epic free-game discovery and visible storefront claim adapter.
- `src/sites/fab/`: Fab free-asset discovery, license-dialog selection, and visible claim adapter.
- `src/ui/popup/`: browser-action status, Start/Stop/Resume controls, settings shortcut, and concise results.
- `src/ui/content/`: isolated, keyboard-accessible status panel mounted without changing site controls or layout beyond its own host element.
- `src/ui/options/`: settings for opt-in auto-start, delays, and Fab license preference.
- A written manual validation checklist will cover eligibility parsing, outcome classification, sequential processing, pause/resume, manifest loading, and the two site flows using synthetic DOM fixtures where possible.

The project is an independent Firefox implementation of the requested capabilities. It may use the [upstream repository](https://github.com/creosB/Game-Asset-Auto-Redeemer) as a functional reference, but must not copy its code or artwork. The upstream README declares CC BY-NC-SA 4.0 and also requests contact before sharing or changing that work; this implementation avoids creating a derivative code fork and will credit the project as inspiration in its README.

## Site adapter contract

Each adapter exposes the same small interface:

```js
{
  canRun(document, location),
  scan(document),
  claim(item, { signal, settings, reportStatus })
}
```

`scan` returns stable item records containing a site key, title, URL, eligibility, and current ownership evidence. `claim` acts only through visible site UI, returns one of the declared terminal states or `needs-user-action`, and respects cancellation between actions. Adapters use scoped selectors and text/ARIA evidence; missing or ambiguous controls yield `needs-user-action` or `failed`, never a guessed success.

The shared runner processes one item at a time, waits the configured delay, publishes every transition, and stops promptly when cancelled or paused. It does not retry a failed claim automatically because repeated checkout attempts can trigger account limits or duplicate dialogs. The user can explicitly resume pending or failed items after reviewing the page.

## Error and safety behavior

- Unsupported page: popup explains that the active tab is not an Epic free-games or Fab assets page.
- Not signed in: pause and direct the user to sign in on the official page.
- CAPTCHA, 2FA, EULA, or checkout confirmation: pause and mark the item `needs-user-action`; do not attempt to solve or dismiss it.
- Site markup changes or ambiguous outcomes: mark failed with a short explanation and preserve the page state for user inspection.
- Already-owned evidence: skip the claim and record `already-owned`.
- Claim success: require a site-rendered confirmation such as the owned/library state; a button click is insufficient.
- Storage or message failure: surface an extension error, stop the run safely, and do not claim completion.
- Rate limiting: stop processing and tell the user to retry later; no automated rapid retries.

## Privacy and permissions

- No Epic or Fab password, cookie, token, or payment information is read or stored by the extension.
- Host access is limited to the exact storefront and Fab hosts needed for the visible-page adapters, with permissions documented in the README.
- Settings and recent results remain local in `browser.storage.local`; sync is not required for the initial release.
- No analytics, telemetry, external API service, or remote code.

## Compatibility and packaging

- Firefox desktop Manifest V3 is the target. Use `browser.*` promise APIs and Firefox's supported background-script/event-page declaration, not a Chrome-only `background.service_worker` assumption.
- The unpacked extension must load in Firefox Developer Edition or release Firefox through `about:debugging` for temporary testing.
- Manifest structure must be checked, and the extension's installation and claim flows must be manually validated in Firefox before calling the implementation complete.
- Site selectors and success signals are inherently subject to change; README will explain how to report a broken site flow and that claim reliability depends on Epic/Fab UI behavior.

## Acceptance criteria

1. Firefox loads the unpacked extension without manifest errors and shows the toolbar popup.
2. On an Epic free-games fixture, the adapter identifies only free PC giveaway entries and excludes free-to-play games, demos, paid offers, and non-game items.
3. On a Fab fixture, the adapter identifies free assets, applies the configured license preference only when a matching choice exists, and leaves ambiguous license prompts for the user.
4. A successful state is recorded only when the page displays positive ownership/claim confirmation.
5. CAPTCHA, sign-in, 2FA, EULA, and checkout prompts pause processing, show `needs-user-action`, and can resume after user action.
6. Stop cancels the run before the next item. An item-level DOM failure is recorded as failed and processing continues with later eligible items; global errors, rate limits, and user-action prompts pause the run.
7. Settings and the most recent run survive popup closure and Firefox background-script suspension.
8. A manual validation checklist covers parsing, statuses, pause/resume, cancellation, and manifest permissions; documentation describes installation and known limits.

## Open implementation details

The exact current DOM selectors and confirmation signals for Epic and Fab must be verified against their live official pages during implementation. The adapters must fail closed when the page structure does not match the evidence fixtures; selectors must not be guessed from storefront screenshots alone.
