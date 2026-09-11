const MODEL_URL = chrome.runtime.getURL("models/en-us-small.tar.gz");
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");

let mediaStream = null;
let audioContext = null;
let processorNode = null;
let silentGain = null;
let sourceNode = null;
let sandbox = null;
let sandboxReady = false;
let modelReady = false;
let modelBuffer = null;
let activeSttLanguage = "en";
let starting = false;
let audioPaused = false;

const STT_DB = "calltogether-stt";
const STT_STORE = "models";

function releaseMediaTracks() {
  if (!mediaStream) return;
  mediaStream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore
    }
  });
  mediaStream = null;
}

function openSttDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STT_DB, 1);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STT_STORE)) {
        db.createObjectStore(STT_STORE, { keyPath: "code" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function readInstalledModelBuffer(code) {
  const db = await openSttDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STT_STORE, "readonly");
    const req = tx.objectStore(STT_STORE).get(code);
    req.onsuccess = async () => {
      const row = req.result;
      if (!row?.buffer) {
        resolve(null);
        return;
      }
      // packVersion 2+ = tar wrapped for vosk stripFirstComponent
      if (row.packVersion !== 2) {
        resolve(null);
        return;
      }
      try {
        let buf = row.buffer;
        if (buf instanceof Blob) buf = await buf.arrayBuffer();
        else if (!(buf instanceof ArrayBuffer) && buf?.buffer) {
          buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }
        if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1000) {
          resolve(null);
          return;
        }
        const head = new Uint8Array(buf, 0, 2);
        if (head[0] !== 0x1f || head[1] !== 0x8b) {
          resolve(null);
          return;
        }
        resolve(buf);
      } catch (error) {
        reject(error);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function isCorruptModelError(error) {
  const msg = error?.message || String(error || "");
  return /missing or corrupt|needs reinstall|Re-add this language|failed to load|buffer is empty/i.test(
    msg
  );
}

async function reportCorruptModel(error) {
  if (!isCorruptModelError(error)) return false;
  if (!activeSttLanguage || activeSttLanguage === "en") return false;
  const msg = error?.message || String(error);
  try {
    await chrome.runtime.sendMessage({
      type: "STT_MODEL_CORRUPT",
      code: activeSttLanguage,
      error: msg,
    });
  } catch {
    // ignore
  }
  activeSttLanguage = "en";
  modelBuffer = null;
  modelReady = false;
  return true;
}

async function resolveModelBuffer(language = activeSttLanguage) {
  const code = language || "en";
  if (code === "en") {
    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`Could not read local speech model (${response.status}).`);
    }
    return response.arrayBuffer();
  }
  const cached = await readInstalledModelBuffer(code);
  if (!cached) {
    throw new Error(
      "Language model missing or corrupt. Remove it and click + to download again."
    );
  }
  return cached;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  // Don't broadcast cancel/errors that wipe UI while user is retrying.
  if (isError && /cancel/i.test(text)) return;
  chrome.runtime
    .sendMessage({
      type: isError ? "CAPTURE_ERROR" : "CAPTURE_STATUS",
      text: isError ? undefined : text,
      error: isError ? text : undefined,
    })
    .catch(() => {});
}

function sendToSandbox(message, transfer = []) {
  sandbox?.contentWindow?.postMessage(message, "*", transfer);
}

function ensureSandboxFrame() {
  if (sandbox) return sandbox;
  sandbox = document.createElement("iframe");
  sandbox.id = "sandbox";
  sandbox.src = chrome.runtime.getURL("sandbox/transcribe.html");
  sandbox.style.cssText = "display:none;width:0;height:0;border:0";
  sandbox.setAttribute("aria-hidden", "true");
  document.body.appendChild(sandbox);
  return sandbox;
}

function waitForSandboxReady() {
  if (sandboxReady) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (sandboxReady) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

async function ensureModelBuffer() {
  if (modelBuffer) return modelBuffer;
  modelBuffer = await resolveModelBuffer(activeSttLanguage);
  return modelBuffer;
}

async function prepareModel() {
  ensureSandboxFrame();
  await waitForSandboxReady();

  // Ask background for the active speech language.
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (state?.sttLanguage) activeSttLanguage = state.sttLanguage;
  } catch {
    // ignore
  }

  modelReady = false;
  modelBuffer = null;
  sendToSandbox({ type: "RESET" });

  let copy = null;
  try {
    await ensureModelBuffer();
    if (!(modelBuffer instanceof ArrayBuffer) || modelBuffer.byteLength < 1000) {
      throw new Error("Speech model buffer is empty. Re-add this language.");
    }
    copy = modelBuffer.slice(0);
  } catch (error) {
    console.warn(error);
    throw error;
  }

  // Always pass the resolved buffer — never omit it (omitting loads English only).
  sendToSandbox({ type: "LOAD_MODEL", modelBuffer: copy }, [copy]);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Speech model init timed out.")),
      120000
    );
    const onMessage = (event) => {
      if (event.source !== sandbox.contentWindow) return;
      const data = event.data;
      if (data?.type === "STATUS") {
        setStatus(data.text || "Loading model…");
        return;
      }
      if (data?.type === "MODEL_READY") {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        modelReady = true;
        resolve();
      }
      if (data?.type === "ERROR") {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        reject(new Error(data.error || "Model load failed."));
      }
    };
    window.addEventListener("message", onMessage);
  });
}

async function reloadSttModel(language) {
  if (language) activeSttLanguage = language;
  modelReady = false;
  modelBuffer = null;
  setStatus("Loading speech language…");
  try {
    await prepareModel();
    setStatus(mediaStream ? "Capturing…" : "Speech language ready.");
  } catch (error) {
    const msg = error?.message || "Could not load speech language";
    const purged = await reportCorruptModel(error);
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", true);
    // Avoid CAPTURE_ERROR here — that would stop an active share.
    if (!purged) {
      chrome.runtime
        .sendMessage({ type: "CAPTURE_STATUS", text: msg })
        .catch(() => {});
    }
  }
}

async function getStreamFromDesktopId(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
        maxWidth: 16,
        maxHeight: 16,
      },
    },
  });
  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
}

async function pickSoundStreamWithGesture() {
  // Must run from a real click in THIS window.
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    preferCurrentTab: false,
  });
}

async function hideHostWindow() {
  try {
    const win = await chrome.windows.getCurrent();
    if (!win?.id) {
      chrome.runtime.sendMessage({ type: "HIDE_CAPTURE_HOST" }).catch(() => {});
      return;
    }
    await chrome.windows.update(win.id, {
      state: "normal",
      focused: false,
      width: 1,
      height: 1,
      left: -10000,
      top: -10000,
    });
    try {
      await chrome.windows.update(win.id, { state: "minimized", focused: false });
    } catch {
      // ignore
    }
    // Retry once — share UI / fullscreen can undo the first hide.
    setTimeout(() => {
      chrome.windows
        .update(win.id, { state: "minimized", focused: false })
        .catch(() => {
          chrome.windows
            .update(win.id, {
              state: "normal",
              focused: false,
              width: 1,
              height: 1,
              left: -10000,
              top: -10000,
            })
            .catch(() => {});
        });
    }, 350);
  } catch {
    chrome.runtime.sendMessage({ type: "HIDE_CAPTURE_HOST" }).catch(() => {});
  }
}

async function startAudioPipeline(stream) {
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No audio track. Enable tab/system audio (Window share has no sound)."
    );
  }

  mediaStream = stream;
  mediaStream.getVideoTracks().forEach((track) => track.stop());
  audioTracks[0].addEventListener("ended", () => stopCapture(true));

  shareBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Capturing…");
  chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" }).catch(() => {});
  // Collapse as soon as share is chosen (before model load).
  await hideHostWindow();

  setStatus("Loading speech model…");
  if (!modelReady) await prepareModel();

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    if (!modelReady || audioPaused) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = new Float32Array(input);
    sendToSandbox(
      {
        type: "AUDIO",
        pcm,
        sampleRate: audioContext.sampleRate,
      },
      [pcm.buffer]
    );
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  setStatus("Capturing…");
}

async function startCapture({ streamId = null } = {}) {
  if (starting || mediaStream) return;
  starting = true;
  shareBtn.disabled = true;

  try {
    let stream;
    if (streamId) {
      setStatus("Connecting to shared audio…");
      try {
        stream = await getStreamFromDesktopId(streamId);
      } catch (error) {
        console.warn("[CallTogether] streamId attach failed", error);
        // Stream IDs from another frame sometimes fail — fall back to a
        // clickable getDisplayMedia in this top-level window.
        shareBtn.disabled = false;
        setStatus(
          "Click Choose sound source in this window to open the share dialog.",
          true
        );
        starting = false;
        return;
      }
    } else {
      setStatus("Choose what to share…");
      stream = await pickSoundStreamWithGesture();
    }
    await startAudioPipeline(stream);
  } catch (error) {
    shareBtn.disabled = false;
    stopBtn.disabled = true;
    const message =
      error?.name === "NotAllowedError"
        ? "Share cancelled — click Choose sound source again."
        : error?.message || "Could not start capture.";
    await reportCorruptModel(error);
    setStatus(message, true);
  } finally {
    starting = false;
  }
}

async function stopCapture(ended = false) {
  if (processorNode) {
    processorNode.onaudioprocess = null;
    try {
      processorNode.disconnect();
    } catch {
      // ignore
    }
    processorNode = null;
  }
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {
      // ignore
    }
    sourceNode = null;
  }
  if (silentGain) {
    try {
      silentGain.disconnect();
    } catch {
      // ignore
    }
    silentGain = null;
  }
  if (audioContext) {
    try {
      await audioContext.close();
    } catch {
      // ignore
    }
    audioContext = null;
  }
  releaseMediaTracks();
  sendToSandbox({ type: "RESET" });
  shareBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus(ended ? "Share ended." : "Stopped.");
  chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" }).catch(() => {});
}

shareBtn.addEventListener("click", () => {
  startCapture();
});

stopBtn.addEventListener("click", () => {
  stopCapture(false);
});

window.addEventListener("message", (event) => {
  if (!sandbox || event.source !== sandbox.contentWindow) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SANDBOX_READY") {
    sandboxReady = true;
    return;
  }
  if (data.type === "STATUS") {
    setStatus(data.text || "Working…");
    return;
  }
  if (data.type === "RESULT" && data.text) {
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text: data.text });
    // End the live (grey italic) session explicitly.
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_PARTIAL", text: "" });
    return;
  }
  if (data.type === "PARTIAL") {
    chrome.runtime.sendMessage({
      type: "TRANSCRIPT_PARTIAL",
      text: data.text || "",
    });
    return;
  }
  if (data.type === "ERROR") {
    const err = data.error || "Transcription error";
    reportCorruptModel(new Error(err)).then((purged) => {
      if (purged) {
        statusEl.textContent = err;
        statusEl.classList.add("error");
        return;
      }
      setStatus(err, true);
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_PAGE_STOP" || message?.type === "STOP_CAPTURE") {
    stopCapture(false).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "CAPTURE_PAGE_PAUSE") {
    audioPaused = true;
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "CAPTURE_PAGE_RESUME") {
    audioPaused = false;
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "CAPTURE_PAGE_FLUSH") {
    sendToSandbox({ type: "FLUSH" });
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "HOST_START_WITH_STREAM_ID") {
    startCapture({ streamId: message.streamId }).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  if (message?.type === "HOST_RELOAD_STT_MODEL") {
    reloadSttModel(message.language).then(() => sendResponse({ ok: true }));
    return true;
  }
});

(async () => {
  setStatus("Click Choose sound source");
})();

// Ensure Chrome's "Stop sharing" bar goes away when this host is closed.
window.addEventListener("pagehide", () => {
  releaseMediaTracks();
});
window.addEventListener("beforeunload", () => {
  releaseMediaTracks();
});
