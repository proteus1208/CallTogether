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
const MIC_PERMISSION_URL = "permission/mic.html";

let capturing = false;
let transcript = "";
let partial = "";
let micWindowId = null;
let startAfterMicGrant = false;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  if (!stored.hotkey) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
  // When the extension is installed/enabled/updated, show the floating panel.
  await chrome.storage.local.set({ floatingVisible: true, panelCollapsed: false });
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
    reasons: ["USER_MEDIA"],
    justification: "Run Chrome Speech recognition with microphone access.",
  });
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

async function openMicPermissionWindow() {
  if (micWindowId != null) {
    try {
      await chrome.windows.update(micWindowId, { focused: true });
      return;
    } catch {
      micWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(MIC_PERMISSION_URL),
    type: "popup",
    width: 420,
    height: 280,
    focused: true,
  });
  micWindowId = win.id ?? null;
}

async function closeMicPermissionWindow() {
  if (micWindowId == null) return;
  try {
    await chrome.windows.remove(micWindowId);
  } catch {
    // already closed
  }
  micWindowId = null;
}

async function startSpeechInOffscreen() {
  await setupOffscreenDocument();
  const result = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START_SPEECH",
    target: "offscreen",
  });
  if (!result?.ok) {
    capturing = false;
    await broadcastState({
      error: result?.error || "Could not start speech recognition.",
    });
    return { ok: false, error: result?.error };
  }
  return { ok: true };
}

async function startListening() {
  const { micGranted } = await chrome.storage.local.get({ micGranted: false });

  if (!micGranted) {
    startAfterMicGrant = true;
    await broadcastState({
      error: "Allow microphone in the popup window (Chrome will ask).",
    });
    await openMicPermissionWindow();
    return { ok: true, needsPermission: true };
  }

  startAfterMicGrant = false;
  return startSpeechInOffscreen();
}

async function stopCapture() {
  capturing = false;
  partial = "";
  startAfterMicGrant = false;
  try {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_STOP_SPEECH",
      target: "offscreen",
    });
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

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === micWindowId) {
    micWindowId = null;
    if (startAfterMicGrant && !capturing) {
      startAfterMicGrant = false;
      broadcastState({
        error: "Microphone permission window closed before allowing access.",
      });
    }
  }
});

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
      case "START_LISTENING": {
        sendResponse(await startListening());
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
      case "MIC_GRANTED": {
        await chrome.storage.local.set({ micGranted: true });
        await closeMicPermissionWindow();
        if (startAfterMicGrant) {
          startAfterMicGrant = false;
          sendResponse(await startSpeechInOffscreen());
        } else {
          sendResponse({ ok: true });
        }
        break;
      }
      case "MIC_DENIED": {
        startAfterMicGrant = false;
        await chrome.storage.local.set({ micGranted: false });
        await broadcastState({
          error: message.error || "Microphone permission denied.",
        });
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
        if (message.error?.includes("permission") || message.error?.includes("Microphone")) {
          await chrome.storage.local.set({ micGranted: false });
        }
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
