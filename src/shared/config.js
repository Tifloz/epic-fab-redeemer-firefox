(function initConfig(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});

  const DEFAULT_SETTINGS = Object.freeze({
    autoStart: false,
    delayMs: 2000,
    fabLicense: "professional"
  });
  const MIN_DELAY_MS = 500;
  const MAX_DELAY_MS = 10000;
  const FAB_LICENSES = Object.freeze(["personal", "professional"]);

  function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function validateSettings(partial, { allowPartial = false } = {}) {
    if (!isPlainObject(partial)) {
      throw new TypeError("Settings must be an object.");
    }

    const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const key of Object.keys(partial)) {
      if (!allowedKeys.has(key)) {
        throw new TypeError(`Unknown setting: ${key}`);
      }
    }

    const requiredKeys = allowPartial ? [] : Object.keys(DEFAULT_SETTINGS);
    for (const key of requiredKeys) {
      if (!Object.hasOwn(partial, key)) {
        throw new TypeError(`Missing setting: ${key}`);
      }
    }

    const validated = {};
    if (Object.hasOwn(partial, "autoStart")) {
      if (typeof partial.autoStart !== "boolean") {
        throw new TypeError("Auto-start must be a boolean.");
      }
      validated.autoStart = partial.autoStart;
    }

    if (Object.hasOwn(partial, "delayMs")) {
      if (
        !Number.isInteger(partial.delayMs) ||
        partial.delayMs < MIN_DELAY_MS ||
        partial.delayMs > MAX_DELAY_MS
      ) {
        throw new RangeError(`Delay must be an integer from ${MIN_DELAY_MS} to ${MAX_DELAY_MS} ms.`);
      }
      validated.delayMs = partial.delayMs;
    }

    if (Object.hasOwn(partial, "fabLicense")) {
      if (!FAB_LICENSES.includes(partial.fabLicense)) {
        throw new TypeError("Fab license must be personal or professional.");
      }
      validated.fabLicense = partial.fabLicense;
    }

    return validated;
  }

  function normalizeStoredSettings(stored) {
    if (!isPlainObject(stored)) {
      return { ...DEFAULT_SETTINGS };
    }

    const normalized = { ...DEFAULT_SETTINGS };
    if (typeof stored.autoStart === "boolean") {
      normalized.autoStart = stored.autoStart;
    }
    if (
      Number.isInteger(stored.delayMs) &&
      stored.delayMs >= MIN_DELAY_MS &&
      stored.delayMs <= MAX_DELAY_MS
    ) {
      normalized.delayMs = stored.delayMs;
    }
    if (FAB_LICENSES.includes(stored.fabLicense)) {
      normalized.fabLicense = stored.fabLicense;
    }
    return normalized;
  }

  async function loadSettings() {
    const result = await browser.storage.local.get("settings");
    return normalizeStoredSettings(result.settings);
  }

  async function saveSettings(partial) {
    const changes = validateSettings(partial, { allowPartial: true });
    const settings = { ...(await loadSettings()), ...changes };
    await browser.storage.local.set({ settings });
    return settings;
  }

  api.config = Object.freeze({
    DEFAULT_SETTINGS,
    MIN_DELAY_MS,
    MAX_DELAY_MS,
    FAB_LICENSES,
    isPlainObject,
    validateSettings,
    normalizeStoredSettings,
    loadSettings,
    saveSettings
  });
})(globalThis);
