const MODEL_URL = chrome.runtime.getURL("models/en-us-small.tar.gz");

const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const finalTextEl = document.getElementById("finalText");
const partialTextEl = document.getElementById("partialText");
const transcriptEl = document.getElementById("transcript");
const hintEl = document.getElementById("hint");
const dotEl = document.querySelector("[data-dot]");
const sandbox = document.getElementById("sandbox");

let localFinal = "";
let localPartial = "";
let mediaStream = null;
let audioContext = null;
let processorNode = null;
let silentGain = null;
let sourceNode = null;
let sandboxReady = false;
let modelReady = false;
let modelBuffer = null;
let capturingLocal = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  chrome.runtime
    .sendMessage({
      type: isError ? "CAPTURE_ERROR" : "CAPTURE_STATUS",
      text: isError ? undefined : text,
      error: isError ? text : undefined,
    })
    .catch(() => {});
}

function renderTranscript() {
  const hasText = Boolean(localFinal.trim() || localPartial.trim());
  transcriptEl.classList.toggle("show-placeholder", !hasText);
  finalTextEl.textContent = localFinal.trim() ? `${localFinal.trim()} ` : "";
  partialTextEl.textContent = localPartial.trim();
}

function setCapturingUi(capturing) {
  capturingLocal = capturing;
  dotEl.classList.toggle("live", capturing);
  shareBtn.disabled = capturing;
  stopBtn.disabled = !capturing;
}

function sendToSandbox(message, transfer = []) {
  sandbox.contentWindow?.postMessage(message, "*", transfer);
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
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Could not read local speech model (${response.status}).`);
  }
  modelBuffer = await response.arrayBuffer();
  return modelBuffer;
}

async function prepareModel() {
  await waitForSandboxReady();
  let copy = null;
  try {
    await ensureModelBuffer();
    copy = modelBuffer.slice(0);
  } catch (error) {
    console.warn(error);
  }

  if (copy) sendToSandbox({ type: "LOAD_MODEL", modelBuffer: copy }, [copy]);
  else sendToSandbox({ type: "LOAD_MODEL" });

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

/** Same-document desktopCapture consume (works; offscreen cannot use these IDs). */
function chooseDesktopStreamId() {
  return new Promise((resolve) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(
        ["screen", "window", "tab", "audio"],
        (streamId) => resolve(streamId || null)
      );
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });
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

async function getStreamViaDisplayMedia() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
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
  stream.getVideoTracks().forEach((track) => track.stop());
  return stream;
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
  audioTracks[0].addEventListener("ended", () => stopCapture(true));

  audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    if (!modelReady) return;
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

  setCapturingUi(true);
  setStatus("Capturing audio…");
  chrome.runtime.sendMessage({ type: "CAPTURE_STARTED" }).catch(() => {});
}

async function startCapture() {
  shareBtn.disabled = true;
  try {
    if (!modelReady) {
      setStatus("Loading local speech model…");
      await prepareModel();
    }

    setStatus("Choose what to share…");

    // Prefer getDisplayMedia (worked in the old session window).
    // Fall back to desktopCapture consumed in THIS same document (not offscreen).
    let stream = null;
    let lastError = null;

    try {
      stream = await getStreamViaDisplayMedia();
    } catch (error) {
      lastError = error;
      console.warn("[CallTogether] getDisplayMedia failed, trying desktopCapture", error);
      const streamId = await chooseDesktopStreamId();
      if (!streamId) {
        throw error?.name === "NotAllowedError"
          ? error
          : new Error("Share cancelled.");
      }
      stream = await getStreamFromDesktopId(streamId);
    }

    await startAudioPipeline(stream);
  } catch (error) {
    setCapturingUi(false);
    const message =
      error?.name === "NotAllowedError"
        ? "Share cancelled."
        : error?.message || "Could not start capture.";
    setStatus(message, true);
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
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  sendToSandbox({ type: "RESET" });
  setCapturingUi(false);
  setStatus(ended ? "Share ended." : "Stopped.");
  chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" }).catch(() => {});
}

shareBtn.addEventListener("click", () => {
  startCapture();
});

stopBtn.addEventListener("click", () => {
  stopCapture(false);
});

clearBtn.addEventListener("click", async () => {
  localFinal = "";
  localPartial = "";
  renderTranscript();
  await chrome.runtime.sendMessage({ type: "CLEAR_TRANSCRIPT" });
  setStatus("Cleared.");
});

window.addEventListener("message", (event) => {
  if (event.source !== sandbox.contentWindow) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "SANDBOX_READY") {
    sandboxReady = true;
    return;
  }
  if (data.type === "STATUS") {
    if (!capturingLocal) setStatus(data.text || "Working…");
    return;
  }
  if (data.type === "RESULT" && data.text) {
    chrome.runtime.sendMessage({ type: "TRANSCRIPT_CHUNK", text: data.text });
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
    setStatus(data.error || "Transcription error", true);
    chrome.runtime.sendMessage({
      type: "CAPTURE_ERROR",
      error: data.error || "Transcription error",
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "STATE_UPDATE") {
    if (typeof message.transcript === "string") localFinal = message.transcript;
    if (typeof message.partial === "string") localPartial = message.partial;
    renderTranscript();
    if (typeof message.capturing === "boolean") {
      setCapturingUi(message.capturing);
    }
    if (message.error) setStatus(message.error, true);
    else if (message.status && !capturingLocal) setStatus(message.status);
    return;
  }

  if (message?.type === "PANEL_START_CAPTURE") {
    // Started from toolbar — may lack user gesture; panel button is preferred.
    startCapture();
    return;
  }

  if (message?.type === "CAPTURE_PAGE_STOP" || message?.type === "STOP_CAPTURE") {
    stopCapture(false).then(() => sendResponse({ ok: true }));
    return true;
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

hintEl.textContent =
  "Enable audio in Chrome’s dialog · hotkey pastes into AI chat";
renderTranscript();
setStatus("Ready — choose a sound source");
setCapturingUi(false);
