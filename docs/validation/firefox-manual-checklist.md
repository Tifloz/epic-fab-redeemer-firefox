# Firefox manual validation checklist

This checklist is a plan for a later manual validation session. **No live Epic or Fab claim flow has been executed or verified.** Do not interpret the listed steps as completed. Use test accounts or an otherwise safe context and inspect the storefront before any manual confirmation.

## Firefox installation and permissions

- [ ] Open `about:debugging` → **This Firefox** → **Load Temporary Add-on…** and select `manifest.json`.
- [ ] Confirm Firefox loads the extension without manifest errors and displays the toolbar action.
- [ ] Inspect the extension's requested permissions: `storage` plus only `https://store.epicgames.com/*` and `https://www.fab.com/*` host access.
- [ ] Open an unrelated tab and confirm the popup reports an unsupported page and disables run controls.
- [ ] Close and reopen the popup during a run; confirm the content-page run continues and the latest status is restored.

## Epic discovery and flow

- [ ] On the official Epic Free Games page, confirm a visibly current PC giveaway with a product link is listed as eligible.
- [ ] Confirm an owned offer is marked already owned and is not clicked.
- [ ] Confirm free-to-play catalog entries, demos, paid products, upcoming/expired offers, and mobile-only offers are excluded.
- [ ] Start a run and confirm items are processed one at a time with the configured delay.
- [ ] Stop during a multi-item run and confirm no next item is started; resume only after inspecting the current page.
- [ ] If a CAPTCHA, sign-in, 2FA, EULA, checkout, rate-limit, or unexpected prompt appears, confirm the run pauses without interacting with that prompt.
- [ ] Confirm an item is reported claimed only after Epic visibly shows it as owned/in the library; a button click or navigation alone must not count.
- [ ] If the page structure is ambiguous or the action is absent, confirm the extension pauses or fails safely without clicking a guessed control.

## Fab discovery and flow

- [ ] On a supported free-assets listing, confirm cards with an explicit Free price are candidates.
- [ ] Confirm a `From Free` card is not enough by itself: the product page and the configured Personal/Professional license must visibly show Free or a zero price.
- [ ] Confirm an owned asset is marked already owned and is not clicked.
- [ ] Confirm paid, ambiguous, or unavailable license options are not selected and do not reach **Add to My Library**.
- [ ] Start a run and confirm assets are processed one at a time with the configured delay; stop and resume after reviewing the page.
- [ ] If CAPTCHA, sign-in, EULA acknowledgement, checkout, rate limit, or an unexpected dialog appears, confirm the run pauses and leaves the prompt for the user.
- [ ] Confirm an item is reported claimed only after Fab visibly shows it in the user's library; a click or navigation alone must not count.

## Persistence and recovery

- [ ] Change auto-start, delay, and Fab license preference; save, reopen Settings, and confirm the saved values load.
- [ ] Confirm auto-start remains off unless explicitly enabled.
- [ ] Navigate from a listing to a product as part of a claim and confirm the exact current item is restored safely for resume.
- [ ] Navigate away from a supported page or close its tab and confirm the run stops safely.
- [ ] Confirm a storage/message failure is surfaced and does not produce a claimed result.

## Completion record

Record the Firefox version, extension build/revision, date, page locale, and observed result for each attempted step. Do not record account credentials, cookies, claim codes, or payment details here. Update this checklist only after each step has actually been performed.
