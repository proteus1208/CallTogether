const DEFAULT_SETTINGS = {
  hotkey: {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    key: "v",
  },
};

const OFFSCREEN_URL = "offscreen/speech.html";

let capturing = false;
let transcript = "";
let partial = "";


chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  if (!stored.hotkey) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
  await chrome.storage.local.set({
    floatingVisible: true,
    panelCollapsed: false,
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
    await chrome.tabs.sendMessage(tab.id, message);
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
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Could not reach this tab.",
      };
    }
  }

  return { ok: true };
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
      case "PANEL_START_CAPTURE": {
        // Panel iframe also receives this runtime message and starts capture.
        // Just ensure the float is visible — do not rebroadcast (avoids loops).
        await chrome.storage.local.set({ floatingVisible: true });
        await sendToActiveHttpTab({ type: "SHOW_PANEL" });
        sendResponse({ ok: true });
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
      case "CAPTURE_STATUS": {
        await broadcastState({ status: message.text });
        sendResponse({ ok: true });
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
