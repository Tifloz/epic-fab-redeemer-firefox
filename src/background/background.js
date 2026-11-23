(function initBackground(global) {
  "use strict";

  const { MESSAGE, sanitizeRunRecord } = global.__efar.messages;
  const { loadSettings, saveSettings, isPlainObject } = global.__efar.config;

  function errorResponse(error) {
    const message = error instanceof Error ? error.message : "The extension could not complete that request.";
    return { ok: false, error: message };
  }

  async function handleMessage(message) {
    if (!isPlainObject(message) || typeof message.type !== "string") {
      return undefined;
    }

    try {
      switch (message.type) {
        case MESSAGE.GET_SETTINGS:
          return { ok: true, settings: await loadSettings() };

        case MESSAGE.SAVE_SETTINGS:
          return { ok: true, settings: await saveSettings(message.settings) };

        case MESSAGE.RUN_STATUS_UPDATED: {
          const run = sanitizeRunRecord(message.run);
          if (!run) {
            return { ok: false, error: "The run update was invalid." };
          }
          await browser.storage.local.set({ latestRun: run });
          return { ok: true };
        }

        case MESSAGE.GET_LATEST_RUN: {
          const result = await browser.storage.local.get("latestRun");
          const run = sanitizeRunRecord(result.latestRun);
          return { ok: true, run };
        }

        default:
          return undefined;
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  browser.runtime.onMessage.addListener((message) => handleMessage(message));
})(globalThis);
