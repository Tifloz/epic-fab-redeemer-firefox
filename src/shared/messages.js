(function initMessages(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});

  const MESSAGE = Object.freeze({
    GET_TAB_STATUS: "GET_TAB_STATUS",
    START_RUN: "START_RUN",
    STOP_RUN: "STOP_RUN",
    RESUME_RUN: "RESUME_RUN",
    GET_SETTINGS: "GET_SETTINGS",
    SAVE_SETTINGS: "SAVE_SETTINGS",
    GET_LATEST_RUN: "GET_LATEST_RUN",
    RUN_STATUS_UPDATED: "RUN_STATUS_UPDATED"
  });

  const ITEM_STATUS = Object.freeze({
    PENDING: "pending",
    ALREADY_OWNED: "already-owned",
    CLAIMED: "claimed",
    FAILED: "failed",
    NEEDS_USER_ACTION: "needs-user-action"
  });

  const RUN_STATUS = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
    STOPPED: "stopped",
    COMPLETED: "completed",
    FAILED: "failed"
  });

  const SITE = Object.freeze({
    EPIC: "epic",
    FAB: "fab"
  });

  const VALID_ITEM_STATUSES = new Set(Object.values(ITEM_STATUS));
  const VALID_RUN_STATUSES = new Set(Object.values(RUN_STATUS));
  const VALID_SITES = new Set(Object.values(SITE));
  const VALID_PHASES = new Set([
    "idle",
    "scanning",
    "claiming",
    "awaiting-navigation",
    "waiting-for-user"
  ]);

  function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function isStatus(value) {
    return VALID_ITEM_STATUSES.has(value);
  }

  function sanitizeText(value, maxLength) {
    if (typeof value !== "string") {
      return null;
    }
    const text = value.trim();
    if (!text || text.length > maxLength) {
      return null;
    }
    return text;
  }

  function sanitizeProductUrl(value, site) {
    if (typeof value !== "string") {
      return null;
    }
    try {
      const url = new URL(value);
      const allowedHost = site === SITE.EPIC
        ? url.hostname === "store.epicgames.com"
        : url.hostname === "www.fab.com";
      if (url.protocol !== "https:" || !allowedHost || url.username || url.password) {
        return null;
      }
      return `${url.origin}${url.pathname}`;
    } catch {
      return null;
    }
  }

  function sanitizeItem(item, site) {
    if (!isPlainObject(item)) {
      return null;
    }
    const key = sanitizeText(item.key, 500);
    const title = sanitizeText(item.title, 300);
    const url = sanitizeProductUrl(item.url, site);
    const detail = item.detail === undefined
      ? ""
      : (typeof item.detail === "string" ? item.detail.trim().slice(0, 500) : null);
    if (!key || !title || !url || detail === null || !isStatus(item.state)) {
      return null;
    }
    return { key, title, url, state: item.state, detail };
  }

  function sanitizeRunRecord(run) {
    if (!isPlainObject(run) || !VALID_SITES.has(run.site)) {
      return null;
    }
    const runId = sanitizeText(run.runId, 100);
    if (
      !runId ||
      !Number.isFinite(run.startedAt) ||
      !Number.isFinite(run.updatedAt) ||
      !VALID_RUN_STATUSES.has(run.state) ||
      !(run.currentItemKey === null || sanitizeText(run.currentItemKey, 500)) ||
      !VALID_PHASES.has(run.phase) ||
      !Array.isArray(run.items) ||
      run.items.length > 1000
    ) {
      return null;
    }

    const items = run.items.map((item) => sanitizeItem(item, run.site));
    if (items.some((item) => item === null)) {
      return null;
    }

    return {
      runId,
      site: run.site,
      startedAt: run.startedAt,
      state: run.state,
      currentItemKey: run.currentItemKey,
      phase: run.phase,
      items,
      updatedAt: run.updatedAt
    };
  }

  api.messages = Object.freeze({
    MESSAGE,
    ITEM_STATUS,
    RUN_STATUS,
    SITE,
    VALID_ITEM_STATUSES,
    VALID_RUN_STATUSES,
    VALID_SITES,
    VALID_PHASES,
    isStatus,
    isPlainObject,
    sanitizeRunRecord
  });
})(globalThis);
