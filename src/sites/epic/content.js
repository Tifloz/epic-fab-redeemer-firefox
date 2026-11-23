(function initEpicContent(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  const { MESSAGE, SITE } = api.messages;
  if (api.sites && api.sites.epic && api.sites.epic.bootstrapped) return;
  api.sites = api.sites || {};
  api.sites.epic = api.sites.epic || {};
  api.sites.epic.bootstrapped = true;

  let panel;
  let controller = null;
  let currentRun = null;
  let routeTimer = null;
  let lastRoute = global.location.href;
  const autoStartedRoutes = new Set();

  async function publishRun(run) {
    currentRun = run;
    if (panel) panel.update(run);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.RUN_STATUS_UPDATED, run });
      if (!response || !response.ok) {
        throw new Error("Progress could not be saved.");
      }
    } catch {
      if (panel) panel.setMessage("Run status could not be saved. Stop safely and review the page.");
      throw new Error("Run progress could not be saved safely.");
    }
  }

  function hasAdapter() {
    return Boolean(api.sites.epic.adapter);
  }

  function pageSupported() {
    return Boolean(
      api.sites.epic.discovery &&
      api.sites.epic.discovery.canRun(document, global.location)
    );
  }

  function isFreeGamesPage() {
    return /(?:^|\/)free-games\/?$/i.test(global.location.pathname);
  }

  async function start(initialRun = null) {
    if (!pageSupported()) {
      return { ok: false, error: "Open the Epic free-games page or a product page from its giveaway flow." };
    }
    const adapter = api.sites.epic.adapter;
    if (!adapter) {
      panel.setMessage("Epic claim handling is not ready on this page yet.");
      return { ok: false, error: "Epic claim handling is not ready." };
    }
    if (controller) {
      return { ok: false, error: "An Epic claim run is already active." };
    }
    if (!initialRun && !isFreeGamesPage()) {
      panel.setMessage("Start on Epic's Free Games page. Product pages can only resume a saved claim.");
      return { ok: false, error: "A new Epic run must start from the Free Games page." };
    }

    let settingsResponse;
    try {
      settingsResponse = await browser.runtime.sendMessage({ type: MESSAGE.GET_SETTINGS });
    } catch {
      panel.setMessage("Extension settings could not be loaded. No claim was started.");
      return { ok: false, error: "Settings could not be loaded." };
    }
    if (!settingsResponse || !settingsResponse.ok || !settingsResponse.settings) {
      panel.setMessage("Extension settings could not be loaded. No claim was started.");
      return { ok: false, error: "Settings could not be loaded." };
    }

    const items = initialRun ? initialRun.items : adapter.scan(document, global.location);
    if (!initialRun && !items.some((item) => item.eligible && !item.owned)) {
      panel.setMessage("No current Epic PC giveaways were confirmed on this page.");
      return { ok: true, run: null };
    }

    const runController = new AbortController();
    controller = runController;
    panel.setMessage(initialRun ? "Resuming the saved Epic claim…" : "Scanning current Epic giveaways…");
    try {
      const run = await api.runner.runItems({
        adapter,
        site: SITE.EPIC,
        items,
        settings: settingsResponse.settings,
        signal: runController.signal,
        initialRun,
        reportStatus: publishRun
      });
      currentRun = run;
      if (panel) panel.update(run);
      return { ok: true, run };
    } catch {
      if (panel) panel.setMessage("Epic claim progress could not be saved. Review the page before trying again.");
      return { ok: false, error: "Epic claim run stopped because progress could not be saved." };
    } finally {
      if (controller === runController) controller = null;
    }
  }

  function stop() {
    if (controller) {
      controller.abort();
      if (panel) panel.setMessage("Stopping after the current page action…");
    } else if (panel) {
      panel.setMessage("No Epic run is active.");
    }
    return { ok: true };
  }

  async function resume() {
    if (!pageSupported()) {
      return { ok: false, error: "Open the Epic free-games page or a product page from its giveaway flow." };
    }
    if (!hasAdapter()) {
      panel.setMessage("Epic claim handling is not ready on this page yet.");
      return { ok: false, error: "Epic claim handling is not ready." };
    }
    if (controller) {
      return { ok: false, error: "An Epic claim run is already active." };
    }

    let run = currentRun;
    if (!run) {
      try {
        const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_LATEST_RUN });
        if (response && response.ok && response.run && response.run.site === SITE.EPIC) {
          run = response.run;
        }
      } catch {
        return { ok: false, error: "The saved Epic run could not be loaded." };
      }
    }

    if (run && ["paused", "stopped", "failed", "running"].includes(run.state)) {
      currentRun = run;
      if (panel) panel.update(run);
      return start(run);
    }
    if (isFreeGamesPage()) return start();
    panel.setMessage("No saved Epic claim is waiting here. Start from Epic's Free Games page.");
    return { ok: false, error: "No saved Epic run is available to resume." };
  }

  function mount() {
    if (!pageSupported()) {
      if (panel) panel.destroy();
      panel = null;
      return;
    }
    panel = api.ui.panel.mountPanel({
      site: SITE.EPIC,
      onStart: start,
      onStop: stop,
      onResume: resume
    });
    if (currentRun) panel.update(currentRun);
  }

  async function maybeAutoStart() {
    const adapter = api.sites.epic.adapter;
    const route = global.location.href;
    if (
      autoStartedRoutes.has(route) ||
      !adapter ||
      typeof adapter.canRun !== "function" ||
      !adapter.canRun(document, global.location) ||
      !isFreeGamesPage() ||
      (currentRun && ["running", "paused"].includes(currentRun.state))
    ) {
      return;
    }
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_SETTINGS });
      if (response && response.ok && response.settings && response.settings.autoStart) {
        autoStartedRoutes.add(route);
        await start();
      }
    } catch {
      if (panel) panel.setMessage("Auto-start settings could not be loaded.");
    }
  }

  function onRouteChange() {
    if (global.location.href === lastRoute) return;
    if (routeTimer) clearTimeout(routeTimer);
    routeTimer = setTimeout(() => {
      routeTimer = null;
      if (global.location.href === lastRoute) return;
      lastRoute = global.location.href;
      if (!pageSupported()) stopForNavigation();
      mount();
      void maybeAutoStart();
    }, 250);
  }

  function stopForNavigation(preservingClaimNavigation = false) {
    if (!controller) return;
    if (preservingClaimNavigation && currentRun && currentRun.phase === "awaiting-navigation") return;
    controller.abort();
    if (currentRun && currentRun.state === "running") {
      const stoppedRun = {
        ...currentRun,
        state: "stopped",
        phase: "idle",
        currentItemKey: null,
        updatedAt: Date.now()
      };
      void publishRun(stoppedRun).catch(() => {});
    }
  }

  function observeNavigation() {
    global.addEventListener("popstate", onRouteChange);
    global.addEventListener("hashchange", onRouteChange);
    global.addEventListener("pagehide", () => stopForNavigation(true));
    const root = document.body || document.documentElement;
    if (root) {
      const observer = new MutationObserver(onRouteChange);
      observer.observe(root, { childList: true, subtree: true });
      api.sites.epic.routeObserver = observer;
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return undefined;
    switch (message.type) {
      case MESSAGE.GET_TAB_STATUS:
        return Promise.resolve({
          ok: true,
          supported: pageSupported(),
          site: SITE.EPIC,
          ready: hasAdapter(),
          run: currentRun
        });
      case MESSAGE.START_RUN:
        return start();
      case MESSAGE.STOP_RUN:
        return stop();
      case MESSAGE.RESUME_RUN:
        return resume();
      default:
        return undefined;
    }
  });

  mount();
  api.sites.epic.adapter = Object.freeze({
    site: SITE.EPIC,
    canRun: api.sites.epic.discovery.canRun,
    scan: api.sites.epic.discovery.scan,
    claim: api.sites.epic.claim.claimEpic
  });
  async function restoreLatestRun() {
    if (!pageSupported()) return;
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_LATEST_RUN });
      if (!response || !response.ok || !response.run || response.run.site !== SITE.EPIC) return;
      currentRun = response.run;
      const currentProductKey = `${global.location.origin}${global.location.pathname}`;
      if (
        currentRun.state === "running" &&
        currentRun.currentItemKey === currentProductKey &&
        /(?:^|\/)p\//i.test(global.location.pathname)
      ) {
        currentRun = {
          ...currentRun,
          state: "paused",
          phase: "awaiting-navigation",
          updatedAt: Date.now()
        };
        await publishRun(currentRun);
      } else if (panel) {
        panel.update(currentRun);
      }
    } catch {
      if (panel) panel.setMessage("The saved Epic run could not be restored.");
    }
  }
  void restoreLatestRun().then(() => maybeAutoStart());
  observeNavigation();
})(globalThis);
