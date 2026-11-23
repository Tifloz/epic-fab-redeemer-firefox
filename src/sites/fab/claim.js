(function initFabClaim(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  api.sites = api.sites || {};
  api.sites.fab = api.sites.fab || {};

  const ADD_LIBRARY_LABELS = new Set([
    "add to library",
    "add to my library",
    "add to your library",
    "ajouter a la bibliotheque",
    "ajouter a ma bibliotheque",
    "ajouter a votre bibliotheque"
  ]);
  const LICENSE_LABELS = {
    personal: /^(?:personal(?:\s+license)?|licence\s+personnelle|license\s+personnelle)$/,
    professional: /^(?:professional(?:\s+license)?|licence\s+professionnelle|license\s+professionnelle)$/
  };
  const OWNED_LABELS = [
    /^owned$/,
    /^in\s+(?:your\s+)?library$/,
    /^already\s+in\s+(?:your\s+)?library$/,
    /^added\s+to\s+(?:your\s+)?library$/,
    /^possede(?:e)?$/,
    /^dans\s+(?:votre\s+)?bibliotheque$/,
    /^ajoute(?:e)?\s+a\s+la\s+bibliotheque$/
  ];
  const BLOCKING_COPY = {
    captcha: /captcha|recaptcha|hcaptcha|verification\s+challenge|verify\s+you(?:'re|\s+are)\s+human/i,
    signIn: /sign\s+in|log\s+in|connexion|se\s+connecter/i,
    eula: /end[- ]user\s+license|eula|license\s+agreement|terms\s+and\s+conditions|i\s+have\s+read\s+and\s+agree|conditions\s+d['’]utilisation|contrat\s+de\s+licence/i,
    checkout: /checkout|order\s+summary|place\s+order|complete\s+(?:your\s+)?purchase|payment\s+method|finaliser\s+(?:la\s+)?commande/i,
    rateLimit: /too\s+many\s+(?:requests|claims)|rate\s+limit|try\s+again\s+later|limite\s+de\s+requete|reessayez\s+plus\s+tard/i
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
    return api.sites.fab.discovery.canonicalListingUrl(value, global.location.href);
  }

  function visibleElements(root, selector) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function visibleOwned(root) {
    return visibleElements(root, "button, a[href], [role='button'], [aria-label], [title]")
      .some((element) => OWNED_LABELS.some((pattern) => pattern.test(controlLabel(element))));
  }

  function visibleDialogs(document) {
    return visibleElements(document, "dialog, [role='dialog'], [aria-modal='true']");
  }

  function classifyFabPage(document, location = global.location) {
    const dialogs = visibleDialogs(document);
    const dialogText = normalize(dialogs.map(textOf).join(" "));
    const pageText = normalize(textOf(document.body));
    const text = dialogText || pageText;

    if (BLOCKING_COPY.rateLimit.test(text)) {
      return { state: "rate-limited", detail: "Fab is limiting requests. Wait and retry later." };
    }
    if (BLOCKING_COPY.captcha.test(text) || visibleElements(document, "iframe[src]").some((frame) => /captcha|challenge/i.test(frame.src))) {
      return { state: "needs-user-action", detail: "Complete Fab's CAPTCHA in the page, then resume." };
    }
    if (BLOCKING_COPY.eula.test(dialogText) || (!dialogText && BLOCKING_COPY.eula.test(pageText))) {
      return { state: "needs-user-action", detail: "Review and accept Fab's license terms yourself, then resume." };
    }
    if (
      BLOCKING_COPY.signIn.test(dialogText) ||
      (!dialogText && BLOCKING_COPY.signIn.test(pageText) && visibleElements(document, "input[type='password'], input[type='email']").length > 0)
    ) {
      return { state: "needs-user-action", detail: "Sign in to Fab in the page, then resume." };
    }
    if (BLOCKING_COPY.checkout.test(dialogText) || /(?:^|\/)(?:checkout|cart|purchase)(?:\/|$)/i.test(location.pathname)) {
      return { state: "needs-user-action", detail: "Review the Fab order in the page and finish it yourself, then resume." };
    }
    if (dialogs.length > 0) {
      return { state: "needs-user-action", detail: "Fab opened an unexpected dialog. Review it in the page, then resume." };
    }
    return null;
  }

  function productTitleMatches(document, item) {
    const expected = normalize(item && item.title);
    if (!expected) return false;
    return visibleElements(document, "main h1, main h2, h1, h2").some((heading) => {
      const title = normalize(textOf(heading));
      return title && (title === expected || title.includes(expected) || expected.includes(title));
    });
  }

  function licenseControlRoots(root) {
    const candidates = visibleElements(root, "label, [role='radio'], input[type='radio'], button, [role='button']");
    const unique = new Map();
    for (const control of candidates) {
      const label = control.closest("label, [role='radio'], button, [role='button']") || control;
      if (licenseKindFromControl(label)) {
        unique.set(label, label);
      }
    }
    return [...unique.values()];
  }

  function licenseKindFromLabel(text) {
    const normalized = normalize(text);
    if (LICENSE_LABELS.personal.test(normalized)) return "personal";
    if (LICENSE_LABELS.professional.test(normalized)) return "professional";
    return null;
  }

  function licenseKindFromControl(control) {
    const candidates = [control, ...control.querySelectorAll("span, div, p, strong, label")];
    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const value = textOf(candidate);
      if (!value || value.length > 80) continue;
      const kind = licenseKindFromLabel(value);
      if (kind) return kind;
    }
    return licenseKindFromLabel(control.getAttribute("aria-label"));
  }

  function isSelected(control) {
    const input = control.matches("input") ? control : control.querySelector("input[type='radio']");
    return Boolean(
      (input && input.checked) ||
      control.getAttribute("aria-checked") === "true" ||
      control.getAttribute("aria-pressed") === "true" ||
      control.getAttribute("data-state") === "checked"
    );
  }

  function selectFabLicense(root, preference) {
    const choices = licenseControlRoots(root);
    if (choices.length === 0) return "unavailable";
    const matching = choices.filter((choice) => licenseKindFromControl(choice) === preference);
    if (matching.length === 0) return "unavailable";
    if (matching.length !== 1) return "ambiguous";

    const option = matching[0];
    const priceKind = api.sites.fab.discovery.exactPriceKind(option);
    if (priceKind === "from-free") return "paid";
    if (priceKind !== "free") return "ambiguous";

    if (!isSelected(option)) option.click();
    return "selected";
  }

  function addLibraryButtons(surface) {
    return visibleElements(surface, "button, a[href], [role='button']")
      .filter((element) => !element.disabled && ADD_LIBRARY_LABELS.has(controlLabel(element)));
  }

  function findProductLink(document, item) {
    const expected = canonicalUrl(item.url);
    if (!expected) return null;
    return visibleElements(document, "a[href]")
      .find((anchor) => canonicalUrl(anchor.href) === expected && anchor.target !== "_blank") || null;
  }

  function waitFor(predicate, { signal, timeoutMs = 18000 } = {}) {
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
        if (signal && signal.aborted) return onAbort();
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

  function onFreeListingPage(location) {
    return api.sites.fab.discovery.isFreeListingRoute(location);
  }

  async function openProductPage(item, { signal, reportStatus }) {
    const link = findProductLink(document, item);
    if (!link) {
      return { state: "needs-user-action", detail: "The selected Fab listing link is missing. Open it manually and resume." };
    }
    if (canonicalUrl(global.location.href) === canonicalUrl(item.url)) return null;

    await reportStatus({ phase: "awaiting-navigation", detail: "Opening the selected Fab asset page." });
    link.click();
    const result = await waitFor(() => {
      const prompt = classifyFabPage(document, global.location);
      if (prompt) return prompt;
      if (canonicalUrl(global.location.href) === canonicalUrl(item.url) && productTitleMatches(document, item)) {
        return { state: "product-ready" };
      }
      return null;
    }, { signal, timeoutMs: 20000 });

    if (result && result.state === "product-ready") return null;
    if (result) return result;
    return { state: "needs-user-action", detail: "Fab did not open the selected listing. Review the page and resume manually." };
  }

  function classifyPostClick(document, item) {
    const prompt = classifyFabPage(document, global.location);
    if (prompt) return prompt;
    const url = canonicalUrl(global.location.href);
    if (url !== canonicalUrl(item.url)) {
      return { state: "needs-user-action", detail: "Fab changed pages after the claim action. Review the listing and resume." };
    }
    const surface = api.sites.fab.discovery.productSurface(document);
    if (surface && productTitleMatches(document, item) && visibleOwned(surface)) {
      return { state: "claimed", detail: "Fab shows this asset in your library." };
    }
    return null;
  }

  async function claimFab(item, { signal, settings, reportStatus }) {
    if (!item || item.eligible === false) {
      return { state: "failed", detail: "This item did not pass Fab's visible free-price checks." };
    }
    if (signal && signal.aborted) {
      throw new DOMException("The claim was stopped.", "AbortError");
    }

    const discovery = api.sites.fab.discovery;
    const url = canonicalUrl(item.url);
    if (!discovery || !url) {
      return { state: "failed", detail: "The Fab listing URL was invalid." };
    }

    const pageIssue = classifyFabPage(document, global.location);
    if (pageIssue) return pageIssue;

    if (onFreeListingPage(global.location)) {
      const current = discovery.scan(document, global.location).find((candidate) => candidate.key === url && candidate.eligible);
      if (!current) {
        return { state: "failed", detail: "Fab no longer shows this asset in a free listing." };
      }
      if (current.owned) {
        return { state: "already-owned", detail: "Fab shows this asset in your library." };
      }
      const navigationIssue = await openProductPage(item, { signal, reportStatus });
      if (navigationIssue) return navigationIssue;
    } else if (canonicalUrl(global.location.href) !== url) {
      return { state: "needs-user-action", detail: "Open the selected Fab asset page, then resume." };
    }

    const prompt = classifyFabPage(document, global.location);
    if (prompt) return prompt;
    if (!productTitleMatches(document, item)) {
      return { state: "needs-user-action", detail: "The Fab page does not match the selected asset. Review it before continuing." };
    }
    const surface = discovery.productSurface(document);
    if (!surface) {
      return { state: "needs-user-action", detail: "Fab's product details could not be matched safely to this asset." };
    }
    if (visibleOwned(surface)) {
      return { state: "already-owned", detail: "Fab shows this asset in your library." };
    }

    const preference = settings && settings.fabLicense;
    if (preference !== "personal" && preference !== "professional") {
      return { state: "failed", detail: "The Fab license preference is invalid." };
    }

    const licenseChoices = licenseControlRoots(surface);
    if (licenseChoices.length > 0) {
      const selection = selectFabLicense(surface, preference);
      if (selection === "paid") {
        return { state: "failed", detail: "The selected Fab license is not free. No claim action was taken." };
      }
      if (selection !== "selected") {
        return { state: "needs-user-action", detail: "Fab's license options are missing or ambiguous. Choose the free license yourself." };
      }
    } else if (discovery.exactPriceKind(surface) !== "free") {
      return { state: "needs-user-action", detail: "The selected Fab license is not visibly free. No claim action was taken." };
    }

    const buttons = addLibraryButtons(surface);
    if (buttons.length !== 1) {
      return {
        state: "needs-user-action",
        detail: buttons.length === 0
          ? "No unique Add to Library control was found. Review the page and continue manually."
          : "Fab shows multiple Add to Library controls. Choose the correct one manually."
      };
    }

    if (signal && signal.aborted) {
      throw new DOMException("The claim was stopped.", "AbortError");
    }
    await reportStatus({ phase: "claiming", detail: "Adding the selected free asset to your Fab library." });
    buttons[0].click();

    const outcome = await waitFor(() => classifyPostClick(document, item), { signal, timeoutMs: 18000 });
    if (outcome) return outcome;
    return {
      state: "failed",
      detail: "Fab did not confirm library ownership. The asset was not reported as claimed."
    };
  }

  api.sites.fab.claim = Object.freeze({
    claimFab,
    classifyFabPage,
    selectFabLicense
  });
})(globalThis);
