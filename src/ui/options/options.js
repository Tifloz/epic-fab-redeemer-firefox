"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#settings-form");
  const status = document.querySelector("#save-status");
  const autoStart = document.querySelector("#auto-start");
  const delay = document.querySelector("#delay-ms");
  const fabLicense = document.querySelector("#fab-license");
  const saveButton = form.querySelector("button[type='submit']");

  async function load() {
    saveButton.disabled = true;
    status.textContent = "Loading settings…";
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_SETTINGS" });
      if (!response || !response.ok || !response.settings) throw new Error("Settings could not be loaded.");
      autoStart.checked = response.settings.autoStart === true;
      delay.value = String(response.settings.delayMs);
      fabLicense.value = response.settings.fabLicense;
      status.textContent = "Settings loaded.";
    } catch {
      status.textContent = "Could not load settings. Reload this page and try again.";
    } finally {
      saveButton.disabled = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const delayMs = Number(delay.value);
    if (!Number.isInteger(delayMs) || delayMs < 500 || delayMs > 10000) {
      status.textContent = "Delay must be a whole number from 500 to 10000 ms.";
      delay.focus();
      return;
    }
    if (!new Set(["personal", "professional"]).has(fabLicense.value)) {
      status.textContent = "Choose a valid Fab license preference.";
      fabLicense.focus();
      return;
    }

    saveButton.disabled = true;
    status.textContent = "Saving settings…";
    try {
      const response = await browser.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: { autoStart: autoStart.checked, delayMs, fabLicense: fabLicense.value }
      });
      if (!response || !response.ok) throw new Error("Settings could not be saved.");
      status.textContent = "Settings saved.";
    } catch {
      status.textContent = "Could not save settings. Check the values and try again.";
    } finally {
      saveButton.disabled = false;
    }
  });

  void load();
});
