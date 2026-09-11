const DEFAULT_SETTINGS = {
  hotkey: {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: "w",
  },
};

const OFFSCREEN_URL = "offscreen/speech.html";
const CAPTURE_HOST_URL = "capture/host.html";

let capturing = false;
let transcript = "";
let partial = "";
let captureHostWindowId = null;
let pendingStreamId = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    floatingVisible: false,
  });
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
        // ignore
      }
    })
  );
}

async function sendToActiveHttpTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab. Open your AI platform tab first." };
  }
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    return { ok: false, error: "Open a normal https AI page first." };
  }

  try {
    const result = await chrome.tabs.sendMessage(tab.id, message);
    return result && typeof result === "object" ? result : { ok: true };
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
      const result = await chrome.tabs.sendMessage(tab.id, message);
      return result && typeof result === "object" ? result : { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Could not reach this tab.",
      };
    }
  }
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "IFRAME_SCRIPTING"],
    justification:
      "Capture shared tab/system audio and run local speech recognition.",
  });
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

async function startCaptureWithStreamId(streamId) {
  await setupOffscreenDocument();
  const result = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START_CAPTURE",
    target: "offscreen",
    streamId,
  });

  if (!result?.ok) {
    capturing = false;
    await broadcastState({
      error: result?.error || "Could not start tab audio capture.",
    });
    return { ok: false, error: result?.error };
  }

  return { ok: true };
}

async function openCaptureHost(streamId = null) {
  if (streamId) pendingStreamId = streamId;

  if (captureHostWindowId != null) {
    try {
      await chrome.windows.update(captureHostWindowId, {
        focused: true,
        state: "fullscreen",
      });
      if (pendingStreamId) {
        const id = pendingStreamId;
        pendingStreamId = null;
        try {
          await chrome.runtime.sendMessage({
            type: "HOST_START_WITH_STREAM_ID",
            streamId: id,
          });
        } catch {
          pendingStreamId = id;
        }
      }
      return { ok: true };
    } catch {
      captureHostWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(CAPTURE_HOST_URL),
    type: "normal",
    state: "fullscreen",
    focused: true,
  });
  captureHostWindowId = win.id ?? null;
  return { ok: true };
}

async function hideCaptureHost(windowId = null) {
  const id = windowId ?? captureHostWindowId;
  if (id == null) return { ok: false, error: "No capture window." };
  captureHostWindowId = id;

  // Always park off-screen first (reliable). Then minimize when the WM allows it.
  try {
    await chrome.windows.update(id, {
      state: "normal",
      focused: false,
      width: 1,
      height: 1,
      left: -10000,
      top: -10000,
    });
  } catch {
    // ignore
  }

  try {
    await chrome.windows.update(id, { state: "minimized", focused: false });
  } catch {
    // ignore — off-screen park above is enough to keep capture alive quietly
  }

  return { ok: true };
}

async function closeCaptureHost() {
  if (captureHostWindowId == null) return;
  try {
    await chrome.windows.remove(captureHostWindowId);
  } catch {
    // already closed
  }
  captureHostWindowId = null;
}

async function stopCapture() {
  capturing = false;
  partial = "";
  try {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_STOP_CAPTURE",
      target: "offscreen",
    });
  } catch {
    // ignore
  }
  try {
    await chrome.runtime.sendMessage({ type: "CAPTURE_PAGE_STOP" });
  } catch {
    // ignore
  }
  await closeOffscreenDocument();
  await closeCaptureHost();
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
  if (windowId === captureHostWindowId) {
    captureHostWindowId = null;
    if (capturing) {
      capturing = false;
      partial = "";
      broadcastState({ status: "Capture window closed." });
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
      case "SHOW_PANEL": {
        await chrome.storage.local.set({ floatingVisible: true });
        sendResponse(await sendToActiveHttpTab({ type: "SHOW_PANEL" }));
        break;
      }
      case "HIDE_PANEL": {
        await chrome.storage.local.set({ floatingVisible: false });
        sendResponse(await sendToActiveHttpTab({ type: "HIDE_PANEL" }));
        break;
      }
      case "START_TAB_CAPTURE": {
        sendResponse(await startCaptureWithStreamId(message.streamId));
        break;
      }
      case "OPEN_CAPTURE_HOST": {
        sendResponse(await openCaptureHost(message.streamId || null));
        break;
      }
      case "HIDE_CAPTURE_HOST": {
        sendResponse(
          await hideCaptureHost(sender.tab?.windowId ?? captureHostWindowId)
        );
        break;
      }
      case "TAKE_PENDING_STREAM_ID": {
        const id = pendingStreamId;
        pendingStreamId = null;
        sendResponse({ streamId: id });
        break;
      }
      case "PANEL_START_CAPTURE": {
        await chrome.storage.local.set({ floatingVisible: true });
        await sendToActiveHttpTab({ type: "SHOW_PANEL" });
        sendResponse(await openCaptureHost(message.streamId || null));
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
      case "SUBMIT_TRANSCRIPT": {
        // Consume here so we never nest CONSUME inside a tab message round-trip.
        const text = [transcript, partial].filter(Boolean).join(" ").trim();
        transcript = "";
        partial = "";
        await broadcastState();
        if (!text) {
          sendResponse({ ok: true, sent: false, empty: true });
          break;
        }
        sendResponse(
          await sendToActiveHttpTab({
            type: "PASTE_TEXT",
            text,
            send: true,
          })
        );
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
      case "CAPTURE_STATUS": {
        await broadcastState({ status: message.text });
        sendResponse({ ok: true });
        break;
      }
      case "CAPTURE_STARTED": {
        capturing = true;
        await broadcastState();
        await hideCaptureHost(captureHostWindowId);
        // Some WMs ignore the first minimize right after getDisplayMedia.
        setTimeout(() => {
          hideCaptureHost(captureHostWindowId).catch(() => {});
        }, 400);
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
