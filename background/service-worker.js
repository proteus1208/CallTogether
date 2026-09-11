const CAPTURE_URL = "capture/capture.html";
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
let captureWindowId = null;

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

async function openCaptureWindow() {
  if (captureWindowId != null) {
    try {
      await chrome.windows.update(captureWindowId, { focused: true });
      return captureWindowId;
    } catch {
      captureWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(CAPTURE_URL),
    type: "popup",
    width: 440,
    height: 420,
    focused: true,
  });

  captureWindowId = win.id ?? null;
  return captureWindowId;
}

async function closeCaptureWindow() {
  if (captureWindowId == null) return;
  try {
    await chrome.windows.remove(captureWindowId);
  } catch {
    // already closed
  }
  captureWindowId = null;
}

async function startCapture() {
  transcript = "";
  partial = "";
  capturing = false;
  await broadcastState();
  await openCaptureWindow();
  return { ok: true, openedCaptureWindow: true };
}

async function stopCapture() {
  capturing = false;
  partial = "";
  try {
    await chrome.runtime.sendMessage({
      type: "CAPTURE_PAGE_STOP",
      target: "capture",
    });
  } catch {
    // capture page may already be closed
  }
  await closeCaptureWindow();
  await broadcastState();
  return { ok: true };
}

async function clearTranscript() {
  transcript = "";
  partial = "";
  await broadcastState();
  return { ok: true, transcript };
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === captureWindowId) {
    captureWindowId = null;
    if (capturing) {
      capturing = false;
      partial = "";
      broadcastState({ error: "Capture window closed." });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "GET_STATE": {
        sendResponse({ capturing, transcript, partial });
        break;
      }
      case "START_CAPTURE": {
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
        if (sender?.tab?.windowId != null) {
          captureWindowId = null;
        }
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
