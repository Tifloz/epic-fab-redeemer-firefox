(function initEpicDiscovery(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  api.sites = api.sites || {};
  api.sites.epic = api.sites.epic || {};

  const GIVEAWAY_MARKERS = [
    /\bfree\s+(?:game\s+)?giveaway\b/i,
    /\bgame\s+giveaway\b/i,
    /\bjeu(?:x)?\s+offert(?:s)?\b/i,
    /\boffre\s+gratuite\b/i,
    /\bcadeaux?\b/i
  ];
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
  const OWNED_MARKERS = [
    /^owned$/i,
    /^in\s+(?:your\s+)?library$/i,
    /^already\s+in\s+(?:your\s+)?library$/i,
    /^possede(?:e)?$/i,
    /^dans\s+(?:votre\s+)?bibliotheque$/i,
    /^deja\s+dans\s+(?:votre\s+)?bibliotheque$/i
  ];
  const CLAIM_ACTIONS = new Set([
    "get",
    "get it",
    "get now",
    "claim",
    "claim now",
    "obtenir",
    "recuperer",
    "recuperer maintenant"
  ]);
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

  function isGiveawayPageMarker(element) {
    const text = elementText(element);
    if (!text || text.length > 100) return false;
    const directLabel = normalizeText(
      element.getAttribute("aria-label") || element.getAttribute("title") || text
    );
    return matchesAny(directLabel, GIVEAWAY_MARKERS);
  }

  function giveawaySections(document) {
    const results = new Set();
    const markers = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, [role='heading'], [aria-label], [data-testid]"
    );

    for (const marker of markers) {
      if (!isVisible(marker) || !isGiveawayPageMarker(marker)) continue;
      const link = marker.closest("a[href]");
      if (link && !isEpicProductUrl(link.href)) {
        // Epic also links a mobile-store promotion using the words “Free Giveaway”.
        continue;
      }

      let section = marker.closest("section, [role='region']");
      if (!section) {
        let ancestor = marker.parentElement;
        for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
          const productLinks = [...ancestor.querySelectorAll("a[href]")]
            .filter((anchor) => canonicalProductUrl(anchor.href));
          if (productLinks.length > 0 && productLinks.length <= 8) {
            section = ancestor;
            break;
          }
        }
      }
      if (section && section !== document.body && section !== document.documentElement) {
        results.add(section);
      }
    }

    return [...results];
  }

  function uniqueProductLinks(root) {
    const byUrl = new Map();
    for (const anchor of root.querySelectorAll("a[href]")) {
      const url = canonicalProductUrl(anchor.href);
      if (url && !byUrl.has(url)) byUrl.set(url, anchor);
    }
    return [...byUrl.values()];
  }

  function hasVisibleClaimAction(card) {
    const controls = card.querySelectorAll("button, a[href], [role='button']");
    for (const control of controls) {
      if (!isVisible(control)) continue;
      const label = normalizeText(
        control.getAttribute("aria-label") || control.getAttribute("title") || elementText(control)
      );
      if (CLAIM_ACTIONS.has(label)) return true;
    }
    return false;
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
      if (
        ancestor.matches("article, li, [role='listitem'], [data-testid*='card' i], [data-testid*='offer' i]") ||
        (hasVisibleClaimAction(ancestor) && ancestor.querySelector("img[alt], h1, h2, h3, h4, [role='heading']"))
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
      if (title && title.length <= 300 && !matchesAny(title, GIVEAWAY_MARKERS)) return title;
    }
    return null;
  }

  function isEpicGiveawayCard(card, section = null) {
    if (!isVisible(card)) return false;
    const context = section || card;
    const contextText = elementText(context);
    if (!matchesAny(normalizeText(contextText), GIVEAWAY_MARKERS)) return false;

    const text = elementText(card);
    if (!text || matchesAny(text, UPCOMING_MARKERS) || matchesAny(text, EXCLUDED_MARKERS)) {
      return false;
    }
    if (!hasCurrentGiveawayMarker(card)) return false;
    if (!hasVisibleClaimAction(card) && !hasOwnedEvidence(card)) return false;
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
    for (const section of giveawaySections(document)) {
      for (const anchor of uniqueProductLinks(section)) {
        const card = findCardRoot(anchor, section);
        if (!card || !isEpicGiveawayCard(card, section)) continue;

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
