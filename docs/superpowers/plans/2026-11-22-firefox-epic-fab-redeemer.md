# Firefox Epic and Fab Redeemer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Firefox desktop add-on that claims free PC games from Epic and free assets from Fab through their visible storefront UI, with clear per-item results and user-controlled verification steps.

**Architecture:** Use a Firefox Manifest V3 extension with an event-driven background script, ordered site-specific content scripts, a shared sequential runner, and a compact popup plus in-page status panel. Epic and Fab adapters handle only their own visible page flows; settings and the latest run are stored locally through `browser.storage.local`.

**Tech Stack:** Firefox WebExtensions Manifest V3, vanilla JavaScript, HTML, and CSS; no build step, remote code, external service, or runtime dependencies.

## Global Constraints

- Target Firefox desktop and use the promise-based `browser.*` namespace.
- Use Firefox-supported background scripts; do not assume `background.service_worker`.
- Limit host access to `https://store.epicgames.com/*` and `https://www.fab.com/*`.
- Do not automate CAPTCHA, sign-in, 2FA, EULA acceptance, payment, or checkout confirmation.
- Claim only items with positive site evidence that they are free and eligible; report success only after positive ownership confirmation.
- Keep item state and settings local; never read or store credentials, cookies, account tokens, or payment details.
- Do not copy upstream code or artwork; identify the upstream project as functional inspiration in the README.
- Do not add or run automated tests unless the user asks for testing. Use code review and manifest validation for implementation checks; defer live claim-flow verification until explicitly requested.

---

## File Structure

- `manifest.json` — Firefox MV3 metadata, permissions, toolbar popup, options page, background event script, and ordered content scripts.
- `src/background/background.js` — extension lifecycle, popup/content messages, and persistence of settings and the latest run.
- `src/shared/config.js` — settings defaults, bounds, and storage read/write helpers.
- `src/shared/messages.js` — stable runtime message names and payload shapes.
- `src/shared/runner.js` — sequential run control, delays, cancellation, pause/resume, and status reporting.
- `src/sites/epic/discovery.js` — eligible Epic giveaway discovery and owned-state evidence.
- `src/sites/epic/claim.js` — visible Epic claim flow and outcome classification.
- `src/sites/epic/content.js` — Epic content-script entry point and adapter wiring.
- `src/sites/fab/discovery.js` — free Fab asset discovery and owned-state evidence.
- `src/sites/fab/claim.js` — Fab visible claim flow and license-dialog handling.
- `src/sites/fab/content.js` — Fab content-script entry point and adapter wiring.
- `src/ui/content/panel.js` and `src/ui/content/panel.css` — isolated, keyboard-accessible run status panel.
- `src/ui/popup/popup.html`, `popup.css`, `popup.js` — current-tab status, controls, summary, and options link.
- `src/ui/options/options.html`, `options.css`, `options.js` — auto-start, action-delay, and Fab license settings.
- `README.md` — installation, permissions, usage, limitations, and upstream attribution.
- `docs/validation/firefox-manual-checklist.md` — reviewable checklist for later browser-flow verification when requested.

Scripts declared in `content_scripts` are classic scripts, loaded in manifest order. They attach APIs to a single `globalThis.__efar` namespace instead of using ES module imports. Background scripts use the same ordered classic-script pattern so the design does not depend on module support in a particular Firefox event-page version.

## Implementation Tasks

### Task 1: Create Firefox extension shell

**Files:**
- Create: `manifest.json`
- Create: `src/background/background.js`
- Create: `src/ui/popup/popup.html`
- Create: `src/ui/popup/popup.css`
- Create: `src/ui/popup/popup.js`
- Create: `src/ui/options/options.html`
- Create: `src/ui/options/options.css`
- Create: `src/ui/options/options.js`

**Interfaces:**
- Produces a loadable extension shell with a popup and options page; site scripts are added in later tasks.
- Manifest uses `manifest_version: 3`, `background.scripts: ["src/background/background.js"]`, `action.default_popup`, and only the `storage` API permission plus the two exact host permissions.

- [ ] Create the directory structure listed above under `H:\Dev\T-Redeem`.
- [ ] Add a manifest named `Epic Fab Redeemer` with version `0.1.0`, a Firefox browser action popup, options page, background scripts declaration, `storage` permission, and exact Epic/Fab host permissions.
- [ ] Add minimal popup HTML with a heading, `#site-status`, `#run-summary`, `#start-button`, `#stop-button`, and an options link.
- [ ] Add options HTML with labeled controls `#auto-start`, `#delay-ms`, and `#fab-license`.
- [ ] Add CSS that uses system fonts, visible focus styles, readable contrast, and responsive popup dimensions.
- [ ] Keep scripts local and add no CDN links or remote dependencies.
- [ ] Parse `manifest.json` as JSON and inspect the resulting permission and script paths.

### Task 2: Define shared configuration and messages

**Files:**
- Create: `src/shared/config.js`
- Create: `src/shared/messages.js`
- Modify: `manifest.json`
- Modify: `src/background/background.js`

**Interfaces:**
- `DEFAULT_SETTINGS = { autoStart: false, delayMs: 2000, fabLicense: "professional" }`.
- `loadSettings()` returns validated settings from `browser.storage.local` or defaults.
- `saveSettings(partial)` validates and stores a merged settings object.
- Message names: `GET_TAB_STATUS`, `START_RUN`, `STOP_RUN`, `RESUME_RUN`, `GET_SETTINGS`, `SAVE_SETTINGS`, `GET_LATEST_RUN`, and `RUN_STATUS_UPDATED`.
- A run record is `{ runId, site, startedAt, state, currentItemKey, phase, items, updatedAt }`, with run states `idle`, `running`, `paused`, `stopped`, `completed`, and `failed`; an item is `{ key, title, url, state, detail }`.
- Store the current item and phase in `latestRun` so a content script can rehydrate after an Epic product-page navigation.

- [ ] Add `config.js` with bounds of 500–10000 ms for `delayMs`, the two allowed Fab license values, and boolean validation for `autoStart`.
- [ ] Add `messages.js` defining the message-name object and status values `pending`, `already-owned`, `claimed`, `failed`, and `needs-user-action` on `globalThis.__efar`.
- [ ] Update `background.scripts` order to load `config.js`, `messages.js`, then `background.js`.
- [ ] Add background message listeners synchronously at script startup so Firefox can wake the event page for each message.
- [ ] Handle `GET_SETTINGS` and `SAVE_SETTINGS` with `browser.storage.local` and return `{ ok, settings }` or `{ ok: false, error }`.
- [ ] Handle `RUN_STATUS_UPDATED` by persisting the provided latest run under `latestRun` after checking required fields and status values.
- [ ] Handle `GET_LATEST_RUN` by returning the stored `latestRun` or `null`.
- [ ] Keep `GET_TAB_STATUS` and run-control messages scoped to direct popup-to-content-script messaging; the popup handles a missing receiver as an unsupported tab.

### Task 3: Build shared sequential runner

**Files:**
- Create: `src/shared/runner.js`
- Modify: `src/shared/messages.js`

**Interfaces:**
- `runItems({ adapter, items, settings, reportStatus, signal })` processes eligible items one at a time.
- Adapter contract: `canRun(document, location)`, `scan(document)`, and `claim(item, { signal, settings, reportStatus })`.
- `claim` returns `already-owned`, `claimed`, `failed`, `needs-user-action`, or `rate-limited`; `rate-limited` marks the item failed with a clear reason and pauses the run.

- [ ] Implement the runner to publish an initial `running` record and a `pending` state for every discovered item.
- [ ] Before each claim, check cancellation and wait `settings.delayMs` unless the item is first.
- [ ] Convert adapter exceptions into an item-level `failed` outcome with a short safe message and continue to later items.
- [ ] Pause on `needs-user-action`, a global error, or an explicit stop; do not auto-retry a failed claim.
- [ ] On `rate-limited`, mark the current item `failed` with a retry-later detail, set the run state to `paused`, and stop processing remaining items.
- [ ] Persist the current item key before each site action. On supported-page reload, re-check ownership before resuming that item so a completed claim is not clicked twice.
- [ ] Implement explicit resume to retry only items in `pending`, `failed`, or `needs-user-action` after the user asks.
- [ ] Publish every item and run transition through the provided `reportStatus` callback.

### Task 4: Add shared content panel and site bootstrap pattern

**Files:**
- Create: `src/ui/content/panel.js`
- Create: `src/ui/content/panel.css`
- Create: `src/sites/epic/content.js`
- Create: `src/sites/fab/content.js`
- Modify: `manifest.json`

**Interfaces:**
- `mountPanel({ site, onStart, onStop, onResume })` returns `{ update(run), destroy() }`.
- Each content entry point registers its supported site in the panel and relays run state using `browser.runtime.sendMessage`.

- [ ] Mount the panel in a Shadow DOM root with labeled Start, Stop, and Resume controls and an `aria-live="polite"` status region.
- [ ] Render aggregate counts and each item's title and state without injecting content into site-owned controls.
- [ ] Wire popup/start actions to the content script through `browser.runtime.onMessage` and message callbacks.
- [ ] Add ordered content script declarations for Epic and Fab separately, using only their exact host patterns and loading `messages.js`, `runner.js`, `panel.js`, then the matching site entry point.
- [ ] Declare only `src/ui/content/panel.css` as a web-accessible resource, matching the same Epic and Fab host patterns so the Shadow DOM panel can load its stylesheet.
- [ ] Detect SPA route changes with a lightweight `popstate` listener and a scoped DOM observer; debounce rescans and avoid double-mounting the panel.
- [ ] Read settings on supported-page initialization and auto-start at most once per page load only when `autoStart` is true.
- [ ] If no supported content script answers, ensure the popup presents the unsupported-page state.

### Task 5: Implement Epic free-game discovery

**Files:**
- Create: `src/sites/epic/discovery.js`
- Modify: `src/sites/epic/content.js`
- Modify: `manifest.json`

**Interfaces:**
- `scanEpic(document)` returns item records `{ key, title, url, eligible, owned }` for giveaway offers only.
- `isEpicGiveawayCard(element)` distinguishes a time-limited free giveaway from free-to-play titles, demos, paid products, and unrelated cards.

- [ ] Restrict `canRun` to the official Epic Store free-games route and relevant Epic Store product routes opened by the claim flow.
- [ ] Identify product cards by visible title, product link, price/offer state, and giveaway wording, not by a generic `$0` value alone.
- [ ] Exclude free-to-play catalog entries, demos, paid items, and non-game storefront products.
- [ ] Use visible `Owned`/library evidence to mark already-owned products; keep uncertain cards ineligible instead of guessing.
- [ ] Deduplicate discovered offers by canonical product URL and derive stable keys from that URL.
- [ ] Return discovery details to the panel and popup without reading account-specific hidden state.
- [ ] Load `discovery.js` before the Epic `content.js` entry point in the Epic content-script bundle.

### Task 6: Implement Epic visible claim flow

**Files:**
- Create: `src/sites/epic/claim.js`
- Modify: `src/sites/epic/content.js`
- Modify: `manifest.json`

**Interfaces:**
- `claimEpic(item, { signal, settings, reportStatus })` returns `already-owned`, `claimed`, `failed`, `needs-user-action`, or `rate-limited`.
- Internal helpers: `findEpicAction(item)` and `classifyEpicPage(document)`.

- [ ] Find a unique visible `Get`/claim control within the selected item's product flow; return `needs-user-action` if it is missing or ambiguous.
- [ ] Activate only the free offer's visible claim control; never proceed if the page exposes a price, payment, or purchase confirmation.
- [ ] Wait for a visible success, owned/library state, blocking prompt, or bounded timeout using a `MutationObserver` and `AbortSignal`.
- [ ] Classify CAPTCHA, sign-in, 2FA, EULA, or checkout confirmation as `needs-user-action` and pause the runner without dismissing the prompt.
- [ ] Treat a visible rate-limit or too-many-claims notice as a run-level pause with a retry-later message.
- [ ] Report `claimed` only after the page visibly confirms ownership; classify timeout or unexpected UI as `failed`.
- [ ] Wire the Epic adapter into the shared runner and display item-level status transitions.
- [ ] Load Epic scripts in this order: shared messages, shared runner, panel, Epic discovery, Epic claim, Epic content entry point.

### Task 7: Implement Fab asset discovery and license selection

**Files:**
- Create: `src/sites/fab/discovery.js`
- Create: `src/sites/fab/claim.js`
- Modify: `src/sites/fab/content.js`
- Modify: `manifest.json`

**Interfaces:**
- `scanFab(document)` returns `{ key, title, url, eligible, owned }` records for assets visibly offered as free.
- `claimFab(item, { signal, settings, reportStatus })` returns `already-owned`, `claimed`, `failed`, `needs-user-action`, or `rate-limited`.
- Internal helper: `selectFabLicense(dialog, preference)` returns `selected`, `unavailable`, `paid`, or `ambiguous`.

- [ ] Restrict `canRun` to Fab asset listing and product routes, excluding unrelated account or checkout pages.
- [ ] Detect free assets from visible Fab price/offer labels and skip paid or ambiguous cards.
- [ ] Treat `From Free` as a mixed-price signal, not proof that the configured license is free; continue only when the selected license is visibly priced Free/Gratuit.
- [ ] Mark an asset already owned only when the visible card or product page indicates it is in the user's library.
- [ ] Use the configured Personal/Professional preference only if the dialog contains one matching visible option with an explicit zero-price/Free label; return `paid` and do not select or click a paid option.
- [ ] Trigger the visible Fab add-to-library control and wait for explicit library/owned evidence before reporting success.
- [ ] Pause on CAPTCHA, authentication, EULA acknowledgement, checkout, or unexpected modal and surface `needs-user-action`; never click the EULA acknowledgement control.
- [ ] Treat a visible rate-limit or too-many-claims notice as a run-level pause with a retry-later message.
- [ ] Wire the Fab adapter into the shared runner independently of the Epic adapter.
- [ ] Load Fab scripts in this order: shared messages, shared runner, panel, Fab discovery, Fab claim, Fab content entry point.

### Task 8: Connect popup, options, and persisted run state

**Files:**
- Modify: `src/ui/popup/popup.js`
- Modify: `src/ui/options/options.js`
- Modify: `src/background/background.js`
- Modify: `src/sites/epic/content.js`
- Modify: `src/sites/fab/content.js`

**Interfaces:**
- Popup queries the active tab, sends `GET_TAB_STATUS` directly to its content script, and asks the background for `GET_LATEST_RUN` when the popup opens.
- Options page calls `loadSettings()` and `saveSettings(partial)` through the background messaging contract.

- [ ] Query the active tab and render supported-site name, controls, and most recent item/run states.
- [ ] Make Start, Stop, and Resume send commands directly to the active supported tab; handle an absent content-script receiver as unsupported.
- [ ] Render action-delay input in milliseconds with a 500–10000 range and Fab license selection with the two allowed values.
- [ ] Save settings on explicit form submission and show a readable confirmation or validation error.
- [ ] Load `latestRun` after popup open and when the background script receives a content status update.
- [ ] Ensure popup closure does not cancel a content-script run, supported-page navigation rehydrates the current item safely, and navigation away or tab closure stops it cleanly.

### Task 9: Document install, permissions, and later validation

**Files:**
- Create: `README.md`
- Create: `docs/validation/firefox-manual-checklist.md`
- Review: `manifest.json`, all files under `src/`

- [ ] Document temporary installation from `about:debugging` → This Firefox → Load Temporary Add-on → select `manifest.json`.
- [ ] Explain Epic and Fab login prerequisites, page navigation, Start/Stop/Resume, settings, and item states.
- [ ] List each browser permission and the two host permissions with the reason the extension needs them.
- [ ] State clearly that Firefox must remain open on a supported page, CAPTCHA and account checks are manual, Epic mobile offers are excluded, and selectors may need maintenance after site changes.
- [ ] Credit the upstream Game Asset Auto Redeemer as inspiration and state that this project does not copy its code or artwork.
- [ ] Write a manual validation checklist for manifest loading, unsupported tabs, eligible/owned/unavailable cards, stop/resume, and success evidence; leave live claim-flow steps unexecuted unless the user asks for verification.
- [ ] Review every acceptance criterion in the approved design and map it to an implementation file or checklist item.

## Plan Self-Review

- **Coverage:** The tasks cover Firefox packaging, Epic PC giveaway discovery and claim handling, Fab discovery and license handling, visible status UI, local persistence, pause/resume, privacy, permissions, and user documentation.
- **Placeholder scan:** No TBD/TODO or incomplete implementation placeholders remain. Site selectors are explicitly verified during implementation against current official pages; ambiguous page structures fail closed.
- **Interface consistency:** Both adapters return the same five claim outcomes and expose the contract from Task 3. The shared status names and storage keys are defined in Task 2. Popup and options page use the background message layer rather than direct shared-state access.
