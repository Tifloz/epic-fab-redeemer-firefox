(function initEpicClaim(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  api.sites = api.sites || {};
  api.sites.epic = api.sites.epic || {};

  const CLAIM_LABELS = new Set([
    "get",
    "get it",
    "get now",
    "claim",
    "claim now",
    "claim for free",
    "obtenir",
    "recuperer",
    "recuperer maintenant"
  ]);
  const OWNED_LABELS = [
    /^owned$/i,
    /^in\s+(?:your\s+)?library$/i,
    /^already\s+in\s+(?:your\s+)?library$/i,
    /^possede(?:e)?$/i,
    /^dans\s+(?:votre\s+)?bibliotheque$/i,
    /^deja\s+dans\s+(?:votre\s+)?bibliotheque$/i
  ];
  const CURRENT_NOW_TEXT = [
    /\bfree\s+now\b/i,
    /\bgratuit(?:e)?\s+maintenant\b/i,
    /\boffert(?:e)?\s+maintenant\b/i
  ];
  const FREE_UNTIL_TEXT = [
    /\bfree\s+until\b/i,
    /\bgratuit(?:e)?\s+jusqu['’]?(?:au|à)\b/i,
    /\boffert(?:e)?\s+jusqu['’]?(?:au|à)\b/i
  ];
  const BLOCKING_COPY = {
    captcha: /captcha|recaptcha|hcaptcha|verify\s+you(?:'re|\s+are)\s+human|verification\s+challenge/i,
    twoFactor: /two[- ]factor|2fa|authenticator\s+code|verification\s+code/i,
    signIn: /sign\s+in\s+to\s+(?:continue|claim|complete)|log\s+in\s+to\s+(?:continue|claim)/i,
    eula: /end[- ]user\s+license|license\s+agreement|terms\s+and\s+conditions|agree\s+to\s+the\s+terms/i,
    checkout: /order\s+summary|place\s+order|complete\s+(?:your\s+)?purchase|confirm\s+(?:your\s+)?order|payment\s+method|r[eé]capitulatif\s+(?:de\s+la\s+)?commande|passer\s+la\s+commande|moyen\s+de\s+paiement/i,
    rateLimit: /unable\s+to\s+download\s+any\s+more\s+free\s+games|too\s+many\s+(?:claims|requests)|claim\s+limit\s+(?:reached|exceeded)|try\s+again\s+later/i
  };

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function textOf(element) {
    if (!element) return "";
    return typeof element.innerText === "string"
      ? element.innerText.replace(/\s+/g, " ").trim()
      : String(element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = global.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    return element.getClientRects().length > 0;
  }

  function controlLabel(element) {
    return normalize(
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      textOf(element)
    );
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(value, global.location.href);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "store.epicgames.com" ||
        !/(?:^|\/)p\//i.test(url.pathname)
      ) {
        return null;
      }
      return `${url.origin}${url.pathname}`;
    } catch {
      return null;
    }
  }

  function visibleElements(document, selector) {
    return [...document.querySelectorAll(selector)].filter(isVisible);
  }

  function visibleOwnedEvidence(root) {
    const controls = visibleElements(
      root,
      "button, a[href], [role='button'], [aria-label], [title]"
    );
    return controls.some((element) => {
      const label = controlLabel(element);
      return OWNED_LABELS.some((pattern) => pattern.test(label));
    });
  }

  function visibleDialogs(document) {
    return visibleElements(document, "dialog, [role='dialog'], [aria-modal='true']");
  }

  function classifyEpicPage(document, location = global.location) {
    const dialogs = visibleDialogs(document);
    const promptText = dialogs.map(textOf).join(" ");
    const pageText = textOf(document.body);
    const text = promptText || pageText;

    if (BLOCKING_COPY.rateLimit.test(text)) {
      return {
        state: "rate-limited",
        detail: "Epic is limiting free-game claims. Wait and retry later."
      };
    }

    const visibleCaptchaFrame = visibleElements(document, "iframe[src]")
      .some((frame) => /captcha|challenge/i.test(frame.src));
    if (visibleCaptchaFrame || BLOCKING_COPY.captcha.test(text)) {
      return {
        state: "needs-user-action",
        detail: "Complete Epic's CAPTCHA in the page, then resume."
      };
    }

    const visiblePasswordField = visibleElements(document, "input[type='password']").length > 0;
    if (BLOCKING_COPY.twoFactor.test(text)) {
      return {
        state: "needs-user-action",
        detail: "Complete Epic's two-factor verification in the page, then resume."
      };
    }
    if (visiblePasswordField || BLOCKING_COPY.signIn.test(promptText)) {
      return {
        state: "needs-user-action",
        detail: "Sign in to Epic in the page, then resume."
      };
    }
    if (BLOCKING_COPY.eula.test(promptText)) {
      return {
        state: "needs-user-action",
        detail: "Review and complete Epic's license or terms prompt in the page, then resume."
      };
    }
    if (
      BLOCKING_COPY.checkout.test(promptText) ||
      /checkout|purchase|order/i.test(location.pathname)
    ) {
      return {
        state: "needs-user-action",
        detail: "Review the free order in Epic's checkout and finish it yourself, then resume."
      };
    }
    if (dialogs.length > 0) {
      return {
        state: "needs-user-action",
        detail: "Epic opened an unexpected dialog. Review it in the page, then resume."
      };
    }
    return null;
  }

  function hasCurrentOfferEvidence(surface) {
    const text = textOf(surface);
    if (!text || /coming\s+soon|available\s+soon|a\s+venir|bientot/i.test(text)) {
      return false;
    }
    const deadlineElements = visibleElements(surface, "time[datetime]");
    const deadlines = deadlineElements
      .map((element) => Date.parse(element.dateTime))
      .filter(Number.isFinite);
    const hasFutureDeadline = deadlines.some((deadline) => deadline > Date.now());

    if (FREE_UNTIL_TEXT.some((pattern) => pattern.test(text))) {
      return hasFutureDeadline;
    }
    if (CURRENT_NOW_TEXT.some((pattern) => pattern.test(text))) {
      return deadlines.length === 0 || hasFutureDeadline;
    }
    return hasFrenchFreePromotion(text) && (deadlines.length === 0 || hasFutureDeadline);
  }

  function hasFrenchFreePromotion(text) {
    if (!/-100\s*%\s*[\d.,\s$€£]{0,24}(?:USD?|EUR|GBP)?\s*\*?\s*gratuit\b/i.test(text)) return false;
    const expiry = normalize(text).match(/\bla promotion se termine le\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+(\d{2}):(\d{2})\s+utc\b/);
    if (!expiry) return false;
    const [day, month, year, hour, minute] = expiry.slice(1).map(Number);
    const deadline = new Date(Date.UTC(year, month - 1, day, hour, minute));
    return deadline.getUTCFullYear() === year && deadline.getUTCMonth() === month - 1 &&
      deadline.getUTCDate() === day && deadline.getUTCHours() === hour &&
      deadline.getUTCMinutes() === minute && deadline.getTime() > Date.now();
  }

  function productTitleMatches(document, item) {
    const expected = normalize(item && item.title);
    if (!expected) return false;
    const headings = visibleElements(document, "main h1, main h2, h1, h2");
    return headings.some((heading) => {
      const title = normalize(textOf(heading));
      return title && (title === expected || title.includes(expected) || expected.includes(title));
    });
  }

  function productSurface(document, item) {
    const expected = normalize(item && item.title);
    if (!expected) return null;
    const main = document.querySelector("main") || document.body;
    const headings = visibleElements(main, "h1, h2").filter((heading) => {
      const title = normalize(textOf(heading));
      return title && (title === expected || title.includes(expected) || expected.includes(title));
    });
    let ancestor = headings.length === 1 ? headings[0] : null;
    for (let depth = 0; ancestor && depth < 10; depth += 1, ancestor = ancestor.parentElement) {
      if (!isVisible(ancestor)) continue;
      const headingCount = visibleElements(ancestor, "h1, h2").length;
      if (headingCount !== 1) continue;
      const controls = visibleElements(ancestor, "button, [role='button']");
      const hasRelevantControl = controls.some((element) => {
        const label = controlLabel(element);
        return CLAIM_LABELS.has(label) || OWNED_LABELS.some((pattern) => pattern.test(label));
      });
      if (hasRelevantControl && (visibleOwnedEvidence(ancestor) || hasCurrentOfferEvidence(ancestor))) return ancestor;
      if (ancestor === main) break;
    }
    return headings.some((heading) => normalize(textOf(heading)) === expected) ? baseGameSidebar(main) : null;
  }

  function baseGameSidebar(main) {
    const selector = "button, [role='button']";
    const controls = visibleElements(main, selector).filter((control) => {
      const label = controlLabel(control);
      return CLAIM_LABELS.has(label) || OWNED_LABELS.some((pattern) => pattern.test(label));
    });
    if (controls.length !== 1) return null;
    for (let node = controls[0].parentElement; node && node !== main; node = node.parentElement) {
      const text = textOf(node);
      if (text.length > 1200 || visibleElements(node, 'h1, h2').length > 0) break;
      if (isVisible(node) && /\b(?:jeu de base|base game)\b/i.test(text) &&
          (hasCurrentOfferEvidence(node) || visibleOwnedEvidence(node))) return node;
    }
    return null;
  }

  function uniqueClaimControls(root) {
    return visibleElements(root, "button, [role='button']")
      .filter((element) => !element.disabled && CLAIM_LABELS.has(controlLabel(element)));
  }

  function findProductLink(document, item) {
    const expected = canonicalUrl(item.url);
    if (!expected) return null;
    const links = visibleElements(document, "a[href]")
      .filter((anchor) => canonicalUrl(anchor.href) === expected && anchor.target !== "_blank");
    return links[0] || null;
  }

  function waitFor(predicate, { signal, timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish(resolve, null), timeoutMs);
      const poll = setInterval(check, 200);

      function cleanup() {
        clearTimeout(timeout);
        clearInterval(poll);
        observer.disconnect();
        if (signal) signal.removeEventListener("abort", onAbort);
      }

      function finish(callback, value) {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      }

      function onAbort() {
        finish(reject, new DOMException("The claim was stopped.", "AbortError"));
      }

      function check() {
        if (signal && signal.aborted) {
          onAbort();
          return;
        }
        let result;
        try {
          result = predicate();
        } catch {
          result = null;
        }
        if (result) finish(resolve, result);
      }

      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      check();
    });
  }

  async function openProductPage(item, { signal, reportStatus }) {
    const link = findProductLink(document, item);
    if (!link) {
      return {
        state: "needs-user-action",
        detail: "The selected giveaway's product link is missing or ambiguous. Open it manually and resume."
      };
    }

    const current = canonicalUrl(global.location.href);
    const expected = canonicalUrl(item.url);
    if (current === expected) return null;

    await reportStatus({ phase: "awaiting-navigation", detail: "Opening the selected Epic game page." });
    link.click();

    const result = await waitFor(() => {
      const issue = classifyEpicPage(document, global.location);
      if (issue) return issue;
      if (
        canonicalUrl(global.location.href) === expected &&
        productTitleMatches(document, item)
      ) {
        return { state: "product-ready" };
      }
      return null;
    }, { signal, timeoutMs: 20000 });

    if (result && result.state === "product-ready") return null;
    if (result) return result;
    return {
      state: "needs-user-action",
      detail: "Epic did not open the expected game page. Review the page and resume manually."
    };
  }

  async function claimEpic(item, { signal, settings, reportStatus }) {
    if (!item || item.eligible === false) {
      return { state: "failed", detail: "This offer did not pass Epic giveaway eligibility checks." };
    }
    if (signal && signal.aborted) {
      throw new DOMException("The claim was stopped.", "AbortError");
    }

    const pageIssue = classifyEpicPage(document, global.location);
    if (pageIssue) return pageIssue;

    const discovery = api.sites.epic.discovery;
    if (!discovery || typeof discovery.scan !== "function") {
      return { state: "failed", detail: "Epic's giveaway scanner is unavailable." };
    }

    const currentItemUrl = canonicalUrl(item.url);
    if (!currentItemUrl) {
      return { state: "failed", detail: "The Epic product URL was invalid." };
    }

    const onListing = /(?:^|\/)free-games\/?$/i.test(global.location.pathname);
    if (onListing) {
      const currentOffer = discovery.scan(document, global.location)
        .find((candidate) => candidate.key === currentItemUrl && candidate.eligible);
      if (currentOffer && currentOffer.owned) {
        return { state: "already-owned", detail: "Epic shows this game in your library." };
      }
      if (!currentOffer) {
        return { state: "failed", detail: "Epic no longer shows this as a current free giveaway." };
      }
      const navigationIssue = await openProductPage(item, { signal, reportStatus });
      if (navigationIssue) return navigationIssue;
    } else {
      const pageUrl = canonicalUrl(global.location.href);
      if (pageUrl !== currentItemUrl) {
        return { state: "needs-user-action", detail: "Open the selected Epic game page, then resume." };
      }
    }

    const updatedIssue = classifyEpicPage(document, global.location);
    if (updatedIssue) return updatedIssue;
    if (!productTitleMatches(document, item)) {
      return { state: "needs-user-action", detail: "The Epic page does not match the selected game. Review it before continuing." };
    }
    const surface = productSurface(document, item);
    if (!surface) {
      return { state: "needs-user-action", detail: "Epic's visible product controls could not be matched to this game." };
    }
    if (visibleOwnedEvidence(surface)) {
      return { state: "already-owned", detail: "Epic shows this game in your library." };
    }
    if (!hasCurrentOfferEvidence(surface)) {
      return { state: "needs-user-action", detail: "The selected product surface does not show a current free giveaway. No claim action was taken." };
    }

    const controls = uniqueClaimControls(surface);
    if (controls.length !== 1) {
      return {
        state: "needs-user-action",
        detail: controls.length === 0
          ? "No unique visible Get/Claim button was found. Review the page and continue manually."
          : "Epic shows more than one possible claim button. Choose the correct one manually."
      };
    }

    if (signal && signal.aborted) {
      throw new DOMException("The claim was stopped.", "AbortError");
    }

    const claimButton = controls[0];
    if (!isVisible(claimButton) || claimButton.disabled) {
      return { state: "needs-user-action", detail: "Epic's claim button is not available." };
    }

    claimButton.click();
    await reportStatus({ phase: "claiming", detail: "Waiting for Epic to confirm ownership." });

    const outcome = await waitFor(() => {
      const issue = classifyEpicPage(document, global.location);
      if (issue) return issue;
      const confirmedSurface = productTitleMatches(document, item)
        ? productSurface(document, item)
        : null;
      if (confirmedSurface && visibleOwnedEvidence(confirmedSurface)) {
        return { state: "claimed", detail: "Epic confirms this game is in your library." };
      }
      return null;
    }, { signal, timeoutMs: 20000 });

    if (outcome) return outcome;
    return {
      state: "failed",
      detail: "Epic did not show an ownership confirmation. The claim was not reported as successful."
    };
  }

  api.sites.epic.claim = Object.freeze({ claimEpic, classifyEpicPage });
})(globalThis);
