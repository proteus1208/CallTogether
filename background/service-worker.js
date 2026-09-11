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
let scriptSessions = [];
let translatedSessions = [];
let translatedPartial = "";
/** Index into scriptSessions: sessions before this were already pasted. */
let pasteCheckpoint = 0;
let translateOpen = false;
let translateTarget = DEFAULT_SETTINGS.translateTarget;
let translateInFlight = false;
let translateQueued = false;
let liveTranslateTimer = null;
let liveTranslateBusy = false;
const LIVE_TRANSLATE_GAP_MS = 5000;

/** Hold Vosk finals briefly so a short pause does not split one speech session. */
let pendingSessionParts = [];
let sessionCloseTimer = null;
const SESSION_CLOSE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearSessionCloseTimer() {
  if (sessionCloseTimer) {
    clearTimeout(sessionCloseTimer);
    sessionCloseTimer = null;
  }
}

function heldSessionText() {
  return pendingSessionParts.join(" ").trim();
}

function composeLivePartial(live = "") {
  const held = heldSessionText();
  const next = String(live || "").trim();
  return [held, next].filter(Boolean).join(" ");
}

function scheduleSessionClose() {
  clearSessionCloseTimer();
  sessionCloseTimer = setTimeout(() => {
    sessionCloseTimer = null;
    finalizePendingSession().catch(() => {});
  }, SESSION_CLOSE_DELAY_MS);
}

async function finalizePendingSession() {
  clearSessionCloseTimer();
  const text = heldSessionText();
  pendingSessionParts = [];
  if (!text) return;

  transcript = transcript ? `${transcript} ${text}` : text;
  // Keep mid-session translation on screen until final translate finishes.
  stopLiveTranslate({ clearPartial: false });
  partial = "";
  utteranceEpoch += 1;
  appendScriptSession(text);
  await broadcastState();
  if (translateOpen) {
    translateSpeechSession(text).catch(() => {});
  }
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
  // No live partial / held session → already complete.
  if (!partial.trim() && !pendingSessionParts.length) return;

  await sendCaptureCommand("CAPTURE_PAGE_PAUSE");
  await sleep(80);
  await sendCaptureCommand("CAPTURE_PAGE_FLUSH");
  await sleep(200);

  // Paste/send should not wait the 1s grace — close any held session now.
  if (pendingSessionParts.length) {
    await finalizePendingSession();
  }

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
  if (pendingSessionParts.length) {
    await finalizePendingSession();
  }

  // Timeout fallback: promote leftover grey italic into final transcript.
  if (partial.trim()) {
    clearSessionCloseTimer();
    pendingSessionParts = [];
    const leftover = partial.trim();
    partial = "";
    transcript = transcript ? `${transcript} ${leftover}` : leftover;
    appendScriptSession(leftover);
    await broadcastState({ busy: actionBusy, status: "Speech session timed out" });
    if (translateOpen) {
      translateSpeechSession(leftover).catch(() => {});
    }
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

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function sessionsWordCount(sessions) {
  return sessions.reduce((sum, item) => sum + wordCount(item), 0);
}

function trimSessionsToWordLimit() {
  while (
    scriptSessions.length > 1 &&
    sessionsWordCount(scriptSessions) > SCRIPT_WORD_LIMIT
  ) {
    scriptSessions.shift();
    if (translatedSessions.length) translatedSessions.shift();
    pasteCheckpoint = Math.max(0, pasteCheckpoint - 1);
  }
  // Keep arrays aligned when translations lag behind.
  while (translatedSessions.length > scriptSessions.length) {
    translatedSessions.shift();
  }
  if (pasteCheckpoint > scriptSessions.length) {
    pasteCheckpoint = scriptSessions.length;
  }
}

function appendScriptSession(chunk) {
  const text = String(chunk || "").trim();
  if (!text) return;
  scriptSessions.push(text);
  trimSessionsToWordLimit();
}

function joinedScriptArchive() {
  return scriptSessions.join(" ").trim();
}

function joinedTranslatedText() {
  return translatedSessions.join(" ").trim();
}

function clearLiveTranslateTimer() {
  if (liveTranslateTimer) {
    clearTimeout(liveTranslateTimer);
    liveTranslateTimer = null;
  }
}

function stopLiveTranslate({ clearPartial = true } = {}) {
  clearLiveTranslateTimer();
  if (clearPartial) translatedPartial = "";
}

/** Schedule/continue live partial translate; timer starts after each request finishes. */
function armLiveTranslate() {
  if (!translateOpen || !partial.trim()) return;
  if (liveTranslateBusy || liveTranslateTimer) return;
  liveTranslateTimer = setTimeout(() => {
    liveTranslateTimer = null;
    runLivePartialTranslate().catch(() => {});
  }, LIVE_TRANSLATE_GAP_MS);
}

async function runLivePartialTranslate() {
  if (!translateOpen) return;
  const source = partial.trim();
  if (!source) {
    // Session may have just finalized — keep last mid translation until final lands.
    return;
  }
  if (liveTranslateBusy) return;

  liveTranslateBusy = true;
  try {
    const piece = (await translateWithGoogle(source, translateTarget)).trim();
    if (translateOpen && partial.trim()) {
      translatedPartial = piece || source;
      await broadcastState();
    }
  } catch {
    // Ignore transient live-translate failures.
  } finally {
    liveTranslateBusy = false;
    // Next tick only after this request finished.
    if (translateOpen && partial.trim()) {
      clearLiveTranslateTimer();
      liveTranslateTimer = setTimeout(() => {
        liveTranslateTimer = null;
        runLivePartialTranslate().catch(() => {});
      }, LIVE_TRANSLATE_GAP_MS);
    }
  }
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

/** Translate one finalized speech session and append (no full re-run). */
async function translateSpeechSession(chunk) {
  const source = String(chunk || "").trim();
  if (!translateOpen || !source) return;

  try {
    const piece = (await translateWithGoogle(source, translateTarget)).trim();
    translatedSessions.push(piece || source);
    trimSessionsToWordLimit();
    // Keep last mid-session translation visible until final is ready; clear only
    // when there is no newer live speech to show.
    if (!partial.trim() && !pendingSessionParts.length) {
      translatedPartial = "";
    }
    await broadcastState();
  } catch (error) {
    await broadcastState({
      error: error?.message || "Translation failed",
    });
  }
}

/** Full retranslate — newest sessions first so the latest chat updates fastest. */
async function retranslateAll() {
  if (translateInFlight) {
    translateQueued = true;
    return;
  }

  if (!scriptSessions.length) {
    translatedSessions = [];
    await broadcastState();
    return;
  }

  translateInFlight = true;
  try {
    const n = scriptSessions.length;
    // Preserve length; replace slots newest → oldest.
    if (translatedSessions.length !== n) {
      translatedSessions = scriptSessions.map(
        (_, i) => translatedSessions[i] || ""
      );
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const session = scriptSessions[i];
      const piece = (await translateWithGoogle(session, translateTarget)).trim();
      translatedSessions[i] = piece || session;
      await broadcastState({
        status: i === 0 ? "Translated" : `Translating… ${n - i}/${n}`,
      });
    }
    trimSessionsToWordLimit();
    await broadcastState({ status: "Translated" });
  } catch (error) {
    await broadcastState({
      error: error?.message || "Translation failed",
    });
  } finally {
    translateInFlight = false;
    if (translateQueued) {
      translateQueued = false;
      retranslateAll().catch(() => {});
    }
  }
}

async function consumeTranscriptText() {
  // Block while grey-italic partial speech is still running.
  await waitForLiveSpeechSession();

  const fresh = scriptSessions.slice(pasteCheckpoint).filter(Boolean);
  const text = fresh.join(" ").trim();
  pasteCheckpoint = scriptSessions.length;
  // Keep full archive; only advance the paste checkpoint (red line).
  transcript = joinedScriptArchive();
  lastPartialAt = 0;
  await broadcastState({ busy: actionBusy });
  return text;
}

chrome.runtime.onInstalled.addListener(async () => {
  const syncStored = await chrome.storage.sync.get(["hotkey"]);
  if (!syncStored.hotkey) {
    await chrome.storage.sync.set({ hotkey: DEFAULT_SETTINGS.hotkey });
  }
  const localStored = await chrome.storage.local.get(["translateTarget"]);
  if (!localStored.translateTarget) {
    await chrome.storage.local.set({
      translateTarget: DEFAULT_SETTINGS.translateTarget,
    });
  }
  // Drop any previously persisted chat/translation history.
  await chrome.storage.local.remove([
    "scriptArchive",
    "translatedText",
    "translateOpen",
    "scriptSessions",
    "translatedSessions",
  ]);
  await chrome.storage.local.set({
    floatingVisible: false,
  });
});

chrome.storage.local.get(["translateTarget"], (stored) => {
  if (stored?.translateTarget) translateTarget = stored.translateTarget;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.translateTarget?.newValue) {
    translateTarget = changes.translateTarget.newValue;
  }
});

async function broadcastState(extra = {}) {
  const payload = {
    type: "STATE_UPDATE",
    capturing,
    transcript,
    partial,
    busy: actionBusy,
    scriptSessions,
    translatedSessions,
    translatedPartial,
    pasteCheckpoint,
    scriptArchive: joinedScriptArchive(),
    translatedText: joinedTranslatedText(),
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
  clearSessionCloseTimer();
  pendingSessionParts = [];
  transcript = "";
  partial = "";
  scriptSessions = [];
  translatedSessions = [];
  pasteCheckpoint = 0;
  stopLiveTranslate({ clearPartial: true });
  await broadcastState();
  return { ok: true, transcript };
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === captureHostWindowId) {
    captureHostWindowId = null;
    if (capturing) {
      capturing = false;
      if (pendingSessionParts.length) {
        finalizePendingSession().catch(() => {});
      } else {
        partial = "";
        broadcastState({ status: "Capture window closed." });
      }
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
          scriptSessions,
          translatedSessions,
          translatedPartial,
          pasteCheckpoint,
          scriptArchive: joinedScriptArchive(),
          translatedText: joinedTranslatedText(),
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
        if (!translateOpen) stopLiveTranslate();
        await broadcastState({
          status: translateOpen ? "Translate open" : "Translate closed",
        });
        // On first open with existing speech, fill translation once.
        if (translateOpen && scriptSessions.length && !translatedSessions.length) {
          await retranslateAll();
        }
        if (translateOpen && partial.trim()) {
          armLiveTranslate();
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
        await chrome.storage.local.set({ translateTarget });
        stopLiveTranslate();
        await broadcastState({ status: "Updating translation…" });
        if (translateOpen) {
          await retranslateAll();
          if (partial.trim()) armLiveTranslate();
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
          // Hold finals for 1s; merge into one session if speech resumes.
          pendingSessionParts.push(chunk);
          utteranceEpoch += 1;
          lastPartialAt = Date.now();
          partial = heldSessionText();
          if (actionBusy) {
            await finalizePendingSession();
          } else {
            scheduleSessionClose();
            await broadcastState();
            if (translateOpen) armLiveTranslate();
          }
        }
        sendResponse({ ok: true });
        break;
      }
      case "TRANSCRIPT_PARTIAL": {
        const text = (message.text || "").trim();
        lastPartialAt = Date.now();
        if (pendingSessionParts.length) {
          if (text) {
            // Speech continued within the grace window — keep session open.
            clearSessionCloseTimer();
            partial = composeLivePartial(text);
            utteranceEpoch += 1;
            await broadcastState();
            if (translateOpen) armLiveTranslate();
          } else {
            // Vosk cleared partial after a final — keep held text as live session.
            partial = heldSessionText();
            await broadcastState();
          }
        } else {
          partial = text;
          if (partial) utteranceEpoch += 1;
          if (!partial) stopLiveTranslate();
          await broadcastState();
          if (partial) armLiveTranslate();
        }
        sendResponse({ ok: true });
        break;
      }
      case "CAPTURE_ERROR": {
        capturing = false;
        if (pendingSessionParts.length) {
          await finalizePendingSession();
        }
        partial = "";
        stopLiveTranslate();
        await broadcastState({ error: message.error || "Capture failed." });
        sendResponse({ ok: true });
        break;
      }
      case "CAPTURE_ENDED": {
        capturing = false;
        if (pendingSessionParts.length) {
          await finalizePendingSession();
        }
        partial = "";
        stopLiveTranslate();
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
