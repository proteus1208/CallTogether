const MODEL_URL = chrome.runtime.getURL("models/en-us-small.tar.gz");
const MODEL_CACHE = "calltogether-model-v1";
const MODEL_CACHE_KEY = MODEL_URL;
const INIT_TIMEOUT_MS = 120_000;

let mediaStream = null;
let audioContext = null;
let processorNode = null;
let silentGain = null;
let sourceNode = null;
let voskModel = null;
let modelBlobUrl = null;
let recognizer = null;
let localFinal = "";
let localPartial = "";
let modelReady = false;
let modelLoading = null;

const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const finalTextEl = document.getElementById("finalText");
const partialTextEl = document.getElementById("partialText");
const transcriptEl = document.getElementById("transcript");
const hintEl = document.getElementById("hint");
const dotEl = document.querySelector("[data-dot]");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressPct = document.getElementById("progressPct");
const progressStage = document.getElementById("progressStage");
const progressDetail = document.getElementById("progressDetail");

const platform = detectPlatform();

function detectPlatform() {
  const uaPlatform = navigator.userAgentData?.platform || navigator.platform || "";
  const ua = `${uaPlatform} ${navigator.userAgent}`.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux") || ua.includes("cros")) return "linux";
  return "unknown";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function setProgress({
  visible = true,
  stage = "",
  percent = null,
  detail = "",
  indeterminate = false,
} = {}) {
  progressWrap.hidden = !visible;
  if (!visible) return;
  if (stage) progressStage.textContent = stage;
  progressDetail.textContent = detail || "";
  progressFill.classList.toggle("indeterminate", indeterminate);
  if (indeterminate || percent == null) {
    progressPct.textContent = indeterminate ? "…" : "";
    if (!indeterminate && percent == null) {
      progressFill.style.width = "0%";
    }
    return;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  progressFill.style.width = `${clamped}%`;
  progressPct.textContent = `${clamped}%`;
}

function hideProgress() {
  setProgress({ visible: false });
}

function renderTranscript() {
  const hasText = Boolean(localFinal.trim() || localPartial.trim());
  transcriptEl.classList.toggle("show-placeholder", !hasText);
  finalTextEl.textContent = localFinal.trim() ? `${localFinal.trim()} ` : "";
  partialTextEl.textContent = localPartial.trim();
}

function setCapturingUi(capturing) {
  dotEl.classList.toggle("live", capturing);
  shareBtn.disabled = capturing || !modelReady;
  stopBtn.disabled = !capturing;
}

function updatePlatformHint() {
  if (platform === "windows") {
    hintEl.textContent =
      "Windows: Share a screen/window and enable “Share system audio”, or a Chrome tab with tab audio.";
  } else if (platform === "macos") {
    hintEl.textContent =
      "macOS: Prefer sharing a Chrome tab with “Share tab audio” (system audio is limited).";
  } else {
    hintEl.textContent =
      "Share a Chrome tab with audio, or a screen if system audio is available.";
  }
}

async function readCachedModel() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(MODEL_CACHE_KEY);
    if (!hit || !hit.ok) return null;
    return hit;
  } catch {
    return null;
  }
}

async function writeCachedModel(buffer) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(
      MODEL_CACHE_KEY,
      new Response(buffer, {
        headers: { "Content-Type": "application/gzip" },
      })
    );
  } catch (error) {
    console.warn("Model cache write failed", error);
  }
}

async function fetchModelWithProgress() {
  const cached = await readCachedModel();
  if (cached) {
    setProgress({
      visible: true,
      stage: "Using cached model",
      percent: 100,
      detail: "Loaded from local cache",
    });
    return cached.arrayBuffer();
  }

  setProgress({
    visible: true,
    stage: "Reading model file",
    percent: 0,
    detail: "Fetching packaged speech model…",
  });

  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Model fetch failed (${response.status}). Reload the extension.`);
  }

  const total = Number(response.headers.get("Content-Length")) || 0;
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    setProgress({
      visible: true,
      stage: "Reading model file",
      percent: 100,
      detail: formatBytes(buffer.byteLength),
    });
    await writeCachedModel(buffer);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const percent = total ? (received / total) * 100 : null;
    setProgress({
      visible: true,
      stage: "Reading model file",
      percent: percent ?? Math.min(95, received / (1024 * 1024) * 2),
      detail: total
        ? `${formatBytes(received)} / ${formatBytes(total)}`
        : `${formatBytes(received)} read`,
    });
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  setProgress({
    visible: true,
    stage: "Reading model file",
    percent: 100,
    detail: `${formatBytes(received)} ready`,
  });

  await writeCachedModel(buffer.buffer);
  return buffer.buffer;
}

function loadVoskFromBlobUrl(blobUrl) {
  return new Promise((resolve, reject) => {
    if (!globalThis.Vosk?.Model) {
      reject(new Error("Vosk library failed to load."));
      return;
    }

    const startedAt = Date.now();
    const model = new globalThis.Vosk.Model(blobUrl, 0);
    let settled = false;

    const tick = setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      setProgress({
        visible: true,
        stage: "Initializing speech engine",
        indeterminate: true,
        detail: `Unpacking + WASM startup… ${secs}s (often 15–60s on Windows)`,
      });
    }, 500);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      reject(
        new Error(
          "Speech engine init timed out. Reload the AI tab and try again. If it keeps hanging, reload the extension."
        )
      );
    }, INIT_TIMEOUT_MS);

    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      clearTimeout(timeout);
      if (ok) resolve(model);
      else reject(error || new Error("Speech model failed to initialize."));
    };

    model.on("load", (message) => {
      const ok = message?.result ?? message?.detail?.result;
      if (ok) finish(true);
      else finish(false, new Error("Vosk reported model load failure."));
    });

    model.on("error", (message) => {
      const err =
        message?.error ||
        message?.detail?.error ||
        "Unknown Vosk worker error while loading model.";
      finish(false, new Error(String(err)));
    });
  });
}

async function ensureModel() {
  if (voskModel && modelReady) return voskModel;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    shareBtn.disabled = true;
    setStatus("Loading speech model…");

    const buffer = await fetchModelWithProgress();
    if (modelBlobUrl) {
      URL.revokeObjectURL(modelBlobUrl);
    }
    const blob = new Blob([buffer], { type: "application/gzip" });
    modelBlobUrl = URL.createObjectURL(blob);

    setProgress({
      visible: true,
      stage: "Initializing speech engine",
      indeterminate: true,
      detail: `Platform: ${platform}. First init can take a minute…`,
    });

    voskModel = await loadVoskFromBlobUrl(modelBlobUrl);
    modelReady = true;
    hideProgress();
    setStatus("Model ready — click Share audio.");
    shareBtn.disabled = false;
    return voskModel;
  })()
    .catch((error) => {
      modelReady = false;
      voskModel = null;
      setProgress({
        visible: true,
        stage: "Model load failed",
        percent: 0,
        detail: error?.message || String(error),
      });
      setStatus(error?.message || String(error), true);
      shareBtn.disabled = true;
      throw error;
    })
    .finally(() => {
      modelLoading = null;
    });

  return modelLoading;
}

function chooseDesktopStreamId() {
  return new Promise((resolve) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(
        ["tab", "window", "screen", "audio"],
        (streamId) => resolve(streamId || null)
      );
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });
}

async function getDesktopAudioStream(streamId) {
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
        maxWidth: 320,
        maxHeight: 180,
      },
    },
  });
  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
}

async function getDisplayMediaAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
  });
  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
}

async function acquireAudioStream() {
  // Windows has the best system-audio path via getDisplayMedia.
  // macOS/Linux usually work better with Chrome tab audio.
  const preferDisplayMedia = platform === "windows";

  const tryDisplayMedia = async () => {
    setStatus(
      platform === "windows"
        ? "Windows share picker… enable “Share system audio” or tab audio"
        : "Share picker… enable tab/system audio"
    );
    const stream = await getDisplayMediaAudio();
    return { stream, mode: "getDisplayMedia" };
  };

  const tryDesktopCapture = async () => {
    setStatus("Extension capture picker… enable audio");
    const streamId = await chooseDesktopStreamId();
    if (!streamId) return { cancelled: true };
    const stream = await getDesktopAudioStream(streamId);
    return { stream, mode: "desktopCapture" };
  };

  if (preferDisplayMedia) {
    try {
      return await tryDisplayMedia();
    } catch (error) {
      if (error?.name === "NotAllowedError") return { cancelled: true };
      console.warn("getDisplayMedia failed, falling back", error);
      try {
        return await tryDesktopCapture();
      } catch (fallbackError) {
        if (fallbackError?.cancelled) return fallbackError;
        throw fallbackError;
      }
    }
  }

  if (chrome.desktopCapture?.chooseDesktopMedia) {
    try {
      const result = await tryDesktopCapture();
      if (result?.cancelled || result?.stream) return result;
    } catch (error) {
      console.warn("desktopCapture failed, falling back", error);
    }
  }

  try {
    return await tryDisplayMedia();
  } catch (error) {
    if (error?.name === "NotAllowedError") return { cancelled: true };
    throw error;
  }
}

async function startCapture() {
  shareBtn.disabled = true;
  try {
    await ensureModel();
  } catch (error) {
    const message = error?.message || String(error);
    setStatus(message, true);
    shareBtn.disabled = !modelReady;
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  let acquired;
  try {
    acquired = await acquireAudioStream();
  } catch (error) {
    const message =
      error?.message ||
      "Could not capture audio. On Windows, share a screen with system audio or a Chrome tab with audio.";
    setStatus(message, true);
    shareBtn.disabled = false;
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  if (acquired?.cancelled) {
    setStatus("Share cancelled.", true);
    shareBtn.disabled = false;
    return;
  }

  mediaStream = acquired.stream;

  const audioTracks = mediaStream.getAudioTracks();
  if (!audioTracks.length) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    const message =
      platform === "windows"
        ? "No audio track. In the picker, enable “Share system audio” (screen) or tab audio."
        : "No audio track. Enable tab/system audio in the picker.";
    setStatus(message, true);
    shareBtn.disabled = false;
    await chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", error: message });
    return;
  }

  audioTracks[0].addEventListener("ended", async () => {
    setStatus("Audio share ended.");
    await stopCapture({ notifyEnded: true });
  });

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  recognizer = new voskModel.KaldiRecognizer(audioContext.sampleRate);
  recognizer.setWords(true);

  recognizer.on("result", (message) => {
    const text = (message?.result?.text || "").trim();
    if (!text) return;
    localFinal = localFinal ? `${localFinal} ${text}` : text;
    localPartial = "";
    renderTranscript();
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text });
    setStatus(`Heard: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
  });

  recognizer.on("partialresult", (message) => {
    const text = (message?.result?.partial || "").trim();
    localPartial = text;
    renderTranscript();
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_PARTIAL", text });
  });

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    try {
      recognizer.acceptWaveform(event.inputBuffer);
    } catch (error) {
      console.error("acceptWaveform failed", error);
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  setCapturingUi(true);
  setStatus(`Listening (${acquired.mode}, ${platform})… stay on this AI tab.`);
  await chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" });
}

async function stopCapture({ notifyEnded = false } = {}) {
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

  if (recognizer) {
    try {
      recognizer.remove();
    } catch {
      // ignore
    }
    recognizer = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  setCapturingUi(false);
  shareBtn.disabled = !modelReady;
  setStatus(modelReady ? "Stopped." : "Model not ready.");

  if (notifyEnded) {
    await chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  }
}

shareBtn.addEventListener("click", () => {
  startCapture();
});

stopBtn.addEventListener("click", async () => {
  await stopCapture({ notifyEnded: true });
});

clearBtn.addEventListener("click", async () => {
  localFinal = "";
  localPartial = "";
  renderTranscript();
  await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  setStatus("Cleared.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target && message.target !== "capture" && message.target !== "panel") {
    return;
  }

  if (message?.type === "CAPTURE_PAGE_STOP") {
    stopCapture({ notifyEnded: false }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "STATE_UPDATE") {
    if (typeof message.transcript === "string") {
      localFinal = message.transcript;
    }
    if (typeof message.partial === "string") {
      localPartial = message.partial;
    }
    renderTranscript();
    setCapturingUi(!!message.capturing);
    if (message.error) setStatus(message.error, true);
  }
});

chrome.runtime
  .sendMessage({ type: "GET_STATE" })
  .then((state) => {
    if (!state) return;
    localFinal = state.transcript || "";
    localPartial = state.partial || "";
    renderTranscript();
    setCapturingUi(!!state.capturing);
  })
  .catch(() => {});

updatePlatformHint();
renderTranscript();
setStatus(`Detected ${platform}. Preparing speech model…`);
ensureModel().catch(() => {
  // error already surfaced in UI
});
