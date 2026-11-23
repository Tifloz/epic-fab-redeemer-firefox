(function initFabContent(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  const { MESSAGE, SITE } = api.messages;
  if (api.sites && api.sites.fab && api.sites.fab.bootstrapped) return;
  api.sites = api.sites || {};
  api.sites.fab = api.sites.fab || {};
  api.sites.fab.bootstrapped = true;

  const discovery = api.sites.fab.discovery;
  const claim = api.sites.fab.claim;
  const adapter = Object.freeze({
    site: SITE.FAB,
    canRun: discovery.canRun,
    scan: discovery.scan,
    claim: claim.claimFab
  });
  api.sites.fab.adapter = adapter;

  let panel = null;
  let controller = null;
  let currentRun = null;
  let routeTimer = null;
  let lastRoute = global.location.href;
  const autoStartedRoutes = new Set();

  function pageSupported() {
    return adapter.canRun(document, global.location);
  }

  function isListingPage() {
    return discovery.isFreeListingRoute(global.location);
  }

  async function publishRun(run) {
    currentRun = run;
    if (panel) panel.update(run);
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.RUN_STATUS_UPDATED, run });
      if (!response || !response.ok) throw new Error("Progress could not be saved.");
    } catch {
      if (panel) panel.setMessage("Run status could not be saved. Stop safely and review the page.");
      throw new Error("Run progress could not be saved safely.");
    }
  }

  async function start(initialRun = null) {
    if (!pageSupported()) {
      return { ok: false, error: "Open a Fab free listing or a product page from a saved claim." };
    }
    if (controller) return { ok: false, error: "A Fab claim run is already active." };
    if (!initialRun && !isListingPage()) {
      if (panel) panel.setMessage("Start on a Fab free listing. Product pages can only resume a saved claim.");
      return { ok: false, error: "A new Fab run must start from a free listing." };
    }

    let settingsResponse;
    try {
      settingsResponse = await browser.runtime.sendMessage({ type: MESSAGE.GET_SETTINGS });
    } catch {
      if (panel) panel.setMessage("Extension settings could not be loaded. No claim was started.");
      return { ok: false, error: "Settings could not be loaded." };
    }
    if (!settingsResponse || !settingsResponse.ok || !settingsResponse.settings) {
      if (panel) panel.setMessage("Extension settings could not be loaded. No claim was started.");
      return { ok: false, error: "Settings could not be loaded." };
    }

    const items = initialRun ? initialRun.items : adapter.scan(document, global.location);
    if (!initialRun && !items.some((item) => item.eligible && !item.owned)) {
      if (panel) panel.setMessage("No free Fab assets were confirmed on this page.");
      return { ok: true, run: null };
    }

    const runController = new AbortController();
    controller = runController;
    if (panel) panel.setMessage(initialRun ? "Resuming the saved Fab claim…" : "Scanning free Fab assets…");
    try {
      const run = await api.runner.runItems({
        adapter,
        site: SITE.FAB,
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
      if (panel) panel.setMessage("Fab claim progress could not be saved. Review the page before trying again.");
      return { ok: false, error: "Fab claim run stopped because progress could not be saved." };
    } finally {
      if (controller === runController) controller = null;
    }
  }

  function stop() {
    if (controller) {
      controller.abort();
      if (panel) panel.setMessage("Stopping after the current page action…");
    } else if (panel) {
      panel.setMessage("No Fab run is active.");
    }
    return { ok: true };
  }

  async function resume() {
    if (!pageSupported()) return { ok: false, error: "Open the Fab free listing or saved asset page." };
    if (controller) return { ok: false, error: "A Fab claim run is already active." };
    let run = currentRun;
    if (!run) {
      try {
        const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_LATEST_RUN });
        if (response && response.ok && response.run && response.run.site === SITE.FAB) run = response.run;
      } catch {
        return { ok: false, error: "The saved Fab run could not be loaded." };
      }
    }
    if (run && ["paused", "stopped", "failed", "running"].includes(run.state)) {
      currentRun = run;
      if (panel) panel.update(run);
      return start(run);
    }
    if (isListingPage()) return start();
    if (panel) panel.setMessage("No saved Fab claim is waiting here. Start from a free listing.");
    return { ok: false, error: "No saved Fab run is available to resume." };
  }

  function mount() {
    if (!pageSupported()) {
      if (panel) panel.destroy();
      panel = null;
      return;
    }
    if (panel) panel.destroy();
    panel = api.ui.panel.mountPanel({ site: SITE.FAB, onStart: start, onStop: stop, onResume: resume });
    if (currentRun) panel.update(currentRun);
  }

  async function maybeAutoStart() {
    const route = global.location.href;
    if (!isListingPage() || !pageSupported() || autoStartedRoutes.has(route) || controller ||
        (currentRun && ["running", "paused"].includes(currentRun.state))) return;
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

  async function restoreLatestRun() {
    if (!pageSupported()) return;
    try {
      const response = await browser.runtime.sendMessage({ type: MESSAGE.GET_LATEST_RUN });
      if (!response || !response.ok || !response.run || response.run.site !== SITE.FAB) return;
      currentRun = response.run;
      const currentProductKey = discovery.canonicalListingUrl(global.location.href);
      if (currentRun.state === "running" && currentProductKey && currentRun.currentItemKey === currentProductKey) {
        currentRun = { ...currentRun, state: "paused", phase: "awaiting-navigation", updatedAt: Date.now() };
        await publishRun(currentRun);
      } else if (panel) {
        panel.update(currentRun);
      }
    } catch {
      if (panel) panel.setMessage("The saved Fab run could not be restored.");
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

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return undefined;
    switch (message.type) {
      case MESSAGE.GET_TAB_STATUS:
        return Promise.resolve({ ok: true, supported: pageSupported(), site: SITE.FAB, ready: Boolean(adapter), run: currentRun });
      case MESSAGE.START_RUN: return start();
      case MESSAGE.STOP_RUN: return stop();
      case MESSAGE.RESUME_RUN: return resume();
      default: return undefined;
    }
  });

  mount();
  void restoreLatestRun().then(() => maybeAutoStart());
  global.addEventListener("popstate", onRouteChange);
  global.addEventListener("hashchange", onRouteChange);
  global.addEventListener("pagehide", () => stopForNavigation(true));
  const root = document.body || document.documentElement;
  if (root) {
    const observer = new MutationObserver(onRouteChange);
    observer.observe(root, { childList: true, subtree: true });
    api.sites.fab.routeObserver = observer;
  }
})(globalThis);
