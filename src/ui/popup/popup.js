"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const siteStatus = document.querySelector("#site-status");
  const runSummary = document.querySelector("#run-summary");
  const runState = document.querySelector("#run-state");
  const startButton = document.querySelector("#start-button");
  const resumeButton = document.querySelector("#resume-button");
  const stopButton = document.querySelector("#stop-button");
  const supportedSites = { epic: "Epic Games Store", fab: "Fab" };
  let activeTab = null;
  let tabStatus = null;
  let latestRun = null;

  function summarize(run) {
    if (!run || !Array.isArray(run.items)) {
      runState.textContent = "No run yet";
      runSummary.textContent = "No claim activity yet.";
      return;
    }
    const counts = new Map();
    for (const item of run.items) counts.set(item.state, (counts.get(item.state) || 0) + 1);
    const parts = [
      ["claimed", "claimed"],
      ["already-owned", "already owned"],
      ["needs-user-action", "need your attention"],
      ["failed", "failed"],
      ["pending", "pending"]
    ].filter(([key]) => counts.has(key)).map(([key, label]) => `${counts.get(key)} ${label}`);
    const current = run.items.find((item) => item.key === run.currentItemKey);
    const site = supportedSites[run.site] || run.site;
    runState.textContent = run.state.replaceAll("-", " ");
    runSummary.textContent = `${site}: ${parts.join(" · ") || "no items"}${current ? ` · Current: ${current.title}` : ""}`;
  }

  function render() {
    const site = tabStatus && supportedSites[tabStatus.site];
    if (!tabStatus || !tabStatus.supported) {
      summarize(latestRun);
      siteStatus.textContent = "Open Epic's Free Games page or a Fab free-assets page to begin.";
      startButton.disabled = true;
      resumeButton.disabled = true;
      stopButton.disabled = true;
      return;
    }
    siteStatus.textContent = `${site}${tabStatus.ready === false ? " (claim handling unavailable)" : " is ready on this tab."}`;
    const run = tabStatus.run || (latestRun && latestRun.site === tabStatus.site ? latestRun : null);
    summarize(run);
    const running = Boolean(run && run.state === "running");
    const resumable = Boolean(run && ["paused", "stopped", "failed", "running"].includes(run.state));
    startButton.disabled = running || tabStatus.ready === false;
    resumeButton.disabled = !resumable || running || tabStatus.ready === false;
    stopButton.disabled = !running;
  }

  async function refresh() {
    siteStatus.textContent = "Checking this page…";
    try {
      const [tabs, latest] = await Promise.all([
        browser.tabs.query({ active: true, currentWindow: true }),
        browser.runtime.sendMessage({ type: "GET_LATEST_RUN" })
      ]);
      activeTab = tabs[0] || null;
      latestRun = latest && latest.ok ? latest.run : null;
      if (!activeTab || typeof activeTab.id !== "number") throw new Error("No active tab.");
      try {
        tabStatus = await browser.tabs.sendMessage(activeTab.id, { type: "GET_TAB_STATUS" });
      } catch {
        tabStatus = null;
      }
      render();
    } catch {
      activeTab = null;
      tabStatus = null;
      siteStatus.textContent = "The active page could not be reached. Open a supported Epic or Fab page.";
      render();
    }
  }

  async function sendToTab(type) {
    if (!activeTab || typeof activeTab.id !== "number") return;
    startButton.disabled = true;
    resumeButton.disabled = true;
    stopButton.disabled = true;
    try {
      const response = await browser.tabs.sendMessage(activeTab.id, { type });
      if (response && response.error) siteStatus.textContent = response.error;
    } catch {
      siteStatus.textContent = "This page stopped responding. Reload it, then try again.";
    }
    await refresh();
  }

  startButton.addEventListener("click", () => void sendToTab("START_RUN"));
  resumeButton.addEventListener("click", () => void sendToTab("RESUME_RUN"));
  stopButton.addEventListener("click", () => void sendToTab("STOP_RUN"));

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "RUN_STATUS_UPDATED" && message.run) {
      latestRun = message.run;
      if (tabStatus && message.run.site === tabStatus.site) tabStatus.run = message.run;
      render();
    }
  });

  void refresh();
});
