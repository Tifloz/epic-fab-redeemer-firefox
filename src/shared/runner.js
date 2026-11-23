(function initRunner(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  const { ITEM_STATUS, RUN_STATUS, VALID_PHASES, VALID_SITES } = api.messages;

  const RESUMABLE_ITEM_STATUSES = new Set([
    ITEM_STATUS.PENDING,
    ITEM_STATUS.FAILED,
    ITEM_STATUS.NEEDS_USER_ACTION
  ]);

  function createRunId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function copyItem(item, state, detail = "") {
    return {
      key: item.key,
      title: item.title,
      url: item.url,
      state,
      detail: typeof detail === "string" ? detail.trim().slice(0, 500) : ""
    };
  }

  function uniqueItems(items) {
    const byKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (
        !item ||
        typeof item.key !== "string" ||
        typeof item.title !== "string" ||
        typeof item.url !== "string" ||
        item.eligible === false
      ) {
        continue;
      }
      if (!byKey.has(item.key)) {
        byKey.set(item.key, item);
      }
    }
    return [...byKey.values()];
  }

  function createInitialRun(site, items, now) {
    const records = uniqueItems(items).map((item) => {
      if (item.owned === true) {
        return copyItem(item, ITEM_STATUS.ALREADY_OWNED, "Already in your library.");
      }
      return copyItem(item, ITEM_STATUS.PENDING);
    });

    return {
      runId: createRunId(),
      site,
      startedAt: now,
      state: RUN_STATUS.RUNNING,
      currentItemKey: null,
      phase: "scanning",
      items: records,
      updatedAt: now
    };
  }

  function createResumedRun(initialRun, now) {
    const records = initialRun.items.map((item) => ({ ...item }));
    return {
      runId: initialRun.runId,
      site: initialRun.site,
      startedAt: initialRun.startedAt,
      state: RUN_STATUS.RUNNING,
      currentItemKey: initialRun.currentItemKey || null,
      phase: "scanning",
      items: records,
      updatedAt: now
    };
  }

  function waitForDelay(delayMs, signal) {
    if (!delayMs || delayMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new DOMException("The run was stopped.", "AbortError"));
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);

      function onAbort() {
        clearTimeout(timer);
        cleanup();
        reject(new DOMException("The run was stopped.", "AbortError"));
      }

      function cleanup() {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function resultState(result) {
    return typeof result === "string" ? result : result && result.state;
  }

  function resultDetail(result) {
    if (typeof result === "string") {
      return "";
    }
    return result && typeof result.detail === "string" ? result.detail : "";
  }

  function errorDetail(error) {
    return "The page could not complete this claim. Review it and try again if appropriate.";
  }

  function mergeResumableItems(initialRun, scannedItems) {
    const currentByKey = new Map(
      uniqueItems(scannedItems).map((item) => [item.key, item])
    );
    return initialRun.items
      .filter((item) => RESUMABLE_ITEM_STATUSES.has(item.state))
      .map((item) => {
        const latest = currentByKey.get(item.key);
        return latest ? { ...item, ...latest } : { ...item };
      });
  }

  async function runItems({
    adapter,
    site: requestedSite = null,
    items,
    settings,
    reportStatus,
    signal,
    initialRun = null
  }) {
    if (!adapter || typeof adapter.claim !== "function") {
      throw new TypeError("A site adapter with a claim function is required.");
    }
    if (typeof reportStatus !== "function") {
      throw new TypeError("A reportStatus callback is required.");
    }

    const site = initialRun
      ? initialRun.site
      : (requestedSite || adapter.site);
    if (!VALID_SITES.has(site)) {
      throw new TypeError("The adapter site must be epic or fab.");
    }

    const delayMs = settings && Number.isFinite(settings.delayMs)
      ? Math.max(0, settings.delayMs)
      : 0;
    const now = Date.now();
    const run = initialRun
      ? createResumedRun(initialRun, now)
      : createInitialRun(site, items, now);

    const refreshForResume = async () => {
      if (!initialRun || typeof adapter.scan !== "function") {
        return mergeResumableItems(initialRun, items);
      }
      try {
        const scanned = await adapter.scan(global.document);
        return mergeResumableItems(initialRun, scanned);
      } catch {
        return mergeResumableItems(initialRun, items);
      }
    };

    async function publish() {
      run.updatedAt = Date.now();
      await reportStatus({
        runId: run.runId,
        site: run.site,
        startedAt: run.startedAt,
        state: run.state,
        currentItemKey: run.currentItemKey,
        phase: run.phase,
        items: run.items.map((item) => ({ ...item })),
        updatedAt: run.updatedAt
      });
    }

    const markRun = async (state, phase, currentItemKey = null) => {
      run.state = state;
      run.phase = phase;
      run.currentItemKey = currentItemKey;
      await publish();
    };

    const markItem = async (item, state, detail = "") => {
      const index = run.items.findIndex((record) => record.key === item.key);
      const record = copyItem(item, state, detail);
      if (index === -1) {
        run.items.push(record);
      } else {
        run.items[index] = record;
      }
      await publish();
    };

    const reportClaimStatus = async (update = {}) => {
      if (update && VALID_PHASES.has(update.phase)) {
        run.phase = update.phase;
      }
      if (update && typeof update.detail === "string") {
        const current = run.items.find((record) => record.key === run.currentItemKey);
        if (current) {
          current.detail = update.detail.trim().slice(0, 500);
        }
      }
      await publish();
    };

    await markRun(
      RUN_STATUS.RUNNING,
      "scanning",
      initialRun ? (initialRun.currentItemKey || null) : null
    );

    let queue;
    if (initialRun) {
      queue = await refreshForResume();
    } else {
      queue = uniqueItems(items).filter((item) => item.owned !== true);
    }

    let attempted = 0;
    for (const item of queue) {
      if (signal && signal.aborted) {
        await markRun(RUN_STATUS.STOPPED, "idle", null);
        return run;
      }

      const previous = run.items.find((record) => record.key === item.key);
      if (previous && !RESUMABLE_ITEM_STATUSES.has(previous.state)) {
        continue;
      }

      if (attempted > 0) {
        await markRun(RUN_STATUS.RUNNING, "claiming", item.key);
        try {
          await waitForDelay(delayMs, signal);
        } catch (error) {
          if (error && error.name === "AbortError") {
            await markRun(RUN_STATUS.STOPPED, "idle", null);
            return run;
          }
          throw error;
        }
      }

      if (signal && signal.aborted) {
        await markRun(RUN_STATUS.STOPPED, "idle", null);
        return run;
      }

      run.currentItemKey = item.key;
      run.phase = "claiming";
      await publish();

      // A product may have been claimed just before navigation or suspension.
      // Refresh visible ownership evidence before repeating any action.
      if (initialRun && typeof adapter.scan === "function") {
        try {
          const refreshed = uniqueItems(await adapter.scan(global.document))
            .find((candidate) => candidate.key === item.key);
          if (refreshed && refreshed.owned === true) {
            await markItem(item, ITEM_STATUS.ALREADY_OWNED, "Already in your library.");
            attempted += 1;
            continue;
          }
        } catch {
          // If the current page cannot be rescanned, the adapter's claim method
          // must still check ownership before it interacts with the page.
        }
      }

      try {
        const result = await adapter.claim(item, {
          signal,
          settings,
          reportStatus: reportClaimStatus
        });
        const state = resultState(result);
        const detail = resultDetail(result);

        if (signal && signal.aborted) {
          await markRun(RUN_STATUS.STOPPED, "idle", null);
          return run;
        }

        if (state === "rate-limited") {
          await markItem(item, ITEM_STATUS.FAILED, detail || "Epic or Fab is limiting claims. Wait and retry later.");
          await markRun(RUN_STATUS.PAUSED, "waiting-for-user", item.key);
          return run;
        }

        if (state === ITEM_STATUS.NEEDS_USER_ACTION) {
          await markItem(item, ITEM_STATUS.NEEDS_USER_ACTION, detail || "Complete the requested step in the page, then resume.");
          await markRun(RUN_STATUS.PAUSED, "waiting-for-user", item.key);
          return run;
        }

        if (
          state !== ITEM_STATUS.ALREADY_OWNED &&
          state !== ITEM_STATUS.CLAIMED &&
          state !== ITEM_STATUS.FAILED
        ) {
          await markItem(item, ITEM_STATUS.FAILED, "The site returned an unrecognized claim result.");
        } else {
          await markItem(item, state, detail);
        }
      } catch (error) {
        if (signal && signal.aborted) {
          await markRun(RUN_STATUS.STOPPED, "idle", null);
          return run;
        }
        await markItem(item, ITEM_STATUS.FAILED, errorDetail(error));
      }

      attempted += 1;
    }

    await markRun(RUN_STATUS.COMPLETED, "idle", null);
    return run;
  }

  api.runner = Object.freeze({ runItems });
})(globalThis);
