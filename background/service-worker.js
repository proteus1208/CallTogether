const DEFAULT_SETTINGS = {
  hotkey: {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    key: "v",
  },
};

let capturing = false;
let transcript = "";
let partial = "";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  if (!stored.hotkey) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});

async function broadcastState(extra = {}) {
  const payload = {
    type: "STATE_UPDATE",
    capturing,
    transcript,
    partial,
    ...extra,
  };

  await chrome.storage.session.set({ capturing, transcript, partial });

  try {
    await chrome.runtime.sendMessage(payload);
  } catch {
    // no listeners
  }

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, payload);
      } catch {
        // content script may be missing on this tab
      }
    })
  );
}

async function showPanelOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab. Open your AI platform tab first." };
  }
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    return {
      ok: false,
      error: "Open a normal https AI page (ChatGPT, Claude, etc.), then Start.",
    };
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SHOW_PANEL" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content/content.css"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "SHOW_PANEL" });
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Could not inject panel into this tab.",
      };
    }
  }

  return { ok: true };
}

async function startCapture() {
  // Do not open a separate window — only reveal the in-page floating panel.
  transcript = "";
  partial = "";
  capturing = false;
  await broadcastState();
  return showPanelOnActiveTab();
}

async function stopCapture() {
  capturing = false;
  partial = "";
  try {
    await chrome.runtime.sendMessage({
      type: "CAPTURE_PAGE_STOP",
      target: "panel",
    });
  } catch {
    // panel may not be listening
  }
  await broadcastState();
  return { ok: true };
}

async function clearTranscript() {
  transcript = "";
  partial = "";
  await broadcastState();
  return { ok: true, transcript };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "GET_STATE": {
        sendResponse({ capturing, transcript, partial });
        break;
      }
      case "START_CAPTURE":
      case "SHOW_PANEL": {
        sendResponse(await startCapture());
        break;
      }
      case "STOP_CAPTURE": {
        sendResponse(await stopCapture());
        break;
      }
      case "CLEAR_TRANSCRIPT": {
        sendResponse(await clearTranscript());
        break;
      }
      case "CONSUME_TRANSCRIPT": {
        const text = [transcript, partial].filter(Boolean).join(" ").trim();
        transcript = "";
        partial = "";
        await broadcastState();
        sendResponse({ ok: true, text });
        break;
      }
      case "CAPTURE_STARTED": {
        capturing = true;
        await broadcastState();
        sendResponse({ ok: true });
        break;
      }
      case "TRANSCRIPT_CHUNK": {
        const chunk = (message.text || "").trim();
        if (chunk) {
          transcript = transcript ? `${transcript} ${chunk}` : chunk;
          partial = "";
          await broadcastState();
        }
        sendResponse({ ok: true });
        break;
      }
      case "TRANSCRIPT_PARTIAL": {
        partial = (message.text || "").trim();
        await broadcastState();
        sendResponse({ ok: true });
        break;
      }
      case "CAPTURE_ERROR": {
        capturing = false;
        partial = "";
        await broadcastState({ error: message.error || "Capture failed." });
        sendResponse({ ok: true });
        break;
      }
      case "CAPTURE_ENDED": {
        capturing = false;
        partial = "";
        await broadcastState();
        sendResponse({ ok: true });
        break;
      }
      case "OPEN_OPTIONS": {
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })();
  return true;
});
