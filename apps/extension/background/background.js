/**
 * background/background.js
 * Service worker: relays messages between popup <-> content script, calls PriceHawk API.
 */

const DEFAULT_API_BASE = "https://price-hawk.store/api/extension";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "extensionApiKey"]);
  return {
    apiBase: (stored.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
    apiKey: stored.extensionApiKey || "",
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (err) {
    console.warn("[PH] Content script not ready:", err.message);
  }
}

async function callExtensionApi(endpoint, payload) {
  const { apiBase, apiKey } = await getConfig();
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-Extension-Key"] = apiKey;
  }

  const res = await fetch(`${apiBase}/${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP ${res.status}`);
  }
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tab = await getActiveTab();

    switch (msg.type) {
      case "START_PICKER": {
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ["content/content.js"],
          })
          .catch(() => {});
        await sendToContent(tab.id, { type: "START_PICKER", mode: msg.mode });
        sendResponse({ ok: true });
        break;
      }

      case "STOP_PICKER": {
        await sendToContent(tab.id, { type: "STOP_PICKER" });
        sendResponse({ ok: true });
        break;
      }

      case "NAME_SELECTED": {
        await chrome.storage.local.set({ selectedName: msg.rawName });
        chrome.runtime.sendMessage({ type: "NAME_SELECTED", rawName: msg.rawName }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case "PRICE_SELECTED": {
        await chrome.storage.local.set({
          selectedPrice: msg.price,
          selectedPriceRaw: msg.rawText,
        });
        chrome.runtime
          .sendMessage({ type: "PRICE_SELECTED", price: msg.price, rawText: msg.rawText })
          .catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case "PRICE_PARSE_ERROR": {
        chrome.runtime
          .sendMessage({ type: "PRICE_PARSE_ERROR", rawText: msg.rawText })
          .catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case "PICKER_CANCELLED": {
        chrome.runtime.sendMessage({ type: "PICKER_CANCELLED" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case "COMPARE": {
        try {
          const data = await callExtensionApi("compare", {
            name: msg.name,
            price: msg.price,
            sourceUrl: msg.sourceUrl,
            brand: msg.brand || null,
            category: msg.category || null,
          });
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "SAVE": {
        try {
          const data = await callExtensionApi("save", {
            name: msg.name,
            price: msg.price,
            sourceUrl: msg.sourceUrl,
            brand: msg.brand || null,
            category: msg.category || null,
          });
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();

  return true;
});
