(function initEpicDiscovery(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  api.sites = api.sites || {};
  api.sites.epic = api.sites.epic || {};

  const CURRENT_NOW_MARKERS = [
    /\bfree\s+now\b/i,
    /\bclaim\s+(?:it\s+)?free\s+now\b/i,
    /\bgratuit(?:e)?\s+maintenant\b/i,
    /\boffert(?:e)?\s+maintenant\b/i
  ];
  const FREE_UNTIL_MARKERS = [
    /\bfree\s+until\b/i,
    /\boffert(?:e)?\s+jusqu['’]?(?:au|à)\b/i,
    /\bgratuit(?:e)?\s+jusqu['’]?(?:au|à)\b/i
  ];
  const UPCOMING_MARKERS = [
    /\bcoming\s+soon\b/i,
    /\bavailable\s+soon\b/i,
    /\bcoming\s+on\b/i,
    /\bà\s+venir\b/i,
    /\bbientôt\b/i
  ];
  const EXCLUDED_MARKERS = [
    /\bfree[- ]to[- ]play\b/i,
    /\bplay\s+for\s+free\b/i,
    /\bplay\s+now\b/i,
    /\bfree\s+access\b/i,
    /\bdemos?\b/i,
    /\bplaytests?\b/i,
    /\btrial\s+version\b/i,
    /\baccès\s+gratuit\b/i,
    /\bjouer\s+gratuitement\b/i,
    /\bdémo(?:s)?\b/i,
    /\bversion\s+d['’]essai\b/i
  ];
  const MOBILE_OFFER_MARKERS = [
    /\bavailable on mobile\b/i,
    /\bdisponible sur mobile\b/i,
    /\binstaller l['’](?:appli|application) mobile\b/i,
    /\binstall the mobile app\b/i,
    /\bavailable on android and (?:iphone|ipad)\b/i
  ];
  const OWNED_MARKERS = [
    /^owned$/i,
    /^in\s+(?:your\s+)?library$/i,
    /^already\s+in\s+(?:your\s+)?library$/i,
    /^possede(?:e)?$/i,
    /^dans\s+(?:votre\s+)?bibliotheque$/i,
    /^deja\s+dans\s+(?:votre\s+)?bibliotheque$/i
  ];
  const FRENCH_MONTHS = new Map([
    ["janvier", 0], ["janv", 0],
    ["fevrier", 1], ["fevr", 1],
    ["mars", 2],
    ["avril", 3], ["avr", 3],
    ["mai", 4],
    ["juin", 5],
    ["juillet", 6], ["juil", 6],
    ["aout", 7],
    ["septembre", 8], ["sept", 8],
    ["octobre", 9], ["oct", 9],
    ["novembre", 10], ["nov", 10],
    ["decembre", 11], ["dec", 11]
  ]);

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function elementText(element) {
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

  function matchesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function isEpicProductUrl(value, base = global.location.href) {
    try {
      const url = new URL(value, base);
      return url.protocol === "https:" &&
        url.hostname === "store.epicgames.com" &&
        /(?:^|\/)p\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function canonicalProductUrl(value, base = global.location.href) {
    try {
      const url = new URL(value, base);
      if (!isEpicProductUrl(url.href, base)) return null;
      return `${url.origin}${url.pathname}`;
    } catch {
      return null;
    }
  }

  function uniqueProductLinks(root) {
    const byUrl = new Map();
    for (const anchor of root.querySelectorAll("a[href]")) {
      const url = canonicalProductUrl(anchor.href);
      if (url && !byUrl.has(url)) byUrl.set(url, anchor);
    }
    return [...byUrl.values()];
  }

  function parseFrenchDeadline(text) {
    const match = normalizeText(text).match(
      /jusqu['’]au\s+(\d{1,2})\s+([a-z.]+)(?:\s+(\d{4}))?\s+a\s*(\d{1,2}:\d{2})\b/i
    );
    if (!match) return null;

    const [, dayText, monthText, yearText, clockText] = match;
    const month = FRENCH_MONTHS.get(monthText.replace(/\.$/, ""));
    if (!Number.isInteger(month)) return null;
    const now = new Date();
    const year = Number(yearText || now.getFullYear());
    const [hour, minute] = clockText.split(":").map(Number);
    const deadline = new Date(year, month, Number(dayText), hour, minute, 0, 0);
    if (
      deadline.getFullYear() !== year || deadline.getMonth() !== month ||
      deadline.getDate() !== Number(dayText) || deadline.getHours() !== hour ||
      deadline.getMinutes() !== minute
    ) {
      return null;
    }
    return deadline.getTime();
  }

  function hasCurrentGiveawayMarker(card) {
    const text = elementText(card);
    if (matchesAny(text, UPCOMING_MARKERS) || matchesAny(text, EXCLUDED_MARKERS)) return false;
    if (matchesAny(text, CURRENT_NOW_MARKERS)) {
      const visibleDeadlines = [...card.querySelectorAll("time[datetime]")]
        .filter(isVisible)
        .map((element) => Date.parse(element.dateTime))
        .filter(Number.isFinite);
      return visibleDeadlines.length === 0 || visibleDeadlines.some((deadline) => deadline > Date.now());
    }
    if (!matchesAny(text, FREE_UNTIL_MARKERS)) return false;
    const deadlines = [...card.querySelectorAll("time[datetime]")]
      .filter(isVisible)
      .map((element) => Date.parse(element.dateTime))
      .filter(Number.isFinite);
    const parsedDeadline = parseFrenchDeadline(text);
    if (parsedDeadline !== null) deadlines.push(parsedDeadline);
    return deadlines.some((deadline) => deadline > Date.now());
  }

  function findCardRoot(anchor, section) {
    let ancestor = anchor.parentElement;
    for (let depth = 0; ancestor && ancestor !== section && depth < 10; depth += 1, ancestor = ancestor.parentElement) {
      const products = uniqueProductLinks(ancestor);
      if (products.length !== 1) continue;
      const text = elementText(ancestor);
      if (!text || text.length > 1200) continue;
      const hasOfferWindow = matchesAny(text, CURRENT_NOW_MARKERS) || matchesAny(text, FREE_UNTIL_MARKERS);
      if (
        ancestor.matches("article, li, [role='listitem'], [data-testid*='card' i], [data-testid*='offer' i]") ||
        hasOfferWindow
      ) {
        return ancestor;
      }
    }
    return null;
  }

  function hasOwnedEvidence(card) {
    const controls = card.querySelectorAll("button, a[href], [role='button'], [aria-label], [title]");
    for (const control of controls) {
      if (!isVisible(control)) continue;
      const labels = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        elementText(control)
      ].map(normalizeText).filter(Boolean);
      if (labels.some((label) => OWNED_MARKERS.some((pattern) => pattern.test(label)))) {
        return true;
      }
    }
    return false;
  }

  function cardTitle(card, productAnchor) {
    const heading = card.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    const values = [
      heading && elementText(heading),
      productAnchor.getAttribute("aria-label"),
      productAnchor.getAttribute("title"),
      elementText(productAnchor),
      ...[...card.querySelectorAll("img[alt]")].map((image) => image.alt)
    ];
    for (const value of values) {
      const title = String(value || "").replace(/\s+/g, " ").trim();
      if (title && title.length <= 300) return title;
    }
    return null;
  }

  function isEpicGiveawayCard(card) {
    if (!isVisible(card)) return false;

    const text = elementText(card);
    if (
      !text ||
      matchesAny(text, UPCOMING_MARKERS) ||
      matchesAny(text, EXCLUDED_MARKERS) ||
      matchesAny(text, MOBILE_OFFER_MARKERS)
    ) {
      return false;
    }
    if (!hasCurrentGiveawayMarker(card)) return false;
    return uniqueProductLinks(card).length === 1;
  }

  function isFreeGamesRoute(location) {
    return /(?:^|\/)free-games\/?$/i.test(location.pathname);
  }

  function isProductRoute(location) {
    return /(?:^|\/)p\//i.test(location.pathname);
  }

  function canRunEpic(document, location = global.location) {
    return Boolean(
      document &&
      location &&
      location.protocol === "https:" &&
      location.hostname === "store.epicgames.com" &&
      (isFreeGamesRoute(location) || isProductRoute(location))
    );
  }

  function scanEpic(document, location = global.location) {
    if (!canRunEpic(document, location) || !isFreeGamesRoute(location)) return [];

    const discovered = new Map();
    for (const anchor of uniqueProductLinks(document)) {
      const card = findCardRoot(anchor, document);
      if (!card || !isEpicGiveawayCard(card)) continue;

      const url = canonicalProductUrl(anchor.href);
      const title = cardTitle(card, anchor);
      if (!url || !title) continue;

      const eligible = hasCurrentGiveawayMarker(card);
      discovered.set(url, {
        key: url,
        title,
        url,
        eligible,
        owned: hasOwnedEvidence(card)
      });
    }
    return [...discovered.values()];
  }

  api.sites.epic.discovery = Object.freeze({
    canRun: canRunEpic,
    scan: scanEpic,
    isEpicGiveawayCard,
    isEpicProductUrl,
    parseFrenchDeadline
  });
})(globalThis);
