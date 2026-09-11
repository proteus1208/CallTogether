const DEFAULT_SETTINGS = {
  hotkey: {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: "w",
  },
  translateTarget: "zh-CN",
};

const OFFSCREEN_URL = "offscreen/speech.html";
const CAPTURE_HOST_URL = "capture/host.html";
const SCRIPT_WORD_LIMIT = 1000;

let capturing = false;
let transcript = "";
let partial = "";
let captureHostWindowId = null;
let pendingStreamId = null;
let lastPartialAt = 0;
let utteranceEpoch = 0;
let actionBusy = false;
let scriptArchive = "";
let translatedText = "";
let translateOpen = false;
let translateTarget = DEFAULT_SETTINGS.translateTarget;
let translateTimer = null;
let translateInFlight = false;
let translateQueued = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCaptureCommand(type) {
  try {
    await chrome.runtime.sendMessage({ type });
  } catch {
    // capture host may be closed
  }
}

/**
 * Grey italic text = live partial session.
 * Wait until that session finalizes (partial cleared) before paste/send.
 */
async function waitForLiveSpeechSession({ timeoutMs = 30000 } = {}) {
  // No live partial → current session already complete.
  if (!partial.trim()) return;

  await sendCaptureCommand("CAPTURE_PAGE_PAUSE");
  await sleep(80);
  await sendCaptureCommand("CAPTURE_PAGE_FLUSH");

  const start = Date.now();
  let lastFlushAt = Date.now();

  while (partial.trim() && Date.now() - start < timeoutMs) {
    // Keep asking Vosk to finalize; do NOT proceed while grey italic remains.
    if (Date.now() - lastFlushAt >= 1000) {
      await sendCaptureCommand("CAPTURE_PAGE_FLUSH");
      lastFlushAt = Date.now();
    }
    await sleep(100);
  }

  // Allow a late RESULT to land after partial clears.
  await sleep(200);

  // Timeout fallback: promote leftover grey italic into final transcript.
  if (partial.trim()) {
    const leftover = partial.trim();
    partial = "";
    transcript = transcript ? `${transcript} ${leftover}` : leftover;
    appendScriptArchive(leftover);
    await persistTranslationState();
    await broadcastState({ busy: actionBusy, status: "Speech session timed out" });
    scheduleTranslation();
  }

  await sendCaptureCommand("CAPTURE_PAGE_RESUME");
}

async function setActionBusy(busy, status) {
  actionBusy = !!busy;
  await broadcastState({
    busy: actionBusy,
    ...(status ? { status } : {}),
  });
}

function trimToLastWords(text, maxWords = SCRIPT_WORD_LIMIT) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(-maxWords).join(" ");
}

function appendScriptArchive(chunk) {
  const next = [scriptArchive, chunk].filter(Boolean).join(" ").trim();
  scriptArchive = trimToLastWords(next);
}

async function persistTranslationState() {
  await chrome.storage.local.set({
    scriptArchive,
    translatedText,
    translateOpen,
  });
}

async function translateWithGoogle(text, target = translateTarget) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";

  const tl = target || "zh-CN";
  const words = trimmed.split(/\s+/).filter(Boolean);
  const chunks = [];
  let buf = [];
  for (const word of words) {
    const next = buf.length ? `${buf.join(" ")} ${word}` : word;
    if (next.length > 450 && buf.length) {
      chunks.push(buf.join(" "));
      buf = [word];
    } else {
      buf.push(word);
    }
  }
  if (buf.length) chunks.push(buf.join(" "));

  const parts = [];
  for (const chunk of chunks) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", tl);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Translate failed (${response.status})`);
    }
    const data = await response.json();
    if (!Array.isArray(data?.[0])) continue;
    parts.push(
      data[0]
        .map((row) => (Array.isArray(row) ? row[0] : ""))
        .filter(Boolean)
        .join("")
    );
  }
  return parts.join("");
}

async function refreshTranslation({ force = false } = {}) {
  if (!translateOpen && !force) return;
  if (translateInFlight) {
    translateQueued = true;
    return;
  }

  const source = trimToLastWords(scriptArchive);
  if (!source) {
    translatedText = "";
    await persistTranslationState();
    await broadcastState();
    return;
  }

  translateInFlight = true;
  try {
    translatedText = await translateWithGoogle(source, translateTarget);
    await persistTranslationState();
    await broadcastState({ status: translateOpen ? "Translated" : undefined });
  } catch (error) {
    await broadcastState({
      error: error?.message || "Translation failed",
    });
  } finally {
    translateInFlight = false;
    if (translateQueued) {
      translateQueued = false;
      scheduleTranslation(120);
    }
  }
}

function scheduleTranslation(delayMs = 450) {
  if (!translateOpen) return;
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => {
    refreshTranslation().catch(() => {});
  }, delayMs);
}

async function consumeTranscriptText() {
  // Block while grey-italic partial speech is still running.
  await waitForLiveSpeechSession();

  const text = [transcript, partial].filter(Boolean).join(" ").trim();
  transcript = "";
  partial = "";
  lastPartialAt = 0;
  // Keep scriptArchive + translatedText (not cleared on paste/send).
  await broadcastState({ busy: actionBusy });
  return text;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    floatingVisible: false,
  });
});

chrome.storage.sync.get(["translateTarget"], (stored) => {
  if (stored?.translateTarget) translateTarget = stored.translateTarget;
});

chrome.storage.local.get(
  ["scriptArchive", "translatedText", "translateOpen"],
  (stored) => {
    if (typeof stored.scriptArchive === "string") {
      scriptArchive = trimToLastWords(stored.scriptArchive);
    }
    if (typeof stored.translatedText === "string") {
      translatedText = stored.translatedText;
    }
    if (typeof stored.translateOpen === "boolean") {
      translateOpen = stored.translateOpen;
    }
  }
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.translateTarget?.newValue) {
    translateTarget = changes.translateTarget.newValue;
    scheduleTranslation(100);
  }
});

async function broadcastState(extra = {}) {
  const payload = {
    type: "STATE_UPDATE",
    capturing,
    transcript,
    partial,
    busy: actionBusy,
    scriptArchive,
    translatedText,
    translateOpen,
    translateTarget,
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
        sendResponse({
          capturing,
          transcript,
          partial,
          busy: actionBusy,
          scriptArchive,
          translatedText,
          translateOpen,
          translateTarget,
        });
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
      case "TOGGLE_TRANSLATE": {
        translateOpen = message.open ?? !translateOpen;
        await persistTranslationState();
        await broadcastState({
          status: translateOpen ? "Translate open" : "Translate closed",
        });
        if (translateOpen) {
          await refreshTranslation({ force: true });
        }
        sendResponse({ ok: true, translateOpen });
        break;
      }
      case "SET_TRANSLATE_TARGET": {
        const next = String(message.target || "").trim();
        if (!next) {
          sendResponse({ ok: false, error: "Missing language." });
          break;
        }
        translateTarget = next;
        await chrome.storage.sync.set({ translateTarget });
        await broadcastState({ status: "Updating translation…" });
        if (translateOpen) {
          await refreshTranslation({ force: true });
        }
        sendResponse({ ok: true, translateTarget });
        break;
      }
      case "SUBMIT_TRANSCRIPT": {
        await setActionBusy(true, "Waiting for speech…");
        try {
          const text = await consumeTranscriptText();
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
        } finally {
          await setActionBusy(false);
        }
        break;
      }
      case "CONSUME_TRANSCRIPT": {
        await setActionBusy(true, "Waiting for speech…");
        try {
          const text = await consumeTranscriptText();
          sendResponse({ ok: true, text });
        } finally {
          await setActionBusy(false);
        }
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
          utteranceEpoch += 1;
          appendScriptArchive(chunk);
          await persistTranslationState();
          await broadcastState();
          scheduleTranslation();
        }
        sendResponse({ ok: true });
        break;
      }
      case "TRANSCRIPT_PARTIAL": {
        partial = (message.text || "").trim();
        lastPartialAt = Date.now();
        if (partial) utteranceEpoch += 1;
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
