(function initFabDiscovery(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  api.sites = api.sites || {};
  api.sites.fab = api.sites.fab || {};

  const LIMITED_TIME_LABELS = [
    /limited[- ]time\s+free/i,
    /offres?\s+gratuites?\s+a\s+duree\s+limitee/i,
    /^gratuit\s+pour\s+une\s+duree\s+limitee\b/i
  ];
  const OWNED_LABELS = [
    /^owned$/i,
    /^in\s+(?:your\s+)?library$/i,
    /^already\s+in\s+(?:your\s+)?library$/i,
    /^added\s+to\s+(?:your\s+)?library$/i,
    /^possede(?:e)?$/i,
    /^dans\s+(?:votre\s+)?bibliotheque$/i,
    /^ajoute(?:e)?\s+a\s+la\s+bibliotheque$/i
  ];

  const MONTH_INDEX = new Map([
    ["january", 0], ["jan", 0], ["janvier", 0], ["janv", 0],
    ["february", 1], ["feb", 1], ["février", 1], ["fevrier", 1], ["févr", 1], ["fevr", 1],
    ["march", 2], ["mar", 2], ["mars", 2],
    ["april", 3], ["apr", 3], ["avril", 3], ["avr", 3],
    ["may", 4], ["mai", 4],
    ["june", 5], ["jun", 5], ["juin", 5],
    ["july", 6], ["jul", 6], ["juillet", 6], ["juil", 6],
    ["august", 7], ["aug", 7], ["août", 7], ["aout", 7],
    ["september", 8], ["sep", 8], ["sept", 8], ["septembre", 8],
    ["october", 9], ["oct", 9], ["octobre", 9],
    ["november", 10], ["nov", 10], ["novembre", 10],
    ["december", 11], ["dec", 11], ["décembre", 11], ["decembre", 11], ["déc", 11], ["dec", 11]
  ]);

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

  function canonicalListingUrl(value, base = global.location.href) {
    try {
      const url = new URL(value, base);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.fab.com" ||
        !/^\/listings\/[a-z0-9-]+\/?$/i.test(url.pathname)
      ) {
        return null;
      }
      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      return null;
    }
  }

  function isFreeListingRoute(location) {
    if (location.pathname === "/limited-time-free" || location.pathname === "/limited-time-free/") {
      return true;
    }
    const url = new URL(location.href);
    return /^(?:\/category\/|\/channels\/|\/search\/?$)/i.test(location.pathname) &&
      url.searchParams.get("is_free") === "1";
  }

  function isProductRoute(location) {
    return /^\/listings\/[a-z0-9-]+\/?$/i.test(location.pathname);
  }

  function canRunFab(document, location = global.location) {
    return Boolean(
      document &&
      location &&
      location.protocol === "https:" &&
      location.hostname === "www.fab.com" &&
      (isFreeListingRoute(location) || isProductRoute(location))
    );
  }

  function exactPriceKind(root) {
    if (!root) return null;
    const nodes = [root, ...root.querySelectorAll("span, div, p, strong, small, [data-testid]")];
    const labels = new Set();
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = normalize(textOf(node));
      if (!text || text.length > 80) continue;
      if (/^(?:from\s+free|a\s+partir\s+de\s+gratuit(?:e)?)$/.test(text)) {
        labels.add("from-free");
      } else if (/^(?:free|gratuit(?:e)?)\s*\*?$/.test(text)) {
        labels.add("free");
      } else if (/^(?:(?:us\$|\$|€|£|¥|usd\s*|eur\s*|gbp\s*)?0(?:[.,]00)?\s*(?:usd|eur|gbp)?)$/.test(text)) {
        labels.add("free");
      }
    }
    if (labels.has("free")) return "free";
    if (labels.has("from-free")) return "from-free";
    return null;
  }

  function parseVisibleUntil(text) {
    const source = String(text || "");
    const english = source.match(/until\s+([\p{L}.]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+at\s+(\d{1,2}:\d{2})\s*(am|pm)?\s*(et|edt|est)\b/iu);
    const french = source.match(/jusqu['’]au\s+(\d{1,2})\s+([\p{L}.]+)(?:\s+(\d{4}))?\s+(?:à\s*)?(\d{1,2}:\d{2})\s*(am|pm)?\s*(et|edt|est)\b/iu);
    let monthName;
    let day;
    let year;
    let clock;
    let meridiem;
    let zone;

    if (english) {
      [, monthName, day, year, clock, meridiem, zone] = english;
    } else if (french) {
      [, day, monthName, year, clock, meridiem, zone] = french;
    } else {
      return null;
    }

    const month = MONTH_INDEX.get(normalize(monthName).replace(/\.$/, ""));
    if (!Number.isInteger(month)) return null;
    const targetYear = Number(year || new Date().getFullYear());
    const dayNumber = Number(day);
    let [hour, minute] = clock.split(":").map(Number);
    if (meridiem) {
      const pm = meridiem.toLowerCase() === "pm";
      hour = (hour % 12) + (pm ? 12 : 0);
    }

    const utcCandidates = [];
    const offsets = zone.toLowerCase() === "edt" ? [-4] : zone.toLowerCase() === "est" ? [-5] : [-4, -5];
    for (const offset of offsets) {
      utcCandidates.push(Date.UTC(targetYear, month, dayNumber, hour - offset, minute));
    }
    const future = utcCandidates.filter((candidate) => candidate > Date.now()).sort((a, b) => a - b);
    return future[0] || null;
  }

  function parseLimitedTimeHeading(text, now = new Date()) {
    const match = normalize(text).match(/\((\d{1,2})\/(\d{1,2})\s+a\s+(\d{1,2})h(\d{2})\s+(cet|cest)\)$/);
    if (!match) return null;
    const [, dayText, monthText, hourText, minuteText, zone] = match;
    const [day, month, hour, minute] = [dayText, monthText, hourText, minuteText].map(Number);
    const offset = zone === "cest" ? 2 : 1;
    const localNow = new Date(now.getTime() + offset * 3600000);
    const currentMonth = localNow.getUTCMonth() + 1;
    const year = localNow.getUTCFullYear() + Number(currentMonth === 12 && month === 1);
    const wallTime = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (wallTime.getUTCMonth() !== month - 1 || wallTime.getUTCDate() !== day ||
        wallTime.getUTCHours() !== hour || wallTime.getUTCMinutes() !== minute) return null;
    const deadline = wallTime.getTime() - offset * 3600000;
    return deadline > now.getTime() ? deadline : null;
  }

  function limitedTimeSection(document) {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, [role='heading']")]
      .filter((heading) => isVisible(heading) && LIMITED_TIME_LABELS.some((pattern) => pattern.test(normalize(textOf(heading)))));
    for (const heading of headings) {
      let ancestor = heading.closest("section, [role='region']");
      if (!ancestor) {
        for (let node = heading.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
          const links = [...node.querySelectorAll("a[href]")].filter((link) => canonicalListingUrl(link.href));
          if (links.length > 0) {
            ancestor = node;
            break;
          }
        }
      }
      const section = ancestor || document.querySelector("main");
      if (!section) continue;

      const machineExpiry = [...section.querySelectorAll("time[datetime]")]
        .filter(isVisible)
        .map((node) => Date.parse(node.dateTime))
        .filter(Number.isFinite)
        .find((value) => value > Date.now());
      const textExpiry = parseVisibleUntil(textOf(section));
      if (machineExpiry || textExpiry || parseLimitedTimeHeading(textOf(heading))) return section;
    }
    return null;
  }

  function uniqueListingLinks(root) {
    const byUrl = new Map();
    for (const anchor of root.querySelectorAll("a[href]")) {
      if (!isVisible(anchor)) continue;
      const url = canonicalListingUrl(anchor.href);
      if (url && !byUrl.has(url)) byUrl.set(url, anchor);
    }
    return [...byUrl.values()];
  }

  function findCardRoot(anchor, boundary) {
    for (let node = anchor.parentElement, depth = 0; node && node !== boundary && depth < 10; node = node.parentElement, depth += 1) {
      const links = uniqueListingLinks(node);
      if (links.length !== 1) continue;
      const hasHeading = Boolean(node.querySelector("h2, h3, h4, h5, [role='heading']"));
      const semanticCard = node.matches("article, li, [role='listitem'], [data-testid*='card' i], [data-testid*='listing' i]");
      const hasTitleLink = Boolean(textOf(anchor) && anchor.getAttribute("aria-label"));
      if ((semanticCard || hasHeading || hasTitleLink) && exactPriceKind(node)) return node;
    }
    return null;
  }

  function visibleOwned(root) {
    const controls = root.querySelectorAll("button, a[href], [role='button'], [aria-label], [title]");
    return [...controls].some((element) => {
      if (!isVisible(element)) return false;
      const label = normalize(element.getAttribute("aria-label") || element.getAttribute("title") || textOf(element));
      return OWNED_LABELS.some((pattern) => pattern.test(label));
    });
  }

  function titleFromCard(card, anchor) {
    const heading = card.querySelector("h2, h3, h4, h5, [role='heading']");
    const values = [
      heading && textOf(heading),
      textOf(anchor),
      anchor.getAttribute("aria-label"),
      anchor.getAttribute("title"),
      ...[...card.querySelectorAll("img[alt]")].map((image) => image.alt)
    ];
    for (const value of values) {
      const title = String(value || "").replace(/\s+/g, " ").trim();
      if (title && title.length <= 300) return title;
    }
    return null;
  }

  function productSurface(document) {
    const main = document.querySelector("main") || document.body;
    const headings = [...main.querySelectorAll("h1, h2")].filter(isVisible);
    if (headings.length === 0) return null;
    for (const heading of headings) {
      for (let node = heading; node && node !== main.parentElement; node = node.parentElement) {
        if (!isVisible(node)) continue;
        const titleCount = [...node.querySelectorAll("h1, h2")].filter(isVisible).length;
        if (titleCount > 1) continue;
        if (exactPriceKind(node) || visibleOwned(node)) return node;
        if (node === main) break;
      }
    }
    return null;
  }

  function scanProductPage(document, location) {
    const url = canonicalListingUrl(location.href);
    const surface = productSurface(document);
    if (!url || !surface) return [];
    const titleNode = surface.querySelector("h1, h2") || document.querySelector("main h1, h1");
    const title = textOf(titleNode);
    if (!title || !exactPriceKind(surface)) return [];
    return [{ key: url, title: title.slice(0, 300), url, eligible: true, owned: visibleOwned(surface) }];
  }

  function scanFab(document, location = global.location) {
    if (!canRunFab(document, location)) return [];
    if (isProductRoute(location)) return scanProductPage(document, location);

    const limited = location.pathname === "/limited-time-free" || location.pathname === "/limited-time-free/";
    const root = limited ? limitedTimeSection(document) : document.querySelector("main");
    if (!root) return [];

    const found = new Map();
    for (const anchor of uniqueListingLinks(root)) {
      const card = findCardRoot(anchor, root);
      if (!card) continue;
      const priceKind = exactPriceKind(card);
      if (!priceKind) continue;
      const url = canonicalListingUrl(anchor.href);
      const title = titleFromCard(card, anchor);
      if (!url || !title) continue;

      found.set(url, {
        key: url,
        title,
        url,
        eligible: true,
        owned: visibleOwned(card),
        priceKind
      });
    }
    return [...found.values()].map(({ priceKind, ...item }) => item);
  }

  api.sites.fab.discovery = Object.freeze({
    canRun: canRunFab,
    scan: scanFab,
    canonicalListingUrl,
    isFreeListingRoute,
    isProductRoute,
    exactPriceKind,
    parseVisibleUntil,
    parseLimitedTimeHeading,
    visibleOwned,
    productSurface
  });
})(globalThis);
