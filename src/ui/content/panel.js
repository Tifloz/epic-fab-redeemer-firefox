(function initPanel(global) {
  "use strict";

  const api = global.__efar || (global.__efar = {});
  api.ui = api.ui || {};

  const PANEL_ID = "__efar-status-panel";
  const MAX_VISIBLE_ITEMS = 50;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function mountPanel({ site, onStart, onStop, onResume }) {
    const existing = document.getElementById(PANEL_ID);
    if (existing && existing.shadowRoot) {
      return existing.__efarPanelController || { update() {}, destroy() {} };
    }

    const host = createElement("div");
    host.id = PANEL_ID;
    host.setAttribute("data-site", site);
    const shadow = host.attachShadow({ mode: "open" });

    const stylesheet = createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = browser.runtime.getURL("src/ui/content/panel.css");

    const shell = createElement("section", "panel");
    shell.setAttribute("aria-labelledby", `${PANEL_ID}-title`);
    const header = createElement("header", "header");
    const titleBlock = createElement("div", "title-block");
    const eyebrow = createElement("p", "eyebrow", "CLAIM ASSISTANT");
    const heading = createElement("h2", "title", site === "epic" ? "Epic Games" : "Fab");
    heading.id = `${PANEL_ID}-title`;
    const state = createElement("span", "state-pill", "Ready");
    titleBlock.append(eyebrow, heading);
    header.append(titleBlock, state);

    const liveStatus = createElement("p", "live-status", "Choose Start to scan this page.");
    liveStatus.setAttribute("role", "status");
    liveStatus.setAttribute("aria-live", "polite");

    const summary = createElement("div", "summary");
    summary.setAttribute("aria-label", "Run summary");
    const counts = {};
    for (const [key, label] of Object.entries({
      pending: "Pending",
      claimed: "Claimed",
      owned: "Already owned",
      failed: "Failed",
      action: "Needs you"
    })) {
      const count = createElement("div", "count");
      const value = createElement("strong", "count-value", "0");
      const caption = createElement("span", "count-label", label);
      count.append(value, caption);
      summary.append(count);
      counts[key] = value;
    }

    const itemList = createElement("ul", "items");
    itemList.setAttribute("aria-label", "Items in the latest run");
    const empty = createElement("li", "empty", "No items scanned yet.");
    itemList.append(empty);
    const overflow = createElement("p", "overflow");
    overflow.hidden = true;

    const actions = createElement("div", "actions");
    const startButton = createElement("button", "button button-primary", "Start");
    startButton.type = "button";
    const stopButton = createElement("button", "button button-secondary", "Stop");
    stopButton.type = "button";
    const resumeButton = createElement("button", "button button-secondary", "Resume");
    resumeButton.type = "button";
    resumeButton.hidden = true;
    actions.append(startButton, stopButton, resumeButton);

    const footer = createElement("footer", "footer", "Claims use the visible site controls.");
    shell.append(header, liveStatus, summary, itemList, overflow, actions, footer);
    shadow.append(stylesheet, shell);
    document.documentElement.append(host);

    async function invoke(callback, button) {
      if (typeof callback !== "function") return;
      button.disabled = true;
      try {
        await callback();
      } catch (error) {
        liveStatus.textContent = error && typeof error.message === "string"
          ? error.message
          : "The extension could not complete that action.";
      } finally {
        button.disabled = false;
      }
    }

    startButton.addEventListener("click", () => invoke(onStart, startButton));
    stopButton.addEventListener("click", () => invoke(onStop, stopButton));
    resumeButton.addEventListener("click", () => invoke(onResume, resumeButton));

    const controller = {
      update(run) {
        if (!run || typeof run !== "object") return;
        state.textContent = run.state || "Ready";
        const items = Array.isArray(run.items) ? run.items : [];
        const tally = {
          pending: 0,
          claimed: 0,
          owned: 0,
          failed: 0,
          action: 0
        };
        for (const item of items) {
          if (item.state === "pending") tally.pending += 1;
          if (item.state === "claimed") tally.claimed += 1;
          if (item.state === "already-owned") tally.owned += 1;
          if (item.state === "failed") tally.failed += 1;
          if (item.state === "needs-user-action") tally.action += 1;
        }
        counts.pending.textContent = String(tally.pending);
        counts.claimed.textContent = String(tally.claimed);
        counts.owned.textContent = String(tally.owned);
        counts.failed.textContent = String(tally.failed);
        counts.action.textContent = String(tally.action);

        itemList.replaceChildren();
        const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
        if (visibleItems.length === 0) {
          itemList.append(createElement("li", "empty", "No items in this run."));
        }
        for (const item of visibleItems) {
          const row = createElement("li", "item");
          const copy = createElement("div", "item-copy");
          const itemTitle = createElement("strong", "item-title", item.title || "Untitled item");
          const detail = createElement("span", "item-detail", item.detail || item.state || "Pending");
          copy.append(itemTitle, detail);
          const badge = createElement("span", `item-state state-${item.state || "pending"}`, item.state || "pending");
          row.append(copy, badge);
          itemList.append(row);
        }
        overflow.hidden = items.length <= MAX_VISIBLE_ITEMS;
        overflow.textContent = `Showing ${MAX_VISIBLE_ITEMS} of ${items.length} items.`;
        liveStatus.textContent = `${items.length} items · ${tally.claimed} claimed · ${tally.action} need your attention.`;
        stopButton.disabled = run.state !== "running";
        resumeButton.hidden = !["paused", "stopped", "failed"].includes(run.state);
        startButton.disabled = run.state === "running" || run.state === "paused";
      },
      setMessage(message) {
        liveStatus.textContent = String(message || "");
      },
      destroy() {
        host.remove();
      }
    };

    host.__efarPanelController = controller;
    return controller;
  }

  api.ui.panel = Object.freeze({ mountPanel });
})(globalThis);
